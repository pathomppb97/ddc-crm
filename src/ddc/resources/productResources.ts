import { Factory, Layers, Package, Tag, Tractor } from "lucide-react";
import {
  choices,
  code,
  createdAt,
  field,
  isActive,
  l,
  nameEn,
  nameTh,
  notes,
  option,
  product,
  ref,
  select,
  sortOrder,
  VERIFICATION,
} from "./helpers";
import type { ResourceDef } from "./schema";

export const HIERARCHY_LEVELS = choices(
  ["family", "กลุ่มผลิตภัณฑ์ (Family)", "Product family"],
  ["category", "หมวด (Category)", "Category"],
  ["type", "ประเภท (Type)", "Type"],
  ["model", "รุ่นสินค้า (Model)", "Product model"],
);

export const productHierarchy: ResourceDef = {
  name: "product_hierarchy_nodes",
  label: {
    one: l("โครงสร้างสินค้า", "Product hierarchy node"),
    many: l("โครงสร้างสินค้า", "Product hierarchy"),
  },
  icon: Layers,
  group: "products",
  recordRepresentation: "name",
  sort: { field: "sort_order", order: "ASC" },
  searchFields: ["code", "name", "name_en"],
  fields: [
    select("level", "ระดับ", "Level", HIERARCHY_LEVELS, {
      required: true,
      list: true,
      filter: true,
    }),
    ref(
      "parent_id",
      "อยู่ภายใต้",
      "Parent",
      "product_hierarchy_nodes",
      "name",
      {
        list: true,
        helper: l(
          "ระดับต้องต่ำกว่าระดับของรายการแม่",
          "Must be a lower level than its parent",
        ),
      },
    ),
    code(),
    nameTh(),
    nameEn(),
    isActive(),
    sortOrder(),
  ],
};

export const products: ResourceDef = {
  name: "products",
  label: { one: l("สินค้า", "Product"), many: l("สินค้า", "Products") },
  icon: Package,
  group: "products",
  recordRepresentation: "part_number",
  sort: { field: "part_number", order: "ASC" },
  searchFields: ["part_number", "name", "name_en", "material", "description"],
  documentEntity: "products",
  fields: [
    field("part_number", "รหัสชิ้นส่วน DDC", "DDC part number", "text", {
      required: true,
      list: true,
      helper: l(
        "รหัสภายในของ CRM ไม่จำเป็นต้องตรงกับรหัสสินค้าใน ERP",
        "CRM internal number. It does not have to match the ERP item number.",
      ),
    }),
    field("name", "ชื่อสินค้า", "Name", "text", { required: true, list: true }),
    nameEn(),
    ref(
      "node_id",
      "ตำแหน่งในโครงสร้างสินค้า",
      "Hierarchy position",
      "product_hierarchy_nodes",
      "name",
      {
        list: true,
        filter: true,
        helper: l(
          "ว่างได้สำหรับสินค้าที่นำเข้าจาก ERP และยังไม่จัดหมวด",
          "Empty for ERP items not classified yet",
        ),
      },
    ),
    ref("brand_id", "แบรนด์", "Brand", "brands", "name", { filter: true }),
    option(
      "lifecycle_status_id",
      "สถานะสินค้า",
      "Lifecycle status",
      "product_lifecycle_status",
      { list: true, filter: true },
    ),
    field("material", "วัสดุ", "Material"),
    field("uom", "หน่วย", "Unit of measure"),
    field("current_revision", "Revision ปัจจุบัน", "Current revision", "text", {
      list: true,
    }),
    field("description", "รายละเอียด", "Description", "textarea", {
      wide: true,
    }),
    createdAt(),
  ],
  children: [
    {
      resource: "product_specifications",
      target: "product_id",
      label: l("ข้อกำหนดและขนาด", "Specifications and dimensions"),
    },
    {
      resource: "product_customer_references",
      target: "product_id",
      label: l("รหัสอ้างอิงของลูกค้า", "Customer part numbers"),
    },
    {
      resource: "product_revisions",
      target: "product_id",
      label: l("ประวัติการแก้ไขแบบ", "Revision history"),
    },
    {
      resource: "product_machine_applications",
      target: "product_id",
      label: l("เครื่องจักรที่ใช้ได้", "Machine applications"),
    },
    {
      resource: "product_relations",
      target: "product_id",
      label: l("สินค้าที่เกี่ยวข้อง", "Related products"),
    },
    {
      resource: "erp_inventory_availability",
      target: "product_id",
      label: l("สินค้าคงคลัง (ERP)", "Inventory (ERP)"),
    },
    {
      resource: "erp_price_list_entries",
      target: "product_id",
      label: l("ราคา (ERP)", "Prices (ERP)"),
    },
  ],
};

