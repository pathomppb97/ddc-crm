import { useTranslate } from "ra-core";
import { l, field, option, ref, businessModel } from "../resources/helpers";
import type { ResourceDef } from "../resources/schema";
import { ChildSections } from "../ui/ChildSection";
import { FieldInput } from "../ui/FieldInput";
import { FieldValue } from "../ui/FieldValue";
import { useLabel } from "../ui/labels";

/** DDC fields of an opportunity (deals table), next to the Atomic CRM ones. */
export const DEAL_DDC_FIELDS = [
  ref("pipeline_id", "Pipeline การขาย", "Sales pipeline", "pipelines", "name", {
    helper: l(
      "ว่างไว้เพื่อใช้ Pipeline ค่าเริ่มต้น",
      "Leave empty to use the default pipeline",
    ),
  }),
  field("currency", "สกุลเงิน", "Currency", "text", { defaultValue: "THB" }),
  field("probability", "โอกาสสำเร็จ (%)", "Probability (%)", "number", {
    helper: l(
      "ว่างไว้เพื่อใช้ค่าของขั้นตอน",
      "Leave empty to use the stage default",
    ),
  }),
  field(
    "estimated_quantity",
    "ปริมาณประมาณการ",
    "Estimated quantity",
    "number",
  ),
  field("quantity_uom", "หน่วยของปริมาณ", "Quantity unit"),
  businessModel(),
  field("follow_up_date", "วันติดตาม", "Follow-up date", "date"),
  option("loss_reason_id", "เหตุผลที่ไม่ได้งาน", "Loss reason", "loss_reason"),
  field("loss_notes", "รายละเอียดที่ไม่ได้งาน", "Loss details", "textarea", {
    wide: true,
  }),
  ref("lead_id", "ลีดต้นทาง", "Source lead", "leads", "company_name", {
    readOnly: true,
  }),
];

export const DdcDealInputs = () => (
  <div className="flex flex-col gap-1">
    {DEAL_DDC_FIELDS.filter((f) => !f.readOnly).map((f) => (
      <FieldInput key={f.source} field={f} />
    ))}
  </div>
);

const DEAL_DEF: ResourceDef = {
  name: "deals",
  label: {
    one: l("โอกาสการขาย", "Opportunity"),
    many: l("โอกาสการขาย", "Opportunities"),
  },
  recordRepresentation: "name",
  fields: DEAL_DDC_FIELDS,
  documentEntity: "deals",
  children: [
    {
      resource: "deal_products",
      target: "deal_id",
      label: l("สินค้าที่สนใจ", "Products of interest"),
    },
    {
      resource: "deal_competitors",
      target: "deal_id",
      label: l("คู่แข่ง", "Competitors"),
    },
    { resource: "rfqs", target: "deal_id", label: l("RFQ", "RFQs") },
    {
      resource: "quotations",
      target: "deal_id",
      label: l("ใบเสนอราคา", "Quotations"),
    },
    {
      resource: "activities",
      target: "deal_id",
      label: l("กิจกรรม", "Activities"),
    },
  ],
};

/** DDC details, related records, documents and history inside the opportunity sheet. */
export const DdcDealPanel = () => {
  const label = useLabel();
  const translate = useTranslate();
  return (
    <section
      className="m-4 flex flex-col gap-4 border-t pt-4"
      aria-label={translate("ddc.deal.details")}
    >
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        {DEAL_DDC_FIELDS.map((f) => (
          <div key={f.source} className={f.wide ? "sm:col-span-3" : ""}>
            <dt className="text-xs text-muted-foreground">{label(f.label)}</dt>
            <dd>
              <FieldValue field={f} />
            </dd>
          </div>
        ))}
      </dl>
      <ChildSections def={DEAL_DEF} />
    </section>
  );
};
