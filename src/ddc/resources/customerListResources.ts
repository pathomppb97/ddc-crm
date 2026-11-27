import { ClipboardList, Tractor } from "lucide-react";
import { company, field, l, ref } from "./helpers";
import type { ResourceDef } from "./schema";

const source = () =>
  ref(
    "source_id",
    "แถวต้นฉบับ",
    "Source row",
    "customer_source_rows",
    "source_row",
  );
const requirement = () =>
  ref(
    "requirement_id",
    "ความต้องการสินค้า",
    "Requirement",
    "customer_requirements",
    "product_family",
  );
const raw = (name: string, th: string, en: string, list = true) =>
  field(name, th, en, "textarea", { list, wide: true });

export const customerSourceRows: ResourceDef = {
  name: "customer_source_rows",
  label: {
    one: l("แถวข้อมูลต้นฉบับ", "Source row"),
    many: l("ข้อมูลต้นฉบับ Excel", "Excel source rows"),
  },
  recordRepresentation: "source_row",
  readOnly: true,
  fields: [
    company({ list: true }),
    field("source_file", "ไฟล์", "File"),
    field("sheet_name", "ชีต", "Sheet"),
    field("source_row", "แถว Excel", "Excel row", "number", { list: true }),
    field("region", "ภาค", "Region", "text", { list: true }),
    field("source_sequence", "ลำดับในภาค", "Regional sequence", "number"),
    field("raw_cells", "ค่าต้นฉบับ A–AJ", "Original cells A–AJ", "json", {
      wide: true,
    }),
    raw("review_notes", "รายการรอตรวจสอบ", "Review notes"),
  ],
};

export const customerFleets: ResourceDef = {
  name: "customer_fleets",
  label: {
    one: l("ข้อมูลรถตัดอ้อย", "Harvester fleet"),
    many: l("รถตัดอ้อยของลูกค้า", "Customer harvester fleets"),
  },
  icon: Tractor,
  group: "customers",
  recordRepresentation: "brands_raw",
  readOnly: true,
  fields: [
    company({ list: true }),
    source(),
    raw("brands_raw", "ยี่ห้อรถ (ต้นฉบับ)", "Brands (source)"),
    raw("quantities_raw", "จำนวนคัน (ต้นฉบับ)", "Machine quantities (source)"),
    raw(
      "capacity_kton_raw",
      "กำลังผลิต/ฤดูกาล (พันตัน)",
      "Capacity per season (kton)",
    ),
  ],
};

export const customerRequirements: ResourceDef = {
  name: "customer_requirements",
  label: {
    one: l("ความต้องการใบมีด", "Blade requirement"),
    many: l("ความต้องการใบมีดลูกค้า", "Customer blade requirements"),
  },
  icon: ClipboardList,
  group: "customers",
  recordRepresentation: "product_family",
  readOnly: true,
  fields: [
    company({ list: true }),
    source(),
    field("product_family", "กลุ่มสินค้า", "Product family", "text", {
      list: true,
      filter: true,
    }),
    raw("old_brands_raw", "ยี่ห้อเดิม", "Existing brands"),
    raw("specification_raw", "สเปคที่ลูกค้าระบุ", "Customer specification"),
    raw("target_cost_raw", "ราคาเป้าหมาย (บาท)", "Target cost (THB)"),
    raw(
      "seasonal_usage_raw",
      "จำนวนใช้/ฤดูกาล (ชิ้น)",
      "Usage per season (pcs)",
    ),
    raw(
      "blades_per_machine_raw",
      "จำนวนใช้/คัน (ชิ้น)",
      "Blades per machine (pcs)",
    ),
  ],
  children: [
    {
      resource: "customer_samples",
      target: "requirement_id",
      label: l("ตัวอย่างและการทดสอบ", "Samples and testing"),
    },
    {
      resource: "customer_purchase_history",
      target: "requirement_id",
      label: l("ประวัติปริมาณตามฤดูกาล", "Seasonal quantity history"),
    },
  ],
};

export const customerSamples: ResourceDef = {
  name: "customer_samples",
  label: {
    one: l("ข้อมูลตัวอย่าง", "Sample record"),
    many: l("ตัวอย่างและการทดสอบจาก Excel", "Excel samples and testing"),
  },
  group: "customers",
  recordRepresentation: "product_family",
  readOnly: true,
  fields: [
    company({ list: true }),
    source(),
    requirement(),
    field("product_family", "กลุ่มสินค้า", "Product family", "text", {
      list: true,
    }),
    raw("specification_raw", "สเปคตัวอย่าง", "Sample specification"),
    raw("quantity_raw", "จำนวนตัวอย่าง", "Sample quantity"),
    raw(
      "sample_date_raw",
      "วันที่ส่งตัวอย่าง (ต้นฉบับ)",
      "Sample date (source)",
    ),
    raw("testing_date_raw", "วันที่ทดสอบ (ต้นฉบับ)", "Testing date (source)"),
    raw(
      "customer_pic_raw",
      "ผู้รับผิดชอบฝั่งลูกค้า (ต้นฉบับ)",
      "Customer PIC (source)",
    ),
  ],
};

export const customerPurchaseHistory: ResourceDef = {
  name: "customer_purchase_history",
  label: {
    one: l("ปริมาณตามฤดูกาล", "Seasonal quantity"),
    many: l(
      "ประวัติปริมาณสั่งซื้อจาก Excel",
      "Excel purchase quantity history",
    ),
  },
  group: "customers",
  recordRepresentation: "season",
  readOnly: true,
  fields: [
    company({ list: true }),
    source(),
    requirement(),
    field("season", "ฤดูกาลตามต้นฉบับ", "Season as recorded", "text", {
      list: true,
      filter: true,
    }),
    raw("specification_raw", "สเปคตามต้นฉบับ", "Source specification"),
    raw("quantity_raw", "จำนวน (ชิ้น)", "Quantity (pcs)"),
    raw("sent_date_raw", "วันที่ส่ง (ต้นฉบับ)", "Sent date (source)"),
    raw("review_notes", "ข้อจำกัดของข้อมูล", "Source limitations", false),
  ],
};
