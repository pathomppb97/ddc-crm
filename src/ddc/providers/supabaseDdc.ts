import type { SupabaseClient } from "@supabase/supabase-js";
import { ERP_ENABLED, requireErpEnabled } from "../featureFlags";
import { HttpError, type GetListParams, type ResourceCallbacks } from "ra-core";
import type { KpiDataset } from "../domain/kpis";
import type { Permission } from "../domain/permissions";
import { RESOURCE_DEFS } from "../resources/registry";
import {
  DASHBOARD_ROW_LIMIT,
  type DdcAccess,
  type DdcDataMethods,
} from "./types";

const fail = (
  operation: string,
  error: { message?: string; code?: string } | null,
  status?: number,
): never => {
  // Workflow functions raise readable messages (permission, invalid transition): show them
  throw new HttpError(
    error?.message || `${operation} failed`,
    status ?? 400,
    error,
  );
};

const rpc = async <T>(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<T> => {
  const { data, error, status } = await client.rpc(name, args);
  if (error) fail(name, error, status);
  return data as T;
};

let accessCache: Promise<DdcAccess> | null = null;
export const clearAccessCache = () => {
  accessCache = null;
};

export const loadAccess = (client: SupabaseClient): Promise<DdcAccess> => {
  accessCache ??= (async () => {
    const { data: session } = await client.auth.getSession();
    const userId = session.session?.user.id;
    if (!userId)
      return {
        salesId: null,
        administrator: false,
        roleKey: null,
        permissions: [],
      };
    const [{ data: sale }, { data: permissions, error }] = await Promise.all([
      client
        .from("sales")
        .select("id, administrator, role_key, disabled")
        .eq("user_id", userId)
        .single(),
      client.rpc("ddc_my_permissions"),
    ]);
    if (error) {
      accessCache = null;
      fail("ddc_my_permissions", error);
    }
    return {
      salesId: sale?.id ?? null,
      administrator: Boolean(sale?.administrator) && !sale?.disabled,
      roleKey: sale?.role_key ?? null,
      permissions: (permissions ?? []) as Permission[],
    };
  })();
  return accessCache;
};

const selectAll = async <T>(
  client: SupabaseClient,
  table: string,
  columns: string,
) => {
  const { data, error, status } = await client
    .from(table)
    .select(columns)
    .limit(DASHBOARD_ROW_LIMIT);
  if (error) fail(`load ${table}`, error, status);
  return (data ?? []) as T[];
};

export const createSupabaseDdcMethods = (
  getClient: () => SupabaseClient,
): DdcDataMethods => ({
  getMyAccess: () => loadAccess(getClient()),

  convertLead: (leadId, { createOpportunity, existingCompanyId }) =>
    rpc(getClient(), "convert_lead", {
      p_lead_id: leadId,
      p_create_opportunity: createOpportunity,
      p_existing_company_id: existingCompanyId ?? null,
    }),

  submitQuotation: (id) =>
    rpc(getClient(), "submit_quotation", { p_quotation_id: id }),
  decideQuotationApproval: (approvalId, decision, comment) =>
    rpc(getClient(), "decide_quotation_approval", {
      p_approval_id: approvalId,
      p_decision: decision,
      p_comment: comment ?? null,
    }),
  setQuotationStatus: (id, status) =>
    rpc(getClient(), "set_quotation_status", {
      p_quotation_id: id,
      p_status: status,
    }),
  createQuotationRevision: (id) =>
    rpc(getClient(), "create_quotation_revision", { p_quotation_id: id }),

  async runErpAction(request) {
    requireErpEnabled();
    const { data, error } = await getClient().functions.invoke<
      Record<string, unknown>
    >("erp_sync", {
      method: "POST",
      body: request,
    });
    if (error) {
      const details = await (async () => {
        try {
          return (
            (await (error as { context?: Response }).context?.json()) ?? {}
          );
        } catch {
          return {};
        }
      })();
      throw new Error(details.message || "ERP request failed");
    }
    return data ?? {};
  },

  ddcSearch: (query, maxResults = 8) =>
    rpc(getClient(), "ddc_global_search", {
      p_query: query,
      p_max_results: maxResults,
    }),

  async getDashboardData() {
    const client = getClient();
    const [
      companies,
      companyBusinessModels,
      leads,
      deals,
      pipelineStages,
      quotations,
      activities,
      activityTypes,
      actionItems,
      interests,
      dealProducts,
      nodes,
      salesOrders,
      invoices,
    ] = await Promise.all([
      selectAll<KpiDataset["companies"][number]>(
        client,
        "companies",
        "id, created_at, sales_id, territory_id, country, lifecycle_status_id, category_id",
      ),
      selectAll<KpiDataset["companyBusinessModels"][number]>(
        client,
        "company_business_models",
        "company_id, business_model_id, sales_channel_id",
      ),
      selectAll<KpiDataset["leads"][number]>(
        client,
        "leads",
        "id, created_at, status, sales_id, business_model_id, territory_id, country, follow_up_date",
      ),
      selectAll<KpiDataset["deals"][number]>(
        client,
        "deals",
        "id, company_id, created_at, updated_at, stage, pipeline_id, amount, currency, probability, sales_id, business_model_id, archived_at, closed_at, follow_up_date",
      ),
      selectAll<KpiDataset["pipelineStages"][number]>(
        client,
        "pipeline_stages",
        "pipeline_id, code, stage_type, probability",
      ),
      selectAll<KpiDataset["quotations"][number]>(
        client,
        "quotations",
        "id, company_id, status, currency, total_amount, created_at, sent_at, sales_id",
      ),
      selectAll<
        KpiDataset["activities"][number] & { activity_type_id: number }
      >(
        client,
        "activities",
        "id, company_id, start_at, status, sales_id, activity_type_id",
      ),
      selectAll<{ id: number; code: string }>(
        client,
        "master_options",
        "id, code, category",
      ),
      selectAll<KpiDataset["actionItems"][number]>(
        client,
        "action_items",
        "id, company_id, due_date, status, sales_id",
      ),
      selectAll<{
        company_id: number;
        node_id: number | null;
        product_id: number | null;
      }>(
        client,
        "company_product_interests",
        "company_id, node_id, product_id",
      ),
      selectAll<{
        deal_id: number;
        node_id: number | null;
        product_id: number | null;
      }>(client, "deal_products", "deal_id, node_id, product_id"),
      selectAll<{ id: number; parent_id: number | null; level: string }>(
        client,
        "product_hierarchy_nodes",
        "id, parent_id, level",
      ),
      ERP_ENABLED
        ? selectAll<NonNullable<KpiDataset["salesOrders"]>[number]>(
            client,
            "erp_sales_orders",
            "company_id, order_date, currency, total_amount",
          ).catch(() => null)
        : Promise.resolve(null),
      ERP_ENABLED
        ? selectAll<NonNullable<KpiDataset["invoices"]>[number]>(
            client,
            "erp_invoices",
            "company_id, invoice_date, currency, invoice_amount, paid_amount",
          ).catch(() => null)
        : Promise.resolve(null),
    ]);
    const products = await selectAll<{ id: number; node_id: number | null }>(
      client,
      "products",
      "id, node_id",
    );
    return assembleDashboardData({
      companies,
      companyBusinessModels,
      leads,
      deals,
      pipelineStages,
      quotations,
      activities,
      activityTypes,
      actionItems,
      interests,
      dealProducts,
      nodes,
      products,
      salesOrders,
      invoices,
      lifecycle: activityTypes,
    });
  },
});

type Row = Record<string, unknown>;

/** Shared by both providers: resolves product families and option codes. */
export const assembleDashboardData = (raw: {
  companies: KpiDataset["companies"];
  companyBusinessModels: KpiDataset["companyBusinessModels"];
  leads: KpiDataset["leads"];
  deals: KpiDataset["deals"];
  pipelineStages: KpiDataset["pipelineStages"];
  quotations: KpiDataset["quotations"];
  activities: Array<
    KpiDataset["activities"][number] & { activity_type_id?: unknown }
  >;
  activityTypes: Row[];
  actionItems: KpiDataset["actionItems"];
  interests: Row[];
  dealProducts: Row[];
  nodes: Row[];
  products: Row[];
  salesOrders: KpiDataset["salesOrders"];
  invoices: KpiDataset["invoices"];
  lifecycle: Row[];
}): KpiDataset & { truncated: boolean } => {
  const nodeById = new Map(raw.nodes.map((n) => [String(n.id), n]));
  const familyOfNode = (nodeId: unknown): number | string | null => {
    let current = nodeId == null ? undefined : nodeById.get(String(nodeId));
    for (let depth = 0; current && depth < 10; depth += 1) {
      if (current.level === "family") return current.id as number;
      current =
        current.parent_id == null
          ? undefined
          : nodeById.get(String(current.parent_id));
    }
    return null;
  };
  const productNode = new Map(
    raw.products.map((p) => [String(p.id), p.node_id]),
  );
  const familyOf = (row: Row) =>
    familyOfNode(
      row.node_id ??
        (row.product_id != null
          ? productNode.get(String(row.product_id))
          : null),
    );
  const codeById = new Map(
    raw.activityTypes.map((o) => [String(o.id), String(o.code)]),
  );
  const truncated = [
    raw.companies,
    raw.deals,
    raw.leads,
    raw.quotations,
    raw.activities,
  ].some((rows) => rows.length >= DASHBOARD_ROW_LIMIT);

  return {
    companies: raw.companies,
    companyBusinessModels: raw.companyBusinessModels,
    leads: raw.leads,
    deals: raw.deals.map((d) => ({
      ...d,
      amount: d.amount == null ? null : Number(d.amount),
    })),
    pipelineStages: raw.pipelineStages,
    quotations: raw.quotations.map((q) => ({
      ...q,
      total_amount: Number(q.total_amount),
    })),
    activities: raw.activities.map((a) => ({
      ...a,
      activity_type_code: codeById.get(String(a.activity_type_id)) ?? null,
    })),
    actionItems: raw.actionItems,
    productInterests: raw.interests.map((row) => ({
      company_id: row.company_id as number,
      product_family_id: familyOf(row),
    })),
    dealProducts: raw.dealProducts.map((row) => ({
      deal_id: row.deal_id as number,
      product_family_id: familyOf(row),
    })),
    salesOrders: raw.salesOrders,
    invoices: raw.invoices,
    lifecycleCodes: Object.fromEntries(
      raw.lifecycle
        .filter((o) => o.category === "customer_lifecycle_status")
        .map((o) => [String(o.id), String(o.code)]),
    ),
    truncated,
  };
};

const SKIP_SEARCH = new Set(["companies"]);

/** Free text search ("q") for DDC resources, translated to PostgREST ilike filters. */
export const ddcSearchCallbacks: ResourceCallbacks[] = RESOURCE_DEFS.filter(
  (def) => def.searchFields?.length && !SKIP_SEARCH.has(def.name),
).map((def) => ({
  resource: def.name,
  beforeGetList: async (params: GetListParams) => {
    if (!params.filter?.q) return params;
    const { q, ...filter } = params.filter;
    return {
      ...params,
      filter: {
        ...filter,
        "@or": Object.fromEntries(
          def.searchFields!.map((column) => [`${column}@ilike`, q]),
        ),
      },
    };
  },
}));
