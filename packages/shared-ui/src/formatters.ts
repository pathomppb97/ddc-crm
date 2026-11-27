export const BANGKOK_TIMEZONE = "Asia/Bangkok";

/** Formats a UTC ISO timestamp for display in Asia/Bangkok (ICT, UTC+7). */
export function formatBangkokDateTime(
  utcIso: string | Date | null | undefined,
  locale: "th" | "en" = "en",
): string {
  if (!utcIso) return "—";
  const date = typeof utcIso === "string" ? new Date(utcIso) : utcIso;
  if (Number.isNaN(date.getTime())) return "—";

  const formatter = new Intl.DateTimeFormat(
    locale === "th" ? "th-TH" : "en-GB",
    {
      timeZone: BANGKOK_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    },
  );
  return `${formatter.format(date)} ICT`;
}

/** Converts a wall-clock Asia/Bangkok string ("YYYY-MM-DDTHH:mm") into a canonical UTC ISO timestamp. */
export function bangkokLocalToUtcIso(localDateTime: string): string {
  const match = localDateTime
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    throw new Error(
      `Invalid Bangkok local datetime "${localDateTime}". Expected YYYY-MM-DDTHH:mm`,
    );
  }
  const [, y, m, d, hh, mm, ss = "00"] = match;
  // Asia/Bangkok has a fixed UTC+07:00 offset (no DST)
  const isoWithOffset = `${y}-${m}-${d}T${hh}:${mm}:${ss}+07:00`;
  const parsed = new Date(isoWithOffset);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid datetime value: ${localDateTime}`);
  }
  return parsed.toISOString();
}

export function formatCurrencyAmount(
  amount: number | null | undefined,
  currency = "THB",
  locale: "th" | "en" = "th",
): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
    return "—";
  }
  return new Intl.NumberFormat(locale === "th" ? "th-TH" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}
