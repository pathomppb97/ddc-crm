import {
  Building2,
  CalendarCheck,
  ClipboardList,
  FileText,
  Handshake,
  Megaphone,
  ShieldAlert,
} from "lucide-react";
import {
  businessModel,
  BY_CUSTOMER,
  BY_OPTIONAL_CUSTOMER,
  choices,
  company,
  createdAt,
  field,
  l,
  notes,
  option,
  owner,
  PRIORITIES,
  product,
  ref,
  select,
} from "./helpers";
import type { ResourceDef } from "./schema";

export const customers: ResourceDef = {
  name: "companies",
  label: { one: l("ลูกค้า", "Customer"), many: l("ลูกค้า", "Customers") },
  icon: Building2,
  group: "customers",
  recordRepresentation: "name",
  sort: { field: "name", order: "ASC" },
  searchFields: [
    "name",
    "customer_code",
    "legal_name",
    "tax_identifier",
    "city",
    "province",
    "email",
    "phone_number",
  ],
  documentEntity: "companies",
  fields: [
    field("customer_code", "รหัสลูกค้า", "Customer ID", "text", {
      list: true,
      helper: l("เว้นว่างเพื่อให้ระบบกำหนดให้", "Leave empty to generate one"),
    }),
    field("name", "ชื่อลูกค้า", "Name", "text", { required: true, list: true }),
    field("legal_name", "ชื่อนิติบุคคล", "Legal name"),
    field("tax_identifier", "เลขประจำตัวผู้เสียภาษี", "Tax ID"),
    select(
      "org_type",
      "ประเภทองค์กร",
      "Organization type",
      choices(
        ["standalone", "องค์กรเดี่ยว", "Standalone"],
        ["headquarters", "สำนักงานใหญ่", "Headquarters"],
        ["subsidiary", "บริษัทในเครือ", "Subsidiary"],
        ["branch", "สาขา", "Branch"],
      ),
      { defaultValue: "standalone", filter: true },
    ),
    ref(
      "parent_company_id",
      "บริษัทแม่ / สำนักงานใหญ่",
      "Parent company",
      "companies",
      "name",
    ),
    field("branch_code", "รหัสสาขา", "Branch code"),
    option(
      "lifecycle_status_id",
      "สถานะลูกค้า",
      "Lifecycle status",
      "customer_lifecycle_status",
      { list: true, filter: true },
    ),
    option("category_id", "ประเภทลูกค้า", "Category", "customer_category", {
      filter: true,
    }),
    option(
      "customer_group_id",
      "กลุ่มลูกค้า",
      "Customer group",
      "customer_group",
      { list: true, filter: true },
    ),
    ref("territory_id", "เขตการขาย", "Territory", "territories", "name", {
      list: true,
      filter: true,
    }),
    owner({ list: true }),
    field("phone_number", "โทรศัพท์", "Phone"),
    field("email", "อีเมล", "Email", "email"),
    field("website", "เว็บไซต์", "Website", "url"),
    field("address", "ที่อยู่", "Address", "textarea", { wide: true }),
    field("city", "อำเภอ/เมือง", "City"),
    field("province", "จังหวัด", "Province", "text", {
      list: true,
      filter: true,
    }),
    field("zipcode", "รหัสไปรษณีย์", "Postal code"),
    field("country", "ประเทศ", "Country", "text", { list: true, filter: true }),
    field("latitude", "ละติจูด (GPS)", "Latitude", "number"),
    field("longitude", "ลองจิจูด (GPS)", "Longitude", "number"),
    field("google_maps_url", "ลิงก์ Google Maps", "Google Maps URL", "url"),
    field("location_note", "จุดสังเกต / รายละเอียดที่ตั้ง", "Location note"),
    field("description", "รายละเอียด", "Description", "textarea", {
      wide: true,
    }),
    field("nb_deals", "โอกาสการขาย", "Opportunities", "number", {
      readOnly: true,
      list: true,
    }),
    field("last_activity_at", "กิจกรรมล่าสุด", "Last activity", "datetime", {
      readOnly: true,
      list: true,
    }),
    createdAt(),
  ],
  children: [
    {
      resource: "customer_capacity_profiles",
      target: "company_id",
      label: l("Cap. การใช้งานและจำนวนรถ", "Usage capacity & fleet"),
    },
    {
      resource: "customer_part_usage",
      target: "company_id",
      label: l("ความถี่การเปลี่ยนอะไหล่", "Part replacement frequency"),
    },
    {
      resource: "activity_photos",
      target: "company_id",
      label: l("รูปถ่ายหน้างาน", "Field photos"),
    },
    {
      resource: "customer_fleets",
      target: "company_id",
      label: l("รถตัดอ้อยจาก Excel", "Excel harvester fleet"),
    },
    {
      resource: "customer_requirements",
      target: "company_id",
      label: l("ความต้องการใบมีด", "Blade requirements"),
    },
    {
      resource: "customer_samples",
      target: "company_id",
      label: l("ตัวอย่างและการทดสอบ", "Samples and testing"),
    },
    {
      resource: "customer_purchase_history",
      target: "company_id",
      label: l("ปริมาณตามฤดูกาล", "Seasonal quantities"),
    },
    {
      resource: "customer_source_rows",
      target: "company_id",
      label: l("ข้อมูลต้นฉบับ Excel", "Excel source rows"),
    },
    {
      resource: "company_business_models",
      target: "company_id",
      label: l("รูปแบบธุรกิจ", "Business relationships"),
    },
    {
      resource: "contacts",
      target: "company_id",
      label: l("ผู้ติดต่อ", "Contacts"),
      columns: ["first_name", "last_name", "title"],
    },
    {
      resource: "company_addresses",
      target: "company_id",
      label: l("ที่อยู่เพิ่มเติม", "Addresses"),
    },
    {
      resource: "company_product_interests",
      target: "company_id",
      label: l("สินค้าที่สนใจ", "Product interests"),
    },
    {
      resource: "company_territories",
      target: "company_id",
      label: l("เขตการขายเพิ่มเติม", "Additional territories"),
    },
    {
      resource: "activities",
      target: "company_id",
      label: l("กิจกรรมและการเข้าพบ", "Activities and visits"),
    },
    {
      resource: "deals",
      target: "company_id",
      label: l("โอกาสการขาย", "Opportunities"),
      columns: ["name", "stage", "amount"],
    },
    { resource: "rfqs", target: "company_id", label: l("RFQ", "RFQs") },
    {
      resource: "quotations",
      target: "company_id",
      label: l("ใบเสนอราคา", "Quotations"),
    },
    {
      resource: "dev_projects",
      target: "company_id",
      label: l("โครงการพัฒนา", "Development projects"),
    },
    {
      resource: "service_cases",
      target: "company_id",
      label: l("ข้อร้องเรียน", "Complaints"),
    },
    {
      resource: "dealer_networks",
      target: "company_id",
      label: l("เครือข่ายตัวแทน", "Dealer network"),
    },
    {
      resource: "erp_sales_orders",
      target: "company_id",
      label: l("ใบสั่งขาย (ERP)", "Sales orders (ERP)"),
    },
    {
      resource: "erp_invoices",
      target: "company_id",
      label: l("ใบแจ้งหนี้ (ERP)", "Invoices (ERP)"),
    },
  ],
};

