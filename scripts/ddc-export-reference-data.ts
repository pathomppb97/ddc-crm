/**
 * Exports the reference data seeded by the DDC migrations to JSON, for the
 * in-browser evaluation mode. Run after changing a migration:
 *
 *   npm run ddc:export-reference-data
 *
 * The migrations stay the single source: a unit test fails when this file is stale.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { createTestDb } from "../supabase/tests/helpers/testDb.ts";

export const REFERENCE_TABLES = [
  "ddc_roles",
  "permission_resources",
  "role_permissions",
  "business_models",
  "option_categories",
  "master_options",
  "product_hierarchy_nodes",
  "pipelines",
  "pipeline_stages",
  "app_settings",
  "erp_connector_config",
  "erp_entity_configs",
  "erp_field_mappings",
] as const;

export const exportReferenceData = async () => {
  const { db } = await createTestDb();
  const data: Record<string, unknown[]> = {};
  for (const table of REFERENCE_TABLES) {
    const { rows } = await db.query(`select * from public.${table} order by 1`);
    data[table] = rows.map((row) => {
      const record = { ...(row as Record<string, unknown>) };
      // react-admin needs an "id": tables keyed by text expose their key as id
      if (record.id === undefined) record.id = record.key ?? record.entity;
      delete record.updated_at;
      delete record.created_at;
      return record;
    });
  }
  return data;
};

const OUTPUT = path.resolve(process.cwd(), "src/ddc/demo/referenceData.json");

if (process.argv[1]?.endsWith("ddc-export-reference-data.ts")) {
  const data = await exportReferenceData();
  writeFileSync(OUTPUT, `${JSON.stringify(data, null, 1)}\n`);
  console.warn(`Wrote ${OUTPUT}`);
}
