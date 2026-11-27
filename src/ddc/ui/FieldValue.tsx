import { useGetOne, useRecordContext } from "ra-core";
import { ReferenceField } from "@/components/admin/reference-field";
import { Badge } from "@/components/ui/badge";
import type { FieldDef } from "../resources/schema";
import {
  formatMoney,
  useDdcLocale,
  useLabel,
  useLocalizedName,
} from "./labels";

const STATUS_TONES: Record<string, string> = {
  approved:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  accepted:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  completed:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  done: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  verified:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  succeeded:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  active:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  converted:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  pending_approval:
    "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  pending: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  partial: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  unverified:
    "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  high: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200",
  rejected: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  declined: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  failed: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  critical: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  not_feasible: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
};

const OptionName = ({ id }: { id: unknown }) => {
  const localizedName = useLocalizedName();
  const { data } = useGetOne(
    "master_options",
    { id: id as string },
    { enabled: id != null },
  );
  return <>{data ? localizedName(data) : "—"}</>;
};

const formatDate = (value: unknown, locale: string, withTime: boolean) => {
  if (!value) return "—";
  const text = String(value);
  // Date-only values are calendar dates: never shift them through a time zone
  const date = withTime
    ? new Date(text)
    : new Date(`${text.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleString(locale === "th" ? "th-TH" : "en-GB", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
  });
};

/** Read-only rendering of one field of the current record. */
export const FieldValue = ({ field }: { field: FieldDef }) => {
  const record = useRecordContext();
  const locale = useDdcLocale();
  const label = useLabel();
  if (!record) return null;
  const value = record[field.source];

  switch (field.type) {
    case "reference":
      return value == null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <ReferenceField
          source={field.source}
          reference={field.reference!}
          link="show"
        />
      );
    case "option":
      return value == null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <OptionName id={value} />
      );
    case "select": {
      const choice = field.choices?.find((c) => c.id === value);
      if (!choice)
        return (
          <span className="text-muted-foreground">
            {value == null ? "—" : String(value)}
          </span>
        );
      return (
        <Badge variant="outline" className={STATUS_TONES[String(value)] ?? ""}>
          {label(choice.label)}
        </Badge>
      );
    }
    case "boolean":
      return (
        <span>
          {value
            ? locale === "th"
              ? "ใช่"
              : "Yes"
            : locale === "th"
              ? "ไม่ใช่"
              : "No"}
        </span>
      );
    case "money":
      return <span className="tabular-nums">{formatMoney(value, locale)}</span>;
    case "number":
      return (
        <span className="tabular-nums">
          {value == null || value === ""
            ? "—"
            : Number(value).toLocaleString(locale === "th" ? "th-TH" : "en-US")}
        </span>
      );
    case "date":
      return <span>{formatDate(value, locale, false)}</span>;
    case "datetime":
      return <span>{formatDate(value, locale, true)}</span>;
    case "url":
      return value ? (
        <a
          href={String(value)}
          target="_blank"
          rel="noopener noreferrer"
          className="underline break-all"
        >
          {String(value)}
        </a>
      ) : (
        <span className="text-muted-foreground">—</span>
      );
    case "email":
      return value ? (
        <a href={`mailto:${String(value)}`} className="underline">
          {String(value)}
        </a>
      ) : (
        <span className="text-muted-foreground">—</span>
      );
    case "json":
      return value == null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">
          {Array.isArray(value) && value.every((v) => typeof v !== "object")
            ? value.join(", ")
            : JSON.stringify(value, null, 2)}
        </pre>
      );
    default:
      return value == null || value === "" ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className="whitespace-pre-wrap">{String(value)}</span>
      );
  }
};
