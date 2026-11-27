import { useGetList, useTranslate } from "ra-core";
import { useWatch } from "react-hook-form";
import { Link } from "react-router";
import { AlertTriangle } from "lucide-react";
import { findDuplicateCandidates } from "../domain/duplicates";

/** Shown in the customer form: existing customers that look like the one being entered. */
export const CustomerDuplicateWarning = () => {
  const translate = useTranslate();
  const [id, name, taxId, email, phone, website] = useWatch({
    name: ["id", "name", "tax_identifier", "email", "phone_number", "website"],
  });
  const enabled = Boolean(name || taxId || email || phone || website);
  const { data: companies = [] } = useGetList(
    "companies",
    {
      pagination: { page: 1, perPage: 2000 },
      sort: { field: "id", order: "ASC" },
    },
    { enabled },
  );
  if (!enabled) return null;
  const matches = findDuplicateCandidates(
    { id, name, tax_identifier: taxId, email, phone_number: phone, website },
    companies,
  ).slice(0, 5);
  if (matches.length === 0) return null;

  return (
    <div
      role="alert"
      className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950"
    >
      <p className="flex items-center gap-2 font-medium">
        <AlertTriangle className="size-4" />
        {translate("ddc.duplicates.title")}
      </p>
      <ul className="mt-2 list-disc pl-6">
        {matches.map((match) => (
          <li key={match.record.id}>
            <Link
              to={`/companies/${match.record.id}/show`}
              target="_blank"
              className="underline"
            >
              {match.record.name}
            </Link>{" "}
            <span className="text-muted-foreground">
              ({Math.round(match.score * 100)}% ·{" "}
              {match.reasons
                .map((r) => translate(`ddc.duplicates.reason.${r}`))
                .join(", ")}
              )
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};