export const productSpecifications: ResourceDef = {
  name: "product_specifications",
  label: {
    one: l("ข้อกำหนด", "Specification"),
    many: l("ข้อกำหนด", "Specifications"),
  },
  childOnly: true,
  parent: { resource: "products", target: "product_id" },
  recordRepresentation: "name",
  sort: { field: "sort_order", order: "ASC" },
  fields: [
    product({ required: true }),
    select(
      "spec_group",
      "กลุ่ม",
      "Group",
      choices(
        ["specification", "ข้อกำหนด", "Specification"],
        ["dimension", "ขนาด", "Dimension"],
        ["material", "วัสดุ", "Material"],
      ),
      { list: true, defaultValue: "specification" },
    ),
    field("name", "รายการ", "Name", "text", { required: true, list: true }),
    field("value", "ค่า", "Value", "text", { required: true, list: true }),
    field("unit", "หน่วย", "Unit", "text", { list: true }),
    field("tolerance", "พิกัดความเผื่อ", "Tolerance", "text", { list: true }),
    field(
      "source",
      "แหล่งข้อมูล (แบบ/รายงาน)",
      "Source (drawing / report)",
      "text",
      {
        list: true,
        helper: l(
          "ระบุเอกสารที่ยืนยันค่านี้",
          "Document that confirms this value",
        ),
      },
    ),
    sortOrder(),
  ],
};

export const productCustomerReferences: ResourceDef = {
  name: "product_customer_references",
  label: {
    one: l("รหัสของลูกค้า", "Customer part number"),
    many: l("รหัสของลูกค้า", "Customer part numbers"),
  },
  childOnly: true,
  parent: { resource: "products", target: "product_id" },
  recordRepresentation: "customer_part_number",
  fields: [
    product({ required: true }),
    ref("company_id", "ลูกค้า", "Customer", "companies", "name", {
      required: true,
      list: true,
    }),
    field(
      "customer_part_number",
      "รหัสชิ้นส่วนของลูกค้า",
      "Customer part number",
      "text",
      { required: true, list: true },
    ),
    field(
      "customer_description",
      "ชื่อเรียกของลูกค้า",
      "Customer description",
      "text",
      { list: true },
    ),
    field("drawing_no", "เลขที่แบบของลูกค้า", "Customer drawing no.", "text", {
      list: true,
    }),
  ],
};

export const productRevisions: ResourceDef = {
  name: "product_revisions",
  label: {
    one: l("Revision", "Revision"),
    many: l("ประวัติ Revision", "Revisions"),
  },
  childOnly: true,
  parent: { resource: "products", target: "product_id" },
  recordRepresentation: "revision",
  sort: { field: "created_at", order: "DESC" },
  fields: [
    product({ required: true }),
    field("revision", "Revision", "Revision", "text", {
      required: true,
      list: true,
    }),
    field("drawing_no", "เลขที่แบบ", "Drawing no.", "text", { list: true }),
    field("effective_date", "มีผลตั้งแต่", "Effective date", "date", {
      list: true,
    }),
    select(
      "status",
      "สถานะ",
      "Status",
      choices(
        ["draft", "ร่าง", "Draft"],
        ["released", "ประกาศใช้", "Released"],
        ["obsolete", "ยกเลิก", "Obsolete"],
      ),
      { list: true, defaultValue: "draft" },
    ),
    field(
      "change_description",
      "รายละเอียดการเปลี่ยนแปลง",
      "Change description",
      "textarea",
      { list: true, wide: true },
    ),
    createdAt(),
  ],
};

export const productRelations: ResourceDef = {
  name: "product_relations",
  label: {
    one: l("สินค้าที่เกี่ยวข้อง", "Related product"),
    many: l("สินค้าที่เกี่ยวข้อง", "Related products"),
  },
  childOnly: true,
  parent: { resource: "products", target: "product_id" },
  recordRepresentation: "relation_type",
  fields: [
    product({ required: true }),
    ref(
      "related_product_id",
      "สินค้าที่เกี่ยวข้อง",
      "Related product",
      "products",
      "part_number",
      { required: true, list: true },
    ),
    select(
      "relation_type",
      "ความสัมพันธ์",
      "Relation",
      choices(
        ["related", "เกี่ยวข้อง", "Related"],
        ["alternative", "ใช้แทนได้", "Alternative"],
        ["supersedes", "แทนรุ่นเดิม", "Supersedes"],
        ["accessory", "อุปกรณ์เสริม", "Accessory"],
        ["kit_component", "ส่วนประกอบชุด", "Kit component"],
      ),
      { list: true, defaultValue: "related" },
    ),
    notes(),
  ],
};

