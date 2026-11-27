import { useEffect, useId, useMemo, useRef } from "react";
import { required, useGetOne, useTranslate } from "ra-core";
import { useFormContext, useWatch } from "react-hook-form";
import { AutocompleteInput } from "@/components/admin/autocomplete-input";
import { BooleanInput } from "@/components/admin/boolean-input";
import { DateInput } from "@/components/admin/date-input";
import { DateTimeInput } from "@/components/admin/date-time-input";
import { ReferenceInput } from "@/components/admin/reference-input";
import { SelectInput } from "@/components/admin/select-input";
import { TextInput } from "@/components/admin/text-input";
import type { FieldDef } from "../resources/schema";
import { useChoices, useDdcLocale, useLabel, useLocalizedName } from "./labels";
import { inputPolicy, referenceLabel } from "../domain/inputPolicy";
import { validatorsFor } from "./fieldValidators";
import { NumericFieldInput } from "./NumericFieldInput";
import { ChoiceFieldInput } from "./ChoiceFieldInput";

const ReferenceFieldInput = ({
  field,
  asFilter,
  alwaysOn,
  helperText,
}: {
  field: FieldDef;
  asFilter: boolean;
  alwaysOn?: boolean;
  helperText: string | false;
}) => {
  const label = useLabel();
  const locale = useDdcLocale();
  const dep = asFilter ? undefined : field.dependsOn;
  const watchedParent = useWatch({
    name: dep?.sourceField ?? "__ddc_unused_parent__",
    disabled: !dep,
  });
  const hasViaSource =
    Boolean(dep?.viaResource) &&
    watchedParent !== null &&
    watchedParent !== undefined &&
    watchedParent !== "";
  const { data: viaRecord } = useGetOne(
    dep?.viaResource ?? "companies",
    { id: watchedParent },
    { enabled: hasViaSource },
  );
  const resolvedParent = dep
    ? dep.viaResource
      ? viaRecord?.[dep.viaField ?? dep.targetField ?? dep.sourceField]
      : watchedParent
    : undefined;
  const hasParent =
    resolvedParent !== null &&
    resolvedParent !== undefined &&
    resolvedParent !== "";

  const form = useFormContext();
  const prevParentRef = useRef<unknown>(undefined);

  useEffect(() => {
    if (!dep || !form) return;
    const prev = prevParentRef.current;
    prevParentRef.current = resolvedParent;
    if (
      prev !== undefined &&
      prev !== null &&
      prev !== "" &&
      String(prev) !== String(resolvedParent ?? "")
    ) {
      form.setValue(field.source, null, { shouldDirty: true });
    }
  }, [dep, field.source, form, resolvedParent]);

  const waitingForParent = Boolean(dep?.requireParent && !hasParent);
  const targetColumn = dep?.targetField ?? dep?.sourceField;
  const combinedFilter = useMemo(() => {
    const base: Record<string, unknown> = { ...(field.referenceFilter ?? {}) };
    if (dep && hasParent && targetColumn) {
      base[targetColumn] = resolvedParent;
    }
    return Object.keys(base).length > 0 ? base : undefined;
  }, [dep, field.referenceFilter, hasParent, resolvedParent, targetColumn]);

  const placeholder =
    waitingForParent && dep?.emptyParentPlaceholder
      ? label(dep.emptyParentPlaceholder)
      : undefined;

  return (
    <ReferenceInput
      key={
        dep ? `${field.source}:${String(resolvedParent ?? "")}` : field.source
      }
      source={field.source}
      reference={field.reference!}
      filter={combinedFilter}
      perPage={250}
      alwaysOn={alwaysOn}
      enableGetChoices={() => !waitingForParent}
      queryOptions={{ placeholderData: undefined }}
    >
      <AutocompleteInput
        label={label(field.label)}
        optionText={(record: Record<string, unknown>) =>
          referenceLabel(record, field, locale)
        }
        helperText={
          waitingForParent && dep?.emptyParentPlaceholder
            ? label(dep.emptyParentPlaceholder)
            : helperText
        }
        validate={
          asFilter ? undefined : field.required ? required() : undefined
        }
        clearable={!asFilter && !field.required}
        disabled={waitingForParent}
        placeholder={placeholder}
      />
    </ReferenceInput>
  );
};

interface FieldInputProps {
  field: FieldDef;
  /** Inputs inside list filters: no validation, no helper */
  asFilter?: boolean;
  alwaysOn?: boolean;
}

