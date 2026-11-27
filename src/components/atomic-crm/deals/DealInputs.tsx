import { useEffect, useMemo, useRef } from "react";
import { DesignSlots } from "@/ddc/pages/pageDesign";
import { required, useTranslate } from "ra-core";
import { AutocompleteArrayInput } from "@/components/admin/autocomplete-array-input";
import { ReferenceArrayInput } from "@/components/admin/reference-array-input";
import { ReferenceInput } from "@/components/admin/reference-input";
import { TextInput } from "@/components/admin/text-input";
import { NumberInput } from "@/components/admin/number-input";
import { DateInput } from "@/components/admin/date-input";
import { SelectInput } from "@/components/admin/select-input";
import { Separator } from "@/components/ui/separator";
import { useIsMobile } from "@/hooks/use-mobile";

import { useConfigurationContext } from "../root/ConfigurationContext";
import { AutocompleteCompanyInput } from "../companies/AutocompleteCompanyInput.tsx";
import { AutocompleteContactInput } from "../contacts/AutocompleteContactInput.tsx";
import { validateClosingDate } from "./dealUtils";
import { useFormContext, useWatch } from "react-hook-form";
import {
  useDealStages,
  usePipelineStages,
} from "@/ddc/features/pipelineStages";
import { DdcDealInputs } from "@/ddc/features/DdcDealInputs";

export const DealInputs = () => {
  const isMobile = useIsMobile();
  return (
    <div className="flex flex-col gap-10 p-1">
      <DealInfoInputs />

      <div className={`flex gap-6 ${isMobile ? "flex-col" : "flex-row"}`}>
        <DealLinkedToInputs />
        <Separator orientation={isMobile ? "horizontal" : "vertical"} />
        <DealMiscInputs />
      </div>
    </div>
  );
};

const DealInfoInputs = () => {
  return (
    <div className="flex flex-col gap-4 flex-1">
      <DesignSlots page="deals" panel="form">
        <TextInput source="name" validate={required()} helperText={false} />
        <TextInput source="description" multiline rows={3} helperText={false} />
      </DesignSlots>
    </div>
  );
};

const DealLinkedToInputs = () => {
  const translate = useTranslate();
  const companyId = useWatch({ name: "company_id" });
  const hasCompany =
    companyId !== null && companyId !== undefined && companyId !== "";
  const form = useFormContext();
  const prevCompanyRef = useRef<unknown>(undefined);

  useEffect(() => {
    const prev = prevCompanyRef.current;
    prevCompanyRef.current = companyId;
    if (
      prev !== undefined &&
      prev !== null &&
      prev !== "" &&
      String(prev) !== String(companyId ?? "")
    ) {
      form?.setValue("contact_ids", [], { shouldDirty: true });
    }
  }, [companyId, form]);

  const contactFilter = useMemo(
    () => (hasCompany ? { company_id: companyId } : undefined),
    [companyId, hasCompany],
  );

  return (
    <div className="flex flex-col gap-4 flex-1">
      <h6 className="text-lg font-semibold">
        {translate("resources.deals.inputs.linked_to")}
      </h6>
      <ReferenceInput source="company_id" reference="companies" perPage={250}>
        <AutocompleteCompanyInput
          label="resources.deals.fields.company_id"
          validate={required()}
          modal
        />
      </ReferenceInput>

      <ReferenceArrayInput
        key={String(companyId ?? "")}
        source="contact_ids"
        reference="contacts_summary"
        filter={contactFilter}
        perPage={250}
        enableGetChoices={() => hasCompany}
        queryOptions={{ placeholderData: undefined }}
      >
        <AutocompleteContactInput label="resources.deals.fields.contact_ids" />
      </ReferenceArrayInput>
    </div>
  );
};

const DealMiscInputs = () => {
  const { dealCategories } = useConfigurationContext();
  const pipelineId = useWatch({ name: "pipeline_id" });
  const currency = useWatch({ name: "currency" });
  const pipelineStages = usePipelineStages(pipelineId);
  const configStages = useDealStages();
  const dealStages = pipelineStages?.length ? pipelineStages : configStages;
  const translate = useTranslate();
  return (
    <div className="flex flex-col gap-4 flex-1">
      <h6 className="text-lg font-semibold">
        {translate("resources.deals.field_categories.misc")}
      </h6>

      <AutocompleteArrayInput
        source="categories"
        choices={dealCategories}
        optionText="label"
        optionValue="value"
        helperText={false}
      />
      <NumberInput
        source="amount"
        helperText="ddc.deal.amount_hint"
        step={0.0001}
        min={0}
        suffix={currency}
      />
      <DdcDealInputs />
      <DateInput
        validate={validateClosingDate}
        source="expected_closing_date"
        helperText={false}
      />
      <SelectInput
        source="stage"
        choices={dealStages}
        optionText="label"
        optionValue="value"
        helperText={false}
        validate={required()}
      />
    </div>
  );
};
