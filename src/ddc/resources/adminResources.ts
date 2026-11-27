import {
  BadgeCheck,
  FileClock,
  FolderKanban,
  GitBranch,
  ListChecks,
  MapPinned,
  Paperclip,
  Receipt,
  ScrollText,
  ShoppingCart,
  SlidersHorizontal,
  Truck,
  Warehouse,
} from "lucide-react";
import {
  choices,
  code,
  field,
  isActive,
  l,
  nameEn,
  nameTh,
  notes,
  option,
  ref,
  select,
  sortOrder,
} from "./helpers";
import type { ResourceDef } from "./schema";

export const businessModels: ResourceDef = {
  name: "business_models",
  label: {
    one: l("รูปแบบธุรกิจ", "Business model"),
    many: l("รูปแบบธุรกิจ", "Business models"),
  },
  icon: BadgeCheck,
  group: "admin",
  recordRepresentation: "name",
  sort: { field: "sort_order", order: "ASC" },
  fields: [
    code(),
    nameTh(),
    nameEn(),
    field("description", "รายละเอียด", "Description", "text", { list: true }),
    isActive(),
    sortOrder(),
  ],
};

export const territories: ResourceDef = {
  name: "territories",
  label: {
    one: l("เขตการขาย", "Territory"),
    many: l("เขตการขาย", "Sales territories"),
  },
  icon: MapPinned,
  group: "admin",
  recordRepresentation: "name",
  sort: { field: "name", order: "ASC" },
  searchFields: ["code", "name", "name_en"],
  fields: [
    code(),
    nameTh(),
    nameEn(),
    ref("parent_id", "อยู่ภายใต้", "Parent territory", "territories", "name", {
      list: true,
    }),
    field("country", "ประเทศ", "Country", "text", { list: true }),
    isActive(),
  ],
};

export const pipelines: ResourceDef = {
  name: "pipelines",
  label: {
    one: l("Pipeline การขาย", "Sales pipeline"),
    many: l("Pipeline การขาย", "Sales pipelines"),
  },
  icon: GitBranch,
  group: "admin",
  recordRepresentation: "name",
  sort: { field: "sort_order", order: "ASC" },
  fields: [
    code(),
    nameTh(),
    nameEn(),
    ref(
      "business_model_id",
      "ใช้กับรูปแบบธุรกิจ",
      "For business model",
      "business_models",
      "name",
      { list: true },
    ),
    field("is_default", "ค่าเริ่มต้น", "Default", "boolean", { list: true }),
    isActive(),
    sortOrder(),
  ],
  children: [
    {
      resource: "pipeline_stages",
      target: "pipeline_id",
      label: l("ขั้นตอน", "Stages"),
    },
  ],
};

export const pipelineStages: ResourceDef = {
  name: "pipeline_stages",
  label: { one: l("ขั้นตอน", "Stage"), many: l("ขั้นตอน", "Stages") },
  childOnly: true,
  parent: { resource: "pipelines", target: "pipeline_id" },
  recordRepresentation: "name",
  sort: { field: "sort_order", order: "ASC" },
  fields: [
    ref("pipeline_id", "Pipeline", "Pipeline", "pipelines", "name", {
      required: true,
    }),
    code(),
    nameTh(),
    nameEn(),
    select(
      "stage_type",
      "ประเภท",
      "Type",
      choices(
        ["open", "อยู่ระหว่างดำเนินการ", "Open"],
        ["won", "ได้งาน", "Won"],
        ["lost", "ไม่ได้งาน", "Lost"],
      ),
      {
        list: true,
        defaultValue: "open",
      },
    ),
    field("probability", "โอกาสสำเร็จ (%)", "Probability (%)", "number", {
      list: true,
      helper: l(
        "ค่าตั้งต้นที่ต้องได้รับการยืนยันจาก DDC",
        "Default value to be confirmed by DDC",
      ),
    }),
    sortOrder(),
  ],
};