export const companyBusinessModels: ResourceDef = {
  name: "company_business_models",
  label: {
    one: l("ความสัมพันธ์ทางธุรกิจ", "Business relationship"),
    many: l("ความสัมพันธ์ทางธุรกิจ", "Business relationships"),
  },
  childOnly: true,
  parent: { resource: "companies", target: "company_id" },
  recordRepresentation: "business_model_id",
  fields: [
    company({ required: true }),
    businessModel({ required: true, list: true }),
    option(
      "sales_channel_id",
      "ช่องทางการขาย",
      "Sales channel",
      "sales_channel",
      { list: true },
    ),
    field("is_primary", "หลัก", "Primary", "boolean", { list: true }),
    notes(),
  ],
};

export const companyAddresses: ResourceDef = {
  name: "company_addresses",
  label: { one: l("ที่อยู่", "Address"), many: l("ที่อยู่", "Addresses") },
  childOnly: true,
  parent: { resource: "companies", target: "company_id" },
  recordRepresentation: "label",
  fields: [
    company({ required: true }),
    select(
      "address_type",
      "ประเภท",
      "Type",
      choices(
        ["registered", "ที่อยู่จดทะเบียน", "Registered"],
        ["billing", "ที่อยู่วางบิล", "Billing"],
        ["shipping", "ที่อยู่จัดส่ง", "Shipping"],
        ["plant", "โรงงาน", "Plant"],
        ["branch", "สาขา", "Branch"],
        ["other", "อื่น ๆ", "Other"],
      ),
      { list: true, defaultValue: "other" },
    ),
    field("label", "ชื่อเรียก", "Label", "text", { list: true }),
    field("address", "ที่อยู่", "Address", "textarea", {
      list: true,
      wide: true,
    }),
    field("city", "อำเภอ/เมือง", "City"),
    field("province", "จังหวัด", "Province", "text", { list: true }),
    field("zipcode", "รหัสไปรษณีย์", "Postal code"),
    field("country", "ประเทศ", "Country", "text", { list: true }),
    field("is_primary", "หลัก", "Primary", "boolean"),
  ],
};

export const companyTerritories: ResourceDef = {
  name: "company_territories",
  label: {
    one: l("เขตการขาย", "Territory"),
    many: l("เขตการขาย", "Territories"),
  },
  childOnly: true,
  parent: { resource: "companies", target: "company_id" },
  recordRepresentation: "territory_id",
  fields: [
    company({ required: true }),
    ref("territory_id", "เขตการขาย", "Territory", "territories", "name", {
      required: true,
      list: true,
    }),
  ],
};

export const companyProductInterests: ResourceDef = {
  name: "company_product_interests",
  label: {
    one: l("สินค้าที่สนใจ", "Product interest"),
    many: l("สินค้าที่สนใจ", "Product interests"),
  },
  childOnly: true,
  parent: { resource: "companies", target: "company_id" },
  recordRepresentation: "notes",
  fields: [
    company({ required: true }),
    ref(
      "node_id",
      "กลุ่มสินค้า",
      "Product family / category",
      "product_hierarchy_nodes",
      "name",
      { list: true },
    ),
    product({ list: true }),
    select(
      "interest_level",
      "ระดับความสนใจ",
      "Interest level",
      choices(
        ["low", "ต่ำ", "Low"],
        ["medium", "ปานกลาง", "Medium"],
        ["high", "สูง", "High"],
      ),
      { list: true },
    ),
    notes(),
  ],
};

export const LEAD_STATUSES = choices(
  ["new", "ใหม่", "New"],
  ["contacted", "ติดต่อแล้ว", "Contacted"],
  ["qualified", "ผ่านการคัดกรอง", "Qualified"],
  ["disqualified", "ไม่ผ่านการคัดกรอง", "Disqualified"],
  ["converted", "แปลงเป็นลูกค้าแล้ว", "Converted"],
);

