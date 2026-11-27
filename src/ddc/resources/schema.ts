import type { LucideIcon } from "lucide-react";

/** A label in both interface languages. Thai is the default language. */
export interface Label {
  th: string;
  en: string;
}

export type FieldType =
  | "text"
  | "textarea"
  | "email"
  | "url"
  | "number"
  | "money"
  | "date"
  | "datetime"
  | "boolean"
  | "select"
  | "reference"
  | "option"
  | "json";

export interface Choice {
  id: string;
  label: Label;
}

export interface ReferenceDependency {
  /** Form field name whose value scopes this reference (e.g. "company_id") */
  sourceField: string;
  /** Column on the referenced resource to filter on (defaults to sourceField) */
  targetField?: string;
  /**
   * When true, the dropdown stays disabled with empty choices until the parent
   * field has a value (used when the parent relationship is mandatory).
   */
  requireParent?: boolean;
  /**
   * Optional indirect lookup: fetch this resource by `sourceField` and read
   * `viaField` to filter `targetField` (e.g. activity_participants -> activities.company_id).
   */
  viaResource?: string;
  viaField?: string;
  /** Placeholder shown while waiting for a required parent to be selected */
  emptyParentPlaceholder?: Label;
}

export interface FieldDef {
  source: string;
  label: Label;
  type: FieldType;
  /** select: static choices */
  choices?: Choice[];
  /** reference: target resource */
  reference?: string;
  /** reference: field shown for the referenced record */
  optionText?: string;
  /** reference: extra filter applied to the choices, e.g. { level: "family" } */
  referenceFilter?: Record<string, unknown>;
  /** reference: scope choices by another field on the form (e.g. company_id) */
  dependsOn?: ReferenceDependency;
  /** option: master_options category */
  category?: string;
  required?: boolean;
  /** Shown in the list table */
  list?: boolean;
  /** Offered as a list filter */
  filter?: boolean;
  /** Computed or system managed: shown, never edited */
  readOnly?: boolean;
  /** Not offered on the creation form */
  hideOnCreate?: boolean;
  /** Takes the full form width */
  wide?: boolean;
  defaultValue?: unknown;
  helper?: Label;
  /** Presentation and validation rules; these do not add database columns. */
  input?: {
    kind?: "code" | "phone" | "quantity" | "percentage";
    min?: number;
    max?: number;
    exclusiveMin?: boolean;
    step?: number | "any";
    unit?: string;
    placeholder?: Label;
    rows?: number;
    suggestions?: string[];
    /** Advisory only: samples and historical orders may use partial boxes. */
    packing?: boolean;
    /** Field whose date/time must be no later than this field. */
    notBefore?: string;
  };
}

export interface ChildDef {
  resource: string;
  /** Foreign key on the child pointing to the parent */
  target: string;
  label: Label;
  /** Child columns to display (defaults to the child list columns) */
  columns?: string[];
}

export type ResourceGroup =
  | "sales"
  | "customers"
  | "products"
  | "engineering"
  | "service"
  | "erp"
  | "admin";

export interface ResourceDef {
  name: string;
  label: { one: Label; many: Label };
  icon?: LucideIcon;
  /** Sidebar group. Child-only resources have none. */
  group?: ResourceGroup;
  fields: FieldDef[];
  /** Field (or template with {field} placeholders) used to represent a record */
  recordRepresentation: string;
  sort?: { field: string; order: "ASC" | "DESC" };
  /** Columns searched by the free text filter */
  searchFields?: string[];
  children?: ChildDef[];
  /** ERP documents and logs: no create / edit / delete in the CRM */
  readOnly?: boolean;
  /** Has no own screens: only edited from its parent */
  childOnly?: boolean;
  /** Parent resource of a child-only resource (redirect after save) */
  parent?: { resource: string; target: string };
  /** Entity key used by document_references, when documents can be attached */
  documentEntity?: string;
}
