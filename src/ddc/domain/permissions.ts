/**
 * Frontend view of the permission matrix. The database (RLS + ddc_can) is the
 * enforcement point; this module only decides what the interface shows.
 */

export type PermissionAction =
  "read" | "create" | "update" | "delete" | "approve" | "export" | "import";
export type PermissionScope = "all" | "own";

export interface Permission {
  resource: string;
  action: PermissionAction;
  scope: PermissionScope;
}

export interface PermissionSubject {
  salesId: number | string | null;
  administrator: boolean;
  permissions: Permission[];
}

/** react-admin resource name -> permission resource key (see permission_resources). */
export const RESOURCE_PERMISSION_MAP: Record<string, string> = {
  companies: "customers",
  customer_source_rows: "customers",
  customer_fleets: "customers",
  customer_requirements: "customers",
  customer_samples: "customers",
  customer_purchase_history: "customers",
  customer_capacity_profiles: "customers",
  customer_part_usage: "customers",
  companies_summary: "customers",
  company_business_models: "customers",
  company_addresses: "customers",
  company_territories: "customers",
  company_product_interests: "customers",
  contacts: "contacts",
  contacts_summary: "contacts",
  contact_notes: "contacts",
  leads: "leads",
  deals: "opportunities",
  deal_notes: "opportunities",
  deal_products: "opportunities",
  deal_competitors: "opportunities",
  activities: "activities",
  activity_participants: "activities",
  activity_products: "activities",
  activity_photos: "activities",
  action_items: "activities",
  tasks: "tasks",
  products: "products",
  product_hierarchy_nodes: "products",
  manufacturers: "products",
  brands: "products",
  product_specifications: "products",
  product_customer_references: "products",
  product_revisions: "products",
  product_relations: "products",
  machine_models: "machine_applications",
  product_machine_applications: "machine_applications",
  rfqs: "rfqs",
  rfq_items: "rfqs",
  quotations: "quotations",
  quotation_items: "quotations",
  quotation_approvals: "quotations",
  dev_projects: "dev_projects",
  dev_project_requirements: "dev_projects",
  dev_project_milestones: "dev_projects",
  dev_project_samples: "dev_projects",
  dev_project_risks: "dev_projects",
  dealer_networks: "aftermarket",
  dealer_product_coverage: "aftermarket",
  service_cases: "service_cases",
  service_case_products: "service_cases",
  service_case_communications: "service_cases",
  business_models: "master_data",
  territories: "master_data",
  pipelines: "master_data",
  pipeline_stages: "master_data",
  master_options: "master_data",
  custom_field_definitions: "master_data",
  dashboard: "reports",
  erp_sales_orders: "erp_documents",
  erp_sales_order_lines: "erp_documents",
  erp_deliveries: "erp_documents",
  erp_invoices: "erp_documents",
  erp_inventory_availability: "erp_documents",
  erp_price_list_entries: "erp_documents",
  erp_integration: "erp_integration",
  erp_sync_runs: "erp_integration",
  erp_sync_errors: "erp_integration",
  audit_log: "audit_log",
  sales: "users",
  sales_orders: "sales_orders",
  sales_order_items: "sales_orders",
  customer_segments: "master_data",
  company_segments: "customers",
  customer_machines: "customers",
  machine_specifications: "machine_applications",
  price_lists: "products",
  price_list_items: "products",
  sales_targets: "reports",
  sales_forecasts: "reports",
  ui_config_versions: "ui_config",
  feature_flags: "feature_flags",
  releases: "releases",
  deployments: "deployments",
  scheduled_jobs: "jobs",
  backup_records: "backups",
};

/** Resources that only administrators may change, whatever the matrix says. */
const ADMIN_ONLY_WRITE = new Set([
  "sales",
  "configuration",
  "ddc_roles",
  "role_permissions",
  "approval_rules",
  "app_settings",
  "option_categories",
]);

/** Owner column of top-level resources that support the 'own' scope. */
export const OWNER_COLUMN = "sales_id";

const toPermissionAction = (raAction: string): PermissionAction | null => {
  switch (raAction) {
    case "list":
    case "show":
    case "read":
      return "read";
    case "create":
      return "create";
    case "edit":
    case "update":
      return "update";
    case "delete":
      return "delete";
    case "export":
    case "import":
    case "approve":
      return raAction;
    default:
      return null;
  }
};

export interface AccessRequest {
  resource: string;
  action: string;
  record?: Record<string, unknown>;
}

export const canAccessResource = (
  subject: PermissionSubject,
  request: AccessRequest,
): boolean => {
  if (subject.administrator) return true;
  if (ADMIN_ONLY_WRITE.has(request.resource)) {
    return (
      request.resource !== "sales" &&
      toPermissionAction(request.action) === "read"
    );
  }
  const permissionResource =
    RESOURCE_PERMISSION_MAP[request.resource] ?? request.resource;
  const action = toPermissionAction(request.action);
  if (!action) return false;

  const grants = subject.permissions.filter(
    (p) => p.resource === permissionResource && p.action === action,
  );
  if (grants.length === 0) return false;
  if (grants.some((p) => p.scope === "all")) return true;

  // Only 'own' grants: without a record (list screens, buttons) the action is offered,
  // with a record it is limited to the records the user owns.
  if (!request.record) return true;
  const owner = request.record[OWNER_COLUMN];
  return (
    owner !== null &&
    owner !== undefined &&
    String(owner) === String(subject.salesId)
  );
};

export const hasPermission = (
  subject: PermissionSubject,
  resource: string,
  action: PermissionAction,
): boolean =>
  subject.administrator ||
  subject.permissions.some(
    (p) => p.resource === resource && p.action === action,
  );
