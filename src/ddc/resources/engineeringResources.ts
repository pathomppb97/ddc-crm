import { FlaskConical, Network } from "lucide-react";
import {
  businessModel,
  BY_CUSTOMER,
  choices,
  company,
  createdAt,
  field,
  l,
  notes,
  option,
  owner,
  product,
  ref,
  select,
  sortOrder,
} from "./helpers";
import type { ResourceDef } from "./schema";

export const DEV_STATUSES = choices(
  ["inquiry", "รับคำขอ", "Inquiry"],
  ["requirements", "รวบรวมข้อกำหนด", "Requirements"],
  ["feasibility", "ประเมินความเป็นไปได้", "Feasibility"],
  ["tooling", "เตรียมแม่พิมพ์/เครื่องมือ", "Tooling"],
  ["sampling", "ทำตัวอย่าง/ต้นแบบ", "Sampling"],
  ["customer_approval", "รอลูกค้าอนุมัติ", "Customer approval"],
  ["production_ready", "พร้อมผลิต", "Production ready"],
  ["on_hold", "พักไว้", "On hold"],
  ["cancelled", "ยกเลิก", "Cancelled"],
  ["completed", "เสร็จสิ้น", "Completed"],
);

export const devProjects: ResourceDef = {
  name: "dev_projects",
  label: {
    one: l("โครงการพัฒนา OEM/ODM", "OEM/ODM project"),
    many: l("พัฒนาลูกค้า OEM/ODM", "OEM/ODM development"),
  },
  icon: FlaskConical,
  group: "engineering",
  recordRepresentation: "project_no",
  sort: { field: "created_at", order: "DESC" },
  searchFields: ["project_no", "name", "inquiry_summary"],
  documentEntity: "dev_projects",
  fields: [
    field("project_no", "เลขที่โครงการ", "Project no.", "text", {
      readOnly: true,
      list: true,
    }),
    field("name", "ชื่อโครงการ", "Project name", "text", {
      required: true,
      list: true,
    }),
    company({ required: true, list: true }),
    businessModel({ list: true }),
    ref("deal_id", "โอกาสการขาย", "Opportunity", "deals", "name", {
      dependsOn: BY_CUSTOMER,
    }),
    ref("rfq_id", "RFQ", "RFQ", "rfqs", "rfq_no", {
      dependsOn: BY_CUSTOMER,
    }),
    product({
      helper: l("สินค้าที่เกิดจากโครงการ (ถ้ามี)", "Resulting product, if any"),
    }),
    select("status", "สถานะ", "Status", DEV_STATUSES, {
      list: true,
      filter: true,
      defaultValue: "inquiry",
    }),
    field("inquiry_summary", "สรุปคำขอพัฒนา", "Inquiry summary", "textarea", {
      wide: true,
    }),
    select(
      "feasibility_status",
      "ผลการประเมินความเป็นไปได้",
      "Feasibility",
      choices(
        ["pending", "รอประเมิน", "Pending"],
        ["feasible", "ทำได้", "Feasible"],
        [
          "feasible_with_conditions",
          "ทำได้แบบมีเงื่อนไข",
          "Feasible with conditions",
        ],
        ["not_feasible", "ทำไม่ได้", "Not feasible"],
      ),
      { list: true, filter: true, defaultValue: "pending" },
    ),
    field(
      "feasibility_notes",
      "รายละเอียดการประเมิน",
      "Feasibility notes",
      "textarea",
      { wide: true },
    ),
    field(
      "process_considerations",
      "ข้อพิจารณาด้านกระบวนการผลิต",
      "Manufacturing process considerations",
      "textarea",
      { wide: true },
    ),
    field(
      "material_requirements",
      "ข้อกำหนดวัสดุ",
      "Material requirements",
      "textarea",
      { wide: true },
    ),
    field(
      "tooling_requirements",
      "ความต้องการแม่พิมพ์/เครื่องมือ",
      "Tooling requirements",
      "textarea",
      { wide: true },
    ),
    select(
      "customer_approval_status",
      "การอนุมัติของลูกค้า",
      "Customer approval",
      choices(
        ["not_submitted", "ยังไม่ส่ง", "Not submitted"],
        ["submitted", "ส่งแล้ว", "Submitted"],
        ["approved", "อนุมัติ", "Approved"],
        [
          "conditionally_approved",
          "อนุมัติแบบมีเงื่อนไข",
          "Conditionally approved",
        ],
        ["rejected", "ไม่อนุมัติ", "Rejected"],
      ),
      { list: true, filter: true, defaultValue: "not_submitted" },
    ),
    field(
      "estimated_production_ready_date",
      "คาดว่าพร้อมผลิต",
      "Estimated production readiness",
      "date",
      { list: true },
    ),
    option(
      "responsible_department_id",
      "แผนกที่รับผิดชอบ",
      "Responsible department",
      "department",
      { filter: true },
    ),
    owner({ list: true }),
    createdAt(),
  ],
  children: [
    {
      resource: "dev_project_requirements",
      target: "project_id",
      label: l("ข้อกำหนดทางเทคนิค", "Technical requirements"),
    },
    {
      resource: "dev_project_milestones",
      target: "project_id",
      label: l("Milestone", "Milestones"),
    },
    {
      resource: "dev_project_samples",
      target: "project_id",
      label: l("ตัวอย่างและต้นแบบ", "Samples and prototypes"),
    },
    {
      resource: "dev_project_risks",
      target: "project_id",
      label: l("ความเสี่ยงทางเทคนิค", "Technical risks"),
    },
  ],
};

