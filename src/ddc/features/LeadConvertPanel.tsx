import { useState } from "react";
import {
  useCanAccess,
  useGetList,
  useNotify,
  useRecordContext,
  useRedirect,
  useTranslate,
} from "ra-core";
import { ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { findDuplicateCandidates } from "../domain/duplicates";
import { errorMessage, useDdcDataProvider } from "./useDdcDataProvider";

/**
 * Converts a qualified lead into a customer, contact and opportunity in one
 * transaction. Possible existing customers are offered first, so that the
 * conversion does not create a duplicate.
 */
export const LeadConvertPanel = () => {
  const record = useRecordContext();
  const translate = useTranslate();
  const notify = useNotify();
  const redirect = useRedirect();
  const dataProvider = useDdcDataProvider();
  const [createOpportunity, setCreateOpportunity] = useState(true);
  const [existingCompanyId, setExistingCompanyId] = useState<string | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const { canAccess } = useCanAccess({
    resource: "leads",
    action: "edit",
    record,
  });
  const { data: companies = [] } = useGetList(
    "companies",
    {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: "name", order: "ASC" },
    },
    {
      enabled: Boolean(
        record && !["converted", "disqualified"].includes(record.status),
      ),
    },
  );
  if (
    !record ||
    !canAccess ||
    ["converted", "disqualified"].includes(record.status)
  )
    return null;

  const candidates = findDuplicateCandidates(
    {
      name: record.company_name,
      email: record.email,
      phone_number: record.phone,
      website: record.website,
    },
    companies,
  ).slice(0, 5);

  const convert = async () => {
    setBusy(true);
    try {
      const result = await dataProvider.convertLead(record.id, {
        createOpportunity,
        existingCompanyId,
      });
      notify("ddc.lead.converted", { type: "success" });
      redirect(`/companies/${result.company_id}/show`);
    } catch (error) {
      notify(errorMessage(error), { type: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <p className="text-sm font-medium">
          {translate("ddc.lead.convert_title")}
        </p>
        {candidates.length > 0 ? (
          <fieldset className="flex flex-col gap-1 text-sm">
            <legend className="mb-1 text-muted-foreground">
              {translate("ddc.lead.possible_existing")}
            </legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="existing"
                checked={existingCompanyId === null}
                onChange={() => setExistingCompanyId(null)}
              />
              {translate("ddc.lead.create_new_customer")}
            </label>
            {candidates.map((match) => (
              <label key={match.record.id} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="existing"
                  checked={existingCompanyId === String(match.record.id)}
                  onChange={() => setExistingCompanyId(String(match.record.id))}
                />
                {match.record.name} ({Math.round(match.score * 100)}% ·{" "}
                {match.reasons.join(", ")})
              </label>
            ))}
          </fieldset>
        ) : null}
        <div className="flex items-center gap-2">
          <Checkbox
            id="create-opportunity"
            checked={createOpportunity}
            onCheckedChange={(checked) =>
              setCreateOpportunity(checked === true)
            }
          />
          <Label htmlFor="create-opportunity">
            {translate("ddc.lead.create_opportunity")}
          </Label>
        </div>
        <div>
          <Button disabled={busy} onClick={convert}>
            <ArrowRightLeft className="size-4" />
            {translate("ddc.lead.convert")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
