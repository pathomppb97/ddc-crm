import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findDefinitionProblems, RESOURCE_DEFS } from "./registry";

// Columns of every table and view, read from the SQL in migration order so that
// a screen never references a column or table that does not exist (or was dropped).
const sqlColumns = () => {
  const root = path.resolve(__dirname, "../../../supabase");
  const files = [
    ...readdirSync(path.join(root, "schemas"))
      .sort()
      .map((f) => path.join(root, "schemas", f)),
    ...readdirSync(path.join(root, "migrations"))
      .filter((f) => f.includes("_ddc_"))
      .sort()
      .map((f) => path.join(root, "migrations", f)),
  ];
  const columns = new Map<string, Set<string>>();
  const add = (table: string, column: string) => {
    if (!columns.has(table)) columns.set(table, new Set(["id"]));
    columns.get(table)!.add(column);
  };
  for (const file of files) {
    const sql = readFileSync(file, "utf8");
    for (const match of sql.matchAll(
      /drop (?:table|view) (?:if exists )?public\.(\w+)/g,
    )) {
      columns.delete(match[1]);
    }
    for (const match of sql.matchAll(
      /create table public\.(\w+) \(([\s\S]*?)\n\);/g,
    )) {
      for (const line of match[2].split("\n")) {
        const column = line.trim().match(/^"?([a-z_0-9]+)"? /)?.[1];
        if (column && !["constraint", "primary", "unique"].includes(column))
          add(match[1], column);
      }
    }
    for (const match of sql.matchAll(
      /alter table public\.(\w+)\s+((?:add column[\s\S]*?[,;]\s*)+)/g,
    )) {
      for (const column of match[2].matchAll(
        /add column (?:if not exists )?(\w+)/g,
      ))
        add(match[1], column[1]);
    }
    for (const match of sql.matchAll(
      /alter table public\.(\w+)\s+drop column (?:if exists )?(\w+)/g,
    )) {
      columns.get(match[1])?.delete(match[2]);
    }
    for (const match of sql.matchAll(
      /create (?:or replace )?view public\.(\w+)[\s\S]*?select([\s\S]*?)\nfrom/g,
    )) {
      columns.delete(match[1]);
      for (const column of match[2].matchAll(/(?:as |\.)(\w+),?\s*$/gm))
        add(match[1], column[1]);
    }
  }
  return columns;
};

describe("resource definitions", () => {
  it("are internally consistent and fully translated", () => {
    expect(findDefinitionProblems()).toEqual([]);
  });

  it("exclude all Automotive and multi-division resources", () => {
    const names = new Set(RESOURCE_DEFS.map((def) => def.name));
    expect(names.has("vehicle_models")).toBe(false);
    expect(names.has("product_vehicle_fitments")).toBe(false);
    expect(names.has("divisions")).toBe(false);
    expect(names.has("machine_models")).toBe(true);
    expect(names.has("product_machine_applications")).toBe(true);
  });

  it("scopes contact, RFQ and opportunity pickers by their parent customer", () => {
    const byName = new Map(RESOURCE_DEFS.map((d) => [d.name, d]));
    const depOf = (resource: string, field: string) =>
      byName.get(resource)?.fields.find((f) => f.source === field)?.dependsOn;

    expect(depOf("quotations", "contact_id")).toMatchObject({
      sourceField: "company_id",
      requireParent: true,
    });
    expect(depOf("quotations", "rfq_id")).toMatchObject({
      sourceField: "company_id",
      requireParent: true,
    });
    expect(depOf("quotations", "deal_id")).toMatchObject({
      sourceField: "company_id",
      requireParent: true,
    });
    expect(depOf("rfqs", "contact_id")).toMatchObject({
      sourceField: "company_id",
      requireParent: true,
    });
    expect(depOf("service_cases", "contact_id")).toMatchObject({
      sourceField: "company_id",
      requireParent: true,
    });
    expect(depOf("dev_projects", "rfq_id")).toMatchObject({
      sourceField: "company_id",
      requireParent: true,
    });
    expect(depOf("activity_participants", "contact_id")).toMatchObject({
      sourceField: "activity_id",
      viaResource: "activities",
      viaField: "company_id",
      targetField: "company_id",
      requireParent: true,
    });
  });

  it("only use columns that exist in the database", () => {
    const columns = sqlColumns();
    const missing = RESOURCE_DEFS.flatMap((def) => {
      const table = def.name === "companies" ? "companies_summary" : def.name;
      const known = columns.get(table);
      if (!known) return [`table ${table}`];
      return def.fields
        .filter((f) => !known.has(f.source))
        .map((f) => `${table}.${f.source}`);
    });

    expect(missing).toEqual([]);
  });
});
