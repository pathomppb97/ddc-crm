import type {
  Choice,
  FieldDef,
  FieldType,
  Label,
  ReferenceDependency,
} from "./schema";

export const l = (th: string, en: string): Label => ({ th, en });

export const field = (
  source: string,
  th: string,
  en: string,
  type: FieldType = "text",
  extra: Partial<FieldDef> = {},
): FieldDef => ({ source, label: l(th, en), type, ...extra });

export const ref = (
  source: string,
  th: string,
  en: string,
  reference: string,
  optionText: string,
  extra: Partial<FieldDef> = {},
): FieldDef =>
  field(source, th, en, "reference", { reference, optionText, ...extra });

export const option = (
  source: string,
  th: string,
  en: string,
  category: string,
  extra: Partial<FieldDef> = {},
): FieldDef => field(source, th, en, "option", { category, ...extra });

export const choices = (
  ...items: Array<[id: string, th: string, en: string]>
): Choice[] => items.map(([id, th, en]) => ({ id, label: l(th, en) }));

export const select = (
  source: string,
  th: string,
  en: string,
  items: Choice[],
  extra: Partial<FieldDef> = {},
): FieldDef => field(source, th, en, "select", { choices: items, ...extra });

/** Common fields */
export const owner = (extra: Partial<FieldDef> = {}) =>
  ref("sales_id", "ผู้รับผิดชอบ", "Owner", "sales", "first_name", {
    filter: true,
    ...extra,
  });
export const businessModel = (extra: Partial<FieldDef> = {}) =>
  ref(
    "business_model_id",
    "รูปแบบธุรกิจ",
    "Business model",
    "business_models",
    "name",
    { filter: true, ...extra },
  );
export const company = (extra: Partial<FieldDef> = {}) =>
  ref("company_id", "ลูกค้า", "Customer", "companies", "name", {
    filter: true,
    ...extra,
  });
export const BY_CUSTOMER: ReferenceDependency = {
  sourceField: "company_id",
  requireParent: true,
  emptyParentPlaceholder: l("กรุณาเลือกลูกค้าก่อน", "Select a customer first"),
};
export const BY_OPTIONAL_CUSTOMER: ReferenceDependency = {
  sourceField: "company_id",
  requireParent: false,
};
export const product = (extra: Partial<FieldDef> = {}) =>
  ref("product_id", "สินค้า", "Product", "products", "part_number", extra);
export const createdAt = () =>
  field("created_at", "สร้างเมื่อ", "Created", "datetime", { readOnly: true });
export const isActive = () =>
  field("is_active", "ใช้งาน", "Active", "boolean", {
    list: true,
    defaultValue: true,
  });
export const sortOrder = () =>
  field("sort_order", "ลำดับ", "Sort order", "number", { defaultValue: 0 });
export const notes = (source = "notes") =>
  field(source, "หมายเหตุ", "Notes", "textarea", { wide: true });
export const code = (extra: Partial<FieldDef> = {}) =>
  field("code", "รหัส", "Code", "text", {
    required: true,
    list: true,
    ...extra,
  });
export const nameTh = (extra: Partial<FieldDef> = {}) =>
  field("name", "ชื่อ", "Name", "text", {
    required: true,
    list: true,
    ...extra,
  });
export const nameEn = () =>
  field("name_en", "ชื่อ (อังกฤษ)", "Name (English)", "text", { list: true });

export const PRIORITIES = choices(
  ["low", "ต่ำ", "Low"],
  ["medium", "ปานกลาง", "Medium"],
  ["high", "สูง", "High"],
  ["critical", "วิกฤต", "Critical"],
);

export const VERIFICATION = choices(
  ["unverified", "ยังไม่ยืนยัน", "Unverified"],
  ["verified", "ยืนยันแล้ว", "Verified"],
);