/** Renders the form input matching a field definition. */
export const FieldInput = ({
  field,
  asFilter = false,
  alwaysOn,
}: FieldInputProps) => {
  const label = useLabel();
  const choices = useChoices(field.choices);
  const localizedName = useLocalizedName();
  const translate = useTranslate();
  const suggestionsId = useId();
  const policy = inputPolicy(field);
  const hintKey =
    policy.kind === "code"
      ? "ddc.input.identifier_hint"
      : policy.kind === "phone"
        ? "ddc.input.phone_hint"
        : field.type === "money"
          ? "ddc.input.money_hint"
          : field.type === "datetime"
            ? "ddc.input.datetime_hint"
            : field.type === "date"
              ? "ddc.input.date_hint"
              : field.type === "json"
                ? "ddc.input.json_hint"
                : undefined;
  const common = {
    source: field.source,
    label: label(field.label),
    helperText: asFilter
      ? (false as const)
      : field.helper
        ? label(field.helper)
        : hintKey
          ? translate(hintKey)
          : (false as const),
    validate: asFilter ? undefined : validatorsFor(field),
    ...(alwaysOn === undefined ? {} : { alwaysOn }),
  };

  switch (field.type) {
    case "textarea":
      return (
        <TextInput
          {...common}
          multiline
          rows={policy.rows ?? 4}
          placeholder={
            policy.placeholder ? label(policy.placeholder) : undefined
          }
          inputClassName="min-h-28 resize-y leading-relaxed"
        />
      );
    case "number":
    case "money":
      return (
        <NumericFieldInput {...common} definition={field} asFilter={asFilter} />
      );
    case "date":
      return <DateInput {...common} />;
    case "datetime":
      return <DateTimeInput {...common} />;
    case "boolean":
      return <BooleanInput {...common} />;
    case "select":
      return !asFilter &&
        choices.length > 1 &&
        choices.length <= 4 &&
        [
          "status",
          "priority",
          "verification_status",
          "feasibility_status",
        ].includes(field.source) ? (
        <ChoiceFieldInput
          {...common}
          choices={choices}
          allowClear={field.defaultValue === undefined && !field.required}
        />
      ) : (
        <SelectInput
          {...common}
          choices={choices}
          emptyText={translate(
            asFilter ? "ddc.input.all_choices" : "ddc.input.choose",
          )}
        />
      );
    case "json":
      return (
        <TextInput
          {...common}
          multiline
          rows={policy.rows ?? 6}
          inputClassName="font-mono text-xs leading-relaxed"
          format={(value: unknown) =>
            typeof value === "string"
              ? value
              : value == null
                ? ""
                : JSON.stringify(value, null, 2)
          }
          parse={(value: string) => {
            try {
              return value === "" ? null : JSON.parse(value);
            } catch {
              return value;
            }
          }}
        />
      );
    case "option":
      return (
        <ReferenceInput
          source={field.source}
          reference="master_options"
          filter={{ category: field.category, is_active: true }}
          sort={{ field: "sort_order", order: "ASC" }}
          perPage={200}
          alwaysOn={alwaysOn}
        >
          <SelectInput
            label={label(field.label)}
            emptyText={translate(
              asFilter ? "ddc.input.all_choices" : "ddc.input.choose",
            )}
            optionText={(record: { name?: string; name_en?: string }) =>
              localizedName(record)
            }
            helperText={common.helperText}
            validate={
              asFilter ? undefined : field.required ? required() : undefined
            }
          />
        </ReferenceInput>
      );
    case "reference":
      return (
        <ReferenceFieldInput
          field={field}
          asFilter={asFilter}
          alwaysOn={alwaysOn}
          helperText={common.helperText}
        />
      );
    default:
      return (
        <>
          <TextInput
            {...common}
            type={
              field.type === "email"
                ? "email"
                : field.type === "url"
                  ? "url"
                  : policy.kind === "phone"
                    ? "tel"
                    : "text"
            }
            inputMode={policy.kind === "phone" ? "tel" : undefined}
            autoComplete={
              field.type === "email"
                ? "email"
                : policy.kind === "phone"
                  ? "tel"
                  : policy.kind === "code"
                    ? "off"
                    : undefined
            }
            autoCapitalize={policy.kind === "code" ? "none" : undefined}
            spellCheck={policy.kind === "code" ? false : undefined}
            list={policy.suggestions?.length ? suggestionsId : undefined}
            placeholder={
              policy.placeholder ? label(policy.placeholder) : undefined
            }
          />
          {policy.suggestions?.length ? (
            <datalist id={suggestionsId}>
              {policy.suggestions.map((suggestion) => (
                <option key={suggestion} value={suggestion} />
              ))}
            </datalist>
          ) : null}
        </>
      );
  }
};