export const leads: ResourceDef = {
  name: "leads",
  label: { one: l("ลีด", "Lead"), many: l("ลีด", "Leads") },
  icon: Megaphone,
  group: "sales",
  recordRepresentation: "company_name",
  sort: { field: "created_at", order: "DESC" },
  searchFields: [
    "company_name",
    "lead_no",
    "contact_name",
    "email",
    "phone",
    "product_interest",
  ],
  documentEntity: "leads",
  fields: [
    field("lead_no", "เลขที่ลีด", "Lead no.", "text", {
      readOnly: true,
      list: true,
    }),
    field("company_name", "ชื่อบริษัท", "Company name", "text", {
      required: true,
      list: true,
    }),
    field("contact_name", "ผู้ติดต่อ", "Contact name", "text", { list: true }),
    field("contact_title", "ตำแหน่ง", "Contact title"),
    field("email", "อีเมล", "Email", "email"),
    field("phone", "โทรศัพท์", "Phone"),
    field("website", "เว็บไซต์", "Website", "url"),
    field("country", "ประเทศ", "Country", "text", { filter: true }),
    field("province", "จังหวัด", "Province"),
    ref("territory_id", "เขตการขาย", "Territory", "territories", "name", {
      filter: true,
    }),
    option("source_id", "แหล่งที่มา", "Source", "lead_source", {
      list: true,
      filter: true,
    }),
    businessModel(),
    select("status", "สถานะ", "Status", LEAD_STATUSES, {
      list: true,
      filter: true,
      defaultValue: "new",
      hideOnCreate: true,
    }),
    field("product_interest", "สินค้าที่สนใจ", "Product interest", "textarea", {
      wide: true,
    }),
    field("estimated_value", "มูลค่าประมาณการ", "Estimated value", "money"),
    field("currency", "สกุลเงิน", "Currency", "text", { defaultValue: "THB" }),
    field("follow_up_date", "วันติดตาม", "Follow-up date", "date", {
      list: true,
    }),
    field(
      "qualification_notes",
      "บันทึกการคัดกรอง",
      "Qualification notes",
      "textarea",
      { wide: true },
    ),
    field(
      "disqualification_reason",
      "เหตุผลที่ไม่ผ่าน",
      "Disqualification reason",
      "textarea",
      { wide: true, hideOnCreate: true },
    ),
    owner({ list: true }),
    ref(
      "converted_company_id",
      "ลูกค้าที่แปลงแล้ว",
      "Converted customer",
      "companies",
      "name",
      { readOnly: true },
    ),
    ref(
      "converted_deal_id",
      "โอกาสการขายที่สร้าง",
      "Created opportunity",
      "deals",
      "name",
      { readOnly: true },
    ),
    field("converted_at", "แปลงเมื่อ", "Converted at", "datetime", {
      readOnly: true,
    }),
    createdAt(),
  ],
};

export const ACTIVITY_STATUSES = choices(
  ["planned", "วางแผน", "Planned"],
  ["completed", "เสร็จสิ้น", "Completed"],
  ["cancelled", "ยกเลิก", "Cancelled"],
);

export const activities: ResourceDef = {
  name: "activities",
  label: {
    one: l("กิจกรรม", "Activity"),
    many: l("กิจกรรมและการเข้าพบ", "Activities and visits"),
  },
  icon: CalendarCheck,
  group: "sales",
  recordRepresentation: "subject",
  sort: { field: "start_at", order: "DESC" },
  searchFields: ["subject", "location", "objective", "discussion"],
  documentEntity: "activities",
  fields: [
    option(
      "activity_type_id",
      "ประเภทกิจกรรม",
      "Activity type",
      "activity_type",
      { required: true, list: true, filter: true },
    ),
    field("subject", "หัวข้อ", "Subject", "text", {
      required: true,
      list: true,
    }),
    company({ list: true }),
    ref("deal_id", "โอกาสการขาย", "Opportunity", "deals", "name", {
      dependsOn: BY_OPTIONAL_CUSTOMER,
    }),
    ref("lead_id", "ลีด", "Lead", "leads", "company_name"),
    field("start_at", "เริ่ม", "Start", "datetime", {
      required: true,
      list: true,
    }),
    field("end_at", "สิ้นสุด", "End", "datetime", {
      input: { notBefore: "start_at" },
    }),
    field("logged_at", "เวลาที่ลงข้อมูล", "Logged at", "datetime", {
      readOnly: true,
      list: true,
    }),
    field("location", "สถานที่", "Location"),
    field("checkin_lat", "ละติจูด Check-in", "Check-in latitude", "number"),
    field("checkin_lng", "ลองจิจูด Check-in", "Check-in longitude", "number"),
    select("status", "สถานะ", "Status", ACTIVITY_STATUSES, {
      list: true,
      filter: true,
      defaultValue: "planned",
    }),
    field("objective", "วัตถุประสงค์", "Objective", "textarea", { wide: true }),
    field("discussion", "รายละเอียดการหารือ", "Discussion", "textarea", {
      wide: true,
    }),
    field("outcome", "ผลลัพธ์", "Outcome", "textarea", { wide: true }),
    field("follow_up_date", "วันติดตามผล", "Follow-up date", "date", {
      list: true,
    }),
    owner({ list: true }),
    createdAt(),
  ],
  children: [
    {
      resource: "activity_participants",
      target: "activity_id",
      label: l("ผู้เข้าร่วม", "Participants"),
    },
    {
      resource: "activity_products",
      target: "activity_id",
      label: l("สินค้าที่หารือ", "Products discussed"),
    },
    {
      resource: "activity_photos",
      target: "activity_id",
      label: l("รูปถ่ายหน้างาน", "Field photos"),
    },
    {
      resource: "action_items",
      target: "activity_id",
      label: l("รายการที่ต้องดำเนินการ", "Action items"),
    },
  ],
};

export const activityParticipants: ResourceDef = {
  name: "activity_participants",
  label: {
    one: l("ผู้เข้าร่วม", "Participant"),
    many: l("ผู้เข้าร่วม", "Participants"),
  },
  childOnly: true,
  parent: { resource: "activities", target: "activity_id" },
  recordRepresentation: "external_name",
  fields: [
    ref("activity_id", "กิจกรรม", "Activity", "activities", "subject", {
      required: true,
    }),
    ref(
      "contact_id",
      "ผู้ติดต่อของลูกค้า",
      "Customer contact",
      "contacts",
      "last_name",
      {
        list: true,
        dependsOn: {
          sourceField: "activity_id",
          viaResource: "activities",
          viaField: "company_id",
          targetField: "company_id",
          requireParent: true,
          emptyParentPlaceholder: l(
            "กิจกรรมนี้ยังไม่ได้ระบุลูกค้า",
            "No customer linked to this activity",
          ),
        },
      },
    ),
    ref("sales_id", "พนักงาน DDC", "DDC staff", "sales", "first_name", {
      list: true,
    }),
    field("external_name", "บุคคลภายนอก", "Other person", "text", {
      list: true,
      helper: l(
        "กรอกเพียงหนึ่งช่อง: ผู้ติดต่อ พนักงาน หรือบุคคลภายนอก",
        "Fill exactly one: contact, staff or other person",
      ),
    }),
    field("role", "บทบาท", "Role", "text", { list: true }),
  ],
};

