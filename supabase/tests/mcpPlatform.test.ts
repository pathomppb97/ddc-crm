import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, expectRejected, type TestDb } from "./helpers/testDb";

type User = Awaited<ReturnType<TestDb["createUser"]>>;

let t: TestDb;
let superAdmin: User;
let manager: User;
let repA: User;
let org2Admin: User;

beforeAll(async () => {
  t = await createTestDb();
  superAdmin = await t.createUser("super_admin", "SuperAdmin");
  manager = await t.createUser("sales_manager", "SalesMgr");
  repA = await t.createUser("sales_rep", "RepA");
  org2Admin = await t.createUser("super_admin", "Org2Admin");

  // Create a second isolated organization and move org2Admin into it
  await t.db.exec(`
    insert into public.organizations (id, code, name, is_active, mcp_enabled)
    values (2, 'ddc_partner_org', 'Partner Agri Org', true, true)
  `);
  await t.db.query(
    "update public.sales set organization_id = 2 where id = $1",
    [org2Admin.salesId],
  );
  await t.db.query(
    `insert into public.companies (id, name, sales_id, organization_id)
     values (8001, 'Org1 Sugar Mill', $1, 1), (8002, 'Org2 Isolated Mill', $2, 2)`,
    [repA.salesId, org2Admin.salesId],
  );
});

describe("MCP platform database schema, RLS & audit invariants", () => {
  it("revokes anonymous access across all MCP & governance tables", async () => {
    const tables = [
      "organizations",
      "mcp_tools",
      "mcp_role_policies",
      "mcp_tool_permissions",
      "mcp_user_policies",
      "mcp_clients",
      "oauth_grants",
      "mcp_connections",
      "mcp_approval_requests",
      "mcp_execution_logs",
      "mcp_security_events",
      "saved_reports",
    ];
    for (const table of tables) {
      const msg = await expectRejected(
        t.asUser(null, (tx) => tx.query(`select * from public.${table}`)),
      );
      expect(msg).toContain("permission denied");
    }
  });

  it("enforces strict cross-organization isolation at PostgreSQL RLS layer", async () => {
    const org1Seen = await t.asUser(superAdmin.userId, (tx) =>
      tx.query<{ id: number }>("select id from public.companies order by id"),
    );
    const org2Seen = await t.asUser(org2Admin.userId, (tx) =>
      tx.query<{ id: number }>("select id from public.companies order by id"),
    );

    expect(org1Seen.rows.map((r) => Number(r.id))).toEqual([8001]);
    expect(org2Seen.rows.map((r) => Number(r.id))).toEqual([8002]);
  });

  it("keeps mcp_execution_logs and mcp_security_events append-only for authenticated users", async () => {
    await t.db.query(
      `insert into public.mcp_execution_logs (
         request_id, organization_id, user_id, sales_id, channel, tool_name,
         action, resource, risk_level, authorization_result, execution_result, duration_ms
       ) values ('req-log-1', 1, $1::uuid, $2, 'mcp', 'search_customers', 'read', 'customers', 'L0', 'allowed', 'success', 12)`,
      [repA.userId, repA.salesId],
    );

    const tamperLogs = await expectRejected(
      t.asUser(superAdmin.userId, (tx) =>
        tx.query("delete from public.mcp_execution_logs"),
      ),
    );
    const tamperSec = await expectRejected(
      t.asUser(superAdmin.userId, (tx) =>
        tx.query("delete from public.mcp_security_events"),
      ),
    );

    expect(tamperLogs).toContain("permission denied");
    expect(tamperSec).toContain("permission denied");
  });

  it("blocks self-approval in mcp_approval_requests via database constraint", async () => {
    const req = await t.db.query<{ id: number }>(
      `insert into public.mcp_approval_requests (
         organization_id, requesting_user_id, requesting_sales_id, tool_name,
         operation_summary, risk_level, target_resource, payload_hash
       ) values (1, $1::uuid, $2, 'update_user_status', 'Suspend test user', 'L4', 'users', repeat('a', 64))
       returning id`,
      [superAdmin.userId, superAdmin.salesId],
    );

    const selfApproveErr = await expectRejected(
      t.db.query(
        `update public.mcp_approval_requests
         set status = 'approved', decided_by_sales_id = $1, decided_at = now()
         where id = $2`,
        [superAdmin.salesId, req.rows[0].id],
      ),
    );
    expect(selfApproveErr).toContain("mcp_approval_no_self_decision");

    // Different authorized approver succeeds
    const okApprove = await t.db.query<{ status: string }>(
      `update public.mcp_approval_requests
       set status = 'approved', decided_by_sales_id = $1, decided_at = now()
       where id = $2 returning status`,
      [manager.salesId, req.rows[0].id],
    );
    expect(okApprove.rows[0].status).toBe("approved");
  });

  it("records channel, ai_client_id, and mcp_tool_name in audit_log", async () => {
    await t.asUser(repA.userId, async (tx) => {
      await tx.query(
        `select set_config('app.channel', 'mcp', true),
                set_config('app.ai_client_id', 'claude-desktop-ddc', true),
                set_config('app.mcp_tool_name', 'update_customer', true),
                set_config('app.request_id', 'mcp-audit-test-01', true)`,
      );
      await tx.query(
        "update public.companies set city = 'Udon Thani' where id = 8001",
      );
    });

    const { rows } = await t.db.query<{
      channel: string;
      ai_client_id: string | null;
      mcp_tool_name: string | null;
      request_id: string | null;
    }>(
      `select channel, ai_client_id, mcp_tool_name, request_id
       from public.audit_log
       where table_name = 'companies' and record_id = '8001'
       order by id desc limit 1`,
    );

    expect(rows[0]).toEqual({
      channel: "mcp",
      ai_client_id: "claude-desktop-ddc",
      mcp_tool_name: "update_customer",
      request_id: "mcp-audit-test-01",
    });
  });

  it("prevents sales_rep from modifying mcp_role_policies or mcp_tool_permissions", async () => {
    // RLS USING filters out all rows for sales_rep -> 0 rows affected on UPDATE
    const upd = await t.asUser(repA.userId, (tx) =>
      tx.query<{ role_key: string }>(
        `update public.mcp_role_policies set max_risk_level = 'L5' where role_key = 'sales_rep' returning role_key`,
      ),
    );
    expect(upd.rows).toHaveLength(0);

    // RLS WITH CHECK rejects INSERT into mcp_tool_permissions
    const insErr = await expectRejected(
      t.asUser(repA.userId, (tx) =>
        tx.query(
          `insert into public.mcp_tool_permissions (organization_id, role_key, tool_name, effect)
           values (1, 'sales_rep', 'invite_user', 'allow')`,
        ),
      ),
    );
    expect(insErr).toMatch(/row-level security|permission denied/i);

    const check = await t.db.query<{ max_risk_level: string }>(
      "select max_risk_level from public.mcp_role_policies where organization_id = 1 and role_key = 'sales_rep'",
    );
    expect(check.rows[0].max_risk_level).toBe("L2");
  });
});