export const masterOptions: ResourceDef = {
  name: "master_options",
  label: {
    one: l("รายการข้อมูลหลัก", "Code list value"),
    many: l("รายการข้อมูลหลัก", "Code lists"),
  },
  icon: ListChecks,
  group: "admin",
  recordRepresentation: "name",
  sort: { field: "category", order: "ASC" },
  searchFields: ["code", "name", "name_en"],
  fields: [
    ref("category", "หมวด", "Category", "option_categories", "name", {
      required: true,
      list: true,
      filter: true,
    }),
    code(),
    nameTh(),
    nameEn(),
    isActive(),
    sortOrder(),
  ],
};

export const customFieldDefinitions: ResourceDef = {
  name: "custom_field_definitions",
  label: {
    one: l("ฟิลด์เพิ่มเติม", "Custom field"),
    many: l("ฟิลด์เพิ่มเติม", "Custom fields"),
  },
  icon: SlidersHorizontal,
  group: "admin",
  recordRepresentation: "label",
  sort: { field: "sort_order", order: "ASC" },
  fields: [
    select(
      "entity",
      "ใช้กับ",
      "Entity",
      choices(
        ["companies", "ลูกค้า", "Customers"],
        ["contacts", "ผู้ติดต่อ", "Contacts"],
        ["leads", "ลีด", "Leads"],
        ["deals", "โอกาสการขาย", "Opportunities"],
        ["products", "สินค้า", "Products"],
      ),
      { required: true, list: true, filter: true },
    ),
    field("field_key", "รหัสฟิลด์", "Field key", "text", {
      required: true,
      list: true,
      helper: l(
        "ตัวพิมพ์เล็กภาษาอังกฤษ ตัวเลข และ _",
        "Lowercase letters, digits and _",
      ),
    }),
    field("label", "ชื่อฟิลด์", "Label", "text", {
      required: true,
      list: true,
    }),
    field("label_en", "ชื่อฟิลด์ (อังกฤษ)", "Label (English)", "text", {
      list: true,
    }),
    select(
      "data_type",
      "ชนิดข้อมูล",
      "Data type",
      choices(
        ["text", "ข้อความ", "Text"],
        ["number", "ตัวเลข", "Number"],
        ["date", "วันที่", "Date"],
        ["boolean", "ใช่/ไม่ใช่", "Yes/No"],
        ["select", "ตัวเลือก", "Choice"],
      ),
      { required: true, list: true, defaultValue: "text" },
    ),
    field("options", "ตัวเลือก (JSON array)", "Choices (JSON array)", "json", {
      defaultValue: [],
      helper: l(
        'เช่น ["A","B"] สำหรับชนิดตัวเลือก',
        'e.g. ["A","B"] for the choice type',
      ),
    }),
    field("is_required", "บังคับกรอก", "Required", "boolean", { list: true }),
    isActive(),
    sortOrder(),
  ],
};

export const approvalRules: ResourceDef = {
  name: "approval_rules",
  label: {
    one: l("กฎการอนุมัติ", "Approval rule"),
    many: l("กฎการอนุมัติใบเสนอราคา", "Quotation approval rules"),
  },
  icon: FolderKanban,
  group: "admin",
  recordRepresentation: "name",
  sort: { field: "sort_order", order: "ASC" },
  fields: [
    field("name", "ชื่อกฎ", "Name", "text", { required: true, list: true }),
    field(
      "currency",
      "สกุลเงิน (ว่าง = ทั้งหมด)",
      "Currency (empty = all)",
      "text",
      { list: true },
    ),
    field("min_amount", "มูลค่าตั้งแต่", "From amount", "money", {
      required: true,
      list: true,
      defaultValue: 0,
    }),
    field(
      "max_amount",
      "มูลค่าไม่เกิน (ว่าง = ไม่จำกัด)",
      "Up to amount (empty = no limit)",
      "money",
      { list: true },
    ),
    ref(
      "approver_role_key",
      "บทบาทผู้อนุมัติ",
      "Approver role",
      "ddc_roles",
      "name",
      { required: true, list: true },
    ),
    isActive(),
    sortOrder(),
  ],
};