const projectRef = () =>
  ref("project_id", "โครงการ", "Project", "dev_projects", "project_no", {
    required: true,
  });

export const devRequirements: ResourceDef = {
  name: "dev_project_requirements",
  label: {
    one: l("ข้อกำหนด", "Requirement"),
    many: l("ข้อกำหนด", "Requirements"),
  },
  childOnly: true,
  parent: { resource: "dev_projects", target: "project_id" },
  recordRepresentation: "requirement",
  sort: { field: "sort_order", order: "ASC" },
  fields: [
    projectRef(),
    select(
      "category",
      "หมวด",
      "Category",
      choices(
        ["technical", "เทคนิค", "Technical"],
        ["material", "วัสดุ", "Material"],
        ["process", "กระบวนการ", "Process"],
        ["tooling", "แม่พิมพ์", "Tooling"],
        ["quality", "คุณภาพ", "Quality"],
        ["packaging", "บรรจุภัณฑ์", "Packaging"],
        ["commercial", "การค้า", "Commercial"],
        ["other", "อื่น ๆ", "Other"],
      ),
      { list: true, defaultValue: "technical" },
    ),
    field("requirement", "ข้อกำหนด", "Requirement", "textarea", {
      required: true,
      list: true,
      wide: true,
    }),
    field(
      "source",
      "แหล่งที่มา (แบบ/เอกสารลูกค้า)",
      "Source (customer drawing / document)",
      "text",
      { list: true },
    ),
    select(
      "status",
      "สถานะ",
      "Status",
      choices(
        ["open", "เปิด", "Open"],
        ["clarifying", "กำลังสอบถาม", "Clarifying"],
        ["agreed", "ตกลงแล้ว", "Agreed"],
        ["rejected", "ไม่รับ", "Rejected"],
      ),
      { list: true, defaultValue: "open" },
    ),
    sortOrder(),
  ],
};

