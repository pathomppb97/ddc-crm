import type {
  CreateParams,
  DataProvider,
  Identifier,
  RaRecord,
  ResourceCallbacks,
} from "ra-core";
import { isResourceEnabled, requireErpEnabled } from "../featureFlags";
import { createMockD365Connector } from "../../../supabase/functions/_shared/erp/mockConnector";
import { createSyncEngine } from "../../../supabase/functions/_shared/erp/syncEngine";
import {
  createTableSyncStore,
  type TableGateway,
} from "../../../supabase/functions/_shared/erp/tableStore";
import type {
  CrmRow,
  ErpEntityKey,
} from "../../../supabase/functions/_shared/erp/types";
import { defaultPermissionsFor } from "../domain/defaultPermissions";
import {
  canAccessResource,
  hasPermission,
  type Permission,
} from "../domain/permissions";
import {
  allowedManualTransitions,
  assertCanDecide,
  isEditable,
  lineTotal,
  REVISABLE_STATUSES,
  requiredApprovals,
  statusAfterDecision,
  WorkflowError,
  type ApprovalRule,
  type QuotationStatus,
} from "../domain/quotationWorkflow";
import { RESOURCE_DEFS } from "../resources/registry";
import { assembleDashboardData } from "./supabaseDdc";
import type { DdcAccess, DdcDataMethods } from "./types";

/**
 * Evaluation mode (in-browser, FakeRest) implementation of the DDC business
 * operations. It mirrors the database workflow functions using the shared
 * domain modules. Data lives in memory and resets on reload; permissions are
 * applied by the interface and by these operations, NOT by row level security.
 */

type Row = RaRecord & Record<string, any>;

interface Identity {
  id: Identifier;
  administrator?: boolean;
  role_key?: string | null;
}

const ALL = { page: 1, perPage: 100_000 };

export const createFakeRestDdcHelpers = (
  base: DataProvider,
  getUser: () => Identity | null,
) => {
  const all = async (
    resource: string,
    filter: Record<string, unknown> = {},
  ): Promise<Row[]> => {
    const { data } = await base.getList(resource, {
      pagination: ALL,
      sort: { field: "id", order: "ASC" },
      filter: {},
    });
    return (data as Row[]).filter((row) =>
      Object.entries(filter).every(
        ([key, value]) => String(row[key]) === String(value),
      ),
    );
  };
  const one = async (resource: string, id: Identifier) =>
    (await base.getOne(resource, { id })).data as Row;
  const create = async (resource: string, data: Record<string, unknown>) =>
    (await base.create(resource, { data })).data as Row;
  const update = async (
    resource: string,
    id: Identifier,
    data: Record<string, unknown>,
  ) =>
    (await base.update(resource, { id, data, previousData: { id } }))
      .data as Row;

  const access = async (): Promise<DdcAccess> => {
    const user = getUser();
    if (!user)
      return {
        salesId: null,
        administrator: false,
        roleKey: null,
        permissions: [],
      };
    const sale = await one("sales", user.id).catch(() => user as Row);
    const rows = await all("role_permissions", {
      role_key: sale.role_key ?? "",
    });
    const permissions: Permission[] = rows.length
      ? rows.map((r) => ({
          resource: r.resource,
          action: r.action,
          scope: r.scope,
        }))
      : defaultPermissionsFor(sale.role_key);
    return {
      salesId: sale.id,
      administrator: Boolean(sale.administrator) && !sale.disabled,
      roleKey: sale.role_key ?? null,
      permissions,
    };
  };

  const assertCan = async (resource: string, action: string, record?: Row) => {
    const me = await access();
    if (!canAccessResource(me, { resource, action, record })) {
      throw new WorkflowError(`Not allowed to ${action} ${resource}`);
    }
    return me;
  };

  return { all, one, create, update, access, assertCan };
};

const notify = (
  create: (r: string, d: Record<string, unknown>) => Promise<Row>,
  recipient: Identifier | null,
  kind: string,
  title: string,
  body: string,
  entityType: string,
  entityId: Identifier,
) =>
  recipient == null
    ? Promise.resolve()
    : create("notifications", {
        recipient_sales_id: recipient,
        kind,
        title,
        body,
        entity_type: entityType,
        entity_id: entityId,
        created_at: new Date().toISOString(),
        read_at: null,
      });