export const documentReferences: ResourceDef = {
  name: "document_references",
  label: {
    one: l("เอกสาร", "Document"),
    many: l("เอกสารอ้างอิง", "Document references"),
  },
  icon: Paperclip,
  childOnly: true,
  recordRepresentation: "title",
  sort: { field: "created_at", order: "DESC" },
  fields: [
    field("entity_type", "ประเภทข้อมูล", "Entity type", "text", {
      required: true,
    }),
    field("entity_id", "รหัสข้อมูล", "Entity id", "number", { required: true }),
    option(
      "document_type_id",
      "ประเภทเอกสาร",
      "Document type",
      "document_type",
      { list: true },
    ),
    field("title", "ชื่อเอกสาร", "Title", "text", {
      required: true,
      list: true,
    }),
    field("reference_no", "เลขที่เอกสาร", "Reference no.", "text", {
      list: true,
    }),
    field("revision", "Revision", "Revision", "text", { list: true }),
    field(
      "external_url",
      "ลิงก์ไปยังระบบเอกสาร",
      "Link to document system",
      "url",
      { list: true },
    ),
    notes(),
    ref("sales_id", "ผู้บันทึก", "Recorded by", "sales", "first_name", {
      readOnly: true,
      list: true,
    }),
    field("created_at", "บันทึกเมื่อ", "Recorded", "datetime", {
      readOnly: true,
      list: true,
    }),
  ],
};

const erpDoc = (
  extra: Partial<ResourceDef> &
    Pick<ResourceDef, "name" | "label" | "fields" | "recordRepresentation">,
): ResourceDef => ({
  group: "erp",
  readOnly: true,
  ...extra,
});

const legalEntity = () =>
  field("data_area_id", "นิติบุคคล (ERP)", "Legal entity", "text", {
    list: true,
    filter: true,
  });
const syncedAt = () =>
  field("synced_at", "ซิงก์ล่าสุด", "Last synchronized", "datetime", {
    list: true,
  });

export const erpSalesOrders = erpDoc({
  name: "erp_sales_orders",
  label: {
    one: l("ใบสั่งขาย (ERP)", "Sales order (ERP)"),
    many: l("ใบสั่งขาย (ERP)", "Sales orders (ERP)"),
  },
  icon: ShoppingCart,
  recordRepresentation: "sales_order_number",
  sort: { field: "order_date", order: "DESC" },
  searchFields: ["sales_order_number", "erp_customer_account"],
  fields: [
    legalEntity(),
    field("sales_order_number", "เลขที่ใบสั่งขาย", "Sales order", "text", {
      list: true,
    }),
    ref("company_id", "ลูกค้า", "Customer", "companies", "name", {
      list: true,
      filter: true,
    }),
    field(
      "erp_customer_account",
      "บัญชีลูกค้าใน ERP",
      "ERP customer account",
      "text",
      { list: true },
    ),
    field("order_date", "วันที่สั่ง", "Order date", "date", { list: true }),
    field("requested_ship_date", "วันที่ขอส่ง", "Requested ship date", "date"),
    field("status", "สถานะใน ERP", "ERP status", "text", { list: true }),
    field("currency", "สกุลเงิน", "Currency", "text", { list: true }),
    field("total_amount", "มูลค่าที่ยืนยันแล้ว", "Confirmed amount", "money", {
      list: true,
    }),
    ref(
      "quotation_id",
      "ใบเสนอราคา",
      "Quotation",
      "quotations",
      "quotation_no",
    ),
    syncedAt(),
  ],
  children: [
    {
      resource: "erp_sales_order_lines",
      target: "sales_order_id",
      label: l("รายการ", "Lines"),
    },
  ],
});

export const erpSalesOrderLines = erpDoc({
  name: "erp_sales_order_lines",
  group: undefined,
  childOnly: true,
  label: {
    one: l("รายการใบสั่งขาย", "Sales order line"),
    many: l("รายการใบสั่งขาย", "Sales order lines"),
  },
  recordRepresentation: "erp_item_number",
  sort: { field: "line_number", order: "ASC" },
  fields: [
    ref(
      "sales_order_id",
      "ใบสั่งขาย",
      "Sales order",
      "erp_sales_orders",
      "sales_order_number",
    ),
    field("line_number", "บรรทัด", "Line", "number", { list: true }),
    field("erp_item_number", "รหัสสินค้า ERP", "ERP item", "text", {
      list: true,
    }),
    ref("product_id", "สินค้า CRM", "CRM product", "products", "part_number", {
      list: true,
    }),
    field("quantity", "จำนวน", "Quantity", "number", { list: true }),
    field("uom", "หน่วย", "Unit", "text", { list: true }),
    field("unit_price", "ราคาต่อหน่วย", "Unit price", "money", { list: true }),
    field("line_amount", "มูลค่า", "Amount", "money", { list: true }),
  ],
});

