import { useRef, useState, type ChangeEvent } from "react";
import { useInput, useRecordContext } from "ra-core";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useDdcLocale } from "../ui/labels";
import { SectionCard } from "../ui/GenericResource";

export interface PartImage {
  id: string;
  name: string;
  src: string;
  added_at: string;
}

export const MAX_PART_IMAGES = 3;
export const MAX_PART_IMAGE_BYTES = 1024 * 1024;
const IMAGE_SOURCE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

export function partImages(value: unknown): PartImage[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is PartImage =>
      !!item &&
      typeof item.id === "string" &&
      typeof item.name === "string" &&
      typeof item.src === "string" &&
      IMAGE_SOURCE.test(item.src),
  );
}

export async function readPartImage(file: File): Promise<PartImage> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error("Use JPG, PNG or WebP.");
  if (file.size > MAX_PART_IMAGE_BYTES)
    throw new Error("Each image must be 1 MB or smaller.");
  const bitmap = await createImageBitmap(file);
  bitmap.close();
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.readAsDataURL(file);
  });
  return {
    id: crypto.randomUUID(),
    name: file.name,
    src,
    added_at: new Date().toISOString(),
  };
}

function Gallery({
  images,
  remove,
}: {
  images: PartImage[];
  remove?: (id: string) => void;
}) {
  const locale = useDdcLocale();
  const [selected, setSelected] = useState<PartImage | null>(null);
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {images.map((image) => (
          <figure key={image.id} className="min-w-0 rounded-lg border p-2">
            <button
              type="button"
              className="w-full"
              onClick={() => setSelected(image)}
              aria-label={image.name}
            >
              <img
                src={image.src}
                alt={image.name}
                className="h-40 w-full rounded object-contain"
                loading="lazy"
              />
            </button>
            <figcaption className="mt-2 break-all text-xs">
              {image.name}
            </figcaption>
            {remove ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => remove(image.id)}
              >
                {locale === "th" ? "นำรูปออก" : "Remove image"}
              </Button>
            ) : null}
          </figure>
        ))}
      </div>
      {selected ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
        >
          <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-4xl">
            <DialogTitle className="break-all pr-8">
              {selected.name}
            </DialogTitle>
            <img
              src={selected.src}
              alt={selected.name}
              className="mt-3 max-h-[70vh] w-full object-contain"
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

function ImageInput({ source, title }: { source: string; title: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locale = useDdcLocale();
  const { field, fieldState } = useInput({
    source,
    defaultValue: [],
    validate: () =>
      busy
        ? locale === "th"
          ? "กรุณารอให้อ่านรูปเสร็จ"
          : "Wait for images to finish loading."
        : undefined,
  });
  const images = partImages(field.value);
  const input = useRef<HTMLInputElement>(null);
  async function add(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    setError("");
    if (images.length + files.length > MAX_PART_IMAGES) {
      setError(
        locale === "th"
          ? "ใส่ได้ไม่เกิน 3 รูปต่อประเภท"
          : "Maximum 3 images per category.",
      );
      return;
    }
    setBusy(true);
    try {
      const added = await Promise.all(files.map(readPartImage));
      field.onChange([...images, ...added]);
      field.onBlur();
    } catch (cause) {
      setError(
        locale === "th"
          ? "เพิ่มรูปไม่ได้: ใช้ JPG, PNG หรือ WebP ที่เปิดได้ ขนาดไม่เกิน 1 MB ต่อรูป"
          : cause instanceof Error
            ? cause.message
            : "Could not load the image.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <SectionCard title={title}>
      <p className="mb-3 text-sm text-muted-foreground">
        JPG / PNG / WebP · ≤ 1 MB · {images.length}/3
      </p>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        onChange={add}
        className="sr-only"
        aria-label={title}
        disabled={busy}
      />
      <Button
        type="button"
        variant="outline"
        disabled={busy || images.length >= MAX_PART_IMAGES}
        onClick={() => input.current?.click()}
      >
        {busy
          ? locale === "th"
            ? "กำลังอ่านรูป…"
            : "Reading images…"
          : locale === "th"
            ? "เลือกรูป"
            : "Choose images"}
      </Button>
      {error || fieldState.error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error || fieldState.error?.message}
        </p>
      ) : null}
      <div className="mt-3">
        <Gallery
          images={images}
          remove={
            busy
              ? undefined
              : (id) => {
                  field.onChange(images.filter((image) => image.id !== id));
                  field.onBlur();
                }
          }
        />
      </div>
    </SectionCard>
  );
}

export function PartImagesForm() {
  const locale = useDdcLocale();
  return (
    <div className="mt-4 flex w-full flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {locale === "th"
          ? "กดบันทึกเพื่อใช้รูปกับ Part นี้ ภาพ 3D ใช้ภาพ Export/Render จาก CAD; ไฟล์แบบต้นฉบับแนบในเอกสารอ้างอิง"
          : "Save the Part to apply images. For 3D images, use CAD exports/renders; link original CAD files in Document references."}
        {import.meta.env.VITE_IS_DEMO === "true"
          ? locale === "th"
            ? " Local workspace: กดบันทึกแล้วรูปจะเก็บในเบราว์เซอร์นี้ ไม่แชร์ข้ามเครื่อง"
            : " Local workspace: saved images persist in this browser and are not shared across devices."
          : null}
      </p>
      <ImageInput
        source="custom_fields.photo_images"
        title={locale === "th" ? "รูปถ่ายชิ้นงาน / Part photos" : "Part photos"}
      />
      <ImageInput
        source="custom_fields.cad_images"
        title={
          locale === "th" ? "ภาพ 3D จาก CAD / 3D images" : "3D images from CAD"
        }
      />
    </div>
  );
}

export function PartImagesPanel() {
  const record = useRecordContext();
  const locale = useDdcLocale();
  if (!record) return null;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {(
        [
          ["photo_images", "รูปถ่ายชิ้นงาน / Part photos", "Part photos"],
          ["cad_images", "ภาพ 3D จาก CAD / 3D images", "3D images from CAD"],
        ] as const
      ).map(([source, th, en]) => {
        const images = partImages(record.custom_fields?.[source]);
        return (
          <SectionCard key={source} title={locale === "th" ? th : en}>
            {images.length ? (
              <Gallery images={images} />
            ) : (
              <p className="text-sm text-muted-foreground">
                {locale === "th"
                  ? "ยังไม่มีรูป — เพิ่มได้ที่แก้ไข Part"
                  : "No images yet — add images in Edit Part."}
              </p>
            )}
          </SectionCard>
        );
      })}
    </div>
  );
}
