import { z } from "zod";
import {
  defaultExecutionPolicyForRisk,
  type AuthPrincipal,
  type DataScopeType,
  type ExecutionPolicy,
  type FieldAccessLevel,
  type RiskLevel,
  type ToolPermissionRequirement,
  type ToolPolicySubject,
} from "../../../packages/shared-auth/src/index";
import type {
  CrmControlServices,
  CrmDomainServices,
  ServiceContext,
  ToolRegistryMetadata,
} from "../../../packages/shared-services/src/index";

export type McpDomain =
  | "identity"
  | "customer_management"
  | "agriculture_equipment"
  | "product_management"
  | "sales_management"
  | "customer_activities"
  | "quotation"
  | "data_management"
  | "analytics_reporting"
  | "administration"
  | "web_design_config"
  | "release_management"
  | "automation";

export interface McpToolExecutionContext {
  principal: AuthPrincipal;
  serviceCtx: ServiceContext;
  domain: CrmDomainServices;
  control: CrmControlServices;
  allowedToolSummaries: Array<{
    toolName: string;
    domain: string;
    riskLevel: RiskLevel;
    executionPolicy: ExecutionPolicy;
  }>;
}

export interface RegisteredMcpTool<
  TInput extends z.ZodTypeAny = z.ZodTypeAny,
> extends ToolPolicySubject {
  toolId: string;
  toolName: string;
  displayName: string;
  description: string;
  domain: McpDomain;
  zodSchema: TInput;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  requiredPermissions: ToolPermissionRequirement[];
  requiredOAuthScopes: string[];
  supportedDataScopes: DataScopeType[];
  fieldRestrictions: Record<string, FieldAccessLevel>;
  riskLevel: RiskLevel;
  executionPolicy: ExecutionPolicy;
  requiresConfirmation: boolean;
  requiresApproval: boolean;
  rateLimitPerMin: number;
  timeoutMs: number;
  requiresIdempotency: boolean;
  toolVersion: string;
  isEnabled: boolean;
  auditPolicy: "minimal" | "standard" | "full";
  handlerRef: string;
  actionLabel: string;
  primaryResource: string;
  execute: (
    args: z.infer<TInput>,
    ctx: McpToolExecutionContext,
  ) => Promise<Record<string, unknown>>;
}

function toJsonSchemaSafe(schema: z.ZodTypeAny): Record<string, unknown> {
  try {
    return z.toJSONSchema(schema) as Record<string, unknown>;
  } catch {
    return { type: "object", properties: {} };
  }
}

function defineTool<TInput extends z.ZodTypeAny>(spec: {
  toolName: string;
  displayName: string;
  description: string;
  domain: McpDomain;
  zodSchema: TInput;
  requiredPermissions: ToolPermissionRequirement[];
  requiredOAuthScopes: string[];
  supportedDataScopes?: DataScopeType[];
  fieldRestrictions?: Record<string, FieldAccessLevel>;
  riskLevel: RiskLevel;
  executionPolicy?: ExecutionPolicy;
  rateLimitPerMin?: number;
  timeoutMs?: number;
  requiresIdempotency?: boolean;
  auditPolicy?: "minimal" | "standard" | "full";
  actionLabel: string;
  primaryResource: string;
  execute: (
    args: z.infer<TInput>,
    ctx: McpToolExecutionContext,
  ) => Promise<Record<string, unknown>>;
}): RegisteredMcpTool<TInput> {
  const executionPolicy =
    spec.executionPolicy ?? defaultExecutionPolicyForRisk(spec.riskLevel);
  return {
    toolId: `ddc.${spec.domain}.${spec.toolName}`,
    toolName: spec.toolName,
    displayName: spec.displayName,
    description: spec.description,
    domain: spec.domain,
    zodSchema: spec.zodSchema,
    inputSchema: toJsonSchemaSafe(spec.zodSchema),
    outputSchema: {
      type: "object",
      properties: {
        ok: { type: "boolean" },
        requestId: { type: "string" },
        data: { type: "object" },
      },
      required: ["ok", "requestId", "data"],
    },
    requiredPermissions: spec.requiredPermissions,
    requiredOAuthScopes: spec.requiredOAuthScopes,
    supportedDataScopes: spec.supportedDataScopes ?? [
      "own",
      "team",
      "territory",
      "all",
    ],
    fieldRestrictions: spec.fieldRestrictions ?? {},
    riskLevel: spec.riskLevel,
    executionPolicy,
    requiresConfirmation: executionPolicy === "confirm",
    requiresApproval:
      executionPolicy === "approve" || executionPolicy === "privileged_approve",
    rateLimitPerMin:
      spec.rateLimitPerMin ?? (spec.riskLevel === "L0" ? 120 : 40),
    timeoutMs: spec.timeoutMs ?? 10_000,
    requiresIdempotency: Boolean(spec.requiresIdempotency),
    toolVersion: "1.0.0",
    isEnabled: true,
    auditPolicy:
      spec.auditPolicy ?? (spec.riskLevel === "L0" ? "standard" : "full"),
    handlerRef: `shared-services:${spec.domain}.${spec.toolName}`,
    actionLabel: spec.actionLabel,
    primaryResource: spec.primaryResource,
    execute: spec.execute,
  };
}

const emptyObj = z.object({}).strict();
const idempotencyField = z
  .string()
  .min(4)
  .max(128)
  .optional()
  .describe("Optional idempotency key to prevent duplicate writes");

/**
 * Explicit server-side allowlist of registered DDC Agriculture CRM MCP Tools.
 *
 * SECURITY INVARIANTS:
 * - No generic SQL, shell, HTTP, or unrestricted admin tools are EVER registered.
 * - Every input schema uses `.strict()` so spoofed identity claims (user_id, role,
 *   organization_id, administrator, permissions) are rejected at schema validation.
 * - Every tool delegates to Shared Business Services with authoritative RBAC & RLS.
 */
