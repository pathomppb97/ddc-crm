import { DesignSlots } from "@/ddc/pages/pageDesign";
import { email, required, useGetIdentity, useRecordContext } from "ra-core";
import { BooleanInput } from "@/components/admin/boolean-input";
import { TextInput } from "@/components/admin/text-input";
import { ReferenceInput } from "@/components/admin/reference-input";
import { SelectInput } from "@/components/admin/select-input";
import { useLocalizedName } from "@/ddc/ui/labels";

import type { Sale } from "../types";

export function SalesInputs() {
  const { identity } = useGetIdentity();
  const record = useRecordContext<Sale>();
  const localizedName = useLocalizedName();
  return (
    <div className="space-y-4 w-full">
      <DesignSlots page="sales" panel="form">
        <TextInput
          source="first_name"
          validate={required()}
          helperText={false}
        />
        <TextInput
          source="last_name"
          validate={required()}
          helperText={false}
        />
        <TextInput
          source="email"
          validate={[required(), email()]}
          helperText={false}
        />
        <ReferenceInput
          source="role_key"
          reference="ddc_roles"
          sort={{ field: "sort_order", order: "ASC" }}
        >
          <SelectInput
            optionText={(role: { name?: string; name_en?: string }) =>
              localizedName(role)
            }
            helperText={false}
            readOnly={record?.id === identity?.id}
          />
        </ReferenceInput>
        <BooleanInput
          source="administrator"
          readOnly={record?.id === identity?.id}
          helperText={false}
        />
        <BooleanInput
          source="disabled"
          readOnly={record?.id === identity?.id}
          helperText={false}
        />
      </DesignSlots>
    </div>
  );
}