export const manufacturers: ResourceDef = {
  name: "manufacturers",
  label: {
    one: l("แบรนด์/ผู้ผลิตเครื่องจักร", "Machine brand / manufacturer"),
    many: l(
      "แบรนด์/ผู้ผลิตเครื่องจักรการเกษตร",
      "Machine brands / manufacturers",
    ),
  },
  icon: Factory,
  group: "products",
  recordRepresentation: "name",
  sort: { field: "name", order: "ASC" },
  searchFields: ["name"],
  fields: [
    nameTh(),
    field("country", "ประเทศ", "Country", "text", { list: true }),
    isActive(),
  ],
};

export const brands: ResourceDef = {
  name: "brands",
  label: { one: l("แบรนด์", "Brand"), many: l("แบรนด์", "Brands") },
  icon: Tag,
  group: "products",
  recordRepresentation: "name",
  sort: { field: "name", order: "ASC" },
  searchFields: ["code", "name"],
  fields: [
    code(),
    nameTh(),
    select(
      "owner_type",
      "เจ้าของแบรนด์",
      "Owner",
      choices(
        ["ddc_owned", "แบรนด์ของ DDC (OBM)", "DDC owned (OBM)"],
        ["customer", "แบรนด์ลูกค้า", "Customer brand"],
        ["third_party", "บุคคลที่สาม", "Third party"],
      ),
      { list: true, filter: true, defaultValue: "ddc_owned" },
    ),
    field("description", "รายละเอียด", "Description", "textarea", {
      wide: true,
    }),
    isActive(),
  ],
};

export const machineModels: ResourceDef = {
  name: "machine_models",
  label: {
    one: l("รุ่นเครื่องจักร", "Machine model"),
    many: l("รุ่นเครื่องจักรการเกษตร", "Agricultural machine models"),
  },
  icon: Tractor,
  group: "products",
  recordRepresentation: "model_name",
  sort: { field: "model_name", order: "ASC" },
  searchFields: ["model_name", "series"],
  documentEntity: "machine_models",
  fields: [
    ref(
      "manufacturer_id",
      "แบรนด์/ผู้ผลิต",
      "Brand / manufacturer",
      "manufacturers",
      "name",
      {
        required: true,
        list: true,
        filter: true,
      },
    ),
    option(
      "equipment_type_id",
      "ประเภทเครื่องจักร",
      "Equipment type",
      "equipment_type",
      { list: true, filter: true },
    ),
    field("model_name", "ชื่อรุ่น", "Model", "text", {
      required: true,
      list: true,
    }),
    field("series", "ซีรีส์", "Series", "text", { list: true }),
    field("year_from", "ปีเริ่ม", "Year from", "number", { list: true }),
    field("year_to", "ปีสิ้นสุด", "Year to", "number", { list: true }),
    notes(),
    isActive(),
  ],
  children: [
    {
      resource: "product_machine_applications",
      target: "machine_model_id",
      label: l("ชิ้นส่วนที่ใช้ได้", "Compatible components"),
    },
  ],
};

const verificationFields = () => [
  select(
    "verification_status",
    "สถานะการยืนยัน",
    "Verification",
    VERIFICATION,
    { list: true, filter: true, defaultValue: "unverified" },
  ),
  field(
    "verification_source",
    "หลักฐานการยืนยัน",
    "Verification source",
    "text",
    {
      list: true,
      helper: l(
        "จำเป็นเมื่อยืนยัน: แบบ ผลทดสอบ หรือเอกสารที่พิสูจน์ว่าใช้ได้จริง",
        "Required to verify: drawing, test result or document proving the application",
      ),
    },
  ),
  ref("verified_by", "ผู้ยืนยัน", "Verified by", "sales", "first_name", {
    readOnly: true,
  }),
  field("verified_at", "ยืนยันเมื่อ", "Verified at", "datetime", {
    readOnly: true,
  }),
];

export const machineApplications: ResourceDef = {
  name: "product_machine_applications",
  label: {
    one: l("การใช้งานกับเครื่องจักร", "Machine application"),
    many: l("การใช้งานกับเครื่องจักร", "Machine applications"),
  },
  icon: Tractor,
  group: "products",
  recordRepresentation: "component_application",
  searchFields: [
    "component_application",
    "application_notes",
    "verification_source",
  ],
  fields: [
    product({ required: true, list: true, filter: true }),
    ref(
      "machine_model_id",
      "รุ่นเครื่องจักร",
      "Machine model",
      "machine_models",
      "model_name",
      { required: true, list: true, filter: true },
    ),
    field(
      "component_application",
      "ตำแหน่ง/การใช้งานของชิ้นส่วน",
      "Component application",
      "text",
      { list: true },
    ),
    field(
      "application_notes",
      "หมายเหตุการใช้งาน",
      "Application notes",
      "textarea",
      { wide: true },
    ),
    ...verificationFields(),
  ],
};