/** Mock ERP state shared by the whole browser session. */
let mockErp: ReturnType<typeof createMockD365Connector> | null = null;

export const createFakeRestDdcMethods = (
  base: DataProvider,
  getUser: () => Identity | null,
): DdcDataMethods => {
  const h = createFakeRestDdcHelpers(base, getUser);

  const recomputeTotal = async (quotationId: Identifier) => {
    const lines = await h.all("quotation_items", { quotation_id: quotationId });
    await h.update("quotations", quotationId, {
      total_amount: lines.reduce(
        (sum, line) =>
          sum + Number(line.line_total ?? lineTotal(line as never)),
        0,
      ),
    });
  };

  const gateway: TableGateway = {
    select: (table, filter) => h.all(table, filter) as Promise<CrmRow[]>,
    insert: (table, data) => h.create(table, data) as Promise<CrmRow>,
    update: async (table, idColumn, id, data) => {
      const [row] = await h.all(table, { [idColumn]: id });
      if (!row) throw new Error(`Row ${String(id)} not found in ${table}`);
      await h.update(table, row.id, data);
    },
  };

  return {
    getMyAccess: h.access,

    async convertLead(leadId, { createOpportunity, existingCompanyId }) {
      const lead = await h.one("leads", leadId);
      await h.assertCan("leads", "edit", lead);
      if (lead.status === "converted")
        throw new WorkflowError(`Lead ${String(leadId)} is already converted`);
      if (lead.status === "disqualified")
        throw new WorkflowError("A disqualified lead cannot be converted");

      const company = existingCompanyId
        ? await h.one("companies", existingCompanyId)
        : await h.create("companies", {
            name: lead.company_name,
            website: lead.website,
            phone_number: lead.phone,
            country: lead.country,
            province: lead.province,
            territory_id: lead.territory_id,
            email: lead.email,
            sales_id: lead.sales_id,
            org_type: "standalone",
            custom_fields: {},
          });
      if (!existingCompanyId && lead.business_model_id) {
        await h.create("company_business_models", {
          company_id: company.id,
          business_model_id: lead.business_model_id,
          is_primary: true,
        });
      }
      let contact: Row | null = null;
      if (lead.contact_name?.trim()) {
        const [first, ...rest] = lead.contact_name.trim().split(/\s+/);
        contact = await h.create("contacts", {
          first_name: first,
          last_name: rest.join(" "),
          title: lead.contact_title,
          company_id: company.id,
          company_name: company.name,
          sales_id: lead.sales_id,
          first_seen: new Date().toISOString(),
          last_seen: new Date().toISOString(),
          email_jsonb: lead.email ? [{ email: lead.email, type: "Work" }] : [],
          phone_jsonb: lead.phone ? [{ number: lead.phone, type: "Work" }] : [],
          tags: [],
        });
      }
      let deal: Row | null = null;
      if (createOpportunity) {
        const pipelines = (await h.all("pipelines")).filter((p) => p.is_active);
        const score = (p: Row) =>
          (p.business_model_id != null &&
          lead.business_model_id != null &&
          String(p.business_model_id) === String(lead.business_model_id)
            ? 2
            : 0) + (p.is_default ? 1 : 0);
        const pipeline = pipelines.sort(
          (a, b) => score(b) - score(a) || a.sort_order - b.sort_order,
        )[0];
        const stage = pipeline
          ? (await h.all("pipeline_stages", { pipeline_id: pipeline.id }))
              .filter((s) => s.stage_type === "open")
              .sort((a, b) => a.sort_order - b.sort_order)[0]
          : undefined;
        if (!stage)
          throw new WorkflowError(
            "No active pipeline with an open stage is configured",
          );
        deal = await h.create("deals", {
          name: `${lead.company_name} - ${lead.product_interest || lead.lead_no}`,
          company_id: company.id,
          contact_ids: contact ? [contact.id] : [],
          stage: stage.code,
          pipeline_id: pipeline.id,
          description: lead.qualification_notes,
          amount: lead.estimated_value,
          currency: lead.currency,
          business_model_id: lead.business_model_id,
          lead_id: lead.id,
          sales_id: lead.sales_id,
          index: 0,
          categories: [],
        });
      }
      await h.update("leads", leadId, {
        status: "converted",
        converted_company_id: company.id,
        converted_contact_id: contact?.id ?? null,
        converted_deal_id: deal?.id ?? null,
        converted_at: new Date().toISOString(),
      });
      return {
        lead_id: leadId,
        company_id: company.id,
        contact_id: contact?.id ?? null,
        deal_id: deal?.id ?? null,
      };
    },

    async submitQuotation(id) {
      const quotation = await h.one("quotations", id);
      const me = await h.assertCan("quotations", "edit", quotation);
      if (!isEditable(quotation.status)) {
        throw new WorkflowError(
          `Only a draft or rejected quotation can be submitted (current status: ${quotation.status})`,
        );
      }
      if ((await h.all("quotation_items", { quotation_id: id })).length === 0) {
        throw new WorkflowError(
          "A quotation needs at least one line before submission",
        );
      }
      for (const pending of await h.all("quotation_approvals", {
        quotation_id: id,
        status: "pending",
      })) {
        await h.update("quotation_approvals", pending.id, {
          status: "cancelled",
        });
      }
      const rules = (await h.all(
        "approval_rules",
      )) as unknown as ApprovalRule[];
      const steps = requiredApprovals(
        {
          currency: quotation.currency,
          total_amount: Number(quotation.total_amount),
        },
        rules.map((r) => ({
          ...r,
          min_amount: Number(r.min_amount),
          max_amount: r.max_amount == null ? null : Number(r.max_amount),
        })),
      );
      for (const step of steps) {
        await h.create("quotation_approvals", {
          quotation_id: id,
          rule_id: step.ruleId,
          required_role_key: step.requiredRoleKey,
          status: "pending",
          created_at: new Date().toISOString(),
        });
      }
      const updated = await h.update("quotations", id, {
        status: "pending_approval",
        submitted_at: new Date().toISOString(),
        submitted_by: me.salesId,
        approved_at: null,
      });
      const approvers = (await h.all("sales")).filter(
        (s) => !s.disabled && String(s.id) !== String(me.salesId),
      );
      for (const approver of approvers) {
        const permissions = defaultPermissionsFor(approver.role_key);
        const matches = steps.some((step) =>
          step.requiredRoleKey
            ? step.requiredRoleKey === approver.role_key
            : permissions.some(
                (p) => p.resource === "quotations" && p.action === "approve",
              ),
        );
        if (matches) {
          await notify(
            h.create,
            approver.id,
            "quotation.approval_requested",
            "Quotation approval requested",
            `${quotation.quotation_no} rev. ${quotation.revision}`,
            "quotations",
            id,
          );
        }
      }
      return updated;
    },

    async decideQuotationApproval(approvalId, decision, comment) {
      const approval = await h.one("quotation_approvals", approvalId);
      const quotation = await h.one("quotations", approval.quotation_id);
      const me = await h.access();
      const settings = await h.all("app_settings", {
        key: "quotation_allow_self_approval",
      });
      assertCanDecide(
        {
          salesId: me.salesId!,
          administrator: me.administrator,
          roleKey: me.roleKey,
          canApprove: hasPermission(me, "quotations", "approve"),
        },
        approval as never,
        quotation as never,
        { allowSelfApproval: settings[0]?.value === true },
      );
      if (decision === "rejected" && !comment?.trim())
        throw new WorkflowError("A comment is required to reject a quotation");
      await h.update("quotation_approvals", approvalId, {
        status: decision,
        decided_by: me.salesId,
        decided_at: new Date().toISOString(),
        comment: comment ?? null,
      });
      const pending = await h.all("quotation_approvals", {
        quotation_id: quotation.id,
        status: "pending",
      });
      const next = statusAfterDecision(decision, pending.length);
      if (decision === "rejected") {
        for (const row of pending)
          await h.update("quotation_approvals", row.id, {
            status: "cancelled",
          });
      }
      const updated = await h.update("quotations", quotation.id, {
        status: next,
        ...(next === "approved"
          ? { approved_at: new Date().toISOString() }
          : {}),
      });
      if (next !== "pending_approval") {
        await notify(
          h.create,
          quotation.sales_id,
          `quotation.${next}`,
          `Quotation ${next}`,
          `${quotation.quotation_no} rev. ${quotation.revision}`,
          "quotations",
          quotation.id,
        );
      }
      return updated;
    },

    async setQuotationStatus(id, status) {
      const quotation = await h.one("quotations", id);
      await h.assertCan("quotations", "edit", quotation);
      if (
        !allowedManualTransitions(quotation.status as QuotationStatus).includes(
          status,
        )
      ) {
        throw new WorkflowError(
          `Transition from ${quotation.status} to ${status} is not allowed`,
        );
      }
      const now = new Date().toISOString();
      const updated = await h.update("quotations", id, {
        status,
        ...(status === "sent" ? { sent_at: now } : {}),
        ...(["accepted", "declined", "expired"].includes(status)
          ? { decided_at: now }
          : {}),
      });
      if (status === "sent" && quotation.rfq_id != null) {
        const rfq = await h.one("rfqs", quotation.rfq_id);
        if (!["closed", "cancelled"].includes(rfq.status))
          await h.update("rfqs", rfq.id, { status: "quoted" });
      }
      return updated;
    },

    async createQuotationRevision(id) {
      const quotation = await h.one("quotations", id);
      await h.assertCan("quotations", "create");
      await h.assertCan("quotations", "edit", quotation);
      if (!REVISABLE_STATUSES.includes(quotation.status)) {
        throw new WorkflowError(
          `A quotation in status ${quotation.status} cannot be revised`,
        );
      }
      const siblings = await h.all("quotations", {
        quotation_no: quotation.quotation_no,
      });
      if (siblings.some((q) => q.revision > quotation.revision)) {
        throw new WorkflowError(
          `A newer revision of ${quotation.quotation_no} already exists`,
        );
      }
      const {
        id: _id,
        status: _s,
        submitted_at: _a,
        submitted_by: _b,
        approved_at: _c,
        sent_at: _d,
        decided_at: _e,
        ...copy
      } = quotation;
      const revision = await h.create("quotations", {
        ...copy,
        revision: quotation.revision + 1,
        previous_revision_id: quotation.id,
        status: "draft",
        created_at: new Date().toISOString(),
      });
      for (const line of await h.all("quotation_items", { quotation_id: id })) {
        const { id: _lineId, ...lineCopy } = line;
        await h.create("quotation_items", {
          ...lineCopy,
          quotation_id: revision.id,
        });
      }
      await recomputeTotal(revision.id);
      await h.update("quotations", id, { status: "superseded" });
      return { id: revision.id };
    },

    async runErpAction(request) {
      requireErpEnabled();
      const me = await h.access();
      if (
        !me.administrator &&
        !me.permissions.some(
          (p) => p.resource === "erp_integration" && p.action === "update",
        )
      ) {
        throw new WorkflowError("Not allowed to run ERP synchronization");
      }
      mockErp ??= createMockD365Connector();
      const engine = createSyncEngine({
        connector: mockErp.connector,
        store: createTableSyncStore(gateway),
      });
      switch (request.action) {
        case "health":
          return { ...(await mockErp.connector.healthCheck()) };
        case "register_legal_entities":
          return { registered: await engine.registerLegalEntities() };
        case "reconcile":
          return {
            ...(await engine.reconcile(
              request.entity as ErpEntityKey,
              request.dataAreaId,
            )),
          };
        case "sync":
          return {
            ...(await engine.syncEntity({
              entity: request.entity as ErpEntityKey,
              dataAreaId: request.dataAreaId,
              mode: request.mode,
              triggeredBy: me.salesId,
            })),
          };
      }
    },

    async ddcSearch(query, maxResults = 8) {
      const text = query.trim().toLowerCase();
      if (text.length < 2) return [];
      const sources: Array<[string, string, string]> = [
        ["companies", "name", "customer_code"],
        ["products", "part_number", "name"],
        ["leads", "company_name", "lead_no"],
        ["rfqs", "rfq_no", "subject"],
        ["quotations", "quotation_no", "subject"],
        ["dev_projects", "project_no", "name"],
        ["service_cases", "case_no", "subject"],
      ];
      const results = await Promise.all(
        sources.map(async ([resource, title, subtitle]) =>
          (await h.all(resource))
            .filter((row) =>
              [row[title], row[subtitle]].some((v) =>
                String(v ?? "")
                  .toLowerCase()
                  .includes(text),
              ),
            )
            .slice(0, maxResults)
            .map((row) => ({
              resource,
              record_id: row.id,
              title: String(row[title] ?? ""),
              subtitle: row[subtitle] ?? null,
            })),
        ),
      );
      return results.flat();
    },

    async getDashboardData() {
      const [
        companies,
        companyBusinessModels,
        leads,
        deals,
        pipelineStages,
        quotations,
        activities,
        options,
        actionItems,
        interests,
        dealProducts,
        nodes,
        products,
        salesOrders,
        invoices,
      ] = await Promise.all(
        [
          "companies",
          "company_business_models",
          "leads",
          "deals",
          "pipeline_stages",
          "quotations",
          "activities",
          "master_options",
          "action_items",
          "company_product_interests",
          "deal_products",
          "product_hierarchy_nodes",
          "products",
          "erp_sales_orders",
          "erp_invoices",
        ].map((resource) =>
          isResourceEnabled(resource) ? h.all(resource) : Promise.resolve([]),
        ),
      );
      return assembleDashboardData({
        companies: companies as never,
        companyBusinessModels: companyBusinessModels as never,
        leads: leads as never,
        deals: deals as never,
        pipelineStages: pipelineStages as never,
        quotations: quotations as never,
        activities: activities as never,
        activityTypes: options,
        actionItems: actionItems as never,
        interests,
        dealProducts,
        nodes,
        products,
        salesOrders: salesOrders as never,
        invoices: invoices as never,
        lifecycle: options,
      });
    },
  };
};

