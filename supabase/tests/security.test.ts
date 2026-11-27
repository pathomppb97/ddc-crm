import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, expectRejected, type TestDb } from "./helpers/testDb";

type User = Awaited<ReturnType<TestDb["createUser"]>>;

let t: TestDb;
let admin: User;
let manager: User;
let repA: User;
let repB: User;
let engineer: User;
let quality: User;
let finance: User;
let readOnly: User;
let noRole: User;

const count = async (tx: { query: TestDb["db"]["query"] }, table: string) => {
  const { rows } = await tx.query<{ n: number }>(
    `select count(*) as n from public.${table}`,
  );
  return Number(rows[0].n);
};

beforeAll(async () => {
  t = await createTestDb();
  admin = await t.createUser("system_admin", "Admin");
  manager = await t.createUser("sales_manager", "Manager");
  repA = await t.createUser("sales_rep", "RepA");
  repB = await t.createUser("sales_rep", "RepB");
  engineer = await t.createUser("engineering", "Engineer");
  quality = await t.createUser("quality", "Quality");
  finance = await t.createUser("finance", "Finance");
  readOnly = await t.createUser("read_only", "Reader");
  noRole = await t.createUser(null, "NoRole");

  await t.db.query(
    `insert into public.companies (id, name, sales_id) values (1, 'Synthetic Customer A', $1), (2, 'Synthetic Customer B', $2)`,
    [repA.salesId, repB.salesId],
  );
});

