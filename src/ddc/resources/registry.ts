import * as admin from "./adminResources";
import { ERP_ENABLED, isResourceEnabled } from "../featureFlags";
import * as customerList from "./customerListResources";
import * as engineering from "./engineeringResources";
import * as productDefs from "./productResources";
import * as sales from "./salesResources";
import type { FieldDef, Label, ResourceDef, ResourceGroup } from "./schema";

const isResourceDef = (value: unknown): value is ResourceDef =>
  typeof value === "object" &&
  value !== null &&
  "name" in value &&
  "fields" in value;

export const RESOURCE_DEFS: ResourceDef[] = [
  sales,
  productDefs,
  engineering,
  admin,
  customerList,
]
  .flatMap((module) => Object.values(module))
  .filter(isResourceDef);

const byName = new Map(RESOURCE_DEFS.map((def) => [def.name, def]));

/** UI projection only: the complete definitions remain available to providers. */
export const UI_RESOURCE_DEFS = RESOURCE_DEFS.filter((def) =>
  isResourceEnabled(def.name),
).map((def) => ({
  ...def,
  children: def.children?.filter((child) => isResourceEnabled(child.resource)),
  fields: def.fields.map((field) =>
    !ERP_ENABLED && field.helper?.en.includes("ERP")
      ? { ...field, helper: undefined }
      : field,
  ),
}));

export const getResourceDef = (name: string): ResourceDef | undefined =>
  byName.get(name);

/** Tables whose primary key is not "id" (PostgREST needs to know). */
export const PRIMARY_KEYS = new Map<string, string[]>([
  ["ddc_roles", ["key"]],
  ["option_categories", ["key"]],
  ["permission_resources", ["key"]],
  ["app_settings", ["key"]],
  ["erp_entity_configs", ["entity"]],
]);

export const GROUP_LABELS: Record<ResourceGroup, Label> = {
  sales: { th: "งานขาย", en: "Sales" },
  customers: { th: "ลูกค้าและเครือข่าย", en: "Customers and network" },
  products: { th: "สินค้า", en: "Products" },
  engineering: { th: "วิศวกรรมเชิงพาณิชย์", en: "Commercial engineering" },
  service: { th: "บริการลูกค้า", en: "Customer service" },
  erp: { th: "ข้อมูลจาก ERP", en: "ERP data" },
  admin: { th: "การตั้งค่าระบบ", en: "Administration" },
};

export const fieldOf = (
  def: ResourceDef,
  source: string,
): FieldDef | undefined => def.fields.find((field) => field.source === source);

type Locale = "th" | "en";

/**
 * Builds the react-admin translation entries (resources.<name>.name / fields)
 * from the resource definitions, so labels exist once, in both languages.
 */
export const buildResourceMessages = (locale: Locale) => {
  const resources: Record<
    string,
    { name: string; fields: Record<string, string> }
  > = {};
  for (const def of RESOURCE_DEFS) {
    const one = def.label.one[locale];
    const many = def.label.many[locale];
    resources[def.name] = {
      name: one === many ? one : `${one} |||| ${many}`,
      fields: Object.fromEntries(
        def.fields.map((f) => [f.source, f.label[locale]]),
      ),
    };
  }
  return { resources };
};

/** Validates the definitions themselves (used by a unit test). */
export const findDefinitionProblems = (): string[] => {
  const problems: string[] = [];
  const names = new Set<string>();
  for (const def of RESOURCE_DEFS) {
    if (names.has(def.name)) problems.push(`duplicate resource ${def.name}`);
    names.add(def.name);
    const sources = new Set<string>();
    for (const field of def.fields) {
      if (sources.has(field.source))
        problems.push(`${def.name}.${field.source} declared twice`);
      sources.add(field.source);
      if (field.type === "reference" && !field.reference)
        problems.push(`${def.name}.${field.source} has no reference`);
      if (field.dependsOn && field.type !== "reference")
        problems.push(
          `${def.name}.${field.source} dependsOn is only valid for reference fields`,
        );
      if (field.type === "option" && !field.category)
        problems.push(`${def.name}.${field.source} has no category`);
      if (field.type === "select" && !field.choices?.length)
        problems.push(`${def.name}.${field.source} has no choices`);
      if (!field.label.th || !field.label.en)
        problems.push(`${def.name}.${field.source} misses a translation`);
    }
    for (const field of def.fields) {
      if (field.dependsOn && !sources.has(field.dependsOn.sourceField)) {
        problems.push(
          `${def.name}.${field.source} dependsOn unknown field ${field.dependsOn.sourceField}`,
        );
      }
    }
    for (const child of def.children ?? []) {
      const childDef = byName.get(child.resource);
      if (childDef && !fieldOf(childDef, child.target)) {
        problems.push(
          `${def.name} child ${child.resource} has no field ${child.target}`,
        );
      }
    }
    if (def.parent && !fieldOf(def, def.parent.target))
      problems.push(`${def.name} parent target missing`);
  }
  return problems;
};