export const devMilestones: ResourceDef = {
  name: "dev_project_milestones",
  label: {
    one: l("Milestone", "Milestone"),
    many: l("Milestone", "Milestones"),
  },
  childOnly: true,
  parent: { resource: "dev_projects", target: "project_id" },
  recordRepresentation: "name",
  sort: { field: "sort_order", order: "ASC" },
  fields: [
    projectRef(),
    field("name", "ชื่อ", "Name", "text", { required: true, list: true }),
    option("department_id", "แผนก", "Department", "department", { list: true }),
    ref("sales_id", "ผู้รับผิดชอบ", "Responsible", "sales", "first_name", {
      list: true,
    }),
    field("planned_date", "วันที่วางแผน", "Planned", "date", { list: true }),
    field("actual_date", "วันที่เสร็จจริง", "Actual", "date", { list: true }),
    select(
      "status",
      "สถานะ",
      "Status",
      choices(
        ["planned", "วางแผน", "Planned"],
        ["in_progress", "กำลังดำเนินการ", "In progress"],
        ["done", "เสร็จ", "Done"],
        ["delayed", "ล่าช้า", "Delayed"],
        ["cancelled", "ยกเลิก", "Cancelled"],
      ),
      { list: true, defaultValue: "planned" },
    ),
    notes(),
    sortOrder(),
  ],
};

export const devSamples: ResourceDef = {
  name: "dev_project_samples",
  label: {
    one: l("ตัวอย่าง", "Sample"),
    many: l("ตัวอย่างและต้นแบบ", "Samples and prototypes"),
  },
  childOnly: true,
  parent: { resource: "dev_projects", target: "project_id" },
  recordRepresentation: "sample_no",
  fields: [
    projectRef(),
    field("sample_no", "เลขที่ตัวอย่าง", "Sample no.", "text", {
      required: true,
      list: true,
    }),
    select(
      "sample_type",
      "ประเภท",
      "Type",
      choices(
        ["prototype", "ต้นแบบ", "Prototype"],
        ["sample", "ตัวอย่าง", "Sample"],
        ["pilot_lot", "Pilot lot", "Pilot lot"],
      ),
      {
        list: true,
        defaultValue: "sample",
      },
    ),
    field("quantity", "จำนวน", "Quantity", "number", { list: true }),
    field("requested_date", "วันที่ลูกค้าขอ", "Requested", "date"),
    field("planned_submission_date", "กำหนดส่ง", "Planned submission", "date", {
      list: true,
    }),
    field("submitted_date", "ส่งจริง", "Submitted", "date", { list: true }),
    select(
      "status",
      "สถานะ",
      "Status",
      choices(
        ["requested", "ได้รับคำขอ", "Requested"],
        ["in_preparation", "กำลังเตรียม", "In preparation"],
        ["submitted", "ส่งแล้ว", "Submitted"],
        ["feedback_received", "ได้รับผลตอบกลับ", "Feedback received"],
        ["closed", "ปิด", "Closed"],
        ["cancelled", "ยกเลิก", "Cancelled"],
      ),
      { list: true, defaultValue: "requested" },
    ),
    select(
      "result",
      "ผลการอนุมัติ",
      "Result",
      choices(
        ["approved", "อนุมัติ", "Approved"],
        [
          "conditionally_approved",
          "อนุมัติแบบมีเงื่อนไข",
          "Conditionally approved",
        ],
        ["rejected", "ไม่อนุมัติ", "Rejected"],
      ),
      { list: true },
    ),
    field(
      "customer_feedback",
      "ความเห็นลูกค้า",
      "Customer feedback",
      "textarea",
      { wide: true },
    ),
    field("report_ref", "อ้างอิงรายงาน", "Report reference"),
  ],
};