export const activityProducts: ResourceDef = {
  name: "activity_products",
  label: {
    one: l("สินค้าที่หารือ", "Product discussed"),
    many: l("สินค้าที่หารือ", "Products discussed"),
  },
  childOnly: true,
  parent: { resource: "activities", target: "activity_id" },
  recordRepresentation: "notes",
  fields: [
    ref("activity_id", "กิจกรรม", "Activity", "activities", "subject", {
      required: true,
    }),
    product({ list: true }),
    ref(
      "node_id",
      "กลุ่มสินค้า",
      "Product family / category",
      "product_hierarchy_nodes",
      "name",
      { list: true },
    ),
    field(
      "custom_part_name",
      "ชิ้นส่วนนอกแค็ตตาล็อก",
      "Custom part name",
      "text",
      {
        list: true,
      },
    ),
    field("quantity", "จำนวนที่ต้องการ", "Quantity", "number", { list: true }),
    field("uom", "หน่วย", "Unit", "text", { list: true, defaultValue: "pcs" }),
    select(
      "urgency",
      "ความเร่งด่วน",
      "Urgency",
      choices(
        ["immediate", "ต้องการด่วน", "Immediate"],
        ["this_season", "ใช้ฤดูนี้", "This season"],
        ["inquiry", "สอบถามข้อมูล", "Inquiry"],
      ),
      { list: true, defaultValue: "inquiry" },
    ),
    notes(),
  ],
};

export const ACTION_STATUSES = choices(
  ["open", "รอดำเนินการ", "Open"],
  ["in_progress", "กำลังดำเนินการ", "In progress"],
  ["done", "เสร็จแล้ว", "Done"],
  ["cancelled", "ยกเลิก", "Cancelled"],
);

export const actionItems: ResourceDef = {
  name: "action_items",
  label: {
    one: l("รายการที่ต้องดำเนินการ", "Action item"),
    many: l("รายการติดตาม", "Action items"),
  },
  icon: ClipboardList,
  group: "sales",
  recordRepresentation: "description",
  sort: { field: "due_date", order: "ASC" },
  searchFields: ["description"],
  fields: [
    field("description", "รายละเอียด", "Description", "textarea", {
      required: true,
      list: true,
      wide: true,
    }),
    ref("activity_id", "กิจกรรม", "Activity", "activities", "subject", {
      list: true,
      dependsOn: BY_OPTIONAL_CUSTOMER,
    }),
    company({ list: true }),
    field("due_date", "กำหนดเสร็จ", "Due date", "date", { list: true }),
    select("status", "สถานะ", "Status", ACTION_STATUSES, {
      list: true,
      filter: true,
      defaultValue: "open",
    }),
    owner({ list: true }),
    field("completed_at", "เสร็จเมื่อ", "Completed at", "datetime", {
      readOnly: true,
    }),
  ],
};

export const dealProducts: ResourceDef = {
  name: "deal_products",
  label: {
    one: l("สินค้าในโอกาสการขาย", "Opportunity product"),
    many: l("สินค้า", "Products"),
  },
  childOnly: true,
  parent: { resource: "deals", target: "deal_id" },
  recordRepresentation: "description",
  fields: [
    ref("deal_id", "โอกาสการขาย", "Opportunity", "deals", "name", {
      required: true,
    }),
    product({ list: true }),
    ref(
      "node_id",
      "กลุ่มสินค้า",
      "Product family / category",
      "product_hierarchy_nodes",
      "name",
      { list: true },
    ),
    field("description", "รายละเอียด", "Description", "text", { list: true }),
    field("quantity", "ปริมาณประมาณการ", "Estimated quantity", "number", {
      list: true,
    }),
    field("uom", "หน่วย", "Unit", "text", { list: true }),
    field(
      "target_price",
      "ราคาเป้าหมายของลูกค้า",
      "Customer target price",
      "money",
      { list: true },
    ),
    notes(),
  ],
};

export const dealCompetitors: ResourceDef = {
  name: "deal_competitors",
  label: { one: l("คู่แข่ง", "Competitor"), many: l("คู่แข่ง", "Competitors") },
  childOnly: true,
  parent: { resource: "deals", target: "deal_id" },
  recordRepresentation: "competitor_name",
  fields: [
    ref("deal_id", "โอกาสการขาย", "Opportunity", "deals", "name", {
      required: true,
    }),
    field("competitor_name", "ชื่อคู่แข่ง", "Competitor", "text", {
      required: true,
      list: true,
    }),
    field("offering", "ข้อเสนอ", "Offering", "text", { list: true }),
    field(
      "price_information",
      "ข้อมูลราคา (ตามที่ทราบ)",
      "Price information (as reported)",
      "text",
      { list: true },
    ),
    notes(),
  ],
};

export const RFQ_STATUSES = choices(
  ["registered", "ลงทะเบียน", "Registered"],
  ["engineering_review", "ทบทวนทางวิศวกรรม", "Engineering review"],
  ["costing", "ประเมินต้นทุน", "Costing"],
  ["quoted", "เสนอราคาแล้ว", "Quoted"],
  ["closed", "ปิด", "Closed"],
  ["cancelled", "ยกเลิก", "Cancelled"],
);

export const REVIEW_STATUSES = choices(
  ["not_required", "ไม่ต้องทบทวน", "Not required"],
  ["pending", "รอทบทวน", "Pending"],
  ["feasible", "ทำได้", "Feasible"],
  [
    "feasible_with_conditions",
    "ทำได้แบบมีเงื่อนไข",
    "Feasible with conditions",
  ],
  ["not_feasible", "ทำไม่ได้", "Not feasible"],
);

