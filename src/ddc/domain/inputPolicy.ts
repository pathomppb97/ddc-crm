import type { FieldDef } from "../resources/schema";

export function inputPolicy(field: FieldDef): NonNullable<FieldDef["input"]> {
  const inferred: NonNullable<FieldDef["input"]> = {};
  if (["phone", "phone_number", "mobile", "fax"].includes(field.source))
    inferred.kind = "phone";
  if (
    [
      "code",
      "customer_code",
      "part_number",
      "customer_part_number",
      "tax_identifier",
      "zipcode",
      "branch_code",
      "reference_no",
      "drawing_no",
      "current_revision",
    ].includes(field.source)
  )
    inferred.kind = "code";
  if (field.type === "money") Object.assign(inferred, { min: 0, step: 0.0001 });
  if (["probability", "discount_percent"].includes(field.source))
    Object.assign(inferred, {
      kind: "percentage",
      min: 0,
      max: 100,
      step: 0.01,
      unit: "%",
    });
  if (field.source === "quantity" || field.source === "estimated_quantity")
    Object.assign(inferred, {
      kind: "quantity",
      min: 0,
      step: 0.001,
      packing: true,
    });
  if (
    [
      "sort_order",
      "line_no",
      "lead_time_days",
      "year_from",
      "year_to",
    ].includes(field.source)
  )
    Object.assign(inferred, { step: 1 });
  if (field.source === "uom")
    inferred.suggestions = ["pcs", "set", "box", "kg", "mm"];
  return { ...inferred, ...field.input };
}

/** Show identifying codes without changing the foreign key stored by the form. */
export function referenceLabel(
  record: Record<string, unknown>,
  field: FieldDef,
  locale: "th" | "en",
): string {
  const name = locale === "en" && record.name_en ? record.name_en : record.name;
  switch (field.reference) {
    case "companies":
      return [record.customer_code, name, record.province]
        .filter(Boolean)
        .join(" · ");
    case "products":
      return [record.part_number, name].filter(Boolean).join(" · ");
    case "sales":
      return [record.first_name, record.last_name].filter(Boolean).join(" ");
    default:
      return String(
        (field.optionText ? record[field.optionText] : undefined) ??
          name ??
          record.id ??
          "",
      );
  }
}

export function packingSummary(
  quantity: unknown,
  packing: unknown,
): { boxes: number; remainder: number; compliant: boolean } | null {
  if (quantity === "" || quantity == null || packing === "" || packing == null)
    return null;
  const qty = Number(quantity);
  const size = Number(packing);
  if (!Number.isFinite(qty) || !Number.isFinite(size) || qty <= 0 || size <= 0)
    return null;
  const boxes = qty / size;
  const compliant = Math.abs(boxes - Math.round(boxes)) < 1e-8;
  return {
    boxes: compliant ? Math.round(boxes) : Math.floor(boxes),
    remainder: compliant
      ? 0
      : Number((qty - Math.floor(boxes) * size).toFixed(6)),
    compliant,
  };
}