const DOC_NUMBERS: Record<string, { column: string; prefix: string }> = {
  leads: { column: "lead_no", prefix: "LD" },
  rfqs: { column: "rfq_no", prefix: "RFQ" },
  quotations: { column: "quotation_no", prefix: "QT" },
  dev_projects: { column: "project_no", prefix: "DEV" },
  service_cases: { column: "case_no", prefix: "CASE" },
};

/** Evaluation mode equivalents of the database triggers (numbering, totals, guards, audit). */
export const createFakeRestDdcCallbacks = (
  getUser: () => Identity | null,
): ResourceCallbacks[] => {
  const audited = new Set([
    ...RESOURCE_DEFS.filter((d) => !d.readOnly).map((d) => d.name),
    "companies",
    "contacts",
    "deals",
  ]);
  audited.delete("audit_log");

  const audit = async (
    dataProvider: DataProvider,
    table: string,
    action: string,
    record: Row,
    previous?: Row,
  ) => {
    const changed = previous
      ? Object.keys(record).filter(
          (key) =>
            !["updated_at", "index"].includes(key) &&
            JSON.stringify(record[key]) !== JSON.stringify(previous[key]),
        )
      : null;
    if (changed && changed.length === 0) return;
    // Best effort: datasets without an audit_log collection (stock Atomic data) are not audited.
    // The authoritative audit is the database trigger in Supabase mode.
    const { data: probe } = await dataProvider
      .getList("audit_log", {
        pagination: { page: 1, perPage: 1 },
        sort: { field: "id", order: "ASC" },
        filter: {},
      })
      .catch(() => ({ data: null }));
    if (probe === null) return;
    await dataProvider.create("audit_log", {
      data: {
        occurred_at: new Date().toISOString(),
        actor_sales_id: getUser()?.id ?? null,
        table_name: table,
        record_id: String(record.id),
        action,
        changed_fields: changed,
        old_data: previous ?? null,
        new_data: action === "DELETE" ? null : record,
      },
    });
  };

  const nextNumber = async (
    dataProvider: DataProvider,
    resource: string,
    column: string,
  ) => {
    const { data } = await dataProvider.getList(resource, {
      pagination: ALL,
      sort: { field: "id", order: "ASC" },
      filter: {},
    });
    return (
      Math.max(
        0,
        ...data.map((row: Row) =>
          Number(String(row[column] ?? "").match(/(\d+)$/)?.[1] ?? 0),
        ),
      ) + 1
    );
  };

  const numbering: ResourceCallbacks[] = [
    ...Object.entries(DOC_NUMBERS).map(([resource, { column, prefix }]) => ({
      resource,
      beforeCreate: async (
        params: CreateParams,
        dataProvider: DataProvider,
      ) => {
        if (params.data[column]) return params;
        const next = await nextNumber(dataProvider, resource, column);
        return {
          ...params,
          data: {
            ...params.data,
            [column]: `${prefix}-${new Date().getFullYear()}-${String(next).padStart(5, "0")}`,
          },
        };
      },
    })),
    {
      resource: "companies",
      beforeCreate: async (
        params: CreateParams,
        dataProvider: DataProvider,
      ) => {
        if (params.data.customer_code) return params;
        const next = await nextNumber(
          dataProvider,
          "companies",
          "customer_code",
        );
        return {
          ...params,
          data: {
            ...params.data,
            customer_code: `CUS-${String(next).padStart(6, "0")}`,
          },
        };
      },
    },
  ];

  const ownership: ResourceCallbacks[] = RESOURCE_DEFS.filter(
    (d) => d.fields.some((f) => f.source === "sales_id") && !d.readOnly,
  ).map((d) => ({
    resource: d.name,
    beforeCreate: async (params) => {
      const now = new Date().toISOString();
      return {
        ...params,
        data: {
          created_at: now,
          ...(d.name === "activities" ? { logged_at: now } : {}),
          ...(d.name === "activity_photos" ? { taken_at: now } : {}),
          ...params.data,
          sales_id: params.data.sales_id ?? getUser()?.id ?? null,
        },
      };
    },
  }));

  const dealPipeline: ResourceCallbacks = {
    resource: "deals",
    beforeCreate: async (params: CreateParams, dataProvider: DataProvider) => {
      if (params.data.pipeline_id != null) return params;
      const { data: pipelines } = await dataProvider
        .getList("pipelines", {
          pagination: ALL,
          sort: { field: "id", order: "ASC" },
          filter: {},
        })
        .catch(() => ({ data: [] as Row[] }));
      const fallback = pipelines.find((p: Row) => p.is_default) ?? pipelines[0];
      return fallback
        ? { ...params, data: { ...params.data, pipeline_id: fallback.id } }
        : params;
    },
  };

  const quotationLineTotals: ResourceCallbacks = {
    resource: "quotation_items",
    beforeSave: async (data: Row, dataProvider: DataProvider) => {
      if (data.quotation_id != null) {
        const { data: quotation } = await dataProvider.getOne("quotations", {
          id: data.quotation_id,
        });
        if (!isEditable(quotation.status))
          throw new WorkflowError(
            `Quotation lines are locked in status ${quotation.status}`,
          );
      }
      return {
        ...data,
        line_total: lineTotal({
          quantity: Number(data.quantity),
          unit_price: Number(data.unit_price),
          discount_percent: Number(data.discount_percent ?? 0),
        }),
      };
    },
    afterSave: async (record: Row, dataProvider: DataProvider) => {
      const { data: lines } = await dataProvider.getList("quotation_items", {
        pagination: ALL,
        sort: { field: "id", order: "ASC" },
        filter: { quotation_id: record.quotation_id },
      });
      const total = lines.reduce(
        (sum: number, line: Row) => sum + Number(line.line_total),
        0,
      );
      await dataProvider.update("quotations", {
        id: record.quotation_id,
        data: { total_amount: total },
        previousData: { id: record.quotation_id },
      });
      return record;
    },
  };

  const quotationGuard: ResourceCallbacks = {
    resource: "quotations",
    beforeCreate: async (params) => {
      if (
        params.data.status &&
        params.data.status !== "draft" &&
        params.meta?.workflow !== true
      ) {
        throw new WorkflowError("A quotation must be created as a draft");
      }
      return {
        ...params,
        data: {
          revision: 0,
          total_amount: 0,
          ...params.data,
          status: params.data.status ?? "draft",
        },
      };
    },
  };

  const auditing: ResourceCallbacks[] = [...audited].map((resource) => ({
    resource,
    afterCreate: async (result, dataProvider) => {
      await audit(dataProvider, resource, "INSERT", result.data as Row);
      return result;
    },
    afterUpdate: async (result, dataProvider) => {
      await audit(
        dataProvider,
        resource,
        "UPDATE",
        result.data as Row,
        undefined,
      );
      return result;
    },
    afterDelete: async (result, dataProvider) => {
      await audit(dataProvider, resource, "DELETE", result.data as Row);
      return result;
    },
  }));

  return [
    ...numbering,
    ...ownership,
    dealPipeline,
    quotationLineTotals,
    quotationGuard,
    ...auditing,
  ];
};