export const rfqs: ResourceDef = {
  name: "rfqs",
  label: { one: l("RFQ", "RFQ"), many: l("คำขอเสนอราคา (RFQ)", "RFQs") },
  icon: FileText,
  group: "sales",
  recordRepresentation: "rfq_no",
  sort: { field: "received_date", order: "DESC" },
  searchFields: ["rfq_no", "subject", "customer_rfq_ref"],
  documentEntity: "rfqs",
  fields: [
    field("rfq_no", "เลขที่ RFQ", "RFQ no.", "text", {
      readOnly: true,
      list: true,
    }),
    field("customer_rfq_ref", "เลขอ้างอิงของลูกค้า", "Customer reference"),
    company({ required: true, list: true }),
    ref("contact_id", "ผู้ติดต่อ", "Contact", "contacts", "last_name", {
      dependsOn: BY_CUSTOMER,
    }),
    ref("deal_id", "โอกาสการขาย", "Opportunity", "deals", "name", {
      dependsOn: BY_CUSTOMER,
    }),
    field("subject", "เรื่อง", "Subject", "text", {
      required: true,
      list: true,
    }),
    field("received_date", "วันที่รับ", "Received", "date", {
      required: true,
      list: true,
    }),
    field("quotation_due_date", "กำหนดส่งใบเสนอราคา", "Quotation due", "date", {
      list: true,
    }),
    field(
      "requested_delivery_date",
      "วันส่งมอบที่ลูกค้าต้องการ",
      "Requested delivery",
    ),
    field(
      "customer_requirements",
      "ความต้องการของลูกค้า",
      "Customer requirements",
      "textarea",
      { wide: true },
    ),
    select("status", "สถานะ", "Status", RFQ_STATUSES, {
      list: true,
      filter: true,
      defaultValue: "registered",
    }),
    select(
      "engineering_review_status",
      "ผลทบทวนทางวิศวกรรม",
      "Engineering review",
      REVIEW_STATUSES,
      {
        list: true,
        filter: true,
        defaultValue: "not_required",
      },
    ),
    field(
      "engineering_notes",
      "ความเห็นวิศวกรรม",
      "Engineering notes",
      "textarea",
      { wide: true },
    ),
    ref(
      "engineering_reviewer_id",
      "ผู้ทบทวน",
      "Reviewer",
      "sales",
      "first_name",
      { readOnly: true },
    ),
    field("engineering_reviewed_at", "ทบทวนเมื่อ", "Reviewed at", "datetime", {
      readOnly: true,
    }),
    field(
      "cost_estimate_ref",
      "เลขอ้างอิงการประเมินต้นทุน",
      "Cost estimate reference",
      "text",
      {
        helper: l(
          "อ้างอิงเอกสารต้นทุนภายนอก ระบบไม่คำนวณต้นทุน",
          "Reference to the external costing document. The CRM does not compute costs.",
        ),
      },
    ),
    field("follow_up_date", "วันติดตาม", "Follow-up date", "date"),
    owner({ list: true }),
    createdAt(),
  ],
  children: [
    {
      resource: "rfq_items",
      target: "rfq_id",
      label: l("รายการสินค้า", "Items"),
    },
    {
      resource: "quotations",
      target: "rfq_id",
      label: l("ใบเสนอราคา", "Quotations"),
    },
  ],
};

export const rfqItems: ResourceDef = {
  name: "rfq_items",
  label: {
    one: l("รายการ RFQ", "RFQ item"),
    many: l("รายการ RFQ", "RFQ items"),
  },
  childOnly: true,
  parent: { resource: "rfqs", target: "rfq_id" },
  recordRepresentation: "description",
  sort: { field: "line_no", order: "ASC" },
  fields: [
    ref("rfq_id", "RFQ", "RFQ", "rfqs", "rfq_no", { required: true }),
    field("line_no", "ลำดับ", "Line", "number", { required: true, list: true }),
    product({ list: true }),
    field(
      "customer_part_number",
      "รหัสชิ้นส่วนของลูกค้า",
      "Customer part no.",
      "text",
      { list: true },
    ),
    field("description", "รายละเอียด", "Description", "text", { list: true }),
    field("quantity", "จำนวน", "Quantity", "number", {
      list: true,
      input: { exclusiveMin: true },
    }),
    field("uom", "หน่วย", "Unit", "text", { list: true }),
    field("target_price", "ราคาเป้าหมาย", "Target price", "money", {
      list: true,
    }),
    field("currency", "สกุลเงิน", "Currency"),
    field(
      "requested_specification",
      "ข้อกำหนดที่ลูกค้าระบุ",
      "Requested specification",
      "textarea",
      { wide: true },
    ),
    field(
      "requested_delivery_date",
      "วันส่งมอบที่ต้องการ",
      "Requested delivery",
      "date",
    ),
    field("drawing_no", "เลขที่แบบ", "Drawing no.", "text", { list: true }),
    field("drawing_revision", "Revision แบบ", "Drawing revision"),
  ],
};

export const QUOTATION_STATUS_CHOICES = choices(
  ["draft", "ร่าง", "Draft"],
  ["pending_approval", "รออนุมัติ", "Pending approval"],
  ["approved", "อนุมัติแล้ว", "Approved"],
  ["rejected", "ไม่อนุมัติ", "Rejected"],
  ["sent", "ส่งลูกค้าแล้ว", "Sent"],
  ["accepted", "ลูกค้ายอมรับ", "Accepted"],
  ["declined", "ลูกค้าปฏิเสธ", "Declined"],
  ["expired", "หมดอายุ", "Expired"],
  ["superseded", "ถูกแทนที่ด้วยฉบับใหม่", "Superseded"],
  ["cancelled", "ยกเลิก", "Cancelled"],
);

