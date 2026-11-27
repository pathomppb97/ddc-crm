import { useLocaleState } from "ra-core";
import { useCallback } from "react";
import type { Choice, Label } from "../resources/schema";

export type DdcLocale = "th" | "en";

export const useDdcLocale = (): DdcLocale => {
  const [locale] = useLocaleState();
  return locale === "en" ? "en" : "th";
};

/** Returns a function picking the label of the current interface language. */
export const useLabel = () => {
  const locale = useDdcLocale();
  return useCallback(
    (label: Label | undefined) => (label ? label[locale] || label.th : ""),
    [locale],
  );
};

export const useChoices = (choices: Choice[] | undefined) => {
  const label = useLabel();
  return (choices ?? []).map((choice) => ({
    id: choice.id,
    name: label(choice.label),
  }));
};

/** Display name of a master data row (name / name_en) in the current language. */
export const useLocalizedName = () => {
  const locale = useDdcLocale();
  return useCallback(
    (record?: { name?: string | null; name_en?: string | null } | null) =>
      record
        ? locale === "en" && record.name_en
          ? record.name_en
          : (record.name ?? "")
        : "",
    [locale],
  );
};

export const formatMoney = (
  value: unknown,
  locale: DdcLocale,
  currency?: string | null,
) => {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  const text = amount.toLocaleString(locale === "th" ? "th-TH" : "en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency ? `${text} ${currency}` : text;
};
