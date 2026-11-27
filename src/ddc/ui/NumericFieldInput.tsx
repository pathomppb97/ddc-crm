import { useId } from "react";
import { useGetOne, useTranslate, type RaRecord } from "ra-core";
import { useWatch } from "react-hook-form";
import {
  NumberInput,
  type NumberInputProps,
} from "@/components/admin/number-input";
import { inputPolicy, packingSummary } from "../domain/inputPolicy";
import type { FieldDef } from "../resources/schema";

type Product = RaRecord & {
  uom?: string;
  custom_fields?: { agriculture_master?: { PackingSize?: number | string } };
};

/** Currency and packing are read from the current record and selected source Part. */
export function NumericFieldInput({
  definition,
  asFilter = false,
  ...props
}: NumberInputProps & { definition: FieldDef; asFilter?: boolean }) {
  const policy = inputPolicy(definition);
  const translate = useTranslate();
  const hintId = useId();
  const productId = useWatch({ name: "product_id" });
  const quotationId = useWatch({ name: "quotation_id" });
  const currency = useWatch({ name: "currency" });
  const unit = useWatch({ name: "uom" });
  const quantity = useWatch({ name: definition.source });
  const { data: product } = useGetOne<Product>(
    "products",
    { id: productId },
    {
      enabled:
        !asFilter &&
        policy.packing === true &&
        productId != null &&
        productId !== "",
    },
  );
  const { data: quotation } = useGetOne(
    "quotations",
    { id: quotationId },
    {
      enabled:
        !asFilter &&
        definition.type === "money" &&
        quotationId != null &&
        quotationId !== "",
    },
  );
  const pack = product?.custom_fields?.agriculture_master?.PackingSize;
  const summary =
    !asFilter && policy.packing ? packingSummary(quantity, pack) : null;
  const suffix =
    policy.unit ??
    (definition.type === "money"
      ? currency || quotation?.currency
      : policy.kind === "quantity"
        ? unit || product?.uom
        : undefined);
  return (
    <div className="min-w-0 space-y-2">
      <NumberInput
        {...props}
        min={asFilter ? undefined : policy.min}
        max={asFilter ? undefined : policy.max}
        step={policy.step ?? "any"}
        inputMode={policy.step === 1 ? "numeric" : "decimal"}
        suffix={suffix}
        placeholder={
          props.placeholder ??
          (asFilter ? undefined : translate("ddc.input.number_placeholder"))
        }
        aria-describedby={summary ? hintId : undefined}
      />
      {summary ? (
        <p
          id={hintId}
          role="status"
          aria-label={translate("ddc.input.packing_advice")}
          className={`text-xs ${summary.compliant ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400"}`}
        >
          {translate("ddc.input.pack_size", {
            size: pack,
            unit: unit || product?.uom || "",
          })}{" "}
          {summary.compliant
            ? translate("ddc.input.pack_complete", { boxes: summary.boxes })
            : translate("ddc.input.pack_partial", {
                boxes: summary.boxes,
                remainder: summary.remainder,
              })}
        </p>
      ) : null}
    </div>
  );
}
