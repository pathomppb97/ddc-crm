import { email, maxLength, required, type Validator } from "ra-core";
import type { FieldDef } from "../resources/schema";
import { inputPolicy } from "../domain/inputPolicy";

const empty = (value: unknown) =>
  value === "" || value === null || value === undefined;

export function validatorsFor(field: FieldDef): Validator[] {
  const rules: Validator[] = [];
  const policy = inputPolicy(field);
  if (field.required) rules.push(required());
  if (field.type === "email") rules.push(email());
  if (field.type === "url")
    rules.push((value) =>
      !empty(value) && !/^https?:\/\/[^\s]+$/i.test(String(value))
        ? "ddc.validation.url"
        : undefined,
    );
  if (field.type === "json")
    rules.push((value) => {
      if (empty(value) || typeof value !== "string") return undefined;
      try {
        JSON.parse(value);
        return undefined;
      } catch {
        return "ddc.validation.json";
      }
    });
  if (field.type === "number" || field.type === "money") {
    rules.push((value) =>
      !empty(value) && !Number.isFinite(Number(value))
        ? "ddc.validation.number"
        : undefined,
    );
    if (policy.min !== undefined)
      rules.push((value) =>
        !empty(value) &&
        (policy.exclusiveMin
          ? Number(value) <= policy.min!
          : Number(value) < policy.min!)
          ? {
              message: policy.exclusiveMin
                ? "ddc.validation.greater_than"
                : "ddc.validation.min_value",
              args: { min: policy.min },
            }
          : undefined,
      );
    if (policy.max !== undefined)
      rules.push((value) =>
        !empty(value) && Number(value) > policy.max!
          ? { message: "ddc.validation.max_value", args: { max: policy.max } }
          : undefined,
      );
    if (policy.step === 1)
      rules.push((value) =>
        !empty(value) && !Number.isInteger(Number(value))
          ? "ddc.validation.integer"
          : undefined,
      );
  }
  if (policy.notBefore)
    rules.push((value, values) => {
      const start = values?.[policy.notBefore!];
      if (empty(value) || empty(start)) return undefined;
      const from = new Date(String(start)).getTime();
      const to = new Date(String(value)).getTime();
      return Number.isFinite(from) && Number.isFinite(to) && to < from
        ? "ddc.validation.date_order"
        : undefined;
    });
  if (["text", "email", "url"].includes(field.type)) rules.push(maxLength(500));
  return rules;
}