export const erpDeliveries = erpDoc({
  name: "erp_deliveries",
  label: {
    one: l("การส่งสินค้า (ERP)", "Delivery (ERP)"),
    many: l("การส่งสินค้า (ERP)", "Deliveries (ERP)"),
  },
  icon: Truck,
  recordRepresentation: "delivery_number",
  sort: { field: "delivery_date", order: "DESC" },
  searchFields: ["delivery_number", "sales_order_number"],
  fields: [
    legalEntity(),
    field("delivery_number", "เลขที่ใบส่งสินค้า", "Delivery no.", "text", {
      list: true,
    }),
    field("sales_order_number", "เลขที่ใบสั่งขาย", "Sales order", "text", {
      list: true,
    }),
    ref("company_id", "ลูกค้า", "Customer", "companies", "name", {
      list: true,
    }),
    field("delivery_date", "วันที่ส่ง", "Delivery date", "date", {
      list: true,
    }),
    syncedAt(),
  ],
});

export const erpInvoices = erpDoc({
  name: "erp_invoices",
  label: {
    one: l("ใบแจ้งหนี้ (ERP)", "Invoice (ERP)"),
    many: l("ใบแจ้งหนี้ (ERP)", "Invoices (ERP)"),
  },
  icon: Receipt,
  recordRepresentation: "invoice_number",
  sort: { field: "invoice_date", order: "DESC" },
  searchFields: [
    "invoice_number",
    "sales_order_number",
    "erp_customer_account",
  ],
  fields: [
    legalEntity(),
    field("invoice_number", "เลขที่ใบแจ้งหนี้", "Invoice no.", "text", {
      list: true,
    }),
    field("sales_order_number", "เลขที่ใบสั่งขาย", "Sales order", "text", {
      list: true,
    }),
    ref("company_id", "ลูกค้า", "Customer", "companies", "name", {
      list: true,
      filter: true,
    }),
    field("invoice_date", "วันที่", "Invoice date", "date", { list: true }),
    field("due_date", "ครบกำหนด", "Due date", "date"),
    field("currency", "สกุลเงิน", "Currency", "text", { list: true }),
    field("invoice_amount", "มูลค่าใบแจ้งหนี้", "Invoiced amount", "money", {
      list: true,
    }),
    field("paid_amount", "ชำระแล้ว", "Paid amount", "money", { list: true }),
    syncedAt(),
  ],
});

export const erpInventory = erpDoc({
  name: "erp_inventory_availability",
  label: {
    one: l("สินค้าคงคลัง (ERP)", "Inventory (ERP)"),
    many: l("สินค้าคงคลัง (ERP)", "Inventory availability (ERP)"),
  },
  icon: Warehouse,
  recordRepresentation: "erp_item_number",
  sort: { field: "erp_item_number", order: "ASC" },
  searchFields: ["erp_item_number", "warehouse_id"],
  fields: [
    legalEntity(),
    field("erp_item_number", "รหัสสินค้า ERP", "ERP item", "text", {
      list: true,
    }),
    ref("product_id", "สินค้า CRM", "CRM product", "products", "part_number", {
      list: true,
    }),
    field("site_id", "Site", "Site", "text", { list: true }),
    field("warehouse_id", "คลัง", "Warehouse", "text", { list: true }),
    field("available_quantity", "พร้อมขาย", "Available", "number", {
      list: true,
    }),
    field("on_hand_quantity", "คงเหลือ", "On hand", "number", { list: true }),
    syncedAt(),
  ],
});

