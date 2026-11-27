/**
 * Dashboard KPIs.
 *
 * Value categories are kept strictly apart and are never added together:
 *   estimated  - opportunity amounts (deals.amount), a forecast
 *   quoted     - quotations sent to customers
 *   confirmed  - sales orders synchronized from the ERP
 *   invoiced   - invoices synchronized from the ERP
 *   collected  - paid amounts on ERP invoices
 * ERP based figures are null (not zero) when no ERP data is present, so the
 * interface can say "not available" instead of showing an invented 0.
 * Money is always grouped by currency.
 */

type Id = number | string;

export interface KpiFilters {
  from?: string | null;
  to?: string | null;
  businessModelId?: Id | null;
  salesChannelId?: Id | null;
  territoryId?: Id | null;
  country?: string | null;
  salesId?: Id | null;
  lifecycleStatusId?: Id | null;
  categoryId?: Id | null;
  productFamilyId?: Id | null;
}

export interface KpiCompany {
  id: Id;
  created_at?: string | null;
  sales_id?: Id | null;
  territory_id?: Id | null;
  country?: string | null;
  lifecycle_status_id?: Id | null;
  category_id?: Id | null;
}

export interface KpiDataset {
  companies: KpiCompany[];
  companyBusinessModels: Array<{
    company_id: Id;
    business_model_id: Id;
    sales_channel_id?: Id | null;
  }>;
  leads: Array<{
    id: Id;
    created_at: string;
    status: string;
    sales_id?: Id | null;
    business_model_id?: Id | null;
    territory_id?: Id | null;
    country?: string | null;
    follow_up_date?: string | null;
  }>;
  deals: Array<{
    id: Id;
    company_id?: Id | null;
    created_at: string;
    stage: string;
    pipeline_id?: Id | null;
    amount?: number | null;
    currency?: string | null;
    probability?: number | null;
    sales_id?: Id | null;
    business_model_id?: Id | null;
    archived_at?: string | null;
    closed_at?: string | null;
    updated_at?: string | null;
    follow_up_date?: string | null;
  }>;
  pipelineStages: Array<{
    pipeline_id: Id;
    code: string;
    stage_type: "open" | "won" | "lost";
    probability?: number | null;
  }>;
  quotations: Array<{
    id: Id;
    company_id: Id;
    status: string;
    currency: string;
    total_amount: number;
    created_at: string;
    sent_at?: string | null;
    sales_id?: Id | null;
  }>;
  activities: Array<{
    id: Id;
    company_id?: Id | null;
    start_at: string;
    status: string;
    activity_type_code?: string | null;
    sales_id?: Id | null;
  }>;
  actionItems: Array<{
    id: Id;
    company_id?: Id | null;
    due_date?: string | null;
    status: string;
    sales_id?: Id | null;
  }>;
  productInterests: Array<{
    company_id: Id;
    node_id?: Id | null;
    product_family_id?: Id | null;
  }>;
  dealProducts: Array<{ deal_id: Id; product_family_id?: Id | null }>;
  salesOrders: Array<{
    company_id?: Id | null;
    order_date?: string | null;
    currency?: string | null;
    total_amount?: number | null;
  }> | null;
  invoices: Array<{
    company_id?: Id | null;
    invoice_date?: string | null;
    currency?: string | null;
    invoice_amount?: number | null;
    paid_amount?: number | null;
  }> | null;
  lifecycleCodes: Record<string, string>;
}

export type MoneyByCurrency = Record<string, number>;

export interface MonthlyPoint {
  month: string;
  leads: number;
  opportunities: number;
  won: number;
}

export interface Kpis {
  customers: number;
  activeCustomers: number;
  newCustomers: number;
  newLeads: number;
  openLeads: number;
  openOpportunities: number;
  estimatedPipeline: MoneyByCurrency;
  weightedPipeline: MoneyByCurrency;
  opportunitiesWithoutAmount: number;
  quotationsSent: number;
  quotedValue: MoneyByCurrency;
  quotationConversionRate: number | null;
  winRate: number | null;
  wonOpportunities: number;
  lostOpportunities: number;
  customerVisits: number;
  completedActivities: number;
  overdueFollowUps: number;
  confirmedOrders: MoneyByCurrency | null;
  invoicedRevenue: MoneyByCurrency | null;
  collectedRevenue: MoneyByCurrency | null;
  customerRetentionRate: number | null;
  productInterest: Array<{ productFamilyId: Id; count: number }>;
  trend: MonthlyPoint[];
}

