import { CoreAdminContext, Form, ResourceContextProvider } from "ra-core";
import { useWatch } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import polyglotI18nProvider from "ra-i18n-polyglot";
import { createDataProvider } from "@/components/atomic-crm/providers/fakerest/dataProvider";
import type { Db } from "@/components/atomic-crm/providers/fakerest/dataGenerator/types";
import type { FieldDef } from "../resources/schema";
import { englishCatalog } from "../i18n/i18nProvider";
import { FieldInput } from "./FieldInput";

const definition = (
  source: string,
  type: FieldDef["type"],
  name: string,
): FieldDef => ({ source, type, label: { th: name, en: name } });
const fixtures = {
  companies: [
    { id: 1, customer_code: "CUS-001", name: "Customer A" },
    { id: 2, customer_code: "CUS-002", name: "Customer B" },
  ],
  contacts: [
    { id: 11, company_id: 1, first_name: "Contact A" },
    { id: 22, company_id: 2, first_name: "Contact B" },
  ],
  products: [
    {
      id: 1,
      part_number: "PART-001",
      name: "Test Part",
      uom: "pcs",
      custom_fields: { agriculture_master: { PackingSize: "25" } },
    },
  ],
  quotations: [{ id: 1, currency: "THB" }],
};

function Values() {
  const values = useWatch();
  return <output aria-label="Current values">{JSON.stringify(values)}</output>;
}

async function form(
  fields: FieldDef[],
  defaults: Record<string, unknown> = {},
) {
  const save = vi.fn();
  const provider = createDataProvider({
    db: structuredClone(fixtures) as unknown as Db,
    silent: true,
    latency: 0,
  });
  const screen = await render(
    <CoreAdminContext
      dataProvider={provider}
      i18nProvider={polyglotI18nProvider(() => englishCatalog, "en")}
    >
      <ResourceContextProvider value="quotation_items">
        <Form defaultValues={defaults} onSubmit={save} noValidate>
          {fields.map((field) => (
            <FieldInput key={field.source} field={field} />
          ))}
          <Values />
          <button type="submit">Save fixture</button>
        </Form>
      </ResourceContextProvider>
    </CoreAdminContext>,
  );
  return { screen, save };
}

