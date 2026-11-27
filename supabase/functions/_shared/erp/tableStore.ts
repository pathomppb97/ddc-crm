import type {
  ConnectorConfig,
  CrmRow,
  EntityConfig,
  ErpEntityKey,
  ExternalId,
  FieldMapping,
  SyncErrorRecord,
  SyncStore,
} from "./types.ts";

/**
 * Minimal table access used by the synchronization store. Two adapters exist:
 * the Supabase service client (edge function) and the in-browser data provider
 * (evaluation mode). Filters are equality only.
 */
export interface TableGateway {
  select(table: string, filter: Record<string, unknown>): Promise<CrmRow[]>;
  insert(table: string, data: Record<string, unknown>): Promise<CrmRow>;
  update(
    table: string,
    idColumn: string,
    id: number | string,
    data: Record<string, unknown>,
  ): Promise<void>;
}

/** Builds the SyncStore on top of the erp_* bookkeeping tables. */
export const createTableSyncStore = (gateway: TableGateway): SyncStore => ({
  async getConnectorConfig() {
    const [row] = await gateway.select("erp_connector_config", { id: 1 });
    if (!row) throw new Error("ERP connector configuration is missing");
    return row as unknown as ConnectorConfig;
  },

  async getEntityConfig(entity) {
    const [row] = await gateway.select("erp_entity_configs", { entity });
    return (row as unknown as EntityConfig) ?? null;
  },

  async getFieldMappings(entity) {
    const rows = await gateway.select("erp_field_mappings", { entity });
    return rows as unknown as FieldMapping[];
  },

  async ensureLegalEntity({ dataAreaId, name }) {
    const existing = await gateway.select("erp_legal_entities", {
      data_area_id: dataAreaId,
    });
    if (existing.length === 0) {
      await gateway.insert("erp_legal_entities", {
        data_area_id: dataAreaId,
        name,
        is_active: true,
        is_default: false,
        is_verified: false,
      });
    }
  },

  async isKnownLegalEntity(dataAreaId) {
    const rows = await gateway.select("erp_legal_entities", {
      data_area_id: dataAreaId,
      is_active: true,
    });
    return rows.length > 0;
  },

  async findExternalId(entity, dataAreaId, erpKey) {
    const [row] = await gateway.select("erp_external_ids", {
      entity,
      data_area_id: dataAreaId,
      erp_key: erpKey,
    });
    return (row as unknown as ExternalId) ?? null;
  },

  async listExternalKeys(entity, dataAreaId) {
    const rows = await gateway.select("erp_external_ids", {
      entity,
      data_area_id: dataAreaId,
    });
    return rows.map((row) => String(row.erp_key));
  },

  async saveExternalId(link, existingId) {
    const data = { ...link, last_synced_at: new Date().toISOString() };
    if (existingId !== undefined) {
      await gateway.update("erp_external_ids", "id", existingId, data);
    } else {
      await gateway.insert("erp_external_ids", data);
    }
  },

  findRows: (table, filter) => gateway.select(table, filter),
  insertRow: (table, data) => gateway.insert(table, data),
  updateRow: (table, id, data) => gateway.update(table, "id", id, data),

  async createRun(run) {
    const row = await gateway.insert("erp_sync_runs", run);
    return row.id;
  },

  finishRun: (runId, patch) =>
    gateway.update("erp_sync_runs", "id", runId, patch),

  async recordError(error) {
    await gateway.insert("erp_sync_errors", {
      is_resolved: false,
      created_at: new Date().toISOString(),
      ...error,
    });
  },

  async listRetryableErrors(
    entity: ErpEntityKey,
    dataAreaId: string,
    now: string,
  ) {
    const rows = await gateway.select("erp_sync_errors", {
      entity,
      data_area_id: dataAreaId,
      is_resolved: false,
    });
    return (
      rows as unknown as Array<
        SyncErrorRecord & { next_retry_at: string | null }
      >
    ).filter((row) => row.next_retry_at !== null && row.next_retry_at <= now);
  },

  async markErrorRetried(errorId, patch) {
    await gateway.update("erp_sync_errors", "id", errorId, {
      ...patch,
      resolved_at: patch.is_resolved ? new Date().toISOString() : null,
    });
  },

  async getCursor(entity, dataAreaId) {
    const [row] = await gateway.select("erp_sync_cursors", {
      entity,
      data_area_id: dataAreaId,
    });
    return (row?.cursor_value as string | null | undefined) ?? null;
  },

  async saveCursor(entity, dataAreaId, cursor, syncedAt) {
    const filter = { entity, data_area_id: dataAreaId };
    const [existing] = await gateway.select("erp_sync_cursors", filter);
    const data = { ...filter, cursor_value: cursor, last_synced_at: syncedAt };
    if (existing)
      await gateway.update("erp_sync_cursors", "id", existing.id, data);
    else await gateway.insert("erp_sync_cursors", data);
    await gateway.update("erp_entity_configs", "entity", entity, {
      last_synced_at: syncedAt,
    });
  },
});

/** In-memory gateway for unit tests and offline evaluation. */
export const createMemoryGateway = (initial: Record<string, CrmRow[]> = {}) => {
  const tables: Record<string, CrmRow[]> = {};
  for (const [table, rows] of Object.entries(initial)) {
    tables[table] = rows.map((row) => ({ ...row }));
  }
  const rowsOf = (table: string) => (tables[table] ??= []);
  const matches = (row: CrmRow, filter: Record<string, unknown>) =>
    Object.entries(filter).every(
      ([key, value]) => String(row[key]) === String(value),
    );

  const gateway: TableGateway = {
    async select(table, filter) {
      return rowsOf(table)
        .filter((row) => matches(row, filter))
        .map((row) => ({ ...row }));
    },
    async insert(table, data) {
      const rows = rowsOf(table);
      const numericIds = rows
        .map((row) => Number(row.id))
        .filter(Number.isFinite);
      const id =
        (data.id as number | string | undefined) ??
        (numericIds.length ? Math.max(...numericIds) + 1 : 1);
      const row = { ...data, id } as CrmRow;
      rows.push(row);
      return { ...row };
    },
    async update(table, idColumn, id, data) {
      const rows = rowsOf(table);
      const index = rows.findIndex(
        (row) => String(row[idColumn]) === String(id),
      );
      if (index < 0) throw new Error(`Row ${String(id)} not found in ${table}`);
      rows[index] = { ...rows[index], ...data } as CrmRow;
    },
  };

  return { gateway, tables };
};
