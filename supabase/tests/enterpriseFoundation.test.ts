import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, expectRejected, type TestDb } from "./helpers/testDb";

type User = Awaited<ReturnType<TestDb["createUser"]>>;

let t: TestDb;
let superAdmin: User;
let releaseManager: User;
let dataAdmin: User;
let execViewer: User;
let repA: User;
let repB: User;
let readOnly: User;

beforeAll(async () => {
  t = await createTestDb();
  superAdmin = await t.createUser("super_admin", "SuperAdmin");
  releaseManager = await t.createUser("release_manager", "ReleaseMgr");
  dataAdmin = await t.createUser("data_admin", "DataAdmin");
  execViewer = await t.createUser("executive_viewer", "Exec");
  repA = await t.createUser("sales_rep", "RepA");
  repB = await t.createUser("sales_rep", "RepB");
  readOnly = await t.createUser("read_only", "Reader");

  await t.db.query(
    `insert into public.companies (id, name, sales_id)
     values (5001, 'Customer Owned By RepA', $1), (5002, 'Customer Owned By RepB', $2)`,
    [repA.salesId, repB.salesId],
  );
});

describe("Phase 1 security hardening", () => {
  it("SEC-01: blocks a disabled administrator from passing is_admin() or modifying config/RBAC", async () => {
    await t.db.query("update public.sales set disabled = true where id = $1", [
      superAdmin.salesId,
    ]);

    const adminCheck = await t.asUser(superAdmin.userId, (tx) =>
      tx.query<{ ok: boolean }>("select public.is_admin() as ok"),
    );
    const configWrite = await t.asUser(superAdmin.userId, (tx) =>
      tx.query(
        "update public.configuration set config = '{\"tampered\":true}'::jsonb where id = 1 returning id",
      ),
    );
    const roleEscalation = await expectRejected(
      t.asUser(superAdmin.userId, (tx) =>
        tx.query(
          "insert into public.role_permissions (role_key, resource, action) values ('read_only', 'users', 'delete')",
        ),
      ),
    );

    await t.db.query("update public.sales set disabled = false where id = $1", [
      superAdmin.salesId,
    ]);

    expect(adminCheck.rows[0].ok).toBe(false);
    expect(configWrite.rows).toHaveLength(0);
    expect(roleEscalation).toContain("row-level security");
  });

  it("SEC-05: revokes anon access to activity_log, favicons_excluded_domains, get_avatar_for_email, and control-plane tables", async () => {
    const tables = [
      "activity_log",
      "favicons_excluded_domains",
      "ui_config_versions",
      "feature_flags",
      "releases",
      "deployments",
      "scheduled_jobs",
      "api_keys",
      "sales_orders",
    ];
    for (const table of tables) {
      const msg = await expectRejected(
        t.asUser(null, (tx) => tx.query(`select * from public.${table}`)),
      );
      expect(msg).toContain("permission denied");
    }

    const avatarCall = await expectRejected(
      t.asUser(null, (tx) =>
        tx.query("select public.get_avatar_for_email('victim@example.com')"),
      ),
    );
    expect(avatarCall).toContain("permission denied");
  });

  it("SEC-05/06: prevents read_only users from modifying tags or deleting storage attachments", async () => {
    const tagInsert = await expectRejected(
      t.asUser(readOnly.userId, (tx) =>
        tx.query(
          "insert into public.tags (name, color) values ('Unauthorized', '#000000')",
        ),
      ),
    );
    expect(tagInsert).toContain("row-level security");

    await t.db.exec(`
      grant usage on schema storage to authenticated;
      grant select, insert, delete on table storage.objects to authenticated;
      insert into storage.objects (bucket_id, name) values ('attachments', 'sample.pdf');
    `);
    const deleted = await t.asUser(readOnly.userId, (tx) =>
      tx.query(
        "delete from storage.objects where bucket_id = 'attachments' returning id",
      ),
    );
    expect(deleted.rows).toHaveLength(0);
  });

  it("SEC-08: enforces parent customer ownership on document_references for own-scoped reps", async () => {
    const ownDoc = await t.asUser(repA.userId, (tx) =>
      tx.query<{ id: number }>(
        "insert into public.document_references (entity_type, entity_id, title) values ('companies', 5001, 'Own Drawing') returning id",
      ),
    );
    const otherDoc = await expectRejected(
      t.asUser(repA.userId, (tx) =>
        tx.query(
          "insert into public.document_references (entity_type, entity_id, title) values ('companies', 5002, 'Other Drawing')",
        ),
      ),
    );

    expect(ownDoc.rows).toHaveLength(1);
    expect(otherDoc).toContain("row-level security");
  });

  it("SEC-09: redacts secret keys and truncates oversized base64 data URIs in audit_log", async () => {
    await t.asUser(superAdmin.userId, async (tx) => {
      await tx.query(
        "select set_config('app.request_id', 'req-audit-001', true), set_config('app.audit_reason', 'Phase 1 test', true)",
      );
      await tx.query(
        `insert into public.api_keys (name, key_prefix, key_hash, owner_sales_id)
         values ('Integration Key', 'ddc_live', 'super-secret-sha256-hash-value', $1)`,
        [superAdmin.salesId],
      );
    });

    const keyAudit = await t.db.query<{
      new_data: Record<string, unknown>;
      request_id: string | null;
      reason: string | null;
    }>(
      `select new_data, request_id, reason from public.audit_log
       where table_name = 'api_keys' order by id desc limit 1`,
    );

    expect(keyAudit.rows[0].new_data.key_hash).toBe("[REDACTED]");
    expect(keyAudit.rows[0].request_id).toBe("req-audit-001");
    expect(keyAudit.rows[0].reason).toBe("Phase 1 test");

    const hugeDataUri = `data:image/jpeg;base64,${"A".repeat(3000)}`;
    await t.db.query(
      `insert into public.activity_photos (company_id, photo_tag, image_src)
       values (5001, 'part_sample', $1)`,
      [hugeDataUri],
    );
    const photoAudit = await t.db.query<{ new_data: Record<string, unknown> }>(
      `select new_data from public.audit_log
       where table_name = 'activity_photos' order by id desc limit 1`,
    );
    expect(photoAudit.rows[0].new_data.image_src).toEqual({
      redacted_data_uri: true,
      bytes: hugeDataUri.length,
    });
  });
});