export const erpPrices = erpDoc({
  name: "erp_price_list_entries",
  label: {
    one: l("ราคา (ERP)", "Price (ERP)"),
    many: l("รายการราคา (ERP)", "Price lists (ERP)"),
  },
  icon: Receipt,
  recordRepresentation: "erp_item_number",
  sort: { field: "erp_item_number", order: "ASC" },
  searchFields: ["erp_item_number", "price_group"],
  fields: [
    legalEntity(),
    field("erp_item_number", "รหัสสินค้า ERP", "ERP item", "text", {
      list: true,
    }),
    ref("product_id", "สินค้า CRM", "CRM product", "products", "part_number", {
      list: true,
    }),
    field("price_group", "กลุ่มราคา", "Price group", "text", { list: true }),
    field("currency", "สกุลเงิน", "Currency", "text", { list: true }),
    field("unit_price", "ราคา", "Price", "money", { list: true }),
    field("quantity_from", "ตั้งแต่จำนวน", "From quantity", "number", {
      list: true,
    }),
    field("valid_from", "มีผลตั้งแต่", "Valid from", "date", { list: true }),
    field("valid_to", "ถึง", "Valid to", "date", { list: true }),
  ],
});

export const erpSyncRuns = erpDoc({
  name: "erp_sync_runs",
  group: undefined,
  label: {
    one: l("รอบการซิงก์", "Sync run"),
    many: l("ประวัติการซิงก์", "Sync runs"),
  },
  icon: FileClock,
  recordRepresentation: "entity",
  sort: { field: "started_at", order: "DESC" },
  fields: [
    field("entity", "ข้อมูล", "Entity", "text", { list: true, filter: true }),
    legalEntity(),
    field("connector_type", "ตัวเชื่อมต่อ", "Connector", "text", {
      list: true,
    }),
    field("mode", "โหมด", "Mode", "text", { list: true }),
    select(
      "status",
      "ผล",
      "Status",
      choices(
        ["running", "กำลังทำงาน", "Running"],
        ["succeeded", "สำเร็จ", "Succeeded"],
        ["partial", "สำเร็จบางส่วน", "Partial"],
        ["failed", "ล้มเหลว", "Failed"],
      ),
      { list: true, filter: true },
    ),
    field("started_at", "เริ่ม", "Started", "datetime", { list: true }),
    field("finished_at", "สิ้นสุด", "Finished", "datetime"),
    field("records_read", "อ่าน", "Read", "number", { list: true }),
    field("records_created", "สร้าง", "Created", "number", { list: true }),
    field("records_updated", "ปรับปรุง", "Updated", "number", { list: true }),
    field("records_unchanged", "ไม่เปลี่ยน", "Unchanged", "number"),
    field("records_conflicted", "ขัดแย้ง", "Conflicts", "number", {
      list: true,
    }),
    field("records_failed", "ล้มเหลว", "Failed", "number", { list: true }),
    field("throttle_waits", "ถูกจำกัดอัตรา", "Throttle waits", "number"),
    field("cursor_before", "ตำแหน่งก่อน", "Cursor before"),
    field("cursor_after", "ตำแหน่งหลัง", "Cursor after"),
    field("error_message", "ข้อผิดพลาด", "Error", "textarea", { wide: true }),
  ],
});

export const erpSyncErrors = erpDoc({
  name: "erp_sync_errors",
  group: undefined,
  label: {
    one: l("ข้อผิดพลาดการซิงก์", "Sync error"),
    many: l("ข้อผิดพลาดการซิงก์", "Sync errors"),
  },
  icon: ScrollText,
  recordRepresentation: "erp_key",
  sort: { field: "created_at", order: "DESC" },
  fields: [
    field("entity", "ข้อมูล", "Entity", "text", { list: true, filter: true }),
    legalEntity(),
    field("erp_key", "คีย์ ERP", "ERP key", "text", { list: true }),
    select(
      "error_type",
      "ประเภท",
      "Type",
      choices(
        ["error", "ข้อผิดพลาด", "Error"],
        ["conflict", "ข้อมูลขัดแย้ง", "Conflict"],
        ["validation", "ข้อมูลไม่ถูกต้อง", "Validation"],
        ["mapping", "การจับคู่ฟิลด์", "Mapping"],
      ),
      { list: true, filter: true },
    ),
    field("error_message", "รายละเอียด", "Message", "text", { list: true }),
    field("attempts", "จำนวนครั้ง", "Attempts", "number", { list: true }),
    field("next_retry_at", "ลองใหม่เมื่อ", "Next retry", "datetime", {
      list: true,
    }),
    field("is_resolved", "แก้ไขแล้ว", "Resolved", "boolean", {
      list: true,
      filter: true,
    }),
    field("payload", "ข้อมูลต้นทาง", "Source payload", "json", { wide: true }),
    field("created_at", "เกิดเมื่อ", "Occurred", "datetime"),
  ],
});