export const quotations: ResourceDef = {
  name: "quotations",
  label: {
    one: l("ใบเสนอราคา", "Quotation"),
    many: l("ใบเสนอราคา", "Quotations"),
  },
  icon: Handshake,
  group: "sales",
  recordRepresentation: "quotation_no",
  sort: { field: "created_at", order: "DESC" },
  searchFields: ["quotation_no", "subject"],
  documentEntity: "quotations",
  fields: [
    field("quotation_no", "เลขที่ใบเสนอราคา", "Quotation no.", "text", {
      readOnly: true,
      list: true,
    }),
    field("revision", "ฉบับแก้ไข", "Revision", "number", {
      readOnly: true,
      list: true,
    }),
    company({ required: true, list: true }),
    ref("contact_id", "ผู้ติดต่อ", "Contact", "contacts", "last_name", {
      dependsOn: BY_CUSTOMER,
    }),
    ref("rfq_id", "RFQ", "RFQ", "rfqs", "rfq_no", {
      list: true,
      dependsOn: BY_CUSTOMER,
    }),
    ref("deal_id", "โอกาสการขาย", "Opportunity", "deals", "name", {
      dependsOn: BY_CUSTOMER,
    }),
    field("subject", "เรื่อง", "Subject", "text", {
      required: true,
      list: true,
    }),
    field("currency", "สกุลเงิน", "Currency", "text", {
      required: true,
      defaultValue: "THB",
      list: true,
    }),
    select("status", "สถานะ", "Status", QUOTATION_STATUS_CHOICES, {
      readOnly: true,
      list: true,
      filter: true,
    }),
    field("total_amount", "มูลค่าเสนอราคา", "Quoted amount", "money", {
      readOnly: true,
      list: true,
    }),
    field("valid_until", "ใช้ได้ถึง", "Valid until", "date"),
    field("payment_terms", "เงื่อนไขการชำระเงิน", "Payment terms"),
    field("delivery_terms", "เงื่อนไขการส่งมอบ", "Delivery terms"),
    notes(),
    field("follow_up_date", "วันติดตามลูกค้า", "Customer follow-up", "date", {
      list: true,
    }),
    owner({ list: true }),
    field("submitted_at", "ส่งขออนุมัติเมื่อ", "Submitted at", "datetime", {
      readOnly: true,
    }),
    field("approved_at", "อนุมัติเมื่อ", "Approved at", "datetime", {
      readOnly: true,
    }),
    field("sent_at", "ส่งลูกค้าเมื่อ", "Sent at", "datetime", {
      readOnly: true,
    }),
    ref(
      "previous_revision_id",
      "ฉบับก่อนหน้า",
      "Previous revision",
      "quotations",
      "quotation_no",
      { readOnly: true },
    ),
    createdAt(),
  ],
  children: [
    {
      resource: "quotation_items",
      target: "quotation_id",
      label: l("รายการเสนอราคา", "Lines"),
    },
    {
      resource: "quotation_approvals",
      target: "quotation_id",
      label: l("การอนุมัติ", "Approvals"),
    },
  ],
};

export const quotationItems: ResourceDef = {
  name: "quotation_items",
  label: {
    one: l("รายการเสนอราคา", "Quotation line"),
    many: l("รายการเสนอราคา", "Quotation lines"),
  },
  childOnly: true,
  parent: { resource: "quotations", target: "quotation_id" },
  recordRepresentation: "description",
  sort: { field: "line_no", order: "ASC" },
  fields: [
    ref(
      "quotation_id",
      "ใบเสนอราคา",
      "Quotation",
      "quotations",
      "quotation_no",
      { required: true },
    ),
    field("line_no", "ลำดับ", "Line", "number", { required: true, list: true }),
    product({ list: true }),
    ref("rfq_item_id", "รายการ RFQ", "RFQ item", "rfq_items", "description", {
      dependsOn: {
        sourceField: "quotation_id",
        viaResource: "quotations",
        viaField: "rfq_id",
        targetField: "rfq_id",
        requireParent: true,
        emptyParentPlaceholder: l(
          "ใบเสนอราคานี้ไม่ได้อ้างอิง RFQ",
          "No RFQ linked to this quotation",
        ),
      },
    }),
    field("description", "รายละเอียด", "Description", "text", { list: true }),
    field("quantity", "จำนวน", "Quantity", "number", {
      required: true,
      list: true,
      input: { exclusiveMin: true },
    }),
    field("uom", "หน่วย", "Unit", "text", { list: true }),
    field("unit_price", "ราคาต่อหน่วย", "Unit price", "money", {
      required: true,
      list: true,
    }),
    field("discount_percent", "ส่วนลด %", "Discount %", "number", {
      defaultValue: 0,
      list: true,
    }),
    field("line_total", "รวม", "Line total", "money", {
      readOnly: true,
      list: true,
    }),
    field("lead_time_days", "ระยะเวลาผลิต (วัน)", "Lead time (days)", "number"),
    notes(),
  ],
};

export const quotationApprovals: ResourceDef = {
  name: "quotation_approvals",
  label: {
    one: l("การอนุมัติ", "Approval"),
    many: l("การอนุมัติ", "Approvals"),
  },
  childOnly: true,
  readOnly: true,
  parent: { resource: "quotations", target: "quotation_id" },
  recordRepresentation: "status",
  fields: [
    ref(
      "quotation_id",
      "ใบเสนอราคา",
      "Quotation",
      "quotations",
      "quotation_no",
    ),
    ref(
      "required_role_key",
      "บทบาทผู้อนุมัติ",
      "Approver role",
      "ddc_roles",
      "name",
      { list: true },
    ),
    select(
      "status",
      "สถานะ",
      "Status",
      choices(
        ["pending", "รออนุมัติ", "Pending"],
        ["approved", "อนุมัติ", "Approved"],
        ["rejected", "ไม่อนุมัติ", "Rejected"],
        ["cancelled", "ยกเลิก", "Cancelled"],
      ),
      { list: true },
    ),
    ref("decided_by", "ผู้ตัดสิน", "Decided by", "sales", "first_name", {
      list: true,
    }),
    field("decided_at", "วันที่", "Decided at", "datetime", { list: true }),
    field("comment", "ความเห็น", "Comment", "text", { list: true }),
  ],
};