describe("Phase 1 enterprise schema & control-plane invariants", () => {
  it("increments optimistic concurrency version on core entity updates", async () => {
    const before = await t.db.query<{ version: number }>(
      "select version from public.companies where id = 5001",
    );
    await t.db.query(
      "update public.companies set city = 'Khon Kaen' where id = 5001",
    );
    const after = await t.db.query<{ version: number }>(
      "select version from public.companies where id = 5001",
    );

    expect(after.rows[0].version).toBe(before.rows[0].version + 1);
  });

  it("enforces atomic UI configuration publishing and rollback", async () => {
    const v1 = await t.asUser(superAdmin.userId, (tx) =>
      tx.query<{ id: number }>(
        `insert into public.ui_config_versions (environment, version_number, status, config_payload, change_summary)
         values ('production', 1, 'approved', '{"branding":{"title":"DDC v1"}}'::jsonb, 'Initial release')
         returning id`,
      ),
    );
    const v2 = await t.asUser(superAdmin.userId, (tx) =>
      tx.query<{ id: number }>(
        `insert into public.ui_config_versions (environment, version_number, status, config_payload, change_summary)
         values ('production', 2, 'approved', '{"branding":{"title":"DDC v2"}}'::jsonb, 'Theme refresh')
         returning id`,
      ),
    );

    // Non-authorized sales rep cannot publish
    const repPublish = await expectRejected(
      t.asUser(repA.userId, (tx) =>
        tx.query("select * from public.publish_ui_config_version($1)", [
          v1.rows[0].id,
        ]),
      ),
    );
    expect(repPublish).toContain("Not allowed to publish UI configuration");

    // Release manager publishes v1, then v2 atomically supersedes v1
    await t.asUser(releaseManager.userId, (tx) =>
      tx.query("select * from public.publish_ui_config_version($1)", [
        v1.rows[0].id,
      ]),
    );
    await t.asUser(releaseManager.userId, (tx) =>
      tx.query("select * from public.publish_ui_config_version($1)", [
        v2.rows[0].id,
      ]),
    );

    const states = await t.db.query<{ version_number: number; status: string }>(
      "select version_number, status from public.ui_config_versions where environment = 'production' order by version_number",
    );
    expect(states.rows).toEqual([
      { version_number: 1, status: "superseded" },
      { version_number: 2, status: "published" },
    ]);

    // Roll back to v1 atomically creates v3 published and marks v2 rolled_back
    const rolled = await t.asUser(releaseManager.userId, (tx) =>
      tx.query<{
        version_number: number;
        status: string;
        config_payload: { branding: { title: string } };
      }>(
        "select version_number, status, config_payload from public.rollback_ui_config_version($1, 'Revert regression')",
        [v1.rows[0].id],
      ),
    );
    expect(rolled.rows[0].version_number).toBe(3);
    expect(rolled.rows[0].status).toBe("published");
    expect(rolled.rows[0].config_payload.branding.title).toBe("DDC v1");
  });

  it("blocks production deployment of an unapproved release and enforces role separation", async () => {
    // Data admin cannot create releases
    const dataAdminRelease = await expectRejected(
      t.asUser(dataAdmin.userId, (tx) =>
        tx.query(
          `insert into public.releases (release_tag, environment, app_target, git_sha, artifact_uri, artifact_checksum, build_status, approval_status)
           values ('v1.0.0-denied', 'production', 'crm', 'abcdef1', 's3://bucket/crm-v1.tgz', 'sha256:abc', 'succeeded', 'approved')`,
        ),
      ),
    );
    expect(dataAdminRelease).toContain("row-level security");

    // Release manager registers unapproved release
    const rel = await t.asUser(releaseManager.userId, (tx) =>
      tx.query<{ id: number }>(
        `insert into public.releases (release_tag, environment, app_target, git_sha, artifact_uri, artifact_checksum, build_status, approval_status)
         values ('v1.0.0-rc1', 'production', 'crm', '1234567', 's3://bucket/crm-v1.tgz', 'sha256:123', 'succeeded', 'pending')
         returning id`,
      ),
    );

    const unapprovedDeploy = await expectRejected(
      t.asUser(releaseManager.userId, (tx) =>
        tx.query(
          `insert into public.deployments (release_id, environment, status)
           values ($1, 'production', 'running')`,
          [rel.rows[0].id],
        ),
      ),
    );
    expect(unapprovedDeploy).toContain("approved release artifact");

    // Approve release -> production deployment allowed
    await t.asUser(releaseManager.userId, (tx) =>
      tx.query(
        "update public.releases set approval_status = 'approved', approved_by_sales_id = $1, approved_at = now() where id = $2",
        [releaseManager.salesId, rel.rows[0].id],
      ),
    );
    const approvedDeploy = await t.asUser(releaseManager.userId, (tx) =>
      tx.query<{ id: number }>(
        `insert into public.deployments (release_id, environment, status)
         values ($1, 'production', 'scheduled') returning id`,
        [rel.rows[0].id],
      ),
    );
    expect(approvedDeploy.rows).toHaveLength(1);
  });

  it("enforces job idempotency and distributed worker leasing (claim_scheduled_job)", async () => {
    const job1 = await t.asUser(dataAdmin.userId, (tx) =>
      tx.query<{ id: number }>(
        `insert into public.scheduled_jobs (job_type, queue_name, idempotency_key, status, payload, created_by_sales_id)
         values ('data_export', 'exports', 'export-customers-20261127', 'pending', '{"resource":"companies"}'::jsonb, $1)
         returning id`,
        [dataAdmin.salesId],
      ),
    );

    // Duplicate active idempotency key rejected
    const duplicate = await expectRejected(
      t.asUser(dataAdmin.userId, (tx) =>
        tx.query(
          `insert into public.scheduled_jobs (job_type, queue_name, idempotency_key, status, payload)
           values ('data_export', 'exports', 'export-customers-20261127', 'pending', '{}'::jsonb)`,
        ),
      ),
    );
    expect(duplicate).toContain("scheduled_jobs_active_idempotency_idx");

    // Authenticated client cannot call claim_scheduled_job directly (service_role only)
    const userClaim = await expectRejected(
      t.asUser(dataAdmin.userId, (tx) =>
        tx.query(
          "select * from public.claim_scheduled_job('rogue-worker', 'exports', 60)",
        ),
      ),
    );
    expect(userClaim).toContain("permission denied");

    // Service role claims the job cleanly
    const claimed = await t.db.query<{
      id: number;
      status: string;
      locked_by: string;
      attempt_count: number;
    }>(
      "select id, status, locked_by, attempt_count from public.claim_scheduled_job('worker-01', 'exports', 120)",
    );

    expect(Number(claimed.rows[0].id)).toBe(Number(job1.rows[0].id));
    expect(claimed.rows[0].status).toBe("running");
    expect(claimed.rows[0].locked_by).toBe("worker-01");
    expect(claimed.rows[0].attempt_count).toBe(1);
  });

  it("keeps executive_viewer strictly read-only across CRM and control-plane tables", async () => {
    const companiesRead = await t.asUser(execViewer.userId, (tx) =>
      tx.query("select id from public.companies"),
    );
    const writeBlocked = await expectRejected(
      t.asUser(execViewer.userId, (tx) =>
        tx.query(
          "insert into public.leads (company_name) values ('Blocked Exec Write')",
        ),
      ),
    );

    expect(companiesRead.rows.length).toBeGreaterThanOrEqual(2);
    expect(writeBlocked).toContain("row-level security");
  });
});