export const auditLog = erpDoc({
  name: "audit_log",
  group: "admin",
  label: {
    one: l("บันทึกการตรวจสอบ", "Audit entry"),
    many: l("บันทึกการตรวจสอบ (Audit log)", "Audit log"),
  },
  icon: ScrollText,
  recordRepresentation: "table_name",
  sort: { field: "occurred_at", order: "DESC" },
  fields: [
    field("occurred_at", "เวลา", "Time", "datetime", { list: true }),
    ref("actor_sales_id", "ผู้ใช้", "User", "sales", "first_name", {
      list: true,
      filter: true,
    }),
    field("table_name", "ตาราง", "Table", "text", { list: true, filter: true }),
    field("record_id", "รหัสข้อมูล", "Record", "text", {
      list: true,
      filter: true,
    }),
    select(
      "action",
      "การกระทำ",
      "Action",
      choices(
        ["INSERT", "สร้าง", "Created"],
        ["UPDATE", "แก้ไข", "Updated"],
        ["DELETE", "ลบ", "Deleted"],
      ),
      {
        list: true,
        filter: true,
      },
    ),
    field("changed_fields", "ฟิลด์ที่เปลี่ยน", "Changed fields", "json", {
      list: true,
    }),
    field("old_data", "ข้อมูลเดิม", "Before", "json", { wide: true }),
    field("new_data", "ข้อมูลใหม่", "After", "json", { wide: true }),
  ],
});

export const ddcRoles: ResourceDef = {
  name: "ddc_roles",
  label: { one: l("บทบาท", "Role"), many: l("บทบาทผู้ใช้", "Roles") },
  childOnly: true,
  recordRepresentation: "name",
  fields: [
    field("key", "รหัส", "Key", "text", { list: true }),
    nameTh(),
    nameEn(),
  ],
};

export const optionCategories: ResourceDef = {
  name: "option_categories",
  label: {
    one: l("หมวดข้อมูลหลัก", "Code list"),
    many: l("หมวดข้อมูลหลัก", "Code lists"),
  },
  childOnly: true,
  recordRepresentation: "name",
  fields: [
    field("key", "รหัส", "Key", "text", { list: true }),
    nameTh(),
    nameEn(),
  ],
};

/* ERP integration configuration (administrators only, see ErpAdminPage) */