describe("DDC input components", () => {
  it("preserves four-decimal prices and distinguishes an empty value from zero", async () => {
    const { screen, save } = await form(
      [definition("amount", "money", "Amount")],
      { amount: 125.1234, currency: "THB" },
    );
    const input = screen.getByRole("spinbutton", { name: "Amount" });
    await expect.element(input).toHaveValue(125.1234);
    await input.fill("0");
    await screen.getByRole("button", { name: "Save fixture" }).click();
    await expect.poll(() => save.mock.calls.length).toBe(1);
    expect(save.mock.calls[0][0].amount).toBe(0);
    await input.fill("");
    await screen.getByRole("button", { name: "Save fixture" }).click();
    await expect.poll(() => save.mock.calls.length).toBe(2);
    expect(save.mock.calls[1][0].amount).toBeNull();
    await input.fill("115.8125");
    await screen.getByRole("button", { name: "Save fixture" }).click();
    await expect.poll(() => save.mock.calls.length).toBe(3);
    expect(save.mock.calls[2][0].amount).toBe(115.8125);
  });

  it("rejects invalid discounts and non-positive required quantities", async () => {
    const { screen, save } = await form(
      [
        {
          ...definition("quantity", "number", "Quantity"),
          required: true,
          input: { exclusiveMin: true },
        },
        definition("discount_percent", "number", "Discount"),
      ],
      { quantity: 0, discount_percent: 101 },
    );
    await screen.getByRole("button", { name: "Save fixture" }).click();
    await expect
      .element(screen.getByText("Must be greater than 0", { exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByText("Must not exceed 100", { exact: true }))
      .toBeVisible();
    expect(save).not.toHaveBeenCalled();
    await screen.getByRole("spinbutton", { name: /Quantity/ }).fill("1.125");
    await screen.getByRole("spinbutton", { name: "Discount" }).fill("25.5");
    await screen.getByRole("button", { name: "Save fixture" }).click();
    await expect.poll(() => save.mock.calls.length).toBe(1);
    expect(save.mock.calls[0][0]).toMatchObject({
      quantity: 1.125,
      discount_percent: 25.5,
    });
  });

  it("preserves phone and identifier strings with leading zeros", async () => {
    const { screen, save } = await form([
      definition("phone_number", "text", "Phone"),
      definition("customer_code", "text", "Customer ID"),
    ]);
    await expect
      .element(screen.getByRole("textbox", { name: "Phone" }))
      .toHaveAttribute("type", "tel");
    await screen
      .getByRole("textbox", { name: "Phone" })
      .fill("0812345678 ต่อ 12");
    await screen
      .getByRole("textbox", { name: "Customer ID" })
      .fill("000123-AB");
    await screen.getByRole("button", { name: "Save fixture" }).click();
    await expect.poll(() => save.mock.calls.length).toBe(1);
    expect(save.mock.calls[0][0]).toMatchObject({
      phone_number: "0812345678 ต่อ 12",
      customer_code: "000123-AB",
    });
  });

  it("shows source packing advice without blocking a partial-pack quote", async () => {
    const { screen, save } = await form(
      [definition("quantity", "number", "Quantity")],
      { product_id: 1, quantity: 26, uom: "pcs" },
    );
    await expect
      .poll(() =>
        screen
          .getByRole("status", { name: "Packing advice" })
          .element()
          .textContent?.replace(/\s+/g, " "),
      )
      .toContain("Full packs: 1; remaining units: 1");
    await screen.getByRole("button", { name: "Save fixture" }).click();
    await expect.poll(() => save.mock.calls.length).toBe(1);
    expect(save.mock.calls[0][0].quantity).toBe(26);
    await screen.getByRole("spinbutton", { name: "Quantity" }).fill("50");
    await expect
      .poll(() =>
        screen
          .getByRole("status", { name: "Packing advice" })
          .element()
          .textContent?.replace(/\s+/g, " "),
      )
      .toContain("Full packs: 2");
  });

  it("stores choice IDs and permits clearing an optional status", async () => {
    const status = {
      ...definition("status", "select", "Status"),
      choices: [
        { id: "open", label: { th: "Open", en: "Open" } },
        { id: "done", label: { th: "Done", en: "Done" } },
      ],
    };
    const { screen, save } = await form([status], { status: "open" });
    await screen.getByRole("radio", { name: "Done" }).click();
    await screen.getByRole("button", { name: "Save fixture" }).click();
    await expect.poll(() => save.mock.calls.length).toBe(1);
    expect(save.mock.calls[0][0].status).toBe("done");
    await screen.getByRole("button", { name: "Clear selection" }).click();
    await screen.getByRole("button", { name: "Save fixture" }).click();
    await expect.poll(() => save.mock.calls.length).toBe(2);
    expect(save.mock.calls[1][0].status).toBeNull();
  });

  it("clears dependent contacts when the selected customer changes", async () => {
    const { screen } = await form(
      [
        {
          ...definition("company_id", "reference", "Customer"),
          reference: "companies",
          optionText: "name",
        },
        {
          ...definition("contact_id", "reference", "Contact"),
          reference: "contacts",
          optionText: "first_name",
          dependsOn: {
            sourceField: "company_id",
            requireParent: true,
            emptyParentPlaceholder: {
              th: "Select a customer first",
              en: "Select a customer first",
            },
          },
        },
      ],
      { company_id: 1, contact_id: 11 },
    );
    await expect
      .element(screen.getByRole("combobox", { name: "Customer" }))
      .toHaveTextContent("CUS-001 · Customer A");
    await screen.getByRole("combobox", { name: "Customer" }).click();
    await screen.getByRole("option", { name: "CUS-002 · Customer B" }).click();
    await expect
      .poll(
        async () =>
          JSON.parse(
            (await screen.getByLabelText("Current values").element()
              .textContent) || "{}",
          ).contact_id,
      )
      .toBeNull();
    await screen.getByRole("combobox", { name: "Contact" }).click();
    await expect
      .element(screen.getByRole("option", { name: "Contact B" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("option", { name: "Contact A" }))
      .not.toBeInTheDocument();
  });

  it("validates appointment end times against the start without rewriting timestamps", async () => {
    const { screen, save } = await form(
      [
        {
          ...definition("end_at", "datetime", "End"),
          input: { notBefore: "start_at" },
        },
      ],
      {
        start_at: "2026-12-02T10:00:00.000Z",
        end_at: "2026-12-02T09:00:00.000Z",
      },
    );
    await screen.getByRole("button", { name: "Save fixture" }).click();
    await expect
      .element(
        screen.getByText("End date and time must not be before the start", {
          exact: true,
        }),
      )
      .toBeVisible();
    expect(save).not.toHaveBeenCalled();
  });
});
