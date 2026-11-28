import { describe, expect, it } from "vitest";
import { generateDdcDemoData } from "../demo/generateDemoData";
import { openLocalWorkspace } from "./localWorkspace";

const sourceVersion = "test-synthetic-v1";

describe("Local workspace persistence", () => {
  it("adds new seed records once while preserving customer edits", async () => {
    const name = crypto.randomUUID();
    const seed = generateDdcDemoData();
    const old = await openLocalWorkspace(seed, sourceVersion, name);
    const customer = (await old.getOne("companies", { id: 1 })).data;
    await old.update("companies", {
      id: customer.id,
      previousData: customer,
      data: { name: "Saved demo customer" },
    });

    const model = { ...seed.machine_models[0], id: 25000 };
    const openUpgraded = () =>
      openLocalWorkspace(seed, sourceVersion, name, {
        version: "test-new-model",
        tables: { machine_models: [model] },
      });

    const upgraded = await openUpgraded();
    expect((await upgraded.getOne("companies", { id: 1 })).data.name).toBe(
      "Saved demo customer",
    );
    expect(
      (await upgraded.getOne("machine_models", { id: model.id })).data,
    ).toMatchObject(model);
    await upgraded.delete("machine_models", { id: model.id });

    const reopened = await openUpgraded();
    const models = await reopened.getList("machine_models", {
      pagination: { page: 1, perPage: 100 },
      sort: { field: "id", order: "ASC" },
      filter: {},
    });
    expect(models.data.some((row) => row.id === model.id)).toBe(false);
  });

  it("persists a product image and customer edit across provider restart", async () => {
    const name = `ddc-local-test-${crypto.randomUUID()}`;
    const seed = generateDdcDemoData();
    const provider = await openLocalWorkspace(seed, sourceVersion, name);
    const customer = (await provider.getOne("companies", { id: 1 })).data;
    await provider.update("companies", {
      id: 1,
      previousData: customer,
      data: { name: "Persistence test customer" },
    });
    const product = (await provider.getOne("products", { id: 1 })).data;
    const photo = {
      id: "test-photo",
      name: "part.png",
      src: "data:image/png;base64,aGVsbG8=",
      added_at: "2026-11-26T00:00:00.000Z",
    };
    await provider.update("products", {
      id: product.id,
      previousData: product,
      data: {
        custom_fields: { ...product.custom_fields, photo_images: [photo] },
      },
    });
    const restored = await openLocalWorkspace(seed, sourceVersion, name);
    expect((await restored.getOne("companies", { id: 1 })).data.name).toBe(
      "Persistence test customer",
    );
    expect(
      (await restored.getOne("products", { id: product.id })).data.custom_fields
        .photo_images,
    ).toEqual([photo]);
    expect(
      (
        await restored.getList("audit_log", {
          pagination: { page: 1, perPage: 100 },
          sort: { field: "id", order: "ASC" },
          filter: {},
        })
      ).data.length,
    ).toBeGreaterThanOrEqual(2);
    expect(seed.companies[0].name).not.toBe("Persistence test customer");
  });

  it("rejects stale-tab writes and preserves data when the source version changes", async () => {
    const name = `ddc-conflict-test-${crypto.randomUUID()}`;
    const seed = generateDdcDemoData();
    const first = await openLocalWorkspace(seed, sourceVersion, name);
    const stale = await openLocalWorkspace(seed, sourceVersion, name);
    await first.update("products", {
      id: 1,
      previousData: { id: 1 },
      data: { description: "Saved by first tab" },
    });
    await expect(
      stale.update("products", {
        id: 1,
        previousData: { id: 1 },
        data: { description: "Stale overwrite" },
      }),
    ).rejects.toThrow("Another CRM tab");
    expect(
      (await stale.getOne("products", { id: 1 })).data.description,
    ).not.toBe("Stale overwrite");
    await expect(
      openLocalWorkspace(seed, "different-source-version", name),
    ).rejects.toThrow("saved data has been preserved");
    const restored = await openLocalWorkspace(seed, sourceVersion, name);
    expect(
      (await restored.getOne("products", { id: 1 })).data.description,
    ).toBe("Saved by first tab");
  });

  it("non-destructively heals legacy snapshots missing new collections while preserving edits", async () => {
    const name = `ddc-legacy-heal-${crypto.randomUUID()}`;
    const seed = generateDdcDemoData();
    const partialSeed = structuredClone(seed);
    for (const collection of [
      "customer_source_rows",
      "customer_fleets",
      "customer_requirements",
      "customer_samples",
      "customer_purchase_history",
      "customer_capacity_profiles",
      "customer_part_usage",
      "activity_photos",
    ]) {
      delete partialSeed[collection];
    }

    const legacyProvider = await openLocalWorkspace(
      partialSeed,
      sourceVersion,
      name,
    );
    const company = (await legacyProvider.getOne("companies", { id: 1 })).data;
    await legacyProvider.update("companies", {
      id: 1,
      previousData: company,
      data: { name: "Existing Customer Preserved" },
    });

    const healed = await openLocalWorkspace(seed, sourceVersion, name);
    expect((await healed.getOne("companies", { id: 1 })).data.name).toBe(
      "Existing Customer Preserved",
    );
    const sourceRows = await healed.getList("customer_source_rows", {
      pagination: { page: 1, perPage: 25 },
      sort: { field: "id", order: "ASC" },
      filter: {},
    });
    expect(sourceRows.data.length).toBeGreaterThan(0);

    // Verify the healed snapshot was persisted into IndexedDB
    const reopened = await openLocalWorkspace(seed, sourceVersion, name);
    const persistedRows = await reopened.getList("customer_source_rows", {
      pagination: { page: 1, perPage: 25 },
      sort: { field: "id", order: "ASC" },
      filter: {},
    });
    expect(persistedRows.data.length).toBe(sourceRows.data.length);
  });
});
