import { hashPayload, mapErpRecord, MappingError } from "./mapping.ts";
import {
  isInboundSupported,
  prepareTarget,
  TargetRejection,
} from "./targets.ts";
import {
  ErpIntegrationDisabledError,
  ErpThrottledError,
  ErpTransientError,
  type ConnectorConfig,
  type EntityConfig,
  type ErpConnector,
  type ErpEntityKey,
  type ErpPage,
  type ErpRecord,
  type FieldMapping,
  type SyncErrorType,
  type SyncMode,
  type SyncRunCounters,
  type SyncRunSummary,
  type SyncStore,
} from "./types.ts";

export interface SyncEngineOptions {
  connector: ErpConnector;
  store: SyncStore;
  /** Injected so that tests and throttling never really wait. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  maxThrottleRetries?: number;
  maxTransientRetries?: number;
  transientBackoffMs?: number;
  /** A record that failed this many times is left for manual resolution. */
  maxRecordAttempts?: number;
  /** Safety valve against a connector that never stops paging. */
  maxPages?: number;
}

export interface SyncRequest {
  entity: ErpEntityKey;
  dataAreaId: string;
  mode?: SyncMode;
  triggeredBy?: number | string | null;
}

const emptyCounters = (): SyncRunCounters => ({
  pages_read: 0,
  records_read: 0,
  records_created: 0,
  records_updated: 0,
  records_unchanged: 0,
  records_conflicted: 0,
  records_failed: 0,
  throttle_waits: 0,
});

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Guards shared by every entry point: the integration must be enabled, a real
 * connector additionally needs a recorded approval, and the connector in use
 * must be the configured one.
 */
export const assertIntegrationAllowed = (
  config: ConnectorConfig,
  connector: ErpConnector,
): void => {
  if (connector.type !== config.connector_type) {
    throw new ErpIntegrationDisabledError(
      `Connector mismatch: configuration expects ${config.connector_type}, got ${connector.type}`,
    );
  }
  if (!config.is_enabled) {
    throw new ErpIntegrationDisabledError("ERP integration is disabled");
  }
  if (
    config.connector_type !== "mock" &&
    config.approval_status !== "approved"
  ) {
    throw new ErpIntegrationDisabledError(
      "Real ERP integration has not been approved",
    );
  }
};

const assertEntityAllowed = (
  config: EntityConfig | null,
  entity: ErpEntityKey,
): EntityConfig => {
  if (!config) {
    throw new ErpIntegrationDisabledError(
      `No integration contract is configured for ${entity}`,
    );
  }
  if (!config.is_enabled) {
    throw new ErpIntegrationDisabledError(
      `Synchronization of ${entity} is disabled`,
    );
  }
  if (config.direction !== "inbound" && config.direction !== "bidirectional") {
    throw new ErpIntegrationDisabledError(
      `${entity} is not configured for inbound synchronization`,
    );
  }
  if (!config.allowed_operations.includes("read")) {
    throw new ErpIntegrationDisabledError(
      `Reading ${entity} from the ERP is not permitted`,
    );
  }
  if (config.system_of_record === "undecided") {
    throw new ErpIntegrationDisabledError(
      `The system of record for ${entity} is undecided: this decision is required before synchronizing`,
    );
  }
  if (!isInboundSupported(entity)) {
    throw new ErpIntegrationDisabledError(
      `Inbound synchronization is not implemented for ${entity}`,
    );
  }
  return config;
};

