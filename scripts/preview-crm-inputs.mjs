/* global document */
import fs from "node:fs/promises";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://127.0.0.1:5180";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const output = "output/playwright/input-components";
const source = encodeURIComponent(
  JSON.stringify({ product_id: 10001, quantity: 26, uom: "pcs" }),
);
const receipt = {
  base,
  note: "Unsaved form previews in an isolated browser context; no customer or quotation records were changed.",
  screenshots: [],
};
try {
  await fs.mkdir(output, { recursive: true });
  await page.goto(`${base}/#/quotation_items/create?source=${source}`);
  await page.getByRole("spinbutton", { name: /จำนวน/ }).waitFor();
  await page.getByRole("status", { name: "คำแนะนำขนาดบรรจุ" }).waitFor();
  await page.screenshot({
    path: `${output}/quotation-line-desktop.png`,
    fullPage: true,
  });
  receipt.screenshots.push(`${output}/quotation-line-desktop.png`);
  await page.setViewportSize({ width: 390, height: 844 });
  const documentWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  if (documentWidth > 390)
    throw new Error(`Mobile form overflows: ${documentWidth}px`);
  await page.screenshot({
    path: `${output}/quotation-line-mobile.png`,
    fullPage: true,
  });
  receipt.screenshots.push(`${output}/quotation-line-mobile.png`);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/#/action_items/30001`);
  await page.getByRole("radiogroup").waitFor();
  await page.screenshot({
    path: `${output}/follow-up-desktop.png`,
    fullPage: true,
  });
  receipt.screenshots.push(`${output}/follow-up-desktop.png`);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
} finally {
  await context.close();
  await browser.close();
}
