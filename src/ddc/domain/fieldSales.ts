/**
 * Pure domain helpers for DDC Agriculture field sales (Desktop & Mobile).
 * No React or I/O dependencies except optional browser canvas image compression.
 */

export type CustomerGroupCode =
  "sugar_mill" | "dealer" | "repair_shop" | "parts_shop" | "farm_owner";

export interface CustomerGroupMeta {
  code: CustomerGroupCode;
  order: number;
  labelTh: string;
  labelEn: string;
  badgeClass: string;
  accentHex: string;
}

export const CUSTOMER_GROUPS: CustomerGroupMeta[] = [
  {
    code: "sugar_mill",
    order: 1,
    labelTh: "โรงงานน้ำตาล",
    labelEn: "Sugar mill",
    badgeClass:
      "border-indigo-300 bg-indigo-50 text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200",
    accentHex: "#4f46e5",
  },
  {
    code: "dealer",
    order: 2,
    labelTh: "ดีลเลอร์",
    labelEn: "Dealer",
    badgeClass:
      "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-200",
    accentHex: "#0284c7",
  },
  {
    code: "repair_shop",
    order: 3,
    labelTh: "อู่ซ่อม",
    labelEn: "Repair workshop",
    badgeClass:
      "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200",
    accentHex: "#d97706",
  },
  {
    code: "parts_shop",
    order: 4,
    labelTh: "ร้านอะไหล่",
    labelEn: "Spare parts shop",
    badgeClass:
      "border-teal-300 bg-teal-50 text-teal-800 dark:border-teal-800 dark:bg-teal-950/60 dark:text-teal-200",
    accentHex: "#0d9488",
  },
  {
    code: "farm_owner",
    order: 5,
    labelTh: "เจ้าของไร่",
    labelEn: "Farm owner",
    badgeClass:
      "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200",
    accentHex: "#059669",
  },
];

const GROUP_BY_CODE = new Map<string, CustomerGroupMeta>(
  CUSTOMER_GROUPS.map((g) => [g.code, g]),
);

export const getCustomerGroupMeta = (
  code: string | null | undefined,
): CustomerGroupMeta | undefined =>
  code ? GROUP_BY_CODE.get(code) : undefined;

/**
 * Advisory suggestion for legacy imported accounts that do not have
 * customer_group_id assigned yet. Never persisted until a user saves.
 */
export function inferCustomerGroupCode(
  name: string | null | undefined,
): CustomerGroupCode | null {
  const text = (name ?? "").toLowerCase();
  if (!text) return null;
  if (
    text.includes("โรงงานน้ำตาล") ||
    text.includes("โรงงานนํ้าตาล") ||
    text.includes("น้ำตาล") ||
    text.includes("นํ้าตาล") ||
    text.includes("sugar") ||
    text.includes("mitr phol") ||
    text.includes("มิตรผล") ||
    text.includes("ktis") ||
    text.includes("ksl")
  ) {
    return "sugar_mill";
  }
  if (
    text.includes("อู่") ||
    text.includes("ช่าง") ||
    text.includes("ซ่อม") ||
    text.includes("workshop") ||
    text.includes("garage")
  ) {
    return "repair_shop";
  }
  if (
    text.includes("อะไหล่") ||
    text.includes("การช่าง") ||
    text.includes("กลการ") ||
    text.includes("ฮาร์ดแวร์") ||
    text.includes("parts")
  ) {
    return "parts_shop";
  }
  if (
    text.includes("ดีลเลอร์") ||
    text.includes("dealer") ||
    text.includes("แทรกเตอร์") ||
    text.includes("tractor") ||
    text.includes("ตัวแทน") ||
    text.includes("จักรกล")
  ) {
    return "dealer";
  }
  if (
    text.includes("ไร่") ||
    text.includes("สวน") ||
    text.includes("ฟาร์ม") ||
    text.includes("กำนัน") ||
    text.includes("ผู้ใหญ่") ||
    text.includes("เสี่ย") ||
    text.includes("farm")
  ) {
    return "farm_owner";
  }
  return null;
}

export interface Coordinates {
  lat: number;
  lng: number;
}

/**
 * Parses coordinates from decimal strings ("17.5152, 99.7614"), Google Maps URLs
 * ("?q=17.5152,99.7614", "/@17.5152,99.7614,15z"), or legacy DMS text pasted
 * into Excel customer names ("@17°33'14.3\"N 100°06'11.1\"E").
 */
