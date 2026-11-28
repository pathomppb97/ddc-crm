import { describe, expect, it } from "vitest";
import { generateDdcDemoData } from "../demo/generateDemoData";
import { RESOURCE_PERMISSION_MAP } from "../domain/permissions";
import { RESOURCE_DEFS } from "./registry";

const CORE_AND_SUPPORT_TABLES = [
  "companies",
  "contacts",
  "deals",
  "sales",
  "tags",
  "tasks",
  "contact_notes",
  "deal_notes",
  "configuration",
  "permission_resources",
  "role_permissions",
  "app_settings",
  "notifications",
  "erp_connector_config",
  "erp_external_ids",
];

describe("demo data parity and referential integrity", () => {
  it("provides every registered resource, child, and support table in generateDdcDemoData", () => {
    const db = generateDdcDemoData();
    const expected = new Set([
      ...RESOURCE_DEFS.map((d) => d.name),
      ...RESOURCE_DEFS.flatMap((d) =>
        (d.children ?? []).map((c) => c.resource),
      ),
      ...CORE_AND_SUPPORT_TABLES,
    ]);

    const missing = [...expected].filter((name) => !Array.isArray(db[name]));
    expect(missing).toEqual([]);
  });

  it("maintains referential integrity across customer list evidence and field sales collections", () => {
    const db = generateDdcDemoData();
    const companyIds = new Set(db.companies.map((c) => String(c.id)));
    const sourceById = new Map(
      db.customer_source_rows.map((r) => [String(r.id), r]),
    );
    const reqById = new Map(
      db.customer_requirements.map((r) => [String(r.id), r]),
    );

    expect(db.customer_source_rows.length).toBeGreaterThan(0);
    for (const row of db.customer_source_rows) {
      expect(companyIds.has(String(row.company_id))).toBe(true);
      expect(Number(row.source_row)).toBeGreaterThan(0);
    }

    for (const fleet of db.customer_fleets) {
      const src = sourceById.get(String(fleet.source_id));
      expect(src).toBeDefined();
      expect(String(src?.company_id)).toBe(String(fleet.company_id));
    }

    for (const req of db.customer_requirements) {
      const src = sourceById.get(String(req.source_id));
      expect(src).toBeDefined();
      expect(String(src?.company_id)).toBe(String(req.company_id));
      expect(["Basecutter Blade", "Chopper Blade"]).toContain(
        req.product_family,
      );
    }

    for (const sample of db.customer_samples) {
      const src = sourceById.get(String(sample.source_id));
      const req = reqById.get(String(sample.requirement_id));
      expect(src).toBeDefined();
      expect(req).toBeDefined();
      expect(String(src?.company_id)).toBe(String(sample.company_id));
      expect(String(req?.company_id)).toBe(String(sample.company_id));
    }

    for (const hist of db.customer_purchase_history) {
      const src = sourceById.get(String(hist.source_id));
      const req = reqById.get(String(hist.requirement_id));
      expect(src).toBeDefined();
      expect(req).toBeDefined();
      expect(["25-26", "26-27"]).toContain(hist.season);
    }

    for (const cap of db.customer_capacity_profiles) {
      expect(companyIds.has(String(cap.company_id))).toBe(true);
      expect(["owner", "service_shop", "dealer_network"]).toContain(
        cap.capacity_role,
      );
      expect(Array.isArray(cap.fleet_breakdown)).toBe(true);
    }

    for (const usage of db.customer_part_usage) {
      expect(companyIds.has(String(usage.company_id))).toBe(true);
      expect(["tons", "days", "hours", "rai", "season"]).toContain(
        usage.change_interval_unit,
      );
    }

    for (const activity of db.activities) {
      expect(activity.logged_at).toBeTruthy();
    }
    for (const company of db.companies) {
      expect(company.customer_group_id).toBeDefined();
    }
  });

  it("maps every non-admin-metadata resource in RESOURCE_DEFS to an RBAC permission key", () => {
    const adminOrPolymorphic = new Set([
      "approval_rules",
      "ddc_roles",
      "document_references",
      "erp_entity_configs",
      "erp_field_mappings",
      "erp_legal_entities",
      "option_categories",
    ]);
    const unmapped = RESOURCE_DEFS.map((d) => d.name).filter(
      (name) =>
        !adminOrPolymorphic.has(name) && !(name in RESOURCE_PERMISSION_MAP),
    );
    expect(unmapped).toEqual([]);
  });
});
