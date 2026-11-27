import {
  useCanAccess,
  useGetList,
  useTranslate,
  type Identifier,
} from "ra-core";
import { SectionCard } from "./GenericResource";
import { useDdcLocale } from "./labels";

const ACTION_LABELS = {
  th: { INSERT: "สร้าง", UPDATE: "แก้ไข", DELETE: "ลบ" },
  en: { INSERT: "Created", UPDATE: "Updated", DELETE: "Deleted" },
} as const;

/** Change history of one record, read from the database audit log. */
export const AuditSection = ({
  table,
  recordId,
}: {
  table: string;
  recordId: Identifier;
}) => {
  const translate = useTranslate();
  const locale = useDdcLocale();
  const { canAccess, isPending: isCheckingAccess } = useCanAccess({
    resource: "audit_log",
    action: "list",
  });
  const { data = [], isPending } = useGetList(
    "audit_log",
    {
      filter: { table_name: table, record_id: String(recordId) },
      sort: { field: "occurred_at", order: "DESC" },
      pagination: { page: 1, perPage: 30 },
    },
    { enabled: canAccess === true },
  );
  if (isCheckingAccess || !canAccess) return null;

  return (
    <SectionCard title={translate("ddc.common.history")}>
      {isPending ? null : data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate("ddc.common.no_history")}
        </p>
      ) : (
        <ol className="space-y-2 text-sm">
          {data.map((entry) => (
            <li key={entry.id} className="border-l-2 pl-3">
              <span className="text-xs text-muted-foreground">
                {new Date(entry.occurred_at).toLocaleString(
                  locale === "th" ? "th-TH" : "en-GB",
                )}
              </span>{" "}
              <span className="font-medium">
                {ACTION_LABELS[locale][
                  entry.action as keyof (typeof ACTION_LABELS)["th"]
                ] ?? entry.action}
              </span>
              {entry.changed_fields?.length ? (
                <span className="text-muted-foreground">
                  {" "}
                  · {entry.changed_fields.join(", ")}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
};
