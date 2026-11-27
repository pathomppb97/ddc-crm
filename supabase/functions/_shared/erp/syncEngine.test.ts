import { describe, expect, it } from "vitest";
import { createMockD365Connector } from "./mockConnector.ts";
import { createSyncEngine } from "./syncEngine.ts";
import { createMemoryGateway, createTableSyncStore } from "./tableStore.ts";
import type { CrmRow, ErpEntityKey } from "./types.ts";

const mapping = (
  entity: string,
  crm_field: string,
  erp_field: string,
  transform = "trim",
  is_key = false,
) => ({
  entity,
  crm_field,
  erp_field,
  transform,
  is_key,
  is_active: true,
});

const entityConfig = (
  entity: ErpEntityKey,
  erp_entity_name: string,
  crm_table: string,
  extra = {},
) => ({
  id: entity,
  entity,
  erp_entity_name,
  crm_table,
  direction: "inbound",
  system_of_record: "erp",
  allowed_operations: ["read"],
  is_enabled: true,
  page_size: 5,
  last_cursor: null,
  ...extra,
});

const setup = (
  options: {
    enabled?: boolean;
    connectorType?: string;
    approval?: string;
    throttleEvery?: number;
  } = {},
) => {
  const { gateway, tables } = createMemoryGateway({
    erp_connector_config: [
      {
        id: 1,
        connector_type: options.connectorType ?? "mock",
        environment_type: "mock",
        is_enabled: options.enabled ?? true,
        approval_status: options.approval ?? "not_requested",
      },
    ],
    erp_entity_configs: [
      entityConfig("customers", "CustomersV3", "companies"),
      entityConfig("released_products", "ReleasedProductsV2", "products"),
      entityConfig("sales_orders", "SalesOrderHeadersV2", "erp_sales_orders"),
      entityConfig(
        "sales_order_lines",
        "SalesOrderLines",
        "erp_sales_order_lines",
      ),
      entityConfig("quotations", "SalesQuotationHeadersV2", "quotations", {
        system_of_record: "undecided",
      }),
    ] as unknown as CrmRow[],
    erp_field_mappings: [
      mapping("customers", "erp_key", "CustomerAccount", "trim", true),
      mapping("customers", "name", "OrganizationName"),
      mapping("customers", "email", "PrimaryContactEmail", "lower"),
      mapping("customers", "country", "AddressCountryRegionId", "upper"),
      mapping("released_products", "erp_key", "ItemNumber", "trim", true),
      mapping("released_products", "part_number", "ItemNumber"),
      mapping("released_products", "name", "SearchName"),
      mapping("sales_orders", "erp_key", "SalesOrderNumber", "trim", true),
      mapping("sales_orders", "sales_order_number", "SalesOrderNumber"),
      mapping(
        "sales_orders",
        "erp_customer_account",
        "OrderingCustomerAccountNumber",
      ),
      mapping("sales_orders", "total_amount", "OrderTotalAmount", "number"),
      mapping("sales_order_lines", "erp_key", "SalesOrderNumber", "trim", true),
      mapping("sales_order_lines", "line_number", "LineNumber", "number", true),
      mapping("sales_order_lines", "sales_order_number", "SalesOrderNumber"),
      mapping("sales_order_lines", "erp_item_number", "ItemNumber"),
      mapping("sales_order_lines", "line_amount", "LineAmount", "number"),
    ].map((row, index) => ({ ...row, id: index + 1 })) as unknown as CrmRow[],
    erp_legal_entities: [
      { id: 1, data_area_id: "syn1", name: "Synthetic 1", is_active: true },
      { id: 2, data_area_id: "syn2", name: "Synthetic 2", is_active: true },
    ],
  });
  const mock = createMockD365Connector({
    throttleEvery: options.throttleEvery ?? 0,
  });
  const waits: number[] = [];
  const clock = { now: Date.UTC(2026, 10, 11) };
  const engine = createSyncEngine({
    now: () => new Date(clock.now),
    connector: mock.connector,
    store: createTableSyncStore(gateway),
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  return { engine, tables, mock, waits, clock };
};

describe("ERP synchronization engine (mock Dynamics 365 F&O)", () => {
  it("refuses to run while the integration is disabled", async () => {
    const { engine } = setup({ enabled: false });

    await expect(
      engine.syncEntity({ entity: "customers", dataAreaId: "syn1" }),
    ).rejects.toThrow("disabled");
  });

  it("refuses a real connector configuration without approval", async () => {
    const { engine } = setup({ connectorType: "d365fo" });

    await expect(
      engine.syncEntity({ entity: "customers", dataAreaId: "syn1" }),
    ).rejects.toThrow("mismatch");
  });

  it("refuses to synchronize an entity whose system of record is undecided", async () => {
    const { engine } = setup();

    await expect(
      engine.syncEntity({ entity: "quotations", dataAreaId: "syn1" }),
    ).rejects.toThrow("undecided");
  });

  it("imports every page with mapped and transformed fields", async () => {
    const { engine, tables } = setup();

    const run = await engine.syncEntity({
      entity: "customers",
      dataAreaId: "syn1",
    });

    expect(run.status).toBe("succeeded");
    expect(run.pages_read).toBe(3);
    expect(run.records_created).toBe(12);
    expect(tables.companies).toHaveLength(12);
    expect(tables.companies[0].email).toBe("contact1@mock-syn1.example.test");
    expect(tables.companies[0].country).toBe("THA");
    expect(tables.erp_external_ids).toHaveLength(12);
  });

  it("is idempotent: a second full run changes nothing", async () => {
    const { engine, tables } = setup();
    await engine.syncEntity({ entity: "customers", dataAreaId: "syn1" });

    const run = await engine.syncEntity({
      entity: "customers",
      dataAreaId: "syn1",
      mode: "full",
    });

    expect(run.records_unchanged).toBe(12);
    expect(run.records_created).toBe(0);
    expect(tables.companies).toHaveLength(12);
  });

  it("keeps identical ERP keys of different legal entities apart", async () => {
    const { engine, tables } = setup();

    await engine.syncEntity({ entity: "customers", dataAreaId: "syn1" });
    await engine.syncEntity({ entity: "customers", dataAreaId: "syn2" });

    const keys = tables.erp_external_ids.filter(
      (row) => row.erp_key === "MOCK-C0001",
    );
    expect(tables.companies).toHaveLength(24);
    expect(keys).toHaveLength(2);
    expect(keys[0].crm_id).not.toBe(keys[1].crm_id);
  });

  it("only reads records changed since the last cursor", async () => {
    const { engine, mock, tables } = setup();
    await engine.syncEntity({ entity: "customers", dataAreaId: "syn1" });
    mock.control.upsert("syn1", "CustomersV3", "CustomerAccount", {
      CustomerAccount: "MOCK-C0003",
      OrganizationName: "Synthetic renamed (mock)",
      ModifiedDateTime: "2026-06-01T00:00:00.000Z",
    });

    const run = await engine.syncEntity({
      entity: "customers",
      dataAreaId: "syn1",
    });

    expect(run.records_read).toBe(1);
    expect(run.records_updated).toBe(1);
    expect(
      tables.companies.find((row) => row.name === "Synthetic renamed (mock)"),
    ).toBeDefined();
  });

  it("waits and retries when the ERP throttles", async () => {
    const { engine, waits } = setup({ throttleEvery: 2 });

    const run = await engine.syncEntity({
      entity: "customers",
      dataAreaId: "syn1",
    });

    expect(run.status).toBe("succeeded");
    expect(run.throttle_waits).toBeGreaterThan(0);
    expect(waits.every((ms) => ms === 1000)).toBe(true);
  });

  it("does not move the cursor when the run fails, so it can be replayed", async () => {
    const { engine, mock, tables } = setup();
    mock.control.failNextRequests(10);

    const run = await engine.syncEntity({
      entity: "customers",
      dataAreaId: "syn1",
    });
    const config = tables.erp_entity_configs.find(
      (row) => row.entity === "customers",
    );

    expect(run.status).toBe("failed");
    expect(config?.last_cursor).toBeNull();
  });

  it("records a failing record, continues, and resolves it on retry", async () => {
    const { engine, tables, clock } = setup();

    // Lines reference orders that are not synchronized yet
    const first = await engine.syncEntity({
      entity: "sales_order_lines",
      dataAreaId: "syn1",
    });
    await engine.syncEntity({ entity: "sales_orders", dataAreaId: "syn1" });
    const tooEarly = await engine.syncEntity({
      entity: "sales_order_lines",
      dataAreaId: "syn1",
      mode: "retry",
    });
    clock.now += 3 * 60 * 60_000;
    const retry = await engine.syncEntity({
      entity: "sales_order_lines",
      dataAreaId: "syn1",
      mode: "retry",
    });

    expect(first.status).toBe("partial");
    expect(first.records_failed).toBe(36);
    expect(tooEarly.records_read).toBe(0);
    expect(retry.records_created).toBe(36);
    expect(tables.erp_sync_errors.every((row) => row.is_resolved)).toBe(true);
    expect(
      tables.erp_sales_order_lines.every((row) => row.sales_order_id),
    ).toBe(true);
  });

  it("reports a conflict instead of overwriting when the CRM owns the entity", async () => {
    const { engine, mock, tables } = setup();
    await engine.syncEntity({ entity: "customers", dataAreaId: "syn1" });
    const config = tables.erp_entity_configs.find(
      (row) => row.entity === "customers",
    )!;
    config.system_of_record = "crm";
    mock.control.upsert("syn1", "CustomersV3", "CustomerAccount", {
      CustomerAccount: "MOCK-C0001",
      OrganizationName: "Changed in ERP",
      ModifiedDateTime: "2026-07-01T00:00:00.000Z",
    });

    const run = await engine.syncEntity({
      entity: "customers",
      dataAreaId: "syn1",
    });

    expect(run.records_conflicted).toBe(1);
    expect(tables.companies.some((row) => row.name === "Changed in ERP")).toBe(
      false,
    );
    expect(tables.erp_sync_errors[0].error_type).toBe("conflict");
  });

  it("reconciles ERP and CRM keys without changing data", async () => {
    const { engine, mock } = setup();
    await engine.syncEntity({ entity: "customers", dataAreaId: "syn1" });
    mock.control.remove("syn1", "CustomersV3", "CustomerAccount", "MOCK-C0002");

    const report = await engine.reconcile("customers", "syn1");

    expect(report.is_consistent).toBe(false);
    expect(report.missing_in_erp).toEqual(["MOCK-C0002"]);
    expect(report.missing_in_crm).toEqual([]);
  });
});