export const createSyncEngine = ({
  connector,
  store,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => new Date(),
  maxThrottleRetries = 5,
  maxTransientRetries = 3,
  transientBackoffMs = 500,
  maxRecordAttempts = 5,
  maxPages = 10_000,
}: SyncEngineOptions) => {
  const fetchPageWithRetry = async (
    query: Parameters<ErpConnector["fetchPage"]>[0],
    counters: SyncRunCounters,
  ): Promise<ErpPage> => {
    let throttled = 0;
    let transient = 0;
    for (;;) {
      try {
        return await connector.fetchPage(query);
      } catch (error) {
        if (
          error instanceof ErpThrottledError &&
          throttled < maxThrottleRetries
        ) {
          throttled += 1;
          counters.throttle_waits += 1;
          await sleep(error.retryAfterMs);
        } else if (
          error instanceof ErpTransientError &&
          transient < maxTransientRetries
        ) {
          await sleep(transientBackoffMs * 2 ** transient);
          transient += 1;
        } else {
          throw error;
        }
      }
    }
  };

  const nextRetryAt = (attempts: number): string | null => {
    if (attempts >= maxRecordAttempts) return null;
    const minutes = Math.min(2 ** attempts, 60);
    return new Date(now().getTime() + minutes * 60_000).toISOString();
  };

  type Outcome = "created" | "updated" | "unchanged" | "conflicted";

  /** Idempotent upsert of one ERP record. Throws on validation, mapping or storage failure. */
  const processRecord = async (
    record: ErpRecord,
    entityConfig: EntityConfig,
    mappings: FieldMapping[],
    dataAreaId: string,
  ): Promise<{ outcome: Outcome; erpKey: string; conflict?: string }> => {
    const mapped = mapErpRecord(record, mappings);
    const entity = entityConfig.entity;
    const link = await store.findExternalId(entity, dataAreaId, mapped.erpKey);
    const prepared = await prepareTarget(entity, mapped, {
      store,
      dataAreaId,
      isLinked: link !== null,
    });
    const hash = hashPayload(prepared.data);
    const modifiedRaw = connector.modifiedField
      ? record[connector.modifiedField]
      : null;
    const erpModifiedAt = modifiedRaw
      ? new Date(String(modifiedRaw)).toISOString()
      : null;
    const linkBase = {
      entity,
      data_area_id: dataAreaId,
      erp_key: mapped.erpKey,
      crm_table: entityConfig.crm_table,
      erp_modified_at: erpModifiedAt,
    };

    if (link) {
      if (link.payload_hash === hash) {
        return { outcome: "unchanged", erpKey: mapped.erpKey };
      }
      if (entityConfig.system_of_record === "crm") {
        return {
          outcome: "conflicted",
          erpKey: mapped.erpKey,
          conflict:
            "The ERP record changed but the CRM is the system of record: the CRM record was not overwritten",
        };
      }
      await store.updateRow(entityConfig.crm_table, link.crm_id, prepared.data);
      await store.saveExternalId(
        { ...linkBase, crm_id: link.crm_id, payload_hash: hash },
        link.id,
      );
      return { outcome: "updated", erpKey: mapped.erpKey };
    }

    if (prepared.existingRow) {
      // Link an existing CRM row. Its data is only overwritten when the ERP owns the entity.
      if (entityConfig.system_of_record === "erp") {
        await store.updateRow(
          entityConfig.crm_table,
          prepared.existingRow.id,
          prepared.data,
        );
      }
      await store.saveExternalId({
        ...linkBase,
        crm_id: prepared.existingRow.id,
        payload_hash: hash,
      });
      return { outcome: "updated", erpKey: mapped.erpKey };
    }

    const created = await store.insertRow(
      entityConfig.crm_table,
      prepared.data,
    );
    await store.saveExternalId({
      ...linkBase,
      crm_id: created.id,
      payload_hash: hash,
    });
    return { outcome: "created", erpKey: mapped.erpKey };
  };

  const classify = (error: unknown): SyncErrorType => {
    if (error instanceof MappingError) return "mapping";
    if (error instanceof TargetRejection) return error.errorType;
    return "error";
  };

  const safeKey = (
    record: ErpRecord,
    mappings: FieldMapping[],
  ): string | null => {
    try {
      return mapErpRecord(record, mappings).erpKey;
    } catch {
      return null;
    }
  };

  const applyOutcome = (outcome: Outcome, counters: SyncRunCounters) => {
    if (outcome === "created") counters.records_created += 1;
    else if (outcome === "updated") counters.records_updated += 1;
    else if (outcome === "unchanged") counters.records_unchanged += 1;
    else counters.records_conflicted += 1;
  };

  const syncEntity = async ({
    entity,
    dataAreaId,
    mode = "incremental",
    triggeredBy = null,
  }: SyncRequest): Promise<SyncRunSummary> => {
    const config = await store.getConnectorConfig();
    assertIntegrationAllowed(config, connector);
    const entityConfig = assertEntityAllowed(
      await store.getEntityConfig(entity),
      entity,
    );
    if (!(await store.isKnownLegalEntity(dataAreaId))) {
      throw new ErpIntegrationDisabledError(
        `Legal entity ${dataAreaId} is not registered`,
      );
    }
    const mappings = await store.getFieldMappings(entity);

    const counters = emptyCounters();
    const cursorBefore =
      mode === "incremental" ? await store.getCursor(entity, dataAreaId) : null;
    const runId = await store.createRun({
      entity,
      data_area_id: dataAreaId,
      connector_type: connector.type,
      direction: "inbound",
      mode,
      status: "running",
      started_at: now().toISOString(),
      cursor_before: cursorBefore,
      triggered_by: triggeredBy,
    });

    let cursorAfter = cursorBefore;
    let failure: string | null = null;

    const handleRecord = async (record: ErpRecord): Promise<boolean> => {
      try {
        const result = await processRecord(
          record,
          entityConfig,
          mappings,
          dataAreaId,
        );
        applyOutcome(result.outcome, counters);
        if (result.outcome === "conflicted") {
          await store.recordError({
            run_id: runId,
            entity,
            data_area_id: dataAreaId,
            erp_key: result.erpKey,
            error_type: "conflict",
            error_message: result.conflict,
            payload: record,
            attempts: 1,
            next_retry_at: null,
          });
        }
        return true;
      } catch (error) {
        counters.records_failed += 1;
        const type = classify(error);
        await store.recordError({
          run_id: runId,
          entity,
          data_area_id: dataAreaId,
          erp_key: safeKey(record, mappings),
          error_type: type,
          error_message: errorMessage(error),
          payload: record,
          attempts: 1,
          // Conflicts need a human decision; everything else is retried automatically
          next_retry_at: type === "conflict" ? null : nextRetryAt(1),
        });
        return false;
      }
    };

    try {
      if (mode === "retry") {
        const pending = await store.listRetryableErrors(
          entity,
          dataAreaId,
          now().toISOString(),
        );
        for (const item of pending) {
          counters.records_read += 1;
          if (!item.payload) continue;
          try {
            const result = await processRecord(
              item.payload,
              entityConfig,
              mappings,
              dataAreaId,
            );
            applyOutcome(result.outcome, counters);
            await store.markErrorRetried(item.id, {
              is_resolved: result.outcome !== "conflicted",
              attempts: item.attempts + 1,
              next_retry_at: null,
            });
          } catch (error) {
            counters.records_failed += 1;
            const attempts = item.attempts + 1;
            await store.markErrorRetried(item.id, {
              is_resolved: false,
              attempts,
              next_retry_at: nextRetryAt(attempts),
              error_message: errorMessage(error),
            });
          }
        }
      } else {
        let nextLink: string | null = null;
        do {
          if (counters.pages_read >= maxPages) {
            throw new Error(`Aborted after ${maxPages} pages`);
          }
          const page: ErpPage = await fetchPageWithRetry(
            {
              entityName: entityConfig.erp_entity_name,
              dataAreaId,
              modifiedSince: cursorBefore,
              pageSize: entityConfig.page_size,
              nextLink,
            },
            counters,
          );
          counters.pages_read += 1;
          for (const record of page.records) {
            counters.records_read += 1;
            await handleRecord(record);
            const modified = connector.modifiedField
              ? record[connector.modifiedField]
              : null;
            if (modified) {
              const iso = new Date(String(modified)).toISOString();
              if (!cursorAfter || iso > cursorAfter) cursorAfter = iso;
            }
          }
          nextLink = page.nextLink;
        } while (nextLink);
      }
    } catch (error) {
      failure = errorMessage(error);
    }

    const status = failure
      ? "failed"
      : counters.records_failed > 0 || counters.records_conflicted > 0
        ? "partial"
        : "succeeded";
    // The cursor only moves when every page was read: a failed run is replayed from the same point
    const finalCursor = failure ? cursorBefore : cursorAfter;
    const finishedAt = now().toISOString();

    await store.finishRun(runId, {
      ...counters,
      status,
      finished_at: finishedAt,
      cursor_after: finalCursor,
      error_message: failure,
    });
    if (!failure && mode !== "retry") {
      await store.saveCursor(entity, dataAreaId, finalCursor, finishedAt);
    }

    return {
      ...counters,
      run_id: runId,
      entity,
      data_area_id: dataAreaId,
      mode,
      status,
      cursor_before: cursorBefore,
      cursor_after: finalCursor,
      error_message: failure,
    };
  };

  /** Registers the legal entities exposed by the connector (used with the mock connector). */
  const registerLegalEntities = async (): Promise<number> => {
    assertIntegrationAllowed(await store.getConnectorConfig(), connector);
    const entities = await connector.listLegalEntities();
    for (const legalEntity of entities) {
      await store.ensureLegalEntity(legalEntity);
    }
    return entities.length;
  };

  /**
   * Compares the keys present in the ERP with the keys mapped in the CRM.
   * Read-only: it reports differences and changes nothing.
   */
  const reconcile = async (entity: ErpEntityKey, dataAreaId: string) => {
    assertIntegrationAllowed(await store.getConnectorConfig(), connector);
    const entityConfig = await store.getEntityConfig(entity);
    if (!entityConfig) {
      throw new ErpIntegrationDisabledError(
        `No integration contract is configured for ${entity}`,
      );
    }
    const mappings = await store.getFieldMappings(entity);
    const counters = emptyCounters();
    const erpKeys = new Set<string>();
    let unreadable = 0;
    let nextLink: string | null = null;
    do {
      const page: ErpPage = await fetchPageWithRetry(
        {
          entityName: entityConfig.erp_entity_name,
          dataAreaId,
          pageSize: entityConfig.page_size,
          nextLink,
        },
        counters,
      );
      counters.pages_read += 1;
      for (const record of page.records) {
        const key = safeKey(record, mappings);
        if (key === null) unreadable += 1;
        else erpKeys.add(key);
      }
      nextLink = page.nextLink;
    } while (nextLink && counters.pages_read < maxPages);

    const crmKeys = new Set(await store.listExternalKeys(entity, dataAreaId));
    return {
      entity,
      data_area_id: dataAreaId,
      erp_count: erpKeys.size,
      crm_count: crmKeys.size,
      missing_in_crm: [...erpKeys].filter((key) => !crmKeys.has(key)).sort(),
      missing_in_erp: [...crmKeys].filter((key) => !erpKeys.has(key)).sort(),
      unreadable_records: unreadable,
      is_consistent:
        unreadable === 0 &&
        erpKeys.size === crmKeys.size &&
        [...erpKeys].every((key) => crmKeys.has(key)),
    };
  };

  return { syncEntity, registerLegalEntities, reconcile };
};

export type SyncEngine = ReturnType<typeof createSyncEngine>;