export const CASE_STATUSES = choices(
  ["open", "เปิด", "Open"],
  ["investigating", "กำลังตรวจสอบ", "Investigating"],
  ["corrective_action", "ดำเนินการแก้ไข", "Corrective action"],
  ["awaiting_customer", "รอลูกค้า", "Awaiting customer"],
  ["closed", "ปิดแล้ว", "Closed"],
  ["cancelled", "ยกเลิก", "Cancelled"],
);

export const serviceCases: ResourceDef = {
  name: "service_cases",
  label: {
    one: l("ข้อร้องเรียน", "Complaint / case"),
    many: l("ข้อร้องเรียนและงานบริการ", "Complaints and service cases"),
  },
  icon: ShieldAlert,
  group: "service",
  recordRepresentation: "case_no",
  sort: { field: "received_date", order: "DESC" },
  searchFields: [
    "case_no",
    "subject",
    "customer_reference",
    "external_8d_ref",
    "external_ncr_ref",
    "external_capa_ref",
  ],
  documentEntity: "service_cases",
  fields: [
    field("case_no", "เลขที่เรื่อง", "Case no.", "text", {
      readOnly: true,
      list: true,
    }),
    company({ required: true, list: true }),
    ref("contact_id", "ผู้ติดต่อ", "Contact", "contacts", "last_name", {
      dependsOn: BY_CUSTOMER,
    }),
    field("customer_reference", "เลขอ้างอิงของลูกค้า", "Customer reference"),
    option("category_id", "ประเภท", "Category", "complaint_category", {
      list: true,
      filter: true,
    }),
    field("subject", "เรื่อง", "Subject", "text", {
      required: true,
      list: true,
    }),
    field("description", "รายละเอียดปัญหา", "Issue description", "textarea", {
      wide: true,
    }),
    select("priority", "ความสำคัญ", "Priority", PRIORITIES, {
      list: true,
      filter: true,
      defaultValue: "medium",
    }),
    select("status", "สถานะ", "Status", CASE_STATUSES, {
      list: true,
      filter: true,
      defaultValue: "open",
    }),
    field("received_date", "วันที่รับเรื่อง", "Received", "date", {
      required: true,
      list: true,
    }),
    field("due_date", "กำหนดตอบกลับ", "Due date", "date", { list: true }),
    option(
      "assigned_department_id",
      "แผนกที่รับผิดชอบ",
      "Assigned department",
      "department",
      { list: true, filter: true },
    ),
    owner(),
    field(
      "investigation_summary",
      "สรุปการตรวจสอบ",
      "Investigation summary",
      "textarea",
      { wide: true },
    ),
    field(
      "corrective_action_summary",
      "สรุปการแก้ไข",
      "Corrective action summary",
      "textarea",
      { wide: true },
    ),
    field("external_8d_ref", "อ้างอิงรายงาน 8D (QMS)", "8D reference (QMS)"),
    field("external_ncr_ref", "อ้างอิง NCR (QMS)", "NCR reference (QMS)"),
    field("external_capa_ref", "อ้างอิง CAPA (QMS)", "CAPA reference (QMS)"),
    field(
      "closure_summary",
      "สรุปการปิดเรื่อง",
      "Closure summary",
      "textarea",
      {
        wide: true,
        helper: l("จำเป็นเมื่อปิดเรื่อง", "Required to close the case"),
      },
    ),
    field("closed_at", "ปิดเมื่อ", "Closed at", "datetime", { readOnly: true }),
    createdAt(),
  ],
  children: [
    {
      resource: "service_case_products",
      target: "case_id",
      label: l("สินค้าที่ได้รับผลกระทบ", "Affected products"),
    },
    {
      resource: "service_case_communications",
      target: "case_id",
      label: l("การสื่อสารกับลูกค้า", "Customer communication"),
    },
  ],
};

export const serviceCaseProducts: ResourceDef = {
  name: "service_case_products",
  label: {
    one: l("สินค้าที่ได้รับผลกระทบ", "Affected product"),
    many: l("สินค้าที่ได้รับผลกระทบ", "Affected products"),
  },
  childOnly: true,
  parent: { resource: "service_cases", target: "case_id" },
  recordRepresentation: "description",
  fields: [
    ref("case_id", "เรื่อง", "Case", "service_cases", "case_no", {
      required: true,
    }),
    product({ list: true }),
    field("description", "รายละเอียด", "Description", "text", { list: true }),
    field("quantity", "จำนวน", "Quantity", "number", { list: true }),
    field("uom", "หน่วย", "Unit", "text", { list: true }),
    field("lot_reference", "Lot / เลขอ้างอิงการผลิต", "Lot reference", "text", {
      list: true,
    }),
  ],
};

export const serviceCaseCommunications: ResourceDef = {
  name: "service_case_communications",
  label: {
    one: l("การสื่อสาร", "Communication"),
    many: l("การสื่อสารกับลูกค้า", "Customer communication"),
  },
  childOnly: true,
  parent: { resource: "service_cases", target: "case_id" },
  recordRepresentation: "summary",
  sort: { field: "occurred_at", order: "DESC" },
  fields: [
    ref("case_id", "เรื่อง", "Case", "service_cases", "case_no", {
      required: true,
    }),
    field("occurred_at", "วันเวลา", "Date", "datetime", {
      required: true,
      list: true,
    }),
    select(
      "channel",
      "ช่องทาง",
      "Channel",
      choices(
        ["email", "อีเมล", "Email"],
        ["phone", "โทรศัพท์", "Phone"],
        ["meeting", "ประชุม", "Meeting"],
        ["visit", "เข้าพบ", "Visit"],
        ["letter", "จดหมาย", "Letter"],
        ["other", "อื่น ๆ", "Other"],
      ),
      { list: true, defaultValue: "email" },
    ),
    select(
      "direction",
      "ทิศทาง",
      "Direction",
      choices(
        ["inbound", "ลูกค้าติดต่อมา", "Inbound"],
        ["outbound", "DDC ติดต่อไป", "Outbound"],
      ),
      {
        list: true,
        defaultValue: "outbound",
      },
    ),
    field("summary", "สรุป", "Summary", "textarea", {
      required: true,
      list: true,
      wide: true,
    }),
    owner(),
  ],
};

