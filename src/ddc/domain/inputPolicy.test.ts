import { describe, expect, it } from "vitest";
import { inputPolicy, packingSummary, referenceLabel } from "./inputPolicy";
import type { FieldDef } from "../resources/schema";

const field = (source: string, type: FieldDef["type"] = "text"): FieldDef => ({
  source,
  type,
  label: { th: source, en: source },
});
describe("CRM input policy", () => {
  it("uses source-compatible precision and percentage bounds", () => {
    expect(inputPolicy(field("unit_price", "money"))).toMatchObject({
      min: 0,
      step: 0.0001,
    });
    expect(inputPolicy(field("quantity", "number"))).toMatchObject({
      step: 0.001,
      packing: true,
    });
    expect(inputPolicy(field("discount_percent", "number"))).toMatchObject({
      min: 0,
      max: 100,
      unit: "%",
    });
    expect(inputPolicy(field("phone_number")).kind).toBe("phone");
    expect(inputPolicy(field("customer_code")).kind).toBe("code");
  });
  it("keeps explicit field rules and leaves identifiers unchanged", () => {
    expect(
      inputPolicy({
        ...field("quantity", "number"),
        input: { step: "any", packing: false },
      }),
    ).toMatchObject({ step: "any", packing: false });
    const customer = {
      id: 5,
      customer_code: "000123",
      name: "Source customer",
      province: "Source province",
    };
    expect(
      referenceLabel(
        customer,
        { ...field("company_id", "reference"), reference: "companies" },
        "en",
      ),
    ).toBe("000123 · Source customer · Source province");
    expect(customer.customer_code).toBe("000123");
    expect(
      referenceLabel(
        { part_number: "1DD05011", name: "Source Part" },
        { ...field("product_id", "reference"), reference: "products" },
        "th",
      ),
    ).toBe("1DD05011 · Source Part");
  });
  it("calculates pack advice without changing or fabricating quantities", () => {
    expect(packingSummary(50, 25)).toEqual({
      boxes: 2,
      remainder: 0,
      compliant: true,
    });
    expect(packingSummary(26, 25)).toEqual({
      boxes: 1,
      remainder: 1,
      compliant: false,
    });
    expect(packingSummary(12.5, 25)).toEqual({
      boxes: 0,
      remainder: 12.5,
      compliant: false,
    });
    for (const value of [null, "", -1, NaN])
      expect(packingSummary(value, 25)).toBeNull();
    expect(packingSummary(10, null)).toBeNull();
  });
});