export const VISIT_ACTIVITY_CODES = ["onsite_visit", "dealer_visit", "meeting"];

const same = (a: Id | null | undefined, b: Id | null | undefined) =>
  a != null && b != null && String(a) === String(b);

const dayOf = (value: string | null | undefined) =>
  value ? value.slice(0, 10) : null;

const inRange = (value: string | null | undefined, filters: KpiFilters) => {
  const day = dayOf(value);
  if (!day) return false;
  if (filters.from && day < filters.from) return false;
  if (filters.to && day > filters.to) return false;
  return true;
};

const addMoney = (
  bucket: MoneyByCurrency,
  currency: string | null | undefined,
  amount: number | null | undefined,
) => {
  if (amount == null || !Number.isFinite(Number(amount))) return;
  const key = (currency || "UNSPECIFIED").toUpperCase();
  bucket[key] = Math.round(((bucket[key] ?? 0) + Number(amount)) * 100) / 100;
};

const ratio = (numerator: number, denominator: number) =>
  denominator === 0 ? null : Math.round((numerator / denominator) * 1000) / 10;

const shiftPeriod = (from: string, to: string) => {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  const length = end - start + 86_400_000;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { from: iso(start - length), to: iso(start - 86_400_000) };
};

export const computeKpis = (
  data: KpiDataset,
  filters: KpiFilters,
  today: string,
): Kpis => {
  const modelsByCompany = new Map<
    string,
    KpiDataset["companyBusinessModels"]
  >();
  for (const row of data.companyBusinessModels) {
    const key = String(row.company_id);
    modelsByCompany.set(key, [...(modelsByCompany.get(key) ?? []), row]);
  }
  const familiesByCompany = new Map<string, Set<string>>();
  for (const row of data.productInterests) {
    if (row.product_family_id == null) continue;
    const key = String(row.company_id);
    familiesByCompany.set(
      key,
      (familiesByCompany.get(key) ?? new Set()).add(
        String(row.product_family_id),
      ),
    );
  }

  const companyMatches = (company: KpiCompany | undefined): boolean => {
    if (!company) {
      // Records without a customer only pass when no customer level filter is active
      return !(
        filters.territoryId ||
        filters.country ||
        filters.lifecycleStatusId ||
        filters.categoryId ||
        filters.businessModelId ||
        filters.salesChannelId ||
        filters.productFamilyId
      );
    }
    if (filters.territoryId && !same(company.territory_id, filters.territoryId))
      return false;
    if (
      filters.country &&
      (company.country ?? "").toUpperCase() !== filters.country.toUpperCase()
    )
      return false;
    if (
      filters.lifecycleStatusId &&
      !same(company.lifecycle_status_id, filters.lifecycleStatusId)
    )
      return false;
    if (filters.categoryId && !same(company.category_id, filters.categoryId))
      return false;
    const models = modelsByCompany.get(String(company.id)) ?? [];
    if (
      filters.businessModelId &&
      !models.some((m) => same(m.business_model_id, filters.businessModelId))
    )
      return false;
    if (
      filters.salesChannelId &&
      !models.some((m) => same(m.sales_channel_id, filters.salesChannelId))
    )
      return false;
    if (
      filters.productFamilyId &&
      !familiesByCompany
        .get(String(company.id))
        ?.has(String(filters.productFamilyId))
    ) {
      return false;
    }
    return true;
  };

  const companies = new Map(
    data.companies.map((company) => [String(company.id), company]),
  );
  const companyOf = (id: Id | null | undefined) =>
    id == null ? undefined : companies.get(String(id));
  const salesMatches = (salesId: Id | null | undefined) =>
    !filters.salesId || same(salesId, filters.salesId);

  const filteredCompanies = data.companies.filter(
    (company) => companyMatches(company) && salesMatches(company.sales_id),
  );
  const lifecycleCode = (company: KpiCompany) =>
    company.lifecycle_status_id == null
      ? null
      : data.lifecycleCodes[String(company.lifecycle_status_id)];

  const leads = data.leads.filter(
    (lead) =>
      salesMatches(lead.sales_id) &&
      (!filters.businessModelId ||
        same(lead.business_model_id, filters.businessModelId)) &&
      (!filters.territoryId || same(lead.territory_id, filters.territoryId)) &&
      (!filters.country ||
        (lead.country ?? "").toUpperCase() === filters.country.toUpperCase()),
  );

  const stageType = (deal: KpiDataset["deals"][number]) => {
    const stage = data.pipelineStages.find(
      (s) =>
        s.code === deal.stage &&
        (deal.pipeline_id == null || same(s.pipeline_id, deal.pipeline_id)),
    );
    if (stage) return stage;
    // Deals created before pipelines existed keep the Atomic CRM stage names
    return {
      stage_type:
        deal.stage === "won" ? "won" : deal.stage === "lost" ? "lost" : "open",
      probability: null,
    };
  };
  const familiesByDeal = new Map<string, Set<string>>();
  for (const row of data.dealProducts) {
    if (row.product_family_id == null) continue;
    const key = String(row.deal_id);
    familiesByDeal.set(
      key,
      (familiesByDeal.get(key) ?? new Set()).add(String(row.product_family_id)),
    );
  }
  const deals = data.deals.filter(
    (deal) =>
      !deal.archived_at &&
      salesMatches(deal.sales_id) &&
      (!filters.businessModelId ||
        deal.business_model_id == null ||
        same(deal.business_model_id, filters.businessModelId)) &&
      companyMatches(companyOf(deal.company_id)) &&
      (!filters.productFamilyId ||
        familiesByDeal
          .get(String(deal.id))
          ?.has(String(filters.productFamilyId)) ||
        familiesByCompany
          .get(String(deal.company_id))
          ?.has(String(filters.productFamilyId))),
  );

  const estimatedPipeline: MoneyByCurrency = {};
  const weightedPipeline: MoneyByCurrency = {};
  let openOpportunities = 0;
  let opportunitiesWithoutAmount = 0;
  let won = 0;
  let lost = 0;
  for (const deal of deals) {
    const stage = stageType(deal);
    if (stage.stage_type === "open") {
      openOpportunities += 1;
      if (deal.amount == null) {
        opportunitiesWithoutAmount += 1;
        continue;
      }
      addMoney(estimatedPipeline, deal.currency, deal.amount);
      const probability = deal.probability ?? stage.probability;
      if (probability != null)
        addMoney(
          weightedPipeline,
          deal.currency,
          (deal.amount * probability) / 100,
        );
    } else if (
      inRange(deal.closed_at ?? deal.updated_at ?? deal.created_at, filters)
    ) {
      if (stage.stage_type === "won") won += 1;
      else lost += 1;
    }
  }

  const quotations = data.quotations.filter(
    (q) =>
      q.status !== "superseded" &&
      salesMatches(q.sales_id) &&
      companyMatches(companyOf(q.company_id)),
  );
  const sent = quotations.filter(
    (q) =>
      ["sent", "accepted", "declined", "expired"].includes(q.status) &&
      inRange(q.sent_at ?? q.created_at, filters),
  );
  const quotedValue: MoneyByCurrency = {};
  for (const q of sent) addMoney(quotedValue, q.currency, q.total_amount);
  const accepted = sent.filter((q) => q.status === "accepted").length;
  const decided = sent.filter((q) =>
    ["accepted", "declined", "expired"].includes(q.status),
  ).length;

  const activities = data.activities.filter(
    (a) => salesMatches(a.sales_id) && companyMatches(companyOf(a.company_id)),
  );
  const completed = activities.filter(
    (a) => a.status === "completed" && inRange(a.start_at, filters),
  );

  const overdue =
    data.actionItems.filter(
      (item) =>
        ["open", "in_progress"].includes(item.status) &&
        item.due_date != null &&
        item.due_date < today &&
        salesMatches(item.sales_id) &&
        companyMatches(companyOf(item.company_id)),
    ).length +
    deals.filter(
      (deal) =>
        stageType(deal).stage_type === "open" &&
        deal.follow_up_date &&
        deal.follow_up_date < today,
    ).length +
    leads.filter(
      (lead) =>
        ["new", "contacted", "qualified"].includes(lead.status) &&
        lead.follow_up_date &&
        lead.follow_up_date < today,
    ).length;

  const erpCompanyMatches = (companyId: Id | null | undefined) => {
    const company = companyOf(companyId);
    return companyMatches(company) && salesMatches(company?.sales_id ?? null);
  };
  const hasOrders = data.salesOrders !== null && data.salesOrders.length > 0;
  const hasInvoices = data.invoices !== null && data.invoices.length > 0;
  let confirmedOrders: MoneyByCurrency | null = null;
  let customerRetentionRate: number | null = null;
  if (hasOrders) {
    confirmedOrders = {};
    const orders = data.salesOrders!.filter((o) =>
      erpCompanyMatches(o.company_id),
    );
    for (const order of orders.filter((o) => inRange(o.order_date, filters))) {
      addMoney(confirmedOrders, order.currency, order.total_amount);
    }
    if (filters.from && filters.to) {
      const previous = shiftPeriod(filters.from, filters.to);
      const buyers = (range: KpiFilters) =>
        new Set(
          orders
            .filter((o) => o.company_id != null && inRange(o.order_date, range))
            .map((o) => String(o.company_id)),
        );
      const before = buyers(previous);
      const now = buyers(filters);
      customerRetentionRate = ratio(
        [...before].filter((id) => now.has(id)).length,
        before.size,
      );
    }
  }
  let invoicedRevenue: MoneyByCurrency | null = null;
  let collectedRevenue: MoneyByCurrency | null = null;
  if (hasInvoices) {
    invoicedRevenue = {};
    collectedRevenue = {};
    for (const invoice of data.invoices!.filter(
      (i) =>
        erpCompanyMatches(i.company_id) && inRange(i.invoice_date, filters),
    )) {
      addMoney(invoicedRevenue, invoice.currency, invoice.invoice_amount);
      addMoney(collectedRevenue, invoice.currency, invoice.paid_amount);
    }
  }

  const interestCounts = new Map<string, number>();
  const filteredIds = new Set(filteredCompanies.map((c) => String(c.id)));
  for (const row of data.productInterests) {
    if (
      row.product_family_id == null ||
      !filteredIds.has(String(row.company_id))
    )
      continue;
    interestCounts.set(
      String(row.product_family_id),
      (interestCounts.get(String(row.product_family_id)) ?? 0) + 1,
    );
  }
  const dealIds = new Set(deals.map((d) => String(d.id)));
  for (const row of data.dealProducts) {
    if (row.product_family_id == null || !dealIds.has(String(row.deal_id)))
      continue;
    interestCounts.set(
      String(row.product_family_id),
      (interestCounts.get(String(row.product_family_id)) ?? 0) + 1,
    );
  }

  const trendMap = new Map<string, MonthlyPoint>();
  const bump = (
    date: string | null | undefined,
    key: keyof Omit<MonthlyPoint, "month">,
  ) => {
    if (!date || !inRange(date, filters)) return;
    const month = date.slice(0, 7);
    const point = trendMap.get(month) ?? {
      month,
      leads: 0,
      opportunities: 0,
      won: 0,
    };
    point[key] += 1;
    trendMap.set(month, point);
  };
  leads.forEach((lead) => bump(lead.created_at, "leads"));
  deals.forEach((deal) => {
    bump(deal.created_at, "opportunities");
    if (stageType(deal).stage_type === "won")
      bump(deal.closed_at ?? deal.updated_at ?? deal.created_at, "won");
  });

  return {
    customers: filteredCompanies.length,
    activeCustomers: filteredCompanies.filter(
      (c) => lifecycleCode(c) === "active",
    ).length,
    newCustomers: filteredCompanies.filter((c) =>
      inRange(c.created_at, filters),
    ).length,
    newLeads: leads.filter((lead) => inRange(lead.created_at, filters)).length,
    openLeads: leads.filter((lead) =>
      ["new", "contacted", "qualified"].includes(lead.status),
    ).length,
    openOpportunities,
    estimatedPipeline,
    weightedPipeline,
    opportunitiesWithoutAmount,
    quotationsSent: sent.length,
    quotedValue,
    quotationConversionRate: ratio(accepted, decided),
    winRate: ratio(won, won + lost),
    wonOpportunities: won,
    lostOpportunities: lost,
    customerVisits: completed.filter((a) =>
      VISIT_ACTIVITY_CODES.includes(a.activity_type_code ?? ""),
    ).length,
    completedActivities: completed.length,
    overdueFollowUps: overdue,
    confirmedOrders,
    invoicedRevenue,
    collectedRevenue,
    customerRetentionRate,
    productInterest: [...interestCounts.entries()]
      .map(([productFamilyId, count]) => ({ productFamilyId, count }))
      .sort((a, b) => b.count - a.count),
    trend: [...trendMap.values()].sort((a, b) =>
      a.month.localeCompare(b.month),
    ),
  };
};
