import {
  CoreAdminContext as AdminContext,
  Form,
  RecordContextProvider,
} from "ra-core";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";
import { vi, describe, it, expect } from "vitest";
import {
  PartImagesForm,
  PartImagesPanel,
  readPartImage,
  MAX_PART_IMAGE_BYTES,
} from "./PartImages";

async function sampleImage(name: string) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 16;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#176e8a";
  context.fillRect(0, 0, 16, 16);
  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((value) => resolve(value!), "image/png"),
  );
  return new File([blob], name, { type: "image/png" });
}

describe("Part images", () => {
  it("saves both categories with the original bytes and preserves other custom fields", async () => {
    const save = vi.fn();
    const screen = await render(
      <AdminContext>
        <Form
          defaultValues={{ custom_fields: { source: "existing evidence" } }}
          onSubmit={save}
        >
          <PartImagesForm />
          <button type="submit">Save test part</button>
        </Form>
      </AdminContext>,
    );
    const photo = await sampleImage("part-photo.png");
    const cad = await sampleImage("part-cad.png");
    await userEvent.upload(screen.getByLabelText("Part photos"), photo);
    await expect.element(screen.getByAltText("part-photo.png")).toBeVisible();
    await userEvent.upload(screen.getByLabelText("3D images from CAD"), cad);
    await expect.element(screen.getByAltText("part-cad.png")).toBeVisible();
    await screen.getByRole("button", { name: "Save test part" }).click();
    await expect.poll(() => save.mock.calls.length).toBe(1);
    const saved = save.mock.calls[0][0];
    expect(saved.custom_fields.source).toBe("existing evidence");
    expect(saved.custom_fields.photo_images[0].src).toBe(
      (await readPartImage(photo)).src,
    );
    expect(saved.custom_fields.cad_images[0].src).toBe(
      (await readPartImage(cad)).src,
    );
    await screen.unmount();
    const restored = await render(
      <AdminContext>
        <RecordContextProvider
          value={{ id: 1, ...JSON.parse(JSON.stringify(saved)) }}
        >
          <PartImagesPanel />
        </RecordContextProvider>
      </AdminContext>,
    );
    await expect.element(restored.getByAltText("part-photo.png")).toBeVisible();
    await expect.element(restored.getByAltText("part-cad.png")).toBeVisible();
    await restored.getByRole("button", { name: "part-photo.png" }).click();
    await expect.element(restored.getByRole("dialog")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(restored.getByRole("dialog")).not.toBeInTheDocument();
  });

  it("rejects oversized files and invalid image bytes", async () => {
    await expect(
      readPartImage(
        new File([new Uint8Array(MAX_PART_IMAGE_BYTES + 1)], "large.png", {
          type: "image/png",
        }),
      ),
    ).rejects.toThrow("1 MB");
    await expect(
      readPartImage(new File(["invalid"], "broken.png", { type: "image/png" })),
    ).rejects.toThrow();
    await expect(
      readPartImage(
        new File(["<svg/>"], "unsafe.svg", { type: "image/svg+xml" }),
      ),
    ).rejects.toThrow("JPG");
  });
});
