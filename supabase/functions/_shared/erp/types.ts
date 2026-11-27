/**
 * ERP integration contracts.
 *
 * This module is runtime agnostic (no Deno, Node or browser API): the same code
 * runs in the Supabase edge function, in the browser evaluation mode and in the
 * unit tests. Keep it free of dependencies.
 */

export const ERP_ENTITIES = [
  "customers",
  "contacts",
  "products",
  "released_products",
  "inventory_availability",
  "price_lists",
  "quotations",
  "sales_orders",
  "sales_order_lines",
  "deliveries",
  "invoices",
] as const;

export type ErpEntityKey = (typeof ERP_ENTITIES)[number];

export type ConnectorType = "mock" | "d365fo";
export type SyncDirection =
  "disabled" | "inbound" | "outbound" | "bidirectional";
export type SystemOfRecord = "undecided" | "erp" | "crm";
export type SyncMode = "incremental" | "full" | "retry";
export type RunStatus = "running" | "succeeded" | "partial" | "failed";
export type FieldTransform =
  "none" | "trim" | "upper" | "lower" | "number" | "date" | "boolean";
export type SyncErrorType = "error" | "conflict" | "validation" | "mapping";

/** A raw record as returned by the ERP (OData JSON object). */
export type ErpRecord = Record<string, unknown>;

export interface ErpLegalEntity {
  dataAreaId: string;
  name: string;
}

export interface ErpQuery {
  /** OData entity set name, e.g. CustomersV3. Comes from configuration, never hardcoded. */
  entityName: string;
  /** Legal entity (dataAreaId). ERP keys are only unique inside one legal entity. */
  dataAreaId: string;
  /** ISO timestamp: only records modified after it (incremental sync). */
  modifiedSince?: string | null;
  pageSize: number;
  /** Opaque continuation token returned by the previous page. */
  nextLink?: string | null;
}

export interface ErpPage {
  records: ErpRecord[];
  nextLink: string | null;
}

export interface ErpHealth {
  ok: boolean;
  message: string;
}

/** Port implemented by every ERP adapter (mock, Dynamics 365 F&O, future systems). */
export interface ErpConnector {
  readonly type: ConnectorType;
  /** Field holding the last modification timestamp, when the ERP exposes one. */
  readonly modifiedField: string | null;
  healthCheck(): Promise<ErpHealth>;
  listLegalEntities(): Promise<ErpLegalEntity[]>;
  fetchPage(query: ErpQuery): Promise<ErpPage>;
}

/** The ERP asked the client to slow down (HTTP 429). */
export class ErpThrottledError extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number, message = "ERP throttled the request") {
    super(message);
    this.name = "ErpThrottledError";
    this.retryAfterMs = retryAfterMs;
  }
}

/** A failure worth retrying (timeout, 5xx). */
export class ErpTransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErpTransientError";
  }
}

/** The integration is not allowed to run in its current configuration. */
export class ErpIntegrationDisabledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErpIntegrationDisabledError";
  }
}

export interface ConnectorConfig {
  connector_type: ConnectorType;
  environment_type: "none" | "mock" | "sandbox" | "production";
  is_enabled: boolean;
  approval_status: "not_requested" | "pending" | "approved" | "rejected";
}

export interface EntityConfig {
  entity: ErpEntityKey;
  erp_entity_name: string;
  crm_table: string;
  direction: SyncDirection;
  system_of_record: SystemOfRecord;
  allowed_operations: string[];
  is_enabled: boolean;
  page_size: number;
}

export interface FieldMapping {
  crm_field: string;
  erp_field: string;
  transform: FieldTransform;
  is_key: boolean;
  is_active: boolean;
}

export interface ExternalId {
  id: number | string;
  entity: ErpEntityKey;
  data_area_id: string;
  erp_key: string;
  crm_table: string;
  crm_id: number | string;
  payload_hash: string | null;
}

export interface SyncRunCounters {
  pages_read: number;
  records_read: number;
  records_created: number;
  records_updated: number;
  records_unchanged: number;
  records_conflicted: number;
  records_failed: number;
  throttle_waits: number;
}

export interface SyncRunSummary extends SyncRunCounters {
  run_id: number | string;
  entity: ErpEntityKey;
  data_area_id: string;
  mode: SyncMode;
  status: RunStatus;
  cursor_before: string | null;
  cursor_after: string | null;
  error_message: string | null;
}

export interface SyncErrorRecord {
  id: number | string;
  entity: ErpEntityKey;
  data_area_id: string;
  erp_key: string | null;
  error_type: SyncErrorType;
  payload: ErpRecord | null;
  attempts: number;
}

export type CrmRow = Record<string, unknown> & { id: number | string };

/**
 * Persistence port of the synchronization engine. Implemented on top of the
 * Supabase service client (edge function) and of the in-browser store
 * (evaluation mode). The engine never talks to a database directly.
 */
export interface SyncStore {
  getConnectorConfig(): Promise<ConnectorConfig>;
  getEntityConfig(entity: ErpEntityKey): Promise<EntityConfig | null>;
  getFieldMappings(entity: ErpEntityKey): Promise<FieldMapping[]>;
  ensureLegalEntity(legalEntity: ErpLegalEntity): Promise<void>;
  isKnownLegalEntity(dataAreaId: string): Promise<boolean>;
  findExternalId(
    entity: ErpEntityKey,
    dataAreaId: string,
    erpKey: string,
  ): Promise<ExternalId | null>;
  listExternalKeys(entity: ErpEntityKey, dataAreaId: string): Promise<string[]>;
  saveExternalId(
    link: Omit<ExternalId, "id"> & { erp_modified_at: string | null },
    existingId?: number | string,
  ): Promise<void>;
  findRows(table: string, filter: Record<string, unknown>): Promise<CrmRow[]>;
  insertRow(table: string, data: Record<string, unknown>): Promise<CrmRow>;
  updateRow(
    table: string,
    id: number | string,
    data: Record<string, unknown>,
  ): Promise<void>;
  createRun(run: Record<string, unknown>): Promise<number | string>;
  finishRun(
    runId: number | string,
    patch: Record<string, unknown>,
  ): Promise<void>;
  recordError(error: Record<string, unknown>): Promise<void>;
  listRetryableErrors(
    entity: ErpEntityKey,
    dataAreaId: string,
    now: string,
  ): Promise<SyncErrorRecord[]>;
  markErrorRetried(
    errorId: number | string,
    patch: {
      is_resolved: boolean;
      attempts: number;
      next_retry_at: string | null;
      error_message?: string;
    },
  ): Promise<void>;
  getCursor(entity: ErpEntityKey, dataAreaId: string): Promise<string | null>;
  saveCursor(
    entity: ErpEntityKey,
    dataAreaId: string,
    cursor: string | null,
    syncedAt: string,
  ): Promise<void>;
}