export const customerCapacityProfiles: ResourceDef = {
  name: "customer_capacity_profiles",
  label: {
    one: l("Cap. การใช้งานลูกค้า", "Customer capacity profile"),
    many: l("Cap. การใช้งานและจำนวนรถ", "Usage capacity & fleets"),
  },
  childOnly: true,
  parent: { resource: "companies", target: "company_id" },
  recordRepresentation: "season_label",
  sort: { field: "updated_at", order: "DESC" },
  fields: [
    company({ required: true }),
    field("season_label", "ฤดูเก็บเกี่ยว", "Harvest season", "text", {
      required: true,
      list: true,
      defaultValue: "2569/70",
    }),
    select(
      "capacity_role",
      "บทบาทการใช้งาน",
      "Usage role",
      choices(
        ["owner", "เจ้าของรถ/ใช้งานเอง", "Fleet owner"],
        ["service_shop", "อู่ซ่อม/ดูแลรถลูกค้า", "Service workshop"],
        ["dealer_network", "ตัวแทน/ร้านจำหน่าย", "Dealer / parts network"],
      ),
      { list: true, defaultValue: "owner" },
    ),
    field("total_vehicles", "จำนวนรถ (คัน)", "Total vehicles", "number", {
      list: true,
    }),
    field(
      "tons_per_vehicle",
      "กำลังตัด (ตัน/คัน/ฤดู)",
      "Tons per vehicle / season",
      "number",
      { list: true },
    ),
    field(
      "total_tons_per_season",
      "กำลังตัดรวม (ตัน/ฤดู)",
      "Total tons / season",
      "number",
      { list: true },
    ),
    field(
      "fleet_breakdown",
      "รายละเอียดรุ่นรถ (JSON)",
      "Fleet breakdown (JSON)",
      "json",
      { wide: true },
    ),
    notes(),
    owner(),
    createdAt(),
  ],
};

export const customerPartUsage: ResourceDef = {
  name: "customer_part_usage",
  label: {
    one: l("ความถี่การเปลี่ยนอะไหล่", "Part replacement frequency"),
    many: l("ความถี่การเปลี่ยนอะไหล่", "Part replacement frequencies"),
  },
  childOnly: true,
  parent: { resource: "companies", target: "company_id" },
  recordRepresentation: "part_label",
  sort: { field: "updated_at", order: "DESC" },
  fields: [
    company({ required: true }),
    product({ list: true }),
    field("part_label", "ชื่ออะไหล่/พาร์ท", "Part name", "text", {
      required: true,
      list: true,
    }),
    field(
      "qty_per_change",
      "จำนวนต่อครั้ง (ชิ้น)",
      "Qty per change",
      "number",
      {
        list: true,
      },
    ),
    field(
      "change_interval_value",
      "เปลี่ยนทุกๆ (ค่า)",
      "Change interval",
      "number",
      { list: true },
    ),
    select(
      "change_interval_unit",
      "หน่วยความถี่",
      "Interval unit",
      choices(
        ["tons", "ตันอ้อย", "Tons"],
        ["days", "วันตัด", "Days"],
        ["hours", "ชั่วโมง", "Hours"],
        ["rai", "ไร่", "Rai"],
        ["season", "ฤดูเก็บเกี่ยว", "Season"],
      ),
      { list: true, defaultValue: "tons" },
    ),
    field(
      "estimated_season_qty",
      "ประมาณการ/ฤดู (ชิ้น)",
      "Est. qty / season",
      "number",
      { list: true },
    ),
    field("current_brand", "ยี่ห้อเดิมที่ใช้", "Current brand", "text", {
      list: true,
    }),
    ref(
      "recorded_activity_id",
      "บันทึกจากการเข้าพบ",
      "Recorded activity",
      "activities",
      "subject",
      { dependsOn: BY_OPTIONAL_CUSTOMER },
    ),
    notes(),
    owner(),
    createdAt(),
  ],
};

export const activityPhotos: ResourceDef = {
  name: "activity_photos",
  label: {
    one: l("รูปถ่ายหน้างาน", "Field photo"),
    many: l("รูปถ่ายหน้างาน", "Field photos"),
  },
  childOnly: true,
  parent: { resource: "companies", target: "company_id" },
  recordRepresentation: "caption",
  sort: { field: "taken_at", order: "DESC" },
  fields: [
    company({ required: true }),
    ref("activity_id", "การเข้าพบ", "Activity", "activities", "subject", {
      dependsOn: BY_OPTIONAL_CUSTOMER,
    }),
    select(
      "photo_tag",
      "หมวดหมู่รูป",
      "Photo category",
      choices(
        ["part_sample", "ตัวอย่างอะไหล่", "Part sample"],
        ["machine", "รถตัดอ้อย/หน้างาน", "Machine / site"],
        ["shop", "หน้าร้าน/โรงงาน", "Shop / mill"],
        ["business_card", "นามบัตร", "Business card"],
        ["other", "อื่นๆ", "Other"],
      ),
      { list: true, defaultValue: "part_sample" },
    ),
    field("caption", "คำอธิบายรูป", "Caption", "text", { list: true }),
    field("file_name", "ชื่อไฟล์", "File name", "text"),
    field("image_src", "ข้อมูลรูปภาพ", "Image source", "text", {
      required: true,
    }),
    field("latitude", "ละติจูด", "Latitude", "number"),
    field("longitude", "ลองจิจูด", "Longitude", "number"),
    field("taken_at", "เวลาที่ถ่าย", "Taken at", "datetime", { list: true }),
    owner(),
    createdAt(),
  ],
};
