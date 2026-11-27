import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ddcMessages } from "../i18n/ddcMessages";

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) && !name.endsWith(".test.ts") ? [full] : [];
  });

const lookup = (catalog: unknown, key: string) =>
  key
    .split(".")
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      catalog,
    );

describe("DDC translations", () => {
  it("define every static ddc.* key used in the code, in Thai and English", () => {
    const keys = new Set<string>();
    for (const file of sources(path.resolve(process.cwd(), "src"))) {
      for (const match of readFileSync(file, "utf8").matchAll(
        /["'](ddc\.[a-z_]+(?:\.[a-z_]+)+)["']/g,
      ))
        keys.add(match[1]);
    }
    const missing = [...keys].flatMap((key) =>
      (["th", "en"] as const)
        .filter(
          (locale) => typeof lookup(ddcMessages[locale], key) !== "string",
        )
        .map((l) => `${l}:${key}`),
    );

    expect(keys.size).toBeGreaterThan(50);
    expect(missing).toEqual([]);
  });

  it("has the same structure in both languages", () => {
    const shape = (node: unknown): unknown =>
      typeof node === "object" && node
        ? Object.fromEntries(
            Object.entries(node).map(([k, v]) => [k, shape(v)]),
          )
        : "s";

    expect(shape(ddcMessages.th)).toEqual(shape(ddcMessages.en));
  });
});