export function extractCoordsFromText(
  text: string | null | undefined,
): Coordinates | null {
  if (!text) return null;

  // DMS format e.g. 17°33'14.3"N 100°06'11.1"E
  const dms = text.match(
    /(\d{1,2})\s*°\s*(\d{1,2})\s*['’]\s*(\d{1,2}(?:\.\d+)?)\s*["”]?\s*([NS])\s*[,\s]+\s*(\d{1,3})\s*°\s*(\d{1,2})\s*['’]\s*(\d{1,2}(?:\.\d+)?)\s*["”]?\s*([EW])/i,
  );
  if (dms) {
    const lat =
      (Number(dms[1]) + Number(dms[2]) / 60 + Number(dms[3]) / 3600) *
      (dms[4].toUpperCase() === "S" ? -1 : 1);
    const lng =
      (Number(dms[5]) + Number(dms[6]) / 60 + Number(dms[7]) / 3600) *
      (dms[8].toUpperCase() === "W" ? -1 : 1);
    if (isValidCoords(lat, lng)) {
      return {
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
      };
    }
  }

  // Google Maps query/path, parentheses "(17.5152, 99.7614)", or plain decimal pair
  const dec = text.match(
    /(?:@|[?&](?:q|ll|query)=|[(\s]|^)(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/,
  );
  if (dec) {
    const lat = Number(dec[1]);
    const lng = Number(dec[2]);
    if (isValidCoords(lat, lng)) {
      return {
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
      };
    }
  }
  return null;
}

export function isValidCoords(lat: unknown, lng: unknown): boolean {
  const la = Number(lat);
  const lo = Number(lng);
  return (
    Number.isFinite(la) &&
    Number.isFinite(lo) &&
    la >= -90 &&
    la <= 90 &&
    lo >= -180 &&
    lo <= 180
  );
}

export function buildGoogleMapsUrl(
  lat: number | null | undefined,
  lng: number | null | undefined,
  fallbackQuery?: string | null,
): string | null {
  if (lat != null && lng != null && isValidCoords(lat, lng)) {
    return `https://www.google.com/maps?q=${lat},${lng}`;
  }
  const q = fallbackQuery?.trim();
  if (q) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  }
  return null;
}

export interface FleetEntry {
  brand: string;
  model: string;
  count: number;
}

export function totalFleetVehicles(
  fleets: FleetEntry[] | null | undefined,
): number {
  if (!Array.isArray(fleets)) return 0;
  return fleets.reduce(
    (sum, item) =>
      sum +
      (Number.isFinite(Number(item.count))
        ? Math.max(0, Math.round(Number(item.count)))
        : 0),
    0,
  );
}

export function computeCapacityTotals(input: {
  totalVehicles: number;
  tonsPerVehicle: number | null;
  totalTons: number | null;
  editedField: "vehicles" | "tonsPerVehicle" | "totalTons";
}): { tonsPerVehicle: number | null; totalTons: number | null } {
  const vehicles = Math.max(0, Math.round(input.totalVehicles || 0));
  const perVeh =
    input.tonsPerVehicle != null &&
    Number.isFinite(input.tonsPerVehicle) &&
    input.tonsPerVehicle >= 0
      ? input.tonsPerVehicle
      : null;
  const total =
    input.totalTons != null &&
    Number.isFinite(input.totalTons) &&
    input.totalTons >= 0
      ? input.totalTons
      : null;

  if (input.editedField === "tonsPerVehicle") {
    if (perVeh === null) return { tonsPerVehicle: null, totalTons: total };
    return {
      tonsPerVehicle: perVeh,
      totalTons: vehicles > 0 ? Math.round(perVeh * vehicles) : total,
    };
  }
  if (input.editedField === "totalTons") {
    if (total === null) return { tonsPerVehicle: perVeh, totalTons: null };
    return {
      tonsPerVehicle: vehicles > 0 ? Math.round(total / vehicles) : perVeh,
      totalTons: total,
    };
  }
  // vehicles changed: preserve totalTons if set and recompute per vehicle, else derive totalTons
  if (vehicles === 0) return { tonsPerVehicle: perVeh, totalTons: total };
  if (total !== null) {
    return { tonsPerVehicle: Math.round(total / vehicles), totalTons: total };
  }
  if (perVeh !== null) {
    return { tonsPerVehicle: perVeh, totalTons: Math.round(perVeh * vehicles) };
  }
  return { tonsPerVehicle: null, totalTons: null };
}

export type ReplacementIntervalUnit =
  "tons" | "days" | "hours" | "rai" | "season";

export const REPLACEMENT_INTERVAL_UNITS: Array<{
  id: ReplacementIntervalUnit;
  labelTh: string;
  labelEn: string;
}> = [
  { id: "tons", labelTh: "ตันอ้อย", labelEn: "tons" },
  { id: "days", labelTh: "วันตัด", labelEn: "harvest days" },
  { id: "hours", labelTh: "ชั่วโมง", labelEn: "hours" },
  { id: "rai", labelTh: "ไร่", labelEn: "rai" },
  { id: "season", labelTh: "ฤดูเก็บเกี่ยว", labelEn: "season" },
];

export const PHOTO_TAGS: Array<{
  id: "part_sample" | "machine" | "shop" | "business_card" | "other";
  labelTh: string;
  labelEn: string;
}> = [
  { id: "part_sample", labelTh: "ตัวอย่างอะไหล่", labelEn: "Part sample" },
  { id: "machine", labelTh: "รถตัดอ้อย/หน้างาน", labelEn: "Machine / site" },
  { id: "shop", labelTh: "หน้าร้าน/โรงงาน", labelEn: "Shop / mill" },
  { id: "business_card", labelTh: "นามบัตร", labelEn: "Business card" },
  { id: "other", labelTh: "อื่นๆ", labelEn: "Other" },
];

/**
 * Estimates seasonal part demand (pcs/season) from replacement frequency.
 * Returns null if insufficient parameters are provided.
 */
export function computeEstimatedSeasonQty(input: {
  qtyPerChange: number | null;
  intervalValue: number | null;
  intervalUnit: ReplacementIntervalUnit;
  totalTonsPerSeason: number | null;
  totalVehicles: number;
  harvestDaysPerSeason?: number;
  hoursPerVehiclePerSeason?: number;
  tonsPerRai?: number;
}): number | null {
  const qty = Number(input.qtyPerChange);
  const interval = Number(input.intervalValue);
  if (
    !Number.isFinite(qty) ||
    qty <= 0 ||
    !Number.isFinite(interval) ||
    interval <= 0
  ) {
    return null;
  }
  const vehicles = Math.max(1, Math.round(input.totalVehicles || 0));
  const tons = Number(input.totalTonsPerSeason);

  switch (input.intervalUnit) {
    case "tons":
      if (!Number.isFinite(tons) || tons <= 0) return null;
      return Math.round((tons / interval) * qty);
    case "season":
      return Math.round((qty / interval) * vehicles);
    case "days": {
      const days = input.harvestDaysPerSeason ?? 120;
      return Math.round((days / interval) * qty * vehicles);
    }
    case "hours": {
      const hours = input.hoursPerVehiclePerSeason ?? 1200;
      return Math.round((hours / interval) * qty * vehicles);
    }
    case "rai": {
      if (!Number.isFinite(tons) || tons <= 0) return null;
      const tonsPerRai = input.tonsPerRai ?? 12;
      const estRai = tons / tonsPerRai;
      return Math.round((estRai / interval) * qty);
    }
    default:
      return null;
  }
}

export function toTelHref(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const cleaned = phone
    .replace(/\s*(?:x|ext\.?|ต่อ)\s*(\d+)\s*$/i, ",$1")
    .replace(/[^\d+,]/g, "");
  return cleaned ? `tel:${cleaned}` : null;
}

export function toLineUrl(lineId: string | null | undefined): string | null {
  const clean = (lineId ?? "").trim().replace(/^@/, "");
  if (!clean) return null;
  return `https://line.me/ti/p/~${encodeURIComponent(clean)}`;
}

/**
 * Compresses a camera or gallery image on the client (Canvas resize + JPEG)
 * so 4-8 MB smartphone photos shrink to ~150-350 KB before storage.
 */
export async function compressFieldImage(
  file: File,
  maxDimension = 1400,
  quality = 0.78,
): Promise<{ dataUrl: string; fileName: string; approxKb: number }> {
  if (!file.type.startsWith("image/")) {
    throw new Error("กรุณาเลือกไฟล์รูปภาพ (JPG, PNG, WebP)");
  }
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(
      1,
      maxDimension / Math.max(bitmap.width, bitmap.height),
    );
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Cannot initialize image canvas");
    ctx.drawImage(bitmap, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    const approxKb = Math.max(1, Math.round((dataUrl.length * 3) / 4 / 1024));
    return { dataUrl, fileName: file.name, approxKb };
  } finally {
    bitmap.close();
  }
}

export function formatThaiDateTime(
  value: string | Date | null | undefined,
  locale: "th" | "en" = "th",
): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  if (locale === "en") {
    return date.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return `${date.toLocaleString("th-TH", {
    day: "numeric",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })} น.`;
}
