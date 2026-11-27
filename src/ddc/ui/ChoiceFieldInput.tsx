import { FieldTitle, useInput, type InputProps } from "ra-core";
import {
  FormControl,
  FormError,
  FormField,
  FormLabel,
} from "@/components/admin/form";
import { InputHelperText } from "@/components/admin/input-helper-text";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Button } from "@/components/ui/button";
import { useTranslate } from "ra-core";

/** Short, stable choice lists remain visible and keyboard accessible. */
export function ChoiceFieldInput({
  choices,
  allowClear = true,
  ...props
}: InputProps & {
  choices: Array<{ id: string; name: string }>;
  allowClear?: boolean;
}) {
  const { field, id, isRequired } = useInput(props);
  const translate = useTranslate();
  return (
    <FormField id={id} name={field.name}>
      <FormLabel id={`${id}-label`}>
        <FieldTitle
          source={props.source}
          label={props.label}
          isRequired={isRequired}
        />
      </FormLabel>
      <FormControl>
        <RadioGroup
          value={field.value ?? ""}
          onValueChange={field.onChange}
          onBlur={field.onBlur}
          disabled={props.disabled || props.readOnly}
          aria-labelledby={`${id}-label`}
          className="grid grid-cols-2 gap-2"
        >
          {choices.map((choice, index) => (
            <label
              key={choice.id}
              htmlFor={`${id}-${index}`}
              className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${field.value === choice.id ? "border-primary bg-primary/5 font-medium" : "border-input hover:bg-muted/50"}`}
            >
              <RadioGroupItem id={`${id}-${index}`} value={choice.id} />
              {choice.name}
            </label>
          ))}
        </RadioGroup>
      </FormControl>
      {allowClear &&
      !props.disabled &&
      !props.readOnly &&
      !isRequired &&
      field.value !== "" &&
      field.value != null ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="w-fit"
          onClick={() => {
            field.onChange(null);
            field.onBlur();
          }}
        >
          {translate("ddc.input.clear_choice")}
        </Button>
      ) : null}
      <InputHelperText helperText={props.helperText} />
      <FormError />
    </FormField>
  );
}