export const devRisks: ResourceDef = {
  name: "dev_project_risks",
  label: {
    one: l("ความเสี่ยง", "Risk"),
    many: l("ความเสี่ยงทางเทคนิค", "Technical risks"),
  },
  childOnly: true,
  parent: { resource: "dev_projects", target: "project_id" },
  recordRepresentation: "description",
  fields: [
    projectRef(),
    field("description", "ความเสี่ยง", "Risk", "textarea", {
      required: true,
      list: true,
      wide: true,
    }),
    select(
      "severity",
      "ระดับ",
      "Severity",
      choices(
        ["low", "ต่ำ", "Low"],
        ["medium", "ปานกลาง", "Medium"],
        ["high", "สูง", "High"],
      ),
      {
        list: true,
        defaultValue: "medium",
      },
    ),
    field("mitigation", "แนวทางลดความเสี่ยง", "Mitigation", "textarea", {
      list: true,
      wide: true,
    }),
    select(
      "status",
      "สถานะ",
      "Status",
      choices(
        ["open", "เปิด", "Open"],
        ["mitigating", "กำลังแก้ไข", "Mitigating"],
        ["closed", "ปิด", "Closed"],
        ["accepted", "ยอมรับความเสี่ยง", "Accepted"],
      ),
      { list: true, defaultValue: "open" },
    ),
    ref("sales_id", "ผู้รับผิดชอบ", "Responsible", "sales", "first_name"),
  ],
};

export const dealerNetworks: ResourceDef = {
  name: "dealer_networks",
  label: {
    one: l("เครือข่ายตัวแทน", "Network member"),
    many: l("OBM และเครือข่ายตัวแทน", "OBM and dealer network"),
  },
  icon: Network,
  group: "customers",
  recordRepresentation: "network_role",
  sort: { field: "created_at", order: "DESC" },
  searchFields: ["notes"],
  fields: [
    ref("brand_id", "แบรนด์", "Brand", "brands", "name", {
      required: true,
      list: true,
      filter: true,
    }),
    company({ required: true, list: true }),
    ref(
      "supplied_by_company_id",
      "รับสินค้าผ่าน (ผู้กระจายสินค้า)",
      "Supplied by",
      "companies",
      "name",
      { list: true },
    ),
    select(
      "network_role",
      "บทบาท",
      "Role",
      choices(
        ["distributor", "ผู้กระจายสินค้า", "Distributor"],
        ["dealer", "ตัวแทนจำหน่าย", "Dealer"],
        ["wholesaler", "ผู้ค้าส่ง", "Wholesaler"],
        ["retailer", "ผู้ค้าปลีก", "Retailer"],
      ),
      { list: true, filter: true, defaultValue: "dealer" },
    ),
    ref("territory_id", "เขตการขาย", "Territory", "territories", "name", {
      list: true,
      filter: true,
    }),
    select(
      "status",
      "สถานะ",
      "Status",
      choices(
        ["prospect", "มุ่งหวัง", "Prospect"],
        ["active", "ใช้งาน", "Active"],
        ["suspended", "ระงับ", "Suspended"],
        ["terminated", "ยกเลิก", "Terminated"],
      ),
      { list: true, filter: true, defaultValue: "prospect" },
    ),
    field("start_date", "เริ่มต้น", "Start date", "date"),
    field("end_date", "สิ้นสุด", "End date", "date"),
    notes(),
    owner({ list: true }),
    createdAt(),
  ],
  children: [
    {
      resource: "dealer_product_coverage",
      target: "dealer_network_id",
      label: l("สินค้าที่จำหน่าย", "Product coverage"),
    },
  ],
};

export const dealerCoverage: ResourceDef = {
  name: "dealer_product_coverage",
  label: {
    one: l("สินค้าที่จำหน่าย", "Product coverage"),
    many: l("สินค้าที่จำหน่าย", "Product coverage"),
  },
  childOnly: true,
  parent: { resource: "dealer_networks", target: "dealer_network_id" },
  recordRepresentation: "notes",
  fields: [
    ref(
      "dealer_network_id",
      "เครือข่าย",
      "Network member",
      "dealer_networks",
      "id",
      { required: true },
    ),
    ref(
      "node_id",
      "กลุ่มสินค้า",
      "Product family / category",
      "product_hierarchy_nodes",
      "name",
      {
        list: true,
        helper: l(
          "เลือกกลุ่มสินค้าหรือสินค้าอย่างใดอย่างหนึ่ง",
          "Choose either a product group or a product",
        ),
      },
    ),
    product({ list: true }),
    notes(),
  ],
};