export const erpEntityConfigs: ResourceDef = {
  name: "erp_entity_configs",
  label: {
    one: l("สัญญาการเชื่อมต่อข้อมูล", "Integration contract"),
    many: l("สัญญาการเชื่อมต่อข้อมูล ERP", "ERP integration contracts"),
  },
  childOnly: true,
  recordRepresentation: "label",
  sort: { field: "sort_order", order: "ASC" },
  fields: [
    field("entity", "รหัส", "Key", "text", { readOnly: true, list: true }),
    field("label", "ชื่อ", "Label", "text", { required: true, list: true }),
    field("erp_entity_name", "Data entity ใน ERP", "ERP data entity", "text", {
      required: true,
      list: true,
      helper: l(
        "ต้องตรวจสอบกับ entity ที่เปิดใช้จริงใน ERP ของ DDC",
        "Must be checked against the entities enabled in the DDC ERP",
      ),
    }),
    field("crm_table", "ตารางใน CRM", "CRM table", "text", { readOnly: true }),
    select(
      "direction",
      "ทิศทาง",
      "Direction",
      choices(
        ["disabled", "ปิด", "Disabled"],
        ["inbound", "ERP → CRM", "ERP to CRM"],
        ["outbound", "CRM → ERP", "CRM to ERP"],
        ["bidirectional", "สองทาง", "Bidirectional"],
      ),
      { list: true },
    ),
    select(
      "system_of_record",
      "ระบบหลักของข้อมูล",
      "System of record",
      choices(
        ["undecided", "ยังไม่ตัดสินใจ", "Undecided"],
        ["erp", "ERP", "ERP"],
        ["crm", "CRM", "CRM"],
      ),
      {
        list: true,
      },
    ),
    field(
      "allowed_operations",
      "การดำเนินการที่อนุญาต",
      "Allowed operations",
      "json",
      {
        helper: l('เช่น ["read"]', 'e.g. ["read"]'),
      },
    ),
    select(
      "decision_status",
      "สถานะการตัดสินใจ",
      "Decision",
      choices(
        ["proposed", "ข้อเสนอ", "Proposed"],
        ["confirmed", "ยืนยันโดย DDC", "Confirmed by DDC"],
      ),
      {
        list: true,
      },
    ),
    field(
      "decision_note",
      "บันทึกการตัดสินใจ (ผู้อนุมัติ วันที่ เอกสาร)",
      "Decision record (approver, date, document)",
      "textarea",
      { wide: true },
    ),
    field("is_enabled", "เปิดใช้", "Enabled", "boolean", { list: true }),
    field("page_size", "จำนวนต่อหน้า", "Page size", "number", {
      required: true,
    }),
    sortOrder(),
  ],
  children: [
    {
      resource: "erp_field_mappings",
      target: "entity",
      label: l("การจับคู่ฟิลด์", "Field mappings"),
    },
  ],
};

export const erpFieldMappings: ResourceDef = {
  name: "erp_field_mappings",
  label: {
    one: l("การจับคู่ฟิลด์", "Field mapping"),
    many: l("การจับคู่ฟิลด์", "Field mappings"),
  },
  childOnly: true,
  parent: { resource: "erp_entity_configs", target: "entity" },
  recordRepresentation: "crm_field",
  fields: [
    field("entity", "สัญญา", "Contract", "text", { required: true }),
    field("crm_field", "ฟิลด์ CRM", "CRM field", "text", {
      required: true,
      list: true,
    }),
    field("erp_field", "ฟิลด์ ERP", "ERP field", "text", {
      required: true,
      list: true,
    }),
    select(
      "transform",
      "การแปลงค่า",
      "Transform",
      choices(
        ["none", "ไม่แปลง", "None"],
        ["trim", "ตัดช่องว่าง", "Trim"],
        ["upper", "ตัวพิมพ์ใหญ่", "Upper case"],
        ["lower", "ตัวพิมพ์เล็ก", "Lower case"],
        ["number", "ตัวเลข", "Number"],
        ["date", "วันที่", "Date"],
        ["boolean", "ใช่/ไม่ใช่", "Boolean"],
      ),
      { list: true, defaultValue: "trim" },
    ),
    field("is_key", "เป็นคีย์", "Key", "boolean", { list: true }),
    field("is_active", "ใช้งาน", "Active", "boolean", {
      list: true,
      defaultValue: true,
    }),
    field(
      "is_verified",
      "ยืนยันกับ ERP จริงแล้ว",
      "Verified against the ERP",
      "boolean",
      { list: true },
    ),
    notes(),
  ],
};

export const erpLegalEntities: ResourceDef = {
  name: "erp_legal_entities",
  label: {
    one: l("นิติบุคคล ERP", "ERP legal entity"),
    many: l("นิติบุคคล ERP", "ERP legal entities"),
  },
  childOnly: true,
  recordRepresentation: "data_area_id",
  fields: [
    field("data_area_id", "รหัส (dataAreaId)", "Code (dataAreaId)", "text", {
      required: true,
      list: true,
    }),
    field("name", "ชื่อ", "Name", "text", { required: true, list: true }),
    field("is_default", "ค่าเริ่มต้น", "Default", "boolean", { list: true }),
    field("is_verified", "ยืนยันแล้ว", "Verified", "boolean", { list: true }),
    isActive(),
    notes(),
  ],
};