export const MCP_TOOL_REGISTRY: readonly RegisteredMcpTool<any>[] = [
  // ==========================================================================
  // 1. Identity (3)
  // ==========================================================================
  defineTool({
    toolName: "get_my_profile",
    displayName: "Get My Profile",
    description:
      "Retrieve the authenticated CRM user's profile, role, territory, and organization derived from verified OAuth credentials.",
    domain: "identity",
    zodSchema: emptyObj,
    requiredPermissions: [],
    requiredOAuthScopes: ["mcp:read"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "identity",
    execute: async (_args, ctx) =>
      ctx.domain.getMyProfile(ctx.principal, ctx.serviceCtx),
  }),
  defineTool({
    toolName: "get_my_capabilities",
    displayName: "Get My Capabilities",
    description:
      "List the authenticated user's effective CRM permissions, granted OAuth scopes, and currently available MCP tools.",
    domain: "identity",
    zodSchema: emptyObj,
    requiredPermissions: [],
    requiredOAuthScopes: ["mcp:read"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "identity",
    execute: async (_args, ctx) =>
      ctx.domain.getMyCapabilities(ctx.principal, ctx.allowedToolSummaries),
  }),
  defineTool({
    toolName: "get_my_data_scope",
    displayName: "Get My Data Scope",
    description:
      "Inspect the authenticated user's organization boundary, team/territory memberships, record scopes, and field restrictions.",
    domain: "identity",
    zodSchema: emptyObj,
    requiredPermissions: [],
    requiredOAuthScopes: ["mcp:read"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "identity",
    execute: async (_args, ctx) => ctx.domain.getMyDataScope(ctx.principal),
  }),

  // ==========================================================================
  // 2. Customer Management (6)
  // ==========================================================================
  defineTool({
    toolName: "search_customers",
    displayName: "Search Customers",
    description:
      "Search agricultural customers (sugar mills, dealers, repair shops, parts shops, farm owners) with pagination and province/group filters.",
    domain: "customer_management",
    zodSchema: z
      .object({
        query: z.string().max(200).optional(),
        province: z.string().max(100).optional(),
        customer_group_code: z
          .enum([
            "sugar_mill",
            "dealer",
            "repair_shop",
            "parts_shop",
            "farm_owner",
          ])
          .optional(),
        page: z.number().int().min(1).max(500).optional(),
        page_size: z.number().int().min(1).max(100).optional(),
        fields: z.array(z.string().max(64)).max(25).optional(),
      })
      .strict(),
    requiredPermissions: [{ resource: "customers", action: "read" }],
    requiredOAuthScopes: ["mcp:read"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "customers",
    execute: async (args, ctx) =>
      ctx.domain.searchCustomers(ctx.principal, ctx.serviceCtx, {
        query: args.query,
        province: args.province,
        customerGroupCode: args.customer_group_code,
        page: args.page,
        pageSize: args.page_size,
        fields: args.fields,
      }),
  }),
  defineTool({
    toolName: "get_customer",
    displayName: "Get Customer",
    description:
      "Retrieve detailed customer master profile and contacts for an authorized customer ID.",
    domain: "customer_management",
    zodSchema: z.object({ customer_id: z.number().int().positive() }).strict(),
    requiredPermissions: [{ resource: "customers", action: "read" }],
    requiredOAuthScopes: ["mcp:read"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "customers",
    execute: async (args, ctx) =>
      ctx.domain.getCustomer(ctx.principal, ctx.serviceCtx, args.customer_id),
  }),
  defineTool({
    toolName: "create_customer",
    displayName: "Create Customer",
    description:
      "Create a new Agriculture CRM customer record after duplicate verification. Never invent missing business data.",
    domain: "customer_management",
    zodSchema: z
      .object({
        name: z.string().min(1).max(200),
        legal_name: z.string().max(200).optional(),
        org_type: z
          .enum(["standalone", "headquarters", "subsidiary", "branch"])
          .optional(),
        province: z.string().max(100).optional(),
        city: z.string().max(100).optional(),
        country: z.string().max(100).optional(),
        address: z.string().max(500).optional(),
        zipcode: z.string().max(20).optional(),
        phone_number: z.string().max(50).optional(),
        email: z.string().email().optional(),
        tax_identifier: z.string().max(50).optional(),
        description: z.string().max(2000).optional(),
        location_note: z.string().max(500).optional(),
        customer_group_id: z.number().int().positive().optional(),
        territory_id: z.number().int().positive().optional(),
        idempotency_key: idempotencyField,
      })
      .strict(),
    requiredPermissions: [{ resource: "customers", action: "create" }],
    requiredOAuthScopes: ["mcp:write"],
    riskLevel: "L1",
    requiresIdempotency: true,
    actionLabel: "create",
    primaryResource: "customers",
    execute: async (args, ctx) => {
      const { idempotency_key, ...payload } = args;
      return ctx.domain.createCustomer(
        ctx.principal,
        {
          ...ctx.serviceCtx,
          idempotencyKey: idempotency_key ?? ctx.serviceCtx.idempotencyKey,
        },
        payload,
      );
    },
  }),
  defineTool({
    toolName: "update_customer",
    displayName: "Update Customer",
    description:
      "Update authorized fields on an existing customer record with optimistic concurrency checking.",
    domain: "customer_management",
    zodSchema: z
      .object({
        customer_id: z.number().int().positive(),
        expected_version: z.number().int().min(1).optional(),
        name: z.string().min(1).max(200).optional(),
        legal_name: z.string().max(200).optional(),
        province: z.string().max(100).optional(),
        city: z.string().max(100).optional(),
        address: z.string().max(500).optional(),
        phone_number: z.string().max(50).optional(),
        email: z.string().email().optional(),
        description: z.string().max(2000).optional(),
        location_note: z.string().max(500).optional(),
        tax_identifier: z.string().max(50).optional(),
        revenue: z.string().max(100).optional(),
      })
      .strict(),
    requiredPermissions: [{ resource: "customers", action: "update" }],
    requiredOAuthScopes: ["mcp:write"],
    riskLevel: "L2",
    actionLabel: "update",
    primaryResource: "customers",
    execute: async (args, ctx) => {
      const { customer_id, expected_version, ...patch } = args;
      return ctx.domain.updateCustomer(
        ctx.principal,
        ctx.serviceCtx,
        customer_id,
        patch,
        expected_version,
      );
    },
  }),
  defineTool({
    toolName: "create_customer_contact",
    displayName: "Create Customer Contact",
    description:
      "Add a contact person (with optional Thai nickname and LINE ID) to an existing customer.",
    domain: "customer_management",
    zodSchema: z
      .object({
        company_id: z.number().int().positive(),
        first_name: z.string().min(1).max(120),
        last_name: z.string().max(120).optional(),
        nickname: z.string().max(80).optional(),
        title: z.string().max(120).optional(),
        department: z.string().max(120).optional(),
        line_id: z.string().max(100).optional(),
        email: z.string().email().optional(),
        phone: z.string().max(50).optional(),
        is_primary: z.boolean().optional(),
      })
      .strict(),
    requiredPermissions: [{ resource: "contacts", action: "create" }],
    requiredOAuthScopes: ["mcp:write"],
    riskLevel: "L1",
    actionLabel: "create",
    primaryResource: "contacts",
    execute: async (args, ctx) =>
      ctx.domain.createCustomerContact(ctx.principal, ctx.serviceCtx, args),
  }),
  defineTool({
    toolName: "get_customer_history",
    displayName: "Get Customer History",
    description:
      "Retrieve chronological visit activities, opportunities, quotations, and service cases for a customer.",
    domain: "customer_management",
    zodSchema: z
      .object({
        customer_id: z.number().int().positive(),
        limit: z.number().int().min(1).max(100).optional(),
      })
      .strict(),
    requiredPermissions: [{ resource: "customers", action: "read" }],
    requiredOAuthScopes: ["mcp:read"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "customers",
    execute: async (args, ctx) =>
      ctx.domain.getCustomerHistory(
        ctx.principal,
        ctx.serviceCtx,
        args.customer_id,
        args.limit,
      ),
  }),

  // ==========================================================================
  // 3. Agriculture Equipment (7)
  // ==========================================================================
  defineTool({
    toolName: "search_machines",
    displayName: "Search Agricultural Machines",
    description:
      "Search agricultural machinery models (sugarcane harvesters, tractors, implements) by model name, manufacturer, or customer ownership.",
    domain: "agriculture_equipment",
    zodSchema: z
      .object({
        query: z.string().max(200).optional(),
        manufacturer_name: z.string().max(120).optional(),
        company_id: z.number().int().positive().optional(),
        page: z.number().int().min(1).optional(),
        page_size: z.number().int().min(1).max(100).optional(),
      })
      .strict(),
    requiredPermissions: [{ resource: "machine_applications", action: "read" }],
    requiredOAuthScopes: ["mcp:read"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "machine_applications",
    execute: async (args, ctx) =>
      ctx.domain.searchMachines(ctx.principal, ctx.serviceCtx, {
        query: args.query,
        manufacturerName: args.manufacturer_name,
        companyId: args.company_id,
        page: args.page,
        pageSize: args.page_size,
      }),
  }),
  defineTool({
    toolName: "get_machine",
    displayName: "Get Registered Machine",
    description:
      "Retrieve details and technical specifications for a customer-owned agricultural machine.",
    domain: "agriculture_equipment",
    zodSchema: z.object({ machine_id: z.number().int().positive() }).strict(),
    requiredPermissions: [{ resource: "customers", action: "read" }],
    requiredOAuthScopes: ["mcp:read"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "customers",
    execute: async (args, ctx) =>
      ctx.domain.getMachine(ctx.principal, ctx.serviceCtx, args.machine_id),
  }),
  defineTool({
    toolName: "register_machine",
    displayName: "Register Customer Machine",
    description:
      "Register an agricultural machine owned or operated by a customer. Never invent serial numbers.",
    domain: "agriculture_equipment",
    zodSchema: z
      .object({
        company_id: z.number().int().positive(),
        machine_model_id: z.number().int().positive(),
        serial_number: z.string().max(120).optional(),
        unit_count: z.number().int().min(1).max(10000).optional(),
        model_year: z.number().int().min(1950).max(2200).optional(),
        operating_hours: z.number().min(0).optional(),
        status: z
          .enum(["active", "seasonal_idle", "under_repair", "retired"])
          .optional(),
        location_note: z.string().max(300).optional(),
        notes: z.string().max(1000).optional(),
      })
      .strict(),
    requiredPermissions: [{ resource: "customers", action: "create" }],
    requiredOAuthScopes: ["mcp:write"],
    riskLevel: "L1",
    actionLabel: "create",
    primaryResource: "customers",
    execute: async (args, ctx) =>
      ctx.domain.registerMachine(ctx.principal, ctx.serviceCtx, args),
  }),
  defineTool({
    toolName: "update_machine",
    displayName: "Update Customer Machine",
    description:
      "Update operating hours, status, or notes on a registered customer machine.",
    domain: "agriculture_equipment",
    zodSchema: z
      .object({
        machine_id: z.number().int().positive(),
        expected_version: z.number().int().min(1).optional(),
        serial_number: z.string().max(120).optional(),
        unit_count: z.number().int().min(1).optional(),
        model_year: z.number().int().min(1950).max(2200).optional(),
        operating_hours: z.number().min(0).optional(),
        status: z
          .enum(["active", "seasonal_idle", "under_repair", "retired"])
          .optional(),
        location_note: z.string().max(300).optional(),
        notes: z.string().max(1000).optional(),
      })
      .strict(),
    requiredPermissions: [{ resource: "customers", action: "update" }],
    requiredOAuthScopes: ["mcp:write"],
    riskLevel: "L2",
    actionLabel: "update",
    primaryResource: "customers",
    execute: async (args, ctx) => {
      const { machine_id, expected_version, ...patch } = args;
      return ctx.domain.updateMachine(
        ctx.principal,
        ctx.serviceCtx,
        machine_id,
        patch,
        expected_version,
      );
    },
  }),
  defineTool({
    toolName: "get_customer_machines",
    displayName: "Get Customer Machines",
    description:
      "List all registered agricultural machines belonging to a customer.",
    domain: "agriculture_equipment",
    zodSchema: z.object({ company_id: z.number().int().positive() }).strict(),
    requiredPermissions: [{ resource: "customers", action: "read" }],
    requiredOAuthScopes: ["mcp:read"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "customers",
    execute: async (args, ctx) =>
      ctx.domain.getCustomerMachines(
        ctx.principal,
        ctx.serviceCtx,
        args.company_id,
      ),
  }),
  defineTool({
    toolName: "get_machine_summary",
    displayName: "Get Machine Fleet Summary",
    description:
      "Summarize registered customer agricultural machines grouped by status and model.",
    domain: "agriculture_equipment",
    zodSchema: emptyObj,
    requiredPermissions: [{ resource: "customers", action: "read" }],
    requiredOAuthScopes: ["mcp:read"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "customers",
    execute: async (_args, ctx) =>
      ctx.domain.getMachineSummary(ctx.principal, ctx.serviceCtx),
  }),
  defineTool({
    toolName: "get_machine_service_history",
    displayName: "Get Machine Service History",
    description:
      "Retrieve related service cases and field visits for a registered customer machine.",
    domain: "agriculture_equipment",
    zodSchema: z.object({ machine_id: z.number().int().positive() }).strict(),
    requiredPermissions: [{ resource: "service_cases", action: "read" }],
    requiredOAuthScopes: ["mcp:read"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "service_cases",
    execute: async (args, ctx) =>
      ctx.domain.getMachineServiceHistory(
        ctx.principal,
        ctx.serviceCtx,
        args.machine_id,
      ),
  }),

  // ==========================================================================
  // 4. Product Management (5)
  // ==========================================================================
  defineTool({
    toolName: "search_products",
    displayName: "Search Products",
    description:
      "Search DDC agricultural spare parts (basecutter blades, chopper blades, sprockets, drive components).",
    domain: "product_management",
    zodSchema: z
      .object({
        query: z.string().max(200).optional(),
        material: z.string().max(100).optional(),
        page: z.number().int().min(1).optional(),
        page_size: z.number().int().min(1).max(100).optional(),
      })
      .strict(),
    requiredPermissions: [{ resource: "products", action: "read" }],
    requiredOAuthScopes: ["mcp:read"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "products",
    execute: async (args, ctx) =>
      ctx.domain.searchProducts(ctx.principal, ctx.serviceCtx, {
        query: args.query,
        material: args.material,
        page: args.page,
        pageSize: args.page_size,
      }),
  }),
  defineTool({
    toolName: "get_product",
    displayName: "Get Product Details",
    description:
      "Retrieve full product details and verified technical specifications by product ID.",
    domain: "product_management",
    zodSchema: z.object({ product_id: z.number().int().positive() }).strict(),
    requiredPermissions: [{ resource: "products", action: "read" }],
    requiredOAuthScopes: ["mcp:read"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "products",
    execute: async (args, ctx) =>
      ctx.domain.getProduct(ctx.principal, ctx.serviceCtx, args.product_id),
  }),
  defineTool({
    toolName: "find_compatible_parts",
    displayName: "Find Compatible Parts",
    description:
      "Find agricultural replacement parts compatible with a machine model. Defaults to verified engineering fitment evidence only.",
    domain: "product_management",
    zodSchema: z
      .object({
        machine_model_id: z.number().int().positive().optional(),
        machine_model_query: z.string().max(120).optional(),
        verified_only: z.boolean().optional(),
      })
      .strict(),
    requiredPermissions: [
      { resource: "machine_applications", action: "read" },
      { resource: "products", action: "read" },
    ],
    requiredOAuthScopes: ["mcp:read"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "machine_applications",
    execute: async (args, ctx) =>
      ctx.domain.findCompatibleParts(ctx.principal, ctx.serviceCtx, {
        machineModelId: args.machine_model_id,
        machineModelQuery: args.machine_model_query,
        verifiedOnly: args.verified_only,
      }),
  }),
  defineTool({
    toolName: "get_product_price",
    displayName: "Get Product Price",
    description:
      "Look up active CRM price list entries for a product and quantity. Never invent prices if none exist.",
    domain: "product_management",
    zodSchema: z
      .object({
        product_id: z.number().int().positive(),
        quantity: z.number().positive().optional(),
        currency: z.string().length(3).optional(),
      })
      .strict(),
    requiredPermissions: [{ resource: "products", action: "read" }],
    requiredOAuthScopes: ["mcp:read"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "products",
    execute: async (args, ctx) =>
      ctx.domain.getProductPrice(ctx.principal, ctx.serviceCtx, {
        productId: args.product_id,
        quantity: args.quantity,
        currency: args.currency,
      }),
  }),
  defineTool({
    toolName: "get_inventory_availability",
    displayName: "Get Inventory Availability",
    description:
      "Read synchronized ERP warehouse inventory availability for a product (requires erp_documents:read).",
    domain: "product_management",
    zodSchema: z.object({ product_id: z.number().int().positive() }).strict(),
    requiredPermissions: [{ resource: "erp_documents", action: "read" }],
    requiredOAuthScopes: ["mcp:read"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "erp_documents",
    execute: async (args, ctx) =>
      ctx.domain.getInventoryAvailability(
        ctx.principal,
        ctx.serviceCtx,
        args.product_id,
      ),
  }),

  // ==========================================================================
  // 5. Sales Management (6)
  // ==========================================================================
  defineTool({
    toolName: "search_opportunities",
    displayName: "Search Sales Opportunities",
    description:
      "Search sales opportunities (deals) by name, customer, or pipeline stage.",
    domain: "sales_management",
    zodSchema: z
      .object({
        query: z.string().max(200).optional(),
        stage: z.string().max(64).optional(),
        company_id: z.number().int().positive().optional(),
        page: z.number().int().min(1).optional(),
        page_size: z.number().int().min(1).max(100).optional(),
      })
      .strict(),
    requiredPermissions: [{ resource: "opportunities", action: "read" }],
    requiredOAuthScopes: ["mcp:read"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "opportunities",
    execute: async (args, ctx) =>
      ctx.domain.searchOpportunities(ctx.principal, ctx.serviceCtx, {
        query: args.query,
        stage: args.stage,
        companyId: args.company_id,
        page: args.page,
        pageSize: args.page_size,
      }),
  }),
  defineTool({
    toolName: "create_opportunity",
    displayName: "Create Sales Opportunity",
    description:
      "Create a new sales opportunity linked to an existing customer.",
    domain: "sales_management",
    zodSchema: z
      .object({
        name: z.string().min(1).max(200),
        company_id: z.number().int().positive(),
        stage: z.string().max(64).optional(),
        amount: z.number().min(0).optional(),
        currency: z.string().length(3).optional(),
        probability: z.number().int().min(0).max(100).optional(),
        expected_closing_date: z.string().max(32).optional(),
        description: z.string().max(2000).optional(),
        follow_up_date: z.string().max(32).optional(),
        idempotency_key: idempotencyField,
      })
      .strict(),
    requiredPermissions: [{ resource: "opportunities", action: "create" }],
    requiredOAuthScopes: ["mcp:write"],
    riskLevel: "L1",
    requiresIdempotency: true,
    actionLabel: "create",
    primaryResource: "opportunities",
    execute: async (args, ctx) => {
      const { idempotency_key, ...payload } = args;
      return ctx.domain.createOpportunity(
        ctx.principal,
        {
          ...ctx.serviceCtx,
          idempotencyKey: idempotency_key ?? ctx.serviceCtx.idempotencyKey,
        },
        payload,
      );
    },
  }),
  defineTool({
    toolName: "update_opportunity",
    displayName: "Update Sales Opportunity",
    description:
      "Update stage, estimated amount, probability, or follow-up date on an authorized opportunity.",
    domain: "sales_management",
    zodSchema: z
      .object({
        opportunity_id: z.number().int().positive(),
        expected_version: z.number().int().min(1).optional(),
        name: z.string().min(1).max(200).optional(),
        stage: z.string().max(64).optional(),
        amount: z.number().min(0).optional(),
        currency: z.string().length(3).optional(),
        probability: z.number().int().min(0).max(100).optional(),
        expected_closing_date: z.string().max(32).optional(),
        description: z.string().max(2000).optional(),
        follow_up_date: z.string().max(32).optional(),
      })
      .strict(),
    requiredPermissions: [{ resource: "opportunities", action: "update" }],
    requiredOAuthScopes: ["mcp:write"],
    riskLevel: "L2",
    actionLabel: "update",
    primaryResource: "opportunities",
    execute: async (args, ctx) => {
      const { opportunity_id, expected_version, ...patch } = args;
      return ctx.domain.updateOpportunity(
        ctx.principal,
        ctx.serviceCtx,
        opportunity_id,
        patch,
        expected_version,
      );
    },
  }),
  defineTool({
    toolName: "get_sales_pipeline",
    displayName: "Get Sales Pipeline",
    description:
      "Aggregate open sales opportunities by stage and estimated opportunity value.",
    domain: "sales_management",
    zodSchema: emptyObj,
    requiredPermissions: [{ resource: "opportunities", action: "read" }],
    requiredOAuthScopes: ["mcp:read"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "opportunities",
    execute: async (_args, ctx) =>
      ctx.domain.getSalesPipeline(ctx.principal, ctx.serviceCtx),
  }),
  defineTool({
    toolName: "get_sales_target",
    displayName: "Get Sales Target",
    description: "Retrieve configured sales targets by period or salesperson.",
    domain: "sales_management",
    zodSchema: z
      .object({
        sales_id: z.number().int().positive().optional(),
        period_type: z
          .enum(["monthly", "quarterly", "seasonal", "annual"])
          .optional(),
      })
      .strict(),
    requiredPermissions: [{ resource: "reports", action: "read" }],
    requiredOAuthScopes: ["mcp:read"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "reports",
    execute: async (args, ctx) =>
      ctx.domain.getSalesTarget(ctx.principal, ctx.serviceCtx, {
        salesId: args.sales_id,
        periodType: args.period_type,
      }),
  }),
  defineTool({
    toolName: "get_sales_forecast",
    displayName: "Get Sales Forecast",
    description:
      "Retrieve sales forecast records (committed, best-case, pipeline).",
    domain: "sales_management",
    zodSchema: emptyObj,
    requiredPermissions: [{ resource: "reports", action: "read" }],
    requiredOAuthScopes: ["mcp:read"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "reports",
    execute: async (_args, ctx) =>
      ctx.domain.getSalesForecast(ctx.principal, ctx.serviceCtx),
  }),

  // ==========================================================================
  // 6. Customer Activities (5)
  // ==========================================================================
  defineTool({
    toolName: "create_visit_report",
    displayName: "Create Visit Report",
    description:
      "Record a field sales customer visit report with discussion, outcome, GPS coordinates, and next follow-up date.",
    domain: "customer_activities",
    zodSchema: z
      .object({
        company_id: z.number().int().positive(),
        subject: z.string().min(1).max(200),
        start_at: z.string().max(64).optional(),
        location: z.string().max(200).optional(),
        objective: z.string().max(500).optional(),
        discussion: z.string().max(4000).optional(),
        outcome: z.string().max(2000).optional(),
        follow_up_date: z.string().max(32).optional(),
        activity_type_code: z.string().max(64).optional(),
        checkin_lat: z.number().min(-90).max(90).optional(),
        checkin_lng: z.number().min(-180).max(180).optional(),
      })
      .strict(),
    requiredPermissions: [{ resource: "activities", action: "create" }],
    requiredOAuthScopes: ["mcp:write"],
    riskLevel: "L1",
    actionLabel: "create",
    primaryResource: "activities",
    execute: async (args, ctx) =>
      ctx.domain.createVisitReport(ctx.principal, ctx.serviceCtx, args),
  }),
  defineTool({
    toolName: "get_visit_history",
    displayName: "Get Visit History",
    description: "Retrieve chronological customer visit history.",
    domain: "customer_activities",
    zodSchema: z
      .object({
        company_id: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      })
      .strict(),
    requiredPermissions: [{ resource: "activities", action: "read" }],
    requiredOAuthScopes: ["mcp:read"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "activities",
    execute: async (args, ctx) =>
      ctx.domain.getVisitHistory(ctx.principal, ctx.serviceCtx, {
        companyId: args.company_id,
        limit: args.limit,
      }),
  }),
  defineTool({
    toolName: "create_follow_up",
    displayName: "Create Follow-Up",
    description: "Create an open follow-up action item for a customer.",
    domain: "customer_activities",
    zodSchema: z
      .object({
        company_id: z.number().int().positive(),
        description: z.string().min(1).max(1000),
        due_date: z.string().max(32).optional(),
        activity_id: z.number().int().positive().optional(),
      })
      .strict(),
    requiredPermissions: [{ resource: "activities", action: "create" }],
    requiredOAuthScopes: ["mcp:write"],
    riskLevel: "L1",
    actionLabel: "create",
    primaryResource: "activities",
    execute: async (args, ctx) =>
      ctx.domain.createFollowUp(ctx.principal, ctx.serviceCtx, args),
  }),
  defineTool({
    toolName: "schedule_follow_up",
    displayName: "Schedule Follow-Up",
    description:
      "Set or reschedule the due date on an authorized follow-up action item.",
    domain: "customer_activities",
    zodSchema: z
      .object({
        follow_up_id: z.number().int().positive(),
        due_date: z.string().min(8).max(32),
      })
      .strict(),
    requiredPermissions: [{ resource: "activities", action: "update" }],
    requiredOAuthScopes: ["mcp:write"],
    riskLevel: "L2",
    actionLabel: "update",
    primaryResource: "activities",
    execute: async (args, ctx) =>
      ctx.domain.scheduleFollowUp(
        ctx.principal,
        ctx.serviceCtx,
        args.follow_up_id,
        args.due_date,
      ),
  }),
  defineTool({
    toolName: "complete_follow_up",
    displayName: "Complete Follow-Up",
    description: "Mark an authorized follow-up action item as completed.",
    domain: "customer_activities",
    zodSchema: z.object({ follow_up_id: z.number().int().positive() }).strict(),
    requiredPermissions: [{ resource: "activities", action: "update" }],
    requiredOAuthScopes: ["mcp:write"],
    riskLevel: "L2",
    actionLabel: "update",
    primaryResource: "activities",
    execute: async (args, ctx) =>
      ctx.domain.completeFollowUp(
        ctx.principal,
        ctx.serviceCtx,
        args.follow_up_id,
      ),
  }),

  // ==========================================================================
  // 7. Quotation (4)
  // ==========================================================================
  defineTool({
    toolName: "create_quotation",
    displayName: "Create Quotation Draft",
    description:
      "Create a new draft quotation with line items for an authorized customer. Always created in draft status.",
    domain: "quotation",
    zodSchema: z
      .object({
        company_id: z.number().int().positive(),
        subject: z.string().min(1).max(200),
        contact_id: z.number().int().positive().optional(),
        deal_id: z.number().int().positive().optional(),
        rfq_id: z.number().int().positive().optional(),
        currency: z.string().length(3).optional(),
        valid_until: z.string().max(32).optional(),
        payment_terms: z.string().max(300).optional(),
        delivery_terms: z.string().max(300).optional(),
        notes: z.string().max(2000).optional(),
        items: z
          .array(
            z
              .object({
                product_id: z.number().int().positive().optional(),
                description: z.string().max(500).optional(),
                quantity: z.number().positive(),
                uom: z.string().max(32).optional(),
                unit_price: z.number().min(0),
                discount_percent: z.number().min(0).max(100).optional(),
              })
              .strict(),
          )
          .max(100)
          .optional(),
        idempotency_key: idempotencyField,
      })
      .strict(),
    requiredPermissions: [{ resource: "quotations", action: "create" }],
    requiredOAuthScopes: ["mcp:write"],
    riskLevel: "L1",
    requiresIdempotency: true,
    actionLabel: "create",
    primaryResource: "quotations",
    execute: async (args, ctx) => {
      const { idempotency_key, ...payload } = args;
      return ctx.domain.createQuotation(
        ctx.principal,
        {
          ...ctx.serviceCtx,
          idempotencyKey: idempotency_key ?? ctx.serviceCtx.idempotencyKey,
        },
        payload,
      );
    },
  }),
  defineTool({
    toolName: "update_quotation_draft",
    displayName: "Update Quotation Draft",
    description:
      "Update commercial notes, terms, or validity on an editable draft/rejected quotation.",
    domain: "quotation",
    zodSchema: z
      .object({
        quotation_id: z.number().int().positive(),
        expected_version: z.number().int().min(1).optional(),
        subject: z.string().min(1).max(200).optional(),
        valid_until: z.string().max(32).optional(),
        payment_terms: z.string().max(300).optional(),
        delivery_terms: z.string().max(300).optional(),
        notes: z.string().max(2000).optional(),
        follow_up_date: z.string().max(32).optional(),
      })
      .strict(),
    requiredPermissions: [{ resource: "quotations", action: "update" }],
    requiredOAuthScopes: ["mcp:write"],
    riskLevel: "L2",
    actionLabel: "update",
    primaryResource: "quotations",
    execute: async (args, ctx) => {
      const { quotation_id, expected_version, ...patch } = args;
      return ctx.domain.updateQuotationDraft(
        ctx.principal,
        ctx.serviceCtx,
        quotation_id,
        patch,
        expected_version,
      );
    },
  }),
  defineTool({
    toolName: "get_quotation",
    displayName: "Get Quotation",
    description: "Retrieve a quotation with its line items and approval trail.",
    domain: "quotation",
    zodSchema: z.object({ quotation_id: z.number().int().positive() }).strict(),
    requiredPermissions: [{ resource: "quotations", action: "read" }],
    requiredOAuthScopes: ["mcp:read"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "quotations",
    execute: async (args, ctx) =>
      ctx.domain.getQuotation(ctx.principal, ctx.serviceCtx, args.quotation_id),
  }),
  defineTool({
    toolName: "submit_quotation_for_approval",
    displayName: "Submit Quotation for Approval",
    description:
      "Submit a draft quotation with at least one line item into the database-enforced commercial approval workflow.",
    domain: "quotation",
    zodSchema: z.object({ quotation_id: z.number().int().positive() }).strict(),
    requiredPermissions: [{ resource: "quotations", action: "update" }],
    requiredOAuthScopes: ["mcp:write"],
    riskLevel: "L2",
    actionLabel: "update",
    primaryResource: "quotations",
    execute: async (args, ctx) =>
      ctx.domain.submitQuotationForApproval(
        ctx.principal,
        ctx.serviceCtx,
        args.quotation_id,
      ),
  }),

  // ==========================================================================
  // 8. Data Management (6)
  // ==========================================================================
  defineTool({
    toolName: "validate_import",
    displayName: "Validate Data Import",
    description:
      "Validate rows for bulk import (companies, contacts, products) and issue a payload-bound confirmation token when valid.",
    domain: "data_management",
    zodSchema: z
      .object({
        resource: z.enum(["companies", "contacts", "products"]),
        rows: z.array(z.record(z.string(), z.unknown())).min(1).max(500),
      })
      .strict(),
    requiredPermissions: [{ resource: "customers", action: "import" }],
    requiredOAuthScopes: ["mcp:write"],
    riskLevel: "L0",
    actionLabel: "import",
    primaryResource: "data_management",
    execute: async (args, ctx) =>
      ctx.control.validateImport(ctx.principal, ctx.serviceCtx, args),
  }),
  defineTool({
    toolName: "preview_bulk_update",
    displayName: "Preview Bulk Update",
    description:
      "Preview before/after records for an allowlisted bulk update and issue a confirmation token.",
    domain: "data_management",
    zodSchema: z
      .object({
        resource: z.enum(["companies", "deals"]),
        record_ids: z.array(z.number().int().positive()).min(1).max(100),
        patch: z.record(z.string(), z.unknown()),
      })
      .strict(),
    requiredPermissions: [{ resource: "data_management", action: "read" }],
    requiredOAuthScopes: ["mcp:write"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "data_management",
    execute: async (args, ctx) =>
      ctx.control.previewBulkUpdate(ctx.principal, ctx.serviceCtx, {
        resource: args.resource,
        recordIds: args.record_ids,
        patch: args.patch,
      }),
  }),
  defineTool({
    toolName: "execute_approved_import",
    displayName: "Execute Approved Import",
    description:
      "Enqueue a validated bulk import job (L3: requires confirmation_token from validate_import).",
    domain: "data_management",
    zodSchema: z
      .object({
        resource: z.enum(["companies", "contacts", "products"]),
        rows: z.array(z.record(z.string(), z.unknown())).min(1).max(500),
        confirmation_token: z.string().min(8).optional(),
        idempotency_key: idempotencyField,
      })
      .strict(),
    requiredPermissions: [{ resource: "customers", action: "import" }],
    requiredOAuthScopes: ["mcp:write"],
    riskLevel: "L3",
    requiresIdempotency: true,
    actionLabel: "import",
    primaryResource: "data_management",
    execute: async (args, ctx) =>
      ctx.control.executeApprovedImport(
        ctx.principal,
        { ...ctx.serviceCtx, idempotencyKey: args.idempotency_key },
        args,
      ),
  }),
  defineTool({
    toolName: "execute_approved_bulk_update",
    displayName: "Execute Approved Bulk Update",
    description:
      "Enqueue a confirmed bulk update job (L3: requires confirmation_token matching preview_bulk_update).",
    domain: "data_management",
    zodSchema: z
      .object({
        resource: z.enum(["companies", "deals"]),
        record_ids: z.array(z.number().int().positive()).min(1).max(100),
        patch: z.record(z.string(), z.unknown()),
        confirmation_token: z.string().min(8).optional(),
        idempotency_key: idempotencyField,
      })
      .strict(),
    requiredPermissions: [{ resource: "data_management", action: "update" }],
    requiredOAuthScopes: ["mcp:write"],
    riskLevel: "L3",
    requiresIdempotency: true,
    actionLabel: "update",
    primaryResource: "data_management",
    execute: async (args, ctx) =>
      ctx.control.executeApprovedBulkUpdate(
        ctx.principal,
        { ...ctx.serviceCtx, idempotencyKey: args.idempotency_key },
        {
          resource: args.resource,
          recordIds: args.record_ids,
          patch: args.patch,
          confirmation_token: args.confirmation_token,
        },
      ),
  }),
  defineTool({
    toolName: "generate_export",
    displayName: "Generate Data Export",
    description:
      "Queue an authorized, field-masked data export job (L3: requires export permission and confirmation for >50 rows).",
    domain: "data_management",
    zodSchema: z
      .object({
        resource: z.string().min(1).max(64),
        format: z.enum(["csv", "json"]).optional(),
        max_rows: z.number().int().min(1).max(1000).optional(),
        confirmation_token: z.string().min(8).optional(),
        idempotency_key: idempotencyField,
      })
      .strict(),
    requiredPermissions: [{ resource: "customers", action: "export" }],
    requiredOAuthScopes: ["mcp:export"],
    riskLevel: "L3",
    requiresIdempotency: true,
    actionLabel: "export",
    primaryResource: "customers",
    execute: async (args, ctx) =>
      ctx.control.generateExport(
        ctx.principal,
        { ...ctx.serviceCtx, idempotencyKey: args.idempotency_key },
        {
          resource: args.resource,
          format: args.format,
          maxRows: args.max_rows,
          confirmation_token: args.confirmation_token,
        },
      ),
  }),
  defineTool({
    toolName: "get_job_status",
    displayName: "Get Job Status",
    description:
      "Check status, attempts, and sanitized result of an authorized background job.",
    domain: "data_management",
    zodSchema: z.object({ job_id: z.number().int().positive() }).strict(),
    requiredPermissions: [],
    requiredOAuthScopes: ["mcp:read"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "jobs",
    execute: async (args, ctx) =>
      ctx.control.getJobStatus(ctx.principal, ctx.serviceCtx, args.job_id),
  }),

  // ==========================================================================
  // 9. Analytics & Reporting (6)
  // ==========================================================================
  defineTool({
    toolName: "query_customer_summary",
    displayName: "Query Customer Summary",
    description:
      "Aggregate customer totals by Agriculture customer group and province.",
    domain: "analytics_reporting",
    zodSchema: emptyObj,
    requiredPermissions: [
      { resource: "reports", action: "read" },
      { resource: "customers", action: "read" },
    ],
    requiredOAuthScopes: ["mcp:read"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "reports",
    execute: async (_args, ctx) =>
      ctx.control.queryCustomerSummary(ctx.principal, ctx.serviceCtx),
  }),
  defineTool({
    toolName: "query_machine_summary",
    displayName: "Query Machine Summary",
    description:
      "Aggregate agricultural machinery fleets by manufacturer and model.",
    domain: "analytics_reporting",
    zodSchema: emptyObj,
    requiredPermissions: [
      { resource: "reports", action: "read" },
      { resource: "customers", action: "read" },
    ],
    requiredOAuthScopes: ["mcp:read"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "reports",
    execute: async (_args, ctx) =>
      ctx.control.queryMachineSummary(ctx.principal, ctx.serviceCtx),
  }),
  defineTool({
    toolName: "query_sales_summary",
    displayName: "Query Sales Summary",
    description:
      "Aggregate sales opportunities by stage and quotations by approval status.",
    domain: "analytics_reporting",
    zodSchema: emptyObj,
    requiredPermissions: [
      { resource: "reports", action: "read" },
      { resource: "opportunities", action: "read" },
    ],
    requiredOAuthScopes: ["mcp:read"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "reports",
    execute: async (_args, ctx) =>
      ctx.control.querySalesSummary(ctx.principal, ctx.serviceCtx),
  }),
  defineTool({
    toolName: "query_replacement_demand",
    displayName: "Query Replacement Demand",
    description:
      "Analyze seasonal agricultural wear-part replacement demand from recorded customer usage profiles.",
    domain: "analytics_reporting",
    zodSchema: z
      .object({ company_id: z.number().int().positive().optional() })
      .strict(),
    requiredPermissions: [
      { resource: "reports", action: "read" },
      { resource: "customers", action: "read" },
    ],
    requiredOAuthScopes: ["mcp:read"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "reports",
    execute: async (args, ctx) =>
      ctx.control.queryReplacementDemand(
        ctx.principal,
        ctx.serviceCtx,
        args.company_id,
      ),
  }),
  defineTool({
    toolName: "generate_report",
    displayName: "Generate Saved Report",
    description:
      "Generate and persist a structured CRM analytics snapshot report.",
    domain: "analytics_reporting",
    zodSchema: z
      .object({
        report_type: z.enum([
          "customer_summary",
          "machine_summary",
          "sales_summary",
          "replacement_demand",
        ]),
        title: z.string().max(200).optional(),
        is_shared: z.boolean().optional(),
      })
      .strict(),
    requiredPermissions: [{ resource: "reports", action: "read" }],
    requiredOAuthScopes: ["mcp:read"],
    riskLevel: "L1",
    actionLabel: "create",
    primaryResource: "reports",
    execute: async (args, ctx) =>
      ctx.control.generateReport(ctx.principal, ctx.serviceCtx, args),
  }),
  defineTool({
    toolName: "get_saved_report",
    displayName: "Get Saved Report",
    description: "Retrieve a previously generated saved report by ID.",
    domain: "analytics_reporting",
    zodSchema: z.object({ report_id: z.number().int().positive() }).strict(),
    requiredPermissions: [{ resource: "reports", action: "read" }],
    requiredOAuthScopes: ["mcp:read"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "reports",
    execute: async (args, ctx) =>
      ctx.control.getSavedReport(ctx.principal, ctx.serviceCtx, args.report_id),
  }),

  // ==========================================================================
  // 10. Administration (7)
  // ==========================================================================
  defineTool({
    toolName: "get_users",
    displayName: "List CRM Users",
    description: "List CRM user accounts in the organization (Admin only).",
    domain: "administration",
    zodSchema: emptyObj,
    requiredPermissions: [{ resource: "users", action: "read" }],
    requiredOAuthScopes: ["mcp:admin"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "users",
    execute: async (_args, ctx) =>
      ctx.control.getUsers(ctx.principal, ctx.serviceCtx),
  }),
  defineTool({
    toolName: "invite_user",
    displayName: "Invite CRM User",
    description:
      "Request or execute an approved user invitation (L4: requires human administrator approval).",
    domain: "administration",
    zodSchema: z
      .object({
        email: z.string().email(),
        first_name: z.string().min(1).max(100),
        last_name: z.string().min(1).max(100),
        role_key: z.string().min(1).max(64),
        approval_id: z.number().int().positive().optional(),
      })
      .strict(),
    requiredPermissions: [{ resource: "users", action: "create" }],
    requiredOAuthScopes: ["mcp:admin"],
    riskLevel: "L4",
    actionLabel: "create",
    primaryResource: "users",
    execute: async (args, ctx) =>
      ctx.control.inviteUser(ctx.principal, ctx.serviceCtx, args),
  }),
  defineTool({
    toolName: "update_user_status",
    displayName: "Update User Status",
    description:
      "Request or execute an approved user suspension/activation (L4: requires independent human approval; self-modification forbidden).",
    domain: "administration",
    zodSchema: z
      .object({
        target_sales_id: z.number().int().positive(),
        disabled: z.boolean(),
        reason: z.string().min(5).max(500),
        approval_id: z.number().int().positive().optional(),
      })
      .strict(),
    requiredPermissions: [{ resource: "users", action: "update" }],
    requiredOAuthScopes: ["mcp:admin"],
    riskLevel: "L4",
    actionLabel: "update",
    primaryResource: "users",
    execute: async (args, ctx) =>
      ctx.control.updateUserStatus(ctx.principal, ctx.serviceCtx, args),
  }),
  defineTool({
    toolName: "get_roles",
    displayName: "List Roles",
    description: "List configured DDC CRM roles.",
    domain: "administration",
    zodSchema: emptyObj,
    requiredPermissions: [{ resource: "roles", action: "read" }],
    requiredOAuthScopes: ["mcp:admin"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "roles",
    execute: async (_args, ctx) =>
      ctx.control.getRoles(ctx.principal, ctx.serviceCtx),
  }),
  defineTool({
    toolName: "get_permissions",
    displayName: "List Role Permissions",
    description:
      "Inspect role permission grants (optionally filtered by role_key).",
    domain: "administration",
    zodSchema: z.object({ role_key: z.string().max(64).optional() }).strict(),
    requiredPermissions: [{ resource: "roles", action: "read" }],
    requiredOAuthScopes: ["mcp:admin"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "roles",
    execute: async (args, ctx) =>
      ctx.control.getPermissions(ctx.principal, ctx.serviceCtx, args.role_key),
  }),
  defineTool({
    toolName: "request_permission_change",
    displayName: "Request Permission Change",
    description:
      "Submit an audited L4 approval request to modify a role permission (AI cannot directly grant or self-approve permissions).",
    domain: "administration",
    zodSchema: z
      .object({
        role_key: z.string().min(1).max(64),
        resource: z.string().min(1).max(64),
        action: z.enum([
          "read",
          "create",
          "update",
          "delete",
          "approve",
          "export",
          "import",
        ]),
        scope: z.enum(["all", "own"]),
        operation: z.enum(["grant", "revoke"]),
        reason: z.string().min(5).max(500),
      })
      .strict(),
    requiredPermissions: [{ resource: "roles", action: "update" }],
    requiredOAuthScopes: ["mcp:admin"],
    riskLevel: "L4",
    actionLabel: "update",
    primaryResource: "roles",
    execute: async (args, ctx) =>
      ctx.control.requestPermissionChange(ctx.principal, ctx.serviceCtx, args),
  }),
  defineTool({
    toolName: "get_audit_history",
    displayName: "Get Audit History",
    description:
      "Query immutable, secret-redacted audit logs filterable by table and channel (web/rest_api/mcp/integration_api/worker).",
    domain: "administration",
    zodSchema: z
      .object({
        table_name: z.string().max(64).optional(),
        channel: z
          .enum([
            "web",
            "rest_api",
            "mcp",
            "integration_api",
            "worker",
            "system",
          ])
          .optional(),
        limit: z.number().int().min(1).max(100).optional(),
      })
      .strict(),
    requiredPermissions: [{ resource: "audit_log", action: "read" }],
    requiredOAuthScopes: ["mcp:admin"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "audit_log",
    execute: async (args, ctx) =>
      ctx.control.getAuditHistory(ctx.principal, ctx.serviceCtx, {
        tableName: args.table_name,
        channel: args.channel,
        limit: args.limit,
      }),
  }),

  // ==========================================================================
  // 11. Web Design & Configuration (7)
  // ==========================================================================
  defineTool({
    toolName: "get_active_configuration",
    displayName: "Get Active UI Configuration",
    description:
      "Retrieve the currently published UI configuration for an environment.",
    domain: "web_design_config",
    zodSchema: z
      .object({
        environment: z
          .enum(["development", "staging", "production"])
          .optional(),
      })
      .strict(),
    requiredPermissions: [{ resource: "ui_config", action: "read" }],
    requiredOAuthScopes: ["mcp:config"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "ui_config",
    execute: async (args, ctx) =>
      ctx.control.getActiveConfiguration(
        ctx.principal,
        ctx.serviceCtx,
        args.environment,
      ),
  }),
  defineTool({
    toolName: "create_theme_draft",
    displayName: "Create Theme / UI Config Draft",
    description:
      "Create a validated non-executable UI configuration draft (zero JS/script injection).",
    domain: "web_design_config",
    zodSchema: z
      .object({
        environment: z.enum(["development", "staging", "production"]),
        change_summary: z.string().max(300).optional(),
        config_payload: z.record(z.string(), z.unknown()),
      })
      .strict(),
    requiredPermissions: [{ resource: "ui_config", action: "create" }],
    requiredOAuthScopes: ["mcp:config"],
    riskLevel: "L1",
    actionLabel: "create",
    primaryResource: "ui_config",
    execute: async (args, ctx) =>
      ctx.control.createThemeDraft(ctx.principal, ctx.serviceCtx, args),
  }),
  defineTool({
    toolName: "update_configuration_draft",
    displayName: "Update Configuration Draft",
    description:
      "Update an existing draft UI configuration after security validation.",
    domain: "web_design_config",
    zodSchema: z
      .object({
        version_id: z.number().int().positive(),
        config_payload: z.record(z.string(), z.unknown()),
        change_summary: z.string().max(300).optional(),
      })
      .strict(),
    requiredPermissions: [{ resource: "ui_config", action: "update" }],
    requiredOAuthScopes: ["mcp:config"],
    riskLevel: "L2",
    actionLabel: "update",
    primaryResource: "ui_config",
    execute: async (args, ctx) =>
      ctx.control.updateConfigurationDraft(
        ctx.principal,
        ctx.serviceCtx,
        args.version_id,
        args.config_payload,
        args.change_summary,
      ),
  }),
  defineTool({
    toolName: "validate_configuration",
    displayName: "Validate UI Configuration",
    description:
      "Validate a candidate UI configuration against the strict anti-XSS Zod schema.",
    domain: "web_design_config",
    zodSchema: z
      .object({ config_payload: z.record(z.string(), z.unknown()) })
      .strict(),
    requiredPermissions: [{ resource: "ui_config", action: "read" }],
    requiredOAuthScopes: ["mcp:config"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "ui_config",
    execute: async (args, ctx) =>
      ctx.control.validateConfiguration(
        ctx.principal,
        args.config_payload,
      ) as unknown as Record<string, unknown>,
  }),
  defineTool({
    toolName: "preview_configuration",
    displayName: "Preview Configuration Draft",
    description:
      "Inspect a configuration version and its validation status without publishing.",
    domain: "web_design_config",
    zodSchema: z.object({ version_id: z.number().int().positive() }).strict(),
    requiredPermissions: [{ resource: "ui_config", action: "read" }],
    requiredOAuthScopes: ["mcp:config"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "ui_config",
    execute: async (args, ctx) =>
      ctx.control.previewConfiguration(
        ctx.principal,
        ctx.serviceCtx,
        args.version_id,
      ),
  }),
  defineTool({
    toolName: "request_configuration_publish",
    displayName: "Request Configuration Publish",
    description:
      "Submit an L4/L5 approval request to publish a UI configuration version.",
    domain: "web_design_config",
    zodSchema: z
      .object({
        version_id: z.number().int().positive(),
        reason: z.string().min(5).max(500),
      })
      .strict(),
    requiredPermissions: [{ resource: "ui_config", action: "update" }],
    requiredOAuthScopes: ["mcp:config"],
    riskLevel: "L4",
    actionLabel: "approve",
    primaryResource: "ui_config",
    execute: async (args, ctx) =>
      ctx.control.requestConfigurationPublish(
        ctx.principal,
        ctx.serviceCtx,
        args,
      ),
  }),
  defineTool({
    toolName: "schedule_configuration_publish",
    displayName: "Schedule Configuration Publish",
    description:
      "Submit an approval request to schedule a future UTC UI configuration publish.",
    domain: "web_design_config",
    zodSchema: z
      .object({
        version_id: z.number().int().positive(),
        scheduled_publish_at_utc: z.string().min(10).max(64),
        reason: z.string().min(5).max(500),
      })
      .strict(),
    requiredPermissions: [{ resource: "ui_config", action: "update" }],
    requiredOAuthScopes: ["mcp:config"],
    riskLevel: "L4",
    actionLabel: "approve",
    primaryResource: "ui_config",
    execute: async (args, ctx) =>
      ctx.control.scheduleConfigurationPublish(
        ctx.principal,
        ctx.serviceCtx,
        args,
      ),
  }),

  // ==========================================================================
  // 12. Release Management (6)
  // ==========================================================================
  defineTool({
    toolName: "get_release_status",
    displayName: "Get Release Status",
    description: "Inspect active deployed release status per environment.",
    domain: "release_management",
    zodSchema: emptyObj,
    requiredPermissions: [{ resource: "releases", action: "read" }],
    requiredOAuthScopes: ["mcp:release"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "releases",
    execute: async (_args, ctx) =>
      ctx.control.getReleaseStatus(ctx.principal, ctx.serviceCtx),
  }),
  defineTool({
    toolName: "get_deployment_history",
    displayName: "Get Deployment History",
    description: "List historical and scheduled deployments.",
    domain: "release_management",
    zodSchema: z
      .object({ limit: z.number().int().min(1).max(100).optional() })
      .strict(),
    requiredPermissions: [{ resource: "deployments", action: "read" }],
    requiredOAuthScopes: ["mcp:release"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "deployments",
    execute: async (args, ctx) =>
      ctx.control.getDeploymentHistory(
        ctx.principal,
        ctx.serviceCtx,
        args.limit,
      ),
  }),
  defineTool({
    toolName: "get_available_releases",
    displayName: "Get Available Releases",
    description: "List immutable build release artifacts and approval status.",
    domain: "release_management",
    zodSchema: emptyObj,
    requiredPermissions: [{ resource: "releases", action: "read" }],
    requiredOAuthScopes: ["mcp:release"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "releases",
    execute: async (_args, ctx) =>
      ctx.control.getAvailableReleases(ctx.principal, ctx.serviceCtx),
  }),
  defineTool({
    toolName: "request_deployment",
    displayName: "Request Deployment",
    description:
      "Submit an L5 privileged approval request for deploying a built release artifact.",
    domain: "release_management",
    zodSchema: z
      .object({
        release_id: z.number().int().positive(),
        environment: z.enum(["development", "staging", "production"]),
        reason: z.string().min(5).max(500),
      })
      .strict(),
    requiredPermissions: [{ resource: "deployments", action: "create" }],
    requiredOAuthScopes: ["mcp:release"],
    riskLevel: "L5",
    actionLabel: "create",
    primaryResource: "deployments",
    execute: async (args, ctx) =>
      ctx.control.requestDeployment(ctx.principal, ctx.serviceCtx, args),
  }),
  defineTool({
    toolName: "schedule_deployment",
    displayName: "Schedule Deployment",
    description:
      "Submit an L5 privileged approval request for a scheduled deployment window.",
    domain: "release_management",
    zodSchema: z
      .object({
        release_id: z.number().int().positive(),
        environment: z.enum(["development", "staging", "production"]),
        scheduled_at_utc: z.string().min(10).max(64),
        reason: z.string().min(5).max(500),
      })
      .strict(),
    requiredPermissions: [{ resource: "deployments", action: "create" }],
    requiredOAuthScopes: ["mcp:release"],
    riskLevel: "L5",
    actionLabel: "create",
    primaryResource: "deployments",
    execute: async (args, ctx) =>
      ctx.control.scheduleDeployment(ctx.principal, ctx.serviceCtx, args),
  }),
  defineTool({
    toolName: "request_rollback",
    displayName: "Request Deployment Rollback",
    description:
      "Submit an L5 privileged approval request to roll back an environment to a prior deployment.",
    domain: "release_management",
    zodSchema: z
      .object({
        target_deployment_id: z.number().int().positive(),
        environment: z.enum(["development", "staging", "production"]),
        reason: z.string().min(5).max(500),
      })
      .strict(),
    requiredPermissions: [{ resource: "deployments", action: "update" }],
    requiredOAuthScopes: ["mcp:release"],
    riskLevel: "L5",
    actionLabel: "update",
    primaryResource: "deployments",
    execute: async (args, ctx) =>
      ctx.control.requestRollback(ctx.principal, ctx.serviceCtx, args),
  }),

  // ==========================================================================
  // 13. Automation (3 unique; get_job_status is in Data Management)
  // ==========================================================================
  defineTool({
    toolName: "create_automation_job",
    displayName: "Create Automation Job",
    description:
      "Enqueue an authorized background automation job (permissions are revalidated by the worker at execution time).",
    domain: "automation",
    zodSchema: z
      .object({
        job_type: z.enum([
          "report_generation",
          "notification_dispatch",
          "ai_automation",
        ]),
        scheduled_at_utc: z.string().max(64).optional(),
        payload: z.record(z.string(), z.unknown()),
        idempotency_key: idempotencyField,
      })
      .strict(),
    requiredPermissions: [{ resource: "jobs", action: "create" }],
    requiredOAuthScopes: ["mcp:automation"],
    riskLevel: "L2",
    requiresIdempotency: true,
    actionLabel: "create",
    primaryResource: "jobs",
    execute: async (args, ctx) =>
      ctx.control.createAutomationJob(
        ctx.principal,
        { ...ctx.serviceCtx, idempotencyKey: args.idempotency_key },
        args,
      ),
  }),
  defineTool({
    toolName: "get_automation_jobs",
    displayName: "Get Automation Jobs",
    description:
      "List automation and background jobs visible to the authenticated user.",
    domain: "automation",
    zodSchema: z
      .object({ limit: z.number().int().min(1).max(100).optional() })
      .strict(),
    requiredPermissions: [],
    requiredOAuthScopes: ["mcp:read"],
    riskLevel: "L0",
    actionLabel: "read",
    primaryResource: "jobs",
    execute: async (args, ctx) =>
      ctx.control.getAutomationJobs(ctx.principal, ctx.serviceCtx, args.limit),
  }),
  defineTool({
    toolName: "cancel_authorized_job",
    displayName: "Cancel Authorized Job",
    description:
      "Cancel a pending or scheduled background job owned by the user or permitted by jobs:update.",
    domain: "automation",
    zodSchema: z.object({ job_id: z.number().int().positive() }).strict(),
    requiredPermissions: [],
    requiredOAuthScopes: ["mcp:automation"],
    riskLevel: "L2",
    actionLabel: "update",
    primaryResource: "jobs",
    execute: async (args, ctx) =>
      ctx.control.cancelAuthorizedJob(
        ctx.principal,
        ctx.serviceCtx,
        args.job_id,
      ),
  }),
];

export const MCP_TOOL_MAP = new Map<string, RegisteredMcpTool<any>>(
  MCP_TOOL_REGISTRY.map((t) => [t.toolName, t]),
);

export const MCP_SUPPORTED_OAUTH_SCOPES = [
  "mcp:read",
  "mcp:write",
  "mcp:export",
  "mcp:admin",
  "mcp:config",
  "mcp:release",
  "mcp:automation",
] as const;

export function getToolRegistryMetadataList(): ToolRegistryMetadata[] {
  return MCP_TOOL_REGISTRY.map((t) => ({
    toolId: t.toolId,
    toolName: t.toolName,
    displayName: t.displayName,
    description: t.description,
    domain: t.domain,
    inputSchema: t.inputSchema,
    outputSchema: t.outputSchema,
    requiredPermissions: t.requiredPermissions,
    requiredOAuthScopes: t.requiredOAuthScopes,
    supportedDataScopes: t.supportedDataScopes,
    fieldRestrictions: t.fieldRestrictions,
    riskLevel: t.riskLevel,
    executionPolicy: t.executionPolicy,
    requiresConfirmation: t.requiresConfirmation,
    requiresApproval: t.requiresApproval,
    rateLimitPerMin: t.rateLimitPerMin,
    timeoutMs: t.timeoutMs,
    requiresIdempotency: t.requiresIdempotency,
    toolVersion: t.toolVersion,
    isEnabled: t.isEnabled,
    auditPolicy: t.auditPolicy,
    handlerRef: t.handlerRef,
  }));
}
