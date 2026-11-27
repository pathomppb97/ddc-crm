import { beforeAll, describe, expect, it } from "vitest";
import { createMockD365Connector } from "../functions/_shared/erp/mockConnector";
import { createSyncEngine } from "../functions/_shared/erp/syncEngine";
import {
  createTableSyncStore,
  type TableGateway,
} from "../functions/_shared/erp/tableStore";
import type { CrmRow } from "../functions/_shared/erp/types";
import { createTestDb, type TestDb } from "./helpers/testDb";

/**
 * Runs the synchronization engine against the real PostgreSQL schema, as the
 * erp_sync edge function does with the service role.
 */
let t: TestDb;
let engine: ReturnType<typeof createSyncEngine>;

const ident = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name))
    throw new Error(`Bad identifier ${name}`);
  return `"${name}"`;
};

const pgGateway = (db: TestDb["db"]): TableGateway => ({
  async select(table, filter) {
    const keys = Object.keys(filter);
    const where = keys.length
      ? `where ${keys.map((k, i) => `${ident(k)}::text = $${i + 1}`).join(" and ")}`
      : "";
    const { rows } = await db.query<CrmRow>(
      `select * from public.${ident(table)} ${where}`,
      keys.map((k) => String(filter[k])),
    );
    return rows;
  },
  async insert(table, data) {
    const keys = Object.keys(data);
    const { rows } = await db.query<CrmRow>(
      `insert into public.${ident(table)} (${keys.map(ident).join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`,
      keys.map((k) =>
        data[k] !== null && typeof data[k] === "object"
          ? JSON.stringify(data[k])
          : data[k],
      ),
    );
    return rows[0];
  },
  async update(table, idColumn, id, data) {
    const keys = Object.keys(data);
    await db.query(
      `update public.${ident(table)} set ${keys.map((k, i) => `${ident(k)} = $${i + 1}`).join(", ")} where ${ident(idColumn)}::text = $${keys.length + 1}`,
      [
        ...keys.map((k) =>
          data[k] !== null && typeof data[k] === "object"
            ? JSON.stringify(data[k])
            : data[k],
        ),
        String(id),
      ],
    );
  },
});

beforeAll(async () => {
  t = await createTestDb();
  // Enable the mock connector and confirm the contracts used below, as an administrator would
  await t.db.exec(`
    update public.erp_connector_config set is_enabled = true;
    update public.erp_entity_configs set is_enabled = true, system_of_record = 'erp', direction = 'inbound'
      where entity in ('customers', 'released_products', 'sales_orders', 'sales_order_lines', 'invoices', 'inventory_availability');
  `);
  engine = createSyncEngine({
    connector: createMockD365Connector().connector,
    store: createTableSyncStore(pgGateway(t.db)),
    sleep: async () => {},
  });
});

describe("ERP synchronization against the database schema", () => {
  it("registers the legal entities of the mock environment as unverified", async () => {
    const registered = await engine.registerLegalEntities();
    const { rows } = await t.db.query<{
      data_area_id: string;
      is_verified: boolean;
    }>(
      "select data_area_id, is_verified from public.erp_legal_entities order by data_area_id",
    );

    expect(registered).toBe(2);
    expect(rows).toEqual([
      { data_area_id: "syn1", is_verified: false },
      { data_area_id: "syn2", is_verified: false },
    ]);
  });

  it("imports customers, items, orders, lines, invoices and stock with links to CRM records", async () => {
    const runs = [];
    for (const entity of [
      "customers",
      "released_products",
      "sales_orders",
      "sales_order_lines",
      "invoices",
      "inventory_availability",
    ] as const) {
      runs.push(await engine.syncEntity({ entity, dataAreaId: "syn1" }));
    }
    const { rows } = await t.db.query<Record<string, number>>(`
      select (select count(*) from public.companies) as companies,
             (select count(*) from public.products where node_id is null) as unclassified_products,
             (select count(*) from public.erp_sales_orders where company_id is not null) as linked_orders,
             (select count(*) from public.erp_sales_order_lines where product_id is not null and sales_order_id is not null) as linked_lines,
             (select count(*) from public.erp_invoices where company_id is not null) as linked_invoices,
             (select count(*) from public.erp_inventory_availability where product_id is not null) as linked_stock
    `);

    expect(runs.map((run) => run.status)).toEqual(Array(6).fill("succeeded"));
    expect(
      Object.fromEntries(
        Object.entries(rows[0]).map(([k, v]) => [k, Number(v)]),
      ),
    ).toEqual({
      companies: 12,
      unclassified_products: 15,
      linked_orders: 18,
      linked_lines: 36,
      linked_invoices: 6,
      linked_stock: 15,
    });
  });

  it("does not merge an item of a second legal entity into an existing product", async () => {
    const run = await engine.syncEntity({
      entity: "released_products",
      dataAreaId: "syn2",
    });
    const { rows } = await t.db.query<{ n: number }>(
      "select count(*) as n from public.products",
    );

    expect(run.records_conflicted + run.records_failed).toBe(15);
    expect(Number(rows[0].n)).toBe(15);
  });

  it("keeps a separate incremental cursor per legal entity", async () => {
    const { rows } = await t.db.query<{ data_area_id: string }>(
      "select data_area_id from public.erp_sync_cursors where entity = 'released_products' order by data_area_id",
    );

    expect(rows.map((r) => r.data_area_id)).toEqual(["syn1", "syn2"]);
  });

  it("shows synchronized orders to finance but lets nobody edit them", async () => {
    const finance = await t.createUser("finance", "Finance");
    const rep = await t.createUser("sales_rep", "Rep");

    const financeRows = await t.asUser(finance.userId, (tx) =>
      tx.query("select id from public.erp_sales_orders"),
    );
    const repRows = await t.asUser(rep.userId, (tx) =>
      tx.query("select id from public.erp_sales_orders"),
    );
    const edit = await t
      .asUser(finance.userId, (tx) =>
        tx.query("update public.erp_sales_orders set total_amount = 0"),
      )
      .catch((error: Error) => error.message);

    expect(financeRows.rows).toHaveLength(18);
    expect(repRows.rows).toHaveLength(0);
    expect(edit).toContain("permission denied");
  });
});
