import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, expectRejected, type TestDb } from "./helpers/testDb";

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
});

describe("DDC schema", () => {
  it("applies every migration and protects all public tables with RLS", async () => {
    const { rows } = await t.db.query<{ tablename: string }>(
      `select c.relname as tablename
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );

    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  it("maps every business table to a permission resource", async () => {
    const { rows } = await t.db.query<{ tablename: string }>(
      `select tablename from pg_tables t
       where schemaname = 'public'
         and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename)
         and tablename <> 'user_invitations'`,
    );

    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  it("seeds the nine DDC roles, ten business models and Agriculture-only reference data", async () => {
    const roles = await t.db.query<{ key: string }>(
      "select key from public.ddc_roles order by sort_order",
    );
    const models = await t.db.query("select code from public.business_models");
    const families = await t.db.query<{ code: string }>(
      "select code from public.product_hierarchy_nodes where level = 'family' order by sort_order",
    );
    const removedTables = await t.db.query<{ tablename: string }>(
      `select tablename from pg_tables
       where schemaname = 'public'
         and tablename in ('divisions', 'vehicle_models', 'product_vehicle_fitments')`,
    );
    const vehicleOptions = await t.db.query(
      "select key from public.option_categories where key = 'vehicle_type'",
    );

    expect(roles.rows.map((r) => r.key)).toEqual([
      "super_admin",
      "system_admin",
      "release_manager",
      "data_admin",
      "management",
      "executive_viewer",
      "sales_manager",
      "sales_rep",
      "marketing",
      "engineering",
      "quality",
      "finance",
      "read_only",
    ]);
    expect(models.rows).toHaveLength(10);
    expect(families.rows.map((r) => r.code)).toEqual([
      "BASE_CUTTER_BLADE",
      "CHOPPER_BLADE",
      "SPROCKET",
      "DRIVE_COMPONENT",
    ]);
    expect(removedTables.rows).toEqual([]);
    expect(vehicleOptions.rows).toEqual([]);
  });

  it("seeds no operational business data", async () => {
    const { rows } = await t.db.query<{ total: number }>(
      `select (select count(*) from public.companies) + (select count(*) from public.products)
            + (select count(*) from public.leads) + (select count(*) from public.quotations)
            + (select count(*) from public.erp_sales_orders) as total`,
    );

    expect(Number(rows[0].total)).toBe(0);
  });

  it("ships with the real ERP connector disabled and unapproved", async () => {
    const { rows } = await t.db.query<Record<string, unknown>>(
      "select connector_type, is_enabled, approval_status from public.erp_connector_config",
    );

    expect(rows).toEqual([
      {
        connector_type: "mock",
        is_enabled: false,
        approval_status: "not_requested",
      },
    ]);
  });

  it("refuses to enable the Dynamics 365 connector without a recorded approval", async () => {
    const message = await expectRejected(
      t.db.exec(
        "update public.erp_connector_config set connector_type = 'd365fo', environment_type = 'sandbox', is_enabled = true",
      ),
    );

    expect(message).toContain("erp_connector_config_real_needs_approval");
  });
});

describe("master data integrity", () => {
  it("lets one customer hold several business models", async () => {
    await t.db.exec(`
      insert into public.companies (id, name) values (9001, 'Synthetic Multi Model Co');
      insert into public.company_business_models (company_id, business_model_id)
      select 9001, bm.id
      from public.business_models bm
      where bm.code in ('OEM', 'DISTRIBUTOR', 'OBM');
    `);

    const { rows } = await t.db.query<{
      business_model_ids: number[];
    }>(
      "select business_model_ids from public.companies_summary where id = 9001",
    );

    expect(rows[0].business_model_ids).toHaveLength(3);
  });

  it("assigns a customer code when none is given", async () => {
    const { rows } = await t.db.query<{ customer_code: string }>(
      "select customer_code from public.companies where id = 9001",
    );

    expect(rows[0].customer_code).toMatch(/^CUS-\d{6}$/);
  });

  it("rejects an option from the wrong category", async () => {
    const leadSource = await t.optionId("lead_source", "referral");

    const message = await expectRejected(
      t.db.query(
        "update public.companies set lifecycle_status_id = $1 where id = 9001",
        [leadSource],
      ),
    );

    expect(message).toContain("expected category customer_lifecycle_status");
  });

  it("rejects a product hierarchy node placed under a lower level", async () => {
    const message = await expectRejected(
      t.db.exec(`
        insert into public.product_hierarchy_nodes (id, level, code, name)
        values (7001, 'type', 'T1', 'Type 1');
        insert into public.product_hierarchy_nodes (parent_id, level, code, name)
        values (7001, 'category', 'C1', 'Category 1');
      `),
    );

    expect(message).toContain("cannot be placed under");
  });

  it("supports many-to-many agricultural machine applications and keeps them unverified until a source is recorded", async () => {
    await t.db.exec(`
      insert into public.manufacturers (id, name) values (1, 'Synthetic Harvesters');
      insert into public.machine_models (id, manufacturer_id, model_name) values (1, 1, 'SYN-H1'), (2, 1, 'SYN-H2');
      insert into public.products (id, part_number, name)
      values (1, 'SYN-BLADE-001', 'Synthetic blade 1'), (2, 'SYN-BLADE-002', 'Synthetic blade 2');
      insert into public.product_machine_applications (product_id, machine_model_id, component_application)
      values (1, 1, 'Basecutter'), (1, 2, 'Basecutter'), (2, 1, 'Chopper');
    `);

    const status = await t.db.query<{ verification_status: string }>(
      "select distinct verification_status from public.product_machine_applications",
    );
    const message = await expectRejected(
      t.db.exec(
        "update public.product_machine_applications set verification_status = 'verified' where product_id = 2",
      ),
    );
    await t.db.exec(
      "update public.product_machine_applications set verification_status = 'verified', verification_source = 'Drawing REV-A' where product_id = 2",
    );
    const verified = await t.db.query<{ verified_at: string | null }>(
      "select verified_at from public.product_machine_applications where product_id = 2",
    );

    expect(status.rows).toEqual([{ verification_status: "unverified" }]);
    expect(message).toContain(
      "product_machine_applications_verified_has_source",
    );
    expect(verified.rows[0].verified_at).not.toBeNull();
  });

  it("enforces customer consistency for linked contacts, RFQs and opportunities", async () => {
    await t.db.exec(`
      insert into public.companies (id, name) values (9002, 'Synthetic Customer Two');
      insert into public.contacts (id, first_name, last_name, company_id)
      values (9101, 'Contact', 'One', 9001), (9102, 'Contact', 'Two', 9002);
      insert into public.rfqs (id, company_id, contact_id, subject)
      values (9201, 9001, 9101, 'Matching RFQ');
    `);

    const wrongContact = await expectRejected(
      t.db.exec(
        "insert into public.quotations (company_id, contact_id, subject) values (9001, 9102, 'Cross-company contact')",
      ),
    );
    const wrongRfq = await expectRejected(
      t.db.exec(
        "insert into public.quotations (company_id, rfq_id, subject) values (9002, 9201, 'Cross-company RFQ')",
      ),
    );
    const matching = await t.db.query<{ id: number }>(
      "insert into public.quotations (company_id, contact_id, rfq_id, subject) values (9001, 9101, 9201, 'Valid quotation') returning id",
    );

    expect(wrongContact).toContain("does not belong to customer");
    expect(wrongRfq).toContain("does not belong to customer");
    expect(matching.rows).toHaveLength(1);
  });

  it("requires a closure summary to close a service case", async () => {
    await t.db.exec(
      "insert into public.service_cases (id, company_id, subject) values (1, 9001, 'Synthetic case')",
    );

    const message = await expectRejected(
      t.db.exec(
        "update public.service_cases set status = 'closed' where id = 1",
      ),
    );
    await t.db.exec(
      "update public.service_cases set status = 'closed', closure_summary = 'Resolved' where id = 1",
    );
    const { rows } = await t.db.query<{
      case_no: string;
      closed_at: string | null;
    }>("select case_no, closed_at from public.service_cases where id = 1");

    expect(message).toContain("service_cases_closed_has_summary");
    expect(rows[0].case_no).toMatch(/^CASE-\d{4}-\d{5}$/);
    expect(rows[0].closed_at).not.toBeNull();
  });

  it("records inserts, updates and deletes in the audit log", async () => {
    await t.db.exec(`
      insert into public.territories (id, code, name) values (501, 'T-AUDIT', 'Audit territory');
      update public.territories set name = 'Audit territory renamed' where id = 501;
      delete from public.territories where id = 501;
    `);

    const { rows } = await t.db.query<{
      action: string;
      changed_fields: string[] | null;
    }>(
      "select action, changed_fields from public.audit_log where table_name = 'territories' and record_id = '501' order by id",
    );

    expect(rows.map((r) => r.action)).toEqual(["INSERT", "UPDATE", "DELETE"]);
    expect(rows[1].changed_fields).toEqual(["name"]);
  });
});

describe("evaluation mode permission matrix", () => {
  it("is identical to the matrix seeded in the database", async () => {
    const { defaultPermissionsFor, DEFAULT_ROLE_KEYS } =
      await import("../../src/ddc/domain/defaultPermissions");
    const { rows } = await t.db.query<{
      role_key: string;
      resource: string;
      action: string;
      scope: string;
    }>(
      "select role_key, resource, action, scope from public.role_permissions order by 1, 2, 3",
    );
    const fromCode = DEFAULT_ROLE_KEYS.flatMap((role) =>
      defaultPermissionsFor(role).map((p) => ({ role_key: role, ...p })),
    ).sort((a, b) =>
      `${a.role_key}|${a.resource}|${a.action}`.localeCompare(
        `${b.role_key}|${b.resource}|${b.action}`,
      ),
    );
    const fromDb = [...rows].sort((a, b) =>
      `${a.role_key}|${a.resource}|${a.action}`.localeCompare(
        `${b.role_key}|${b.resource}|${b.action}`,
      ),
    );

    expect(fromCode).toEqual(fromDb);
  });
});

describe("opportunity pipelines", () => {
  it("assigns the default pipeline to an opportunity created without one", async () => {
    const { rows } = await t.db.query<{ code: string }>(
      `insert into public.deals (name, company_id, stage) values ('Synthetic deal', 9001, 'opportunity')
       returning (select code from public.pipelines p where p.id = pipeline_id) as code`,
    );

    expect(rows[0].code).toBe("STANDARD");
  });
});

describe("field sales mobile & desktop extensions", () => {
  it("seeds the 5 customer groups and persists visit demand, contacts with LINE ID, capacity, replacement frequency and photos", async () => {
    const groups = await t.db.query<{ code: string }>(
      "select code from public.master_options where category = 'customer_group' order by sort_order",
    );
    expect(groups.rows.map((r) => r.code)).toEqual([
      "sugar_mill",
      "dealer",
      "repair_shop",
      "parts_shop",
      "farm_owner",
    ]);

    const millGroupId = await t.optionId("customer_group", "sugar_mill");
    const visitTypeId = await t.optionId("activity_type", "onsite_visit");
    await t.db.query(
      `update public.companies
       set customer_group_id = $1, latitude = 17.5152, longitude = 99.7614, location_note = 'Gate 2'
       where id = 9001`,
      [millGroupId],
    );
    const compSummary = await t.db.query<{
      customer_group_id: number;
      latitude: number;
      longitude: number;
    }>(
      "select customer_group_id, latitude, longitude from public.companies_summary where id = 9001",
    );
    expect(Number(compSummary.rows[0].customer_group_id)).toBe(millGroupId);
    expect(Number(compSummary.rows[0].latitude)).toBeCloseTo(17.5152, 4);

    // Single-name Thai contact with LINE ID (last_name defaults to '')
    const contactRes = await t.db.query<{
      id: number;
      last_name: string;
      line_id: string;
    }>(
      `insert into public.contacts (first_name, company_id, line_id)
       values ('คุณเป้', 9001, 'pae.ddc')
       returning id, last_name, line_id`,
    );
    expect(contactRes.rows[0].last_name).toBe("");
    expect(contactRes.rows[0].line_id).toBe("pae.ddc");

    const actRes = await t.db.query<{ id: number; logged_at: string }>(
      `insert into public.activities (activity_type_id, subject, company_id, start_at, checkin_lat, checkin_lng, status)
       values ($1, 'Field visit test', 9001, now(), 17.5152, 99.7614, 'completed')
       returning id, logged_at`,
      [visitTypeId],
    );
    const actId = Number(actRes.rows[0].id);
    expect(actRes.rows[0].logged_at).toBeTruthy();

    await t.db.query(
      `insert into public.activity_products (activity_id, custom_part_name, quantity, uom, urgency)
       values ($1, 'Custom Basecutter Blade 5mm', 2000, 'pcs', 'this_season')`,
      [actId],
    );
    await t.db.query(
      `insert into public.customer_capacity_profiles (company_id, season_label, total_vehicles, tons_per_vehicle, total_tons_per_season, fleet_breakdown)
       values (9001, '2569/70', 42, 17143, 720000, '[{"brand":"John Deere","model":"CH570","count":19}]'::jsonb)`,
    );
    await t.db.query(
      `insert into public.customer_part_usage (company_id, part_label, qty_per_change, change_interval_value, change_interval_unit, estimated_season_qty, recorded_activity_id)
       values (9001, 'ใบมีดตัดโคน 5mm', 10, 500, 'tons', 14400, $1)`,
      [actId],
    );
    await t.db.query(
      `insert into public.activity_photos (company_id, activity_id, photo_tag, caption, image_src)
       values (9001, $1, 'part_sample', 'Blade edge wear', 'data:image/jpeg;base64,AAAA')`,
      [actId],
    );

    const photoCount = await t.db.query<{ n: number }>(
      "select count(*) as n from public.activity_photos where activity_id = $1",
      [actId],
    );
    expect(Number(photoCount.rows[0].n)).toBe(1);
  });
});
