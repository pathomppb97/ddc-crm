import { memoryStore } from "ra-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { toast } from "sonner";
import {
  clearRecentErrorLogs,
  resetNotificationDedupe,
} from "@/ddc/errors/crmError";
import {
  createAuthProvider,
  USER_STORAGE_KEY,
} from "@/components/atomic-crm/providers/fakerest/authProvider";
import { createDataProvider } from "@/components/atomic-crm/providers/fakerest/dataProvider";
import { CRM } from "@/components/atomic-crm/root/CRM";
import { ddcConfiguration } from "@/ddc/config";
import { generateDdcDemoData } from "@/ddc/demo/generateDemoData";

function buildDemoApp(options?: {
  email?: string;
  onBeforeCall?: (
    method: string,
    resource: string,
    next: () => Promise<unknown>,
  ) => Promise<unknown>;
}) {
  const db = generateDdcDemoData();
  const baseProvider = createDataProvider({ db, latency: 0, silent: true });
  const provider = options?.onBeforeCall
    ? new Proxy(baseProvider, {
        get(target, prop, receiver) {
          const val = Reflect.get(target, prop, receiver);
          if (
            typeof val === "function" &&
            ["getList", "getManyReference", "getOne"].includes(String(prop))
          ) {
            return (resource: string, params: unknown) =>
              options.onBeforeCall!(String(prop), resource, () =>
                val.call(target, resource, params),
              );
          }
          return typeof val === "function" ? val.bind(target) : val;
        },
      })
    : baseProvider;

  const authProvider = createAuthProvider(provider);
  const email = options?.email ?? "admin@demo.ddc.test";
  const user = db.sales.find((s) => s.email === email)!;
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));

  return { provider, authProvider };
}

describe("Customer Detail mobile responsive & production error resilience", () => {
  beforeEach(() => {
    toast.dismiss();
    resetNotificationDedupe();
    clearRecentErrorLogs();
    window.location.hash = "#/companies/1/show";
  });

  it.each([
    [320, 568],
    [375, 667],
    [430, 932],
  ])(
    "renders Customer Detail cleanly at %dx%d without undefined collections or horizontal overflow",
    async (width, height) => {
      await page.viewport(width, height);
      const { provider, authProvider } = buildDemoApp();

      const screen = await render(
        <CRM
          {...ddcConfiguration}
          dataProvider={provider}
          authProvider={authProvider}
          store={memoryStore()}
        />,
      );

      await expect
        .element(
          screen.getByRole("heading", {
            name: "บริษัท ตัวอย่างลูกค้า 1 จำกัด (ทดลอง)",
            exact: true,
          }),
        )
        .toBeVisible();

      // Grouped detail sections & Excel evidence section load cleanly
      await expect.element(screen.getByText("ข้อมูลหลักลูกค้า")).toBeVisible();
      await expect
        .element(screen.getByText("ข้อมูลติดต่อและที่ตั้ง"))
        .toBeVisible();
      await expect
        .element(screen.getByText("ข้อมูลต้นฉบับ Excel"))
        .toBeVisible();

      // Zero undefined collection errors or error toasts
      const bodyText = document.body.textContent ?? "";
      expect(bodyText).not.toContain("Undefined collection");
      expect(
        document.querySelectorAll('[data-sonner-toast][data-type="error"]')
          .length,
      ).toBe(0);

      // No horizontal overflow
      await expect
        .poll(() => document.documentElement.scrollWidth <= window.innerWidth)
        .toBe(true);

      // Primary actions & MobileBottomBar buttons meet >= 44px touch target
      const logVisitLink = screen
        .getByRole("link", { name: /บันทึกเข้าพบรายนี้/ })
        .element();
      expect(
        logVisitLink.getBoundingClientRect().height,
      ).toBeGreaterThanOrEqual(44);

      const mobileNav = screen
        .getByRole("navigation", { name: "Field mobile navigation" })
        .element();
      const navLinks = mobileNav.querySelectorAll("a");
      expect(navLinks.length).toBe(5);
      for (const link of navLinks) {
        const rect = link.getBoundingClientRect();
        expect(rect.height).toBeGreaterThanOrEqual(44);
        expect(rect.width).toBeGreaterThanOrEqual(44);
      }

      await screen.unmount();
    },
  );

  it("does not retry permanent schema errors, deduplicates error toasts, avoids bottom nav overlap, and keeps other sections usable", async () => {
    await page.viewport(375, 667);
    const sourceRowCalls = vi.fn();

    const { provider, authProvider } = buildDemoApp({
      onBeforeCall: async (method, resource, next) => {
        if (resource === "customer_source_rows") {
          sourceRowCalls(method, resource);
          const err = new Error('Undefined collection "customer_source_rows"');
          err.name = "UndefinedResourceError";
          throw err;
        }
        return next();
      },
    });

    const screen = await render(
      <CRM
        {...ddcConfiguration}
        dataProvider={provider}
        authProvider={authProvider}
        store={memoryStore()}
      />,
    );

    await expect
      .element(
        screen.getByRole("heading", {
          name: "บริษัท ตัวอย่างลูกค้า 1 จำกัด (ทดลอง)",
          exact: true,
        }),
      )
      .toBeVisible();

    // Failed section displays honest Thai inline error alert with correlation ID
    await expect
      .element(screen.getByText("ไม่สามารถโหลดข้อมูลส่วนนี้ได้"))
      .toBeVisible();
    await expect
      .element(screen.getByText(/โครงสร้างข้อมูลไม่สอดคล้องกัน/))
      .toBeVisible();

    // Wait briefly to confirm no retry loop happens
    await new Promise((r) => setTimeout(r, 400));
    expect(sourceRowCalls).toHaveBeenCalledTimes(1);

    // Other Customer Detail sections still render normally
    await expect.element(screen.getByText("ข้อมูลหลักลูกค้า")).toBeVisible();
    await expect.element(screen.getByText("รถตัดอ้อยจาก Excel")).toBeVisible();

    // At most 1 error toast, localized in Thai with Ref ID, and never overlapping MobileBottomBar
    const errorToasts = document.querySelectorAll(
      '[data-sonner-toast][data-type="error"]',
    );
    expect(errorToasts.length).toBeLessThanOrEqual(1);
    if (errorToasts.length === 1) {
      const toastRect = errorToasts[0].getBoundingClientRect();
      const navRect = screen
        .getByRole("navigation", { name: "Field mobile navigation" })
        .element()
        .getBoundingClientRect();
      expect(toastRect.bottom).toBeLessThanOrEqual(navRect.top + 2);
      expect(errorToasts[0].textContent ?? "").toContain("req_");
    }

    await screen.unmount();
  });

  it("enforces read_only RBAC on Customer Detail without exposing edit or delete controls", async () => {
    await page.viewport(375, 667);
    const { provider, authProvider } = buildDemoApp({
      email: "readonly@demo.ddc.test",
    });

    const screen = await render(
      <CRM
        {...ddcConfiguration}
        dataProvider={provider}
        authProvider={authProvider}
        store={memoryStore()}
      />,
    );

    await expect
      .element(
        screen.getByRole("heading", {
          name: "บริษัท ตัวอย่างลูกค้า 1 จำกัด (ทดลอง)",
          exact: true,
        }),
      )
      .toBeVisible();

    await expect
      .element(screen.getByRole("link", { name: /แก้ไข/ }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: /ลบ/ }))
      .not.toBeInTheDocument();

    await screen.unmount();
  });
});
