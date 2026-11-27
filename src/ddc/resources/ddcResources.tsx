import { Resource } from "ra-core";
import { CustomerDuplicateWarning } from "../features/DuplicateWarning";
import { LeadConvertPanel } from "../features/LeadConvertPanel";
import {
  isQuotationLocked,
  QuotationWorkflowPanel,
} from "../features/QuotationWorkflowPanel";
import { makeImportExportActions } from "../features/SpreadsheetImport";
import {
  makeGenericResource,
  type ResourceExtensions,
} from "../ui/GenericResource";
import { UI_RESOURCE_DEFS } from "./registry";
import { isResourceEnabled } from "../featureFlags";
import { PartImagesForm, PartImagesPanel } from "../features/PartImages";
import { Customer360Panel } from "../features/field/Customer360Panel";
import { CustomerGroupFilterBar } from "../features/field/CustomerGroupFilterBar";

const EXTENSIONS: Record<string, ResourceExtensions> = {
  companies: {
    formExtras: CustomerDuplicateWarning,
    listActions: makeImportExportActions("companies"),
    listAside: <CustomerGroupFilterBar />,
    showPanel: Customer360Panel,
  },
  leads: {
    showPanel: LeadConvertPanel,
    listActions: makeImportExportActions("leads"),
  },
  products: {
    listActions: makeImportExportActions("products"),
    formExtras: PartImagesForm,
    showPanel: PartImagesPanel,
  },
  quotations: {
    showPanel: QuotationWorkflowPanel,
    isLocked: isQuotationLocked,
  },
  quotation_items: {
    // Lines of a submitted quotation are locked by the database as well
    isLocked: () => false,
  },
};

/** Resources whose screens are generated from their definitions. */
export const ddcResourceElements = () =>
  UI_RESOURCE_DEFS.map((def) => (
    <Resource
      key={def.name}
      name={def.name}
      {...makeGenericResource(def, EXTENSIONS[def.name])}
    />
  ));

/** Supporting tables used through references only. */
export const ddcSupportResources = [
  "permission_resources",
  "role_permissions",
  "app_settings",
  "notifications",
  "erp_connector_config",
  "erp_external_ids",
  "configuration",
]
  .filter(isResourceEnabled)
  .map((name) => <Resource key={name} name={name} />);