describe("row level security", () => {
  it("makes the first registered user the administrator", () => {
    expect(admin.administrator).toBe(true);
    expect(manager.administrator).toBe(false);
  });

  it("hides all business data from anonymous visitors", async () => {
    const message = await expectRejected(
      t.asUser(null, (tx) => count(tx, "companies")),
    );

    expect(message).toContain("permission denied");
  });

  it("hides business data from a signed-in user without a role", async () => {
    const visible = await t.asUser(noRole.userId, (tx) =>
      count(tx, "companies"),
    );

    expect(visible).toBe(0);
  });

  it("lets a sales representative read all customers but update only their own", async () => {
    const visible = await t.asUser(repA.userId, (tx) => count(tx, "companies"));
    const own = await t.asUser(repA.userId, (tx) =>
      tx.query(
        "update public.companies set city = 'Bangkok' where id = 1 returning id",
      ),
    );
    const other = await t.asUser(repA.userId, (tx) =>
      tx.query(
        "update public.companies set city = 'Bangkok' where id = 2 returning id",
      ),
    );

    expect(visible).toBe(2);
    expect(own.rows).toHaveLength(1);
    expect(other.rows).toHaveLength(0);
  });

  it("prevents a sales representative from reassigning a customer to themselves", async () => {
    const result = await t.asUser(repA.userId, (tx) =>
      tx.query(
        "update public.companies set sales_id = $1 where id = 2 returning id",
        [repA.salesId],
      ),
    );

    expect(result.rows).toHaveLength(0);
  });

  it("prevents a sales representative from deleting customers", async () => {
    const result = await t.asUser(repA.userId, (tx) =>
      tx.query("delete from public.companies where id = 1 returning id"),
    );

    expect(result.rows).toHaveLength(0);
  });

  it("assigns ownership to the creator and lets a manager update any record", async () => {
    const created = await t.asUser(repA.userId, (tx) =>
      tx.query<{ id: number; sales_id: number }>(
        "insert into public.leads (company_name) values ('Synthetic Lead') returning id, sales_id",
      ),
    );
    const updated = await t.asUser(manager.userId, (tx) =>
      tx.query(
        "update public.leads set status = 'contacted' where id = $1 returning id",
        [created.rows[0].id],
      ),
    );

    expect(Number(created.rows[0].sales_id)).toBe(repA.salesId);
    expect(updated.rows).toHaveLength(1);
  });

  it("rejects every write from a read-only user", async () => {
    const insert = await expectRejected(
      t.asUser(readOnly.userId, (tx) =>
        tx.query("insert into public.leads (company_name) values ('Blocked')"),
      ),
    );
    const update = await t.asUser(readOnly.userId, (tx) =>
      tx.query("update public.companies set city = 'X' returning id"),
    );

    expect(insert).toContain("row-level security");
    expect(update.rows).toHaveLength(0);
  });

  it("lets engineering manage products and agricultural machine models while sales can only read them", async () => {
    const created = await t.asUser(engineer.userId, (tx) =>
      tx.query(
        `insert into public.products (id, part_number, name)
         values (10, 'SYN-ENG-001', 'Synthetic engineered part') returning id`,
      ),
    );
    await t.asUser(engineer.userId, (tx) =>
      tx.query(
        "insert into public.manufacturers (id, name) values (10, 'Synthetic Agri Maker')",
      ),
    );
    const machine = await t.asUser(engineer.userId, (tx) =>
      tx.query(
        "insert into public.machine_models (id, manufacturer_id, model_name) values (10, 10, 'SYN-AG-1') returning id",
      ),
    );
    const salesWrite = await expectRejected(
      t.asUser(repA.userId, (tx) =>
        tx.query(
          `insert into public.products (part_number, name)
           values ('SYN-REP-001', 'Blocked')`,
        ),
      ),
    );
    const salesMachineWrite = await expectRejected(
      t.asUser(repA.userId, (tx) =>
        tx.query(
          "insert into public.machine_models (manufacturer_id, model_name) values (10, 'Blocked')",
        ),
      ),
    );
    const salesRead = await t.asUser(repA.userId, (tx) =>
      count(tx, "products"),
    );
    const salesMachineRead = await t.asUser(repA.userId, (tx) =>
      count(tx, "machine_models"),
    );

    expect(created.rows).toHaveLength(1);
    expect(machine.rows).toHaveLength(1);
    expect(salesWrite).toContain("row-level security");
    expect(salesMachineWrite).toContain("row-level security");
    expect(salesRead).toBe(1);
    expect(salesMachineRead).toBe(1);
  });

  it("applies the parent permission to child rows", async () => {
    const ownChild = await t.asUser(repA.userId, (tx) =>
      tx.query(
        "insert into public.company_addresses (company_id, address) values (1, 'Synthetic road') returning id",
      ),
    );
    const otherChild = await expectRejected(
      t.asUser(repA.userId, (tx) =>
        tx.query(
          "insert into public.company_addresses (company_id, address) values (2, 'Blocked road')",
        ),
      ),
    );

    expect(ownChild.rows).toHaveLength(1);
    expect(otherChild).toContain("row-level security");
  });

  it("restricts complaints to the quality role for deletion and sales for creation", async () => {
    const created = await t.asUser(repA.userId, (tx) =>
      tx.query<{ id: number }>(
        "insert into public.service_cases (company_id, subject) values (1, 'Synthetic complaint') returning id",
      ),
    );
    const repDelete = await t.asUser(repA.userId, (tx) =>
      tx.query("delete from public.service_cases where id = $1 returning id", [
        created.rows[0].id,
      ]),
    );
    const qualityDelete = await t.asUser(quality.userId, (tx) =>
      tx.query("delete from public.service_cases where id = $1 returning id", [
        created.rows[0].id,
      ]),
    );

    expect(repDelete.rows).toHaveLength(0);
    expect(qualityDelete.rows).toHaveLength(1);
  });

  it("keeps the audit log readable by authorized roles only and append-only", async () => {
    const adminRows = await t.asUser(admin.userId, (tx) =>
      count(tx, "audit_log"),
    );
    const repRows = await t.asUser(repA.userId, (tx) => count(tx, "audit_log"));
    const tamper = await expectRejected(
      t.asUser(admin.userId, (tx) => tx.query("delete from public.audit_log")),
    );

    expect(adminRows).toBeGreaterThan(0);
    expect(repRows).toBe(0);
    expect(tamper).toContain("permission denied");
  });

  it("records who changed a record", async () => {
    await t.asUser(repA.userId, (tx) =>
      tx.query("update public.companies set zipcode = '10110' where id = 1"),
    );

    const { rows } = await t.db.query<{
      actor_sales_id: number;
      changed_fields: string[];
    }>(
      `select actor_sales_id, changed_fields from public.audit_log
       where table_name = 'companies' and record_id = '1' and action = 'UPDATE' order by id desc limit 1`,
    );

    expect(Number(rows[0].actor_sales_id)).toBe(repA.salesId);
    expect(rows[0].changed_fields).toContain("zipcode");
  });

  it("lets only administrators change the permission matrix", async () => {
    const escalation = await expectRejected(
      t.asUser(repA.userId, (tx) =>
        tx.query(
          "insert into public.role_permissions (role_key, resource, action) values ('sales_rep', 'customers', 'delete')",
        ),
      ),
    );
    const selfPromotion = await expectRejected(
      t
        .asUser(repA.userId, (tx) =>
          tx.query(
            "update public.sales set administrator = true where id = $1 returning id",
            [repA.salesId],
          ),
        )
        .then((result) => {
          if (result.rows.length === 0) throw new Error("no row updated");
        }),
    );

    expect(escalation).toContain("row-level security");
    expect(selfPromotion).toBeTruthy();
  });

  it("applies a permission change immediately", async () => {
    await t.asUser(admin.userId, (tx) =>
      tx.query(
        "insert into public.role_permissions (role_key, resource, action) values ('read_only', 'leads', 'create')",
      ),
    );

    const created = await t.asUser(readOnly.userId, (tx) =>
      tx.query(
        "insert into public.leads (company_name) values ('Now allowed') returning id",
      ),
    );
    await t.db.exec(
      "delete from public.role_permissions where role_key = 'read_only' and action = 'create'",
    );

    expect(created.rows).toHaveLength(1);
  });

  it("blocks a disabled account", async () => {
    await t.db.query("update public.sales set disabled = true where id = $1", [
      repB.salesId,
    ]);

    const visible = await t.asUser(repB.userId, (tx) => count(tx, "companies"));
    await t.db.query("update public.sales set disabled = false where id = $1", [
      repB.salesId,
    ]);

    expect(visible).toBe(0);
  });

  it("exposes ERP configuration to finance in read-only mode and hides it from sales", async () => {
    const financeRows = await t.asUser(finance.userId, (tx) =>
      count(tx, "erp_entity_configs"),
    );
    const repRows = await t.asUser(repA.userId, (tx) =>
      count(tx, "erp_entity_configs"),
    );
    const financeWrite = await t.asUser(finance.userId, (tx) =>
      tx.query(
        "update public.erp_connector_config set is_enabled = true returning id",
      ),
    );

    expect(financeRows).toBe(11);
    expect(repRows).toBe(0);
    expect(financeWrite.rows).toHaveLength(0);
  });

  it("returns the effective permissions of the connected user", async () => {
    const { rows } = await t.asUser(repA.userId, (tx) =>
      tx.query<{ resource: string; action: string; scope: string }>(
        "select * from public.ddc_my_permissions() where resource = 'customers' order by action",
      ),
    );

    expect(rows).toEqual([
      { resource: "customers", action: "create", scope: "all" },
      { resource: "customers", action: "read", scope: "all" },
      { resource: "customers", action: "update", scope: "own" },
    ]);
  });
});
