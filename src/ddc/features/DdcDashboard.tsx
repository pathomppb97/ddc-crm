import { DesignSlots } from "@/ddc/pages/pageDesign";
import { ERP_ENABLED } from "../featureFlags";
import { useMemo } from "react";
import { useGetList, useTranslate } from "ra-core";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { ResponsiveBar } from "@nivo/bar";
import { Clock, FileSpreadsheet, Package, Plus, Tractor } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  computeKpis,
  type KpiFilters,
  type MoneyByCurrency,
} from "../domain/kpis";
import { formatMoney, useDdcLocale, useLocalizedName } from "../ui/labels";
import {
  CustomerGroupIcon,
  useCustomerGroupOptions,
} from "./field/CustomerGroupBadge";
import { downloadXlsx } from "./spreadsheet";
import { useDdcDataProvider } from "./useDdcDataProvider";

const FILTER_KEYS = [
  "from",
  "to",
  "businessModelId",
  "salesChannelId",
  "territoryId",
  "country",
  "salesId",
  "lifecycleStatusId",
  "categoryId",
  "productFamilyId",
] as const;

const startOfYear = () => `${new Date().getFullYear()}-01-01`;
const today = () => new Date().toISOString().slice(0, 10);

const listLink = (resource: string, filter: Record<string, unknown>) =>
  `/${resource}?filter=${encodeURIComponent(JSON.stringify(filter))}`;

const Kpi = ({
  label,
  value,
  hint,
  to,
}: {
  label: string;
  value: string;
  hint?: string;
  to?: string;
}) => {
  const body = (
    <Card className="h-full transition-colors hover:bg-muted/40">
      <CardContent className="pt-6">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        {hint ? (
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </CardContent>
    </Card>
  );
  return to ? (
    <Link to={to} className="block">
      {body}
    </Link>
  ) : (
    body
  );
};

const FilterSelect = ({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ id: unknown; name: string }>;
}) => (
  <label className="flex min-w-0 flex-col justify-end gap-2 text-xs">
    <span className="text-muted-foreground">{label}</span>
    <select
      className="h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">—</option>
      {options.map((option) => (
        <option key={String(option.id)} value={String(option.id)}>
          {option.name}
        </option>
      ))}
    </select>
  </label>
);

const useOptions = (resource: string, filter: Record<string, unknown> = {}) => {
  const localizedName = useLocalizedName();
  const { data = [] } = useGetList(resource, {
    filter,
    pagination: { page: 1, perPage: 500 },
    sort: { field: "id", order: "ASC" },
  });
  return data.map((row) => ({
    id: row.id,
    name: row.first_name
      ? `${row.first_name} ${row.last_name ?? ""}`.trim()
      : localizedName(row),
  }));
};

export const DdcDashboard = () => {
  const translate = useTranslate();
  const locale = useDdcLocale();
  const dataProvider = useDdcDataProvider();
  const [params, setParams] = useSearchParams();
  const filters: KpiFilters = useMemo(() => {
    const value = Object.fromEntries(
      FILTER_KEYS.map((key) => [key, params.get(key) || null]),
    );
    return {
      ...value,
      from: value.from ?? startOfYear(),
      to: value.to ?? today(),
    };
  }, [params]);
  const setFilter = (key: (typeof FILTER_KEYS)[number], value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const { data, isPending, error } = useQuery({
    queryKey: ["ddc", "dashboard"],
    queryFn: () => dataProvider.getDashboardData(),
  });
  const kpis = useMemo(
    () => (data ? computeKpis(data, filters, today()) : null),
    [data, filters],
  );

  const businessModels = useOptions("business_models");
  const territories = useOptions("territories");
  const sales = useOptions("sales");
  const channels = useOptions("master_options", { category: "sales_channel" });
  const lifecycle = useOptions("master_options", {
    category: "customer_lifecycle_status",
  });
  const categories = useOptions("master_options", {
    category: "customer_category",
  });
  const families = useOptions("product_hierarchy_nodes", { level: "family" });
  const { groups: customerGroups, resolveForCompany } =
    useCustomerGroupOptions();
  const { data: allCompanies = [] } = useGetList("companies", {
    pagination: { page: 1, perPage: 2000 },
    sort: { field: "id", order: "ASC" },
  });
  const { data: allCapacities = [] } = useGetList(
    "customer_capacity_profiles",
    {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: "updated_at", order: "DESC" },
    },
  );
  const { data: allActivityProducts = [] } = useGetList("activity_products", {
    pagination: { page: 1, perPage: 2000 },
    sort: { field: "id", order: "DESC" },
  });

  const fieldSummary = useMemo(() => {
    const groupCounts = new Map<string, number>();
    for (const c of allCompanies) {
      const code = resolveForCompany(c).group?.code;
      if (code) groupCounts.set(code, (groupCounts.get(code) ?? 0) + 1);
    }
    const latestCapByCompany = new Map<
      string,
      (typeof allCapacities)[number]
    >();
    for (const cap of allCapacities) {
      const cid = String(cap.company_id);
      if (!latestCapByCompany.has(cid)) latestCapByCompany.set(cid, cap);
    }
    let totalVehicles = 0;
    let totalTons = 0;
    for (const cap of latestCapByCompany.values()) {
      totalVehicles += Number(cap.total_vehicles ?? 0);
      totalTons += Number(cap.total_tons_per_season ?? 0);
    }
    const totalRequestedParts = allActivityProducts.reduce(
      (sum, row) => sum + Number(row.quantity ?? 0),
      0,
    );
    return { groupCounts, totalVehicles, totalTons, totalRequestedParts };
  }, [allCompanies, allCapacities, allActivityProducts, resolveForCompany]);
  const familyName = (id: unknown) =>
    families.find((f) => String(f.id) === String(id))?.name ?? String(id);

  const money = (value: MoneyByCurrency | null) => {
    if (value === null) return translate("ddc.dashboard.not_available");
    const entries = Object.entries(value);
    return entries.length
      ? entries
          .map(([currency, amount]) => formatMoney(amount, locale, currency))
          .join(" · ")
      : formatMoney(0, locale);
  };
  const percent = (value: number | null) =>
    value === null
      ? "—"
      : `${value.toLocaleString(locale === "th" ? "th-TH" : "en-US")}%`;
  const count = (value: number) =>
    value.toLocaleString(locale === "th" ? "th-TH" : "en-US");

  if (error) return <p className="p-4 text-red-700">{String(error)}</p>;

  const rows = kpis
    ? [
        ["ddc.dashboard.customers", count(kpis.customers)],
        ["ddc.dashboard.active_customers", count(kpis.activeCustomers)],
        ["ddc.dashboard.new_customers", count(kpis.newCustomers)],
        ["ddc.dashboard.new_leads", count(kpis.newLeads)],
        ["ddc.dashboard.open_opportunities", count(kpis.openOpportunities)],
        ["ddc.dashboard.estimated_pipeline", money(kpis.estimatedPipeline)],
        ["ddc.dashboard.weighted_pipeline", money(kpis.weightedPipeline)],
        ["ddc.dashboard.quoted_value", money(kpis.quotedValue)],
        [
          "ddc.dashboard.quotation_conversion",
          percent(kpis.quotationConversionRate),
        ],
        ["ddc.dashboard.win_rate", percent(kpis.winRate)],
        ["ddc.dashboard.customer_visits", count(kpis.customerVisits)],
        ["ddc.dashboard.overdue", count(kpis.overdueFollowUps)],
        ["ddc.dashboard.confirmed_orders", money(kpis.confirmedOrders)],
        ["ddc.dashboard.invoiced_revenue", money(kpis.invoicedRevenue)],
        ["ddc.dashboard.collected_revenue", money(kpis.collectedRevenue)],
        ["ddc.dashboard.retention", percent(kpis.customerRetentionRate)],
      ].filter(
        ([key]) =>
          ERP_ENABLED ||
          ![
            "ddc.dashboard.confirmed_orders",
            "ddc.dashboard.invoiced_revenue",
            "ddc.dashboard.collected_revenue",
            "ddc.dashboard.retention",
          ].includes(key),
      )
    : [];

  return (
    <div className="flex flex-col gap-4 py-4">
      {/* Field Sales Quick Launch & 5 Customer Groups Summary (Mobile-First & Desktop) */}
      <Card className="border-primary/25 bg-gradient-to-br from-primary/5 via-background to-background">
        <CardContent className="space-y-4 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">
                {locale === "th"
                  ? "ศูนย์งานขายภาคสนาม (Field Sales)"
                  : "Field Sales Quick Desk"}
              </h2>
              <p className="text-xs text-muted-foreground">
                {locale === "th"
                  ? "บันทึกการเข้าพบลูกค้าครบทั้ง 8 หัวข้อภายใน 60 วินาที · ใช้งานสะดวกทั้งมือถือและคอมพิวเตอร์"
                  : "Log customer visits in 60 seconds across Desktop and Mobile"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                to="/field-visit"
                className={buttonVariants({
                  size: "sm",
                  className: "h-10 font-semibold",
                })}
              >
                <Plus className="size-4" />
                {translate("ddc.field.quick_visit")}
              </Link>
              <Link
                to="/timeline"
                className={buttonVariants({
                  size: "sm",
                  variant: "outline",
                  className: "h-10",
                })}
              >
                <Clock className="size-4" />
                {translate("ddc.field.visit_timeline")}
              </Link>
              <Link
                to="/catalog"
                className={buttonVariants({
                  size: "sm",
                  variant: "outline",
                  className: "h-10",
                })}
              >
                <Package className="size-4" />
                {translate("ddc.field.part_catalog")}
              </Link>
            </div>
          </div>

          {/* 5 Customer Groups clickable summary chips */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {customerGroups.map((g) => {
              const cnt = fieldSummary.groupCounts.get(g.code) ?? 0;
              return (
                <Link
                  key={g.code}
                  to={
                    g.optionId != null
                      ? listLink("companies", { customer_group_id: g.optionId })
                      : "/companies"
                  }
                  className="flex items-center justify-between gap-2 rounded-xl border bg-card px-3 py-2.5 transition hover:bg-secondary/60"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <CustomerGroupIcon
                      code={g.code}
                      className="size-4 shrink-0"
                    />
                    <span className="truncate text-xs font-semibold">
                      {g.order}. {locale === "en" ? g.labelEn : g.labelTh}
                    </span>
                  </div>
                  <span className="text-sm font-bold tabular-nums">{cnt}</span>
                </Link>
              );
            })}
          </div>

          {(fieldSummary.totalVehicles > 0 ||
            fieldSummary.totalTons > 0 ||
            fieldSummary.totalRequestedParts > 0) && (
            <div className="flex flex-wrap gap-4 border-t pt-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Tractor className="size-3.5 text-primary" />
                {locale === "th" ? "ฐานรถที่บันทึกแล้ว: " : "Recorded fleet: "}
                <strong className="text-foreground tabular-nums">
                  {count(fieldSummary.totalVehicles)}{" "}
                  {locale === "th" ? "คัน" : "units"}
                </strong>
              </span>
              <span>
                {locale === "th" ? "กำลังตัดรวม/ฤดู: " : "Harvest capacity: "}
                <strong className="text-foreground tabular-nums">
                  {count(fieldSummary.totalTons)}{" "}
                  {locale === "th" ? "ตัน" : "tons"}
                </strong>
              </span>
              <span>
                {locale === "th"
                  ? "ความต้องการพาร์ท DDC จากหน้างาน: "
                  : "Field part demand: "}
                <strong className="text-foreground tabular-nums">
                  {count(fieldSummary.totalRequestedParts)}{" "}
                  {locale === "th" ? "ชิ้น" : "pcs"}
                </strong>
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-2xl font-semibold">
          {translate("ddc.dashboard.title")}
        </h1>
        <Button
          variant="outline"
          size="sm"
          disabled={!kpis}
          onClick={() =>
            downloadXlsx(
              [
                { key: "metric", header: translate("ddc.dashboard.metric") },
                { key: "value", header: translate("ddc.dashboard.value") },
              ],
              [
                {
                  metric: translate("ddc.dashboard.period"),
                  value: `${filters.from} – ${filters.to}`,
                },
                ...rows.map(([key, value]) => ({
                  metric: translate(key),
                  value,
                })),
              ],
              `ddc-dashboard-${today()}.xlsx`,
            )
          }
        >
          <FileSpreadsheet className="size-4" />
          {translate("ddc.import.export_excel")}
        </Button>
      </div>

      <Card>
        <CardContent className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] items-end gap-x-4 gap-y-5">
          <label className="flex min-w-0 flex-col justify-end gap-2 text-xs">
            <span className="text-muted-foreground">
              {translate("ddc.dashboard.from")}
            </span>
            <Input
              type="date"
              value={filters.from ?? ""}
              onChange={(e) => setFilter("from", e.target.value)}
            />
          </label>
          <label className="flex min-w-0 flex-col justify-end gap-2 text-xs">
            <span className="text-muted-foreground">
              {translate("ddc.dashboard.to")}
            </span>
            <Input
              type="date"
              value={filters.to ?? ""}
              onChange={(e) => setFilter("to", e.target.value)}
            />
          </label>
          <FilterSelect
            label={translate("ddc.dashboard.business_model")}
            value={params.get("businessModelId") ?? ""}
            onChange={(v) => setFilter("businessModelId", v)}
            options={businessModels}
          />
          <FilterSelect
            label={translate("ddc.dashboard.product_family")}
            value={params.get("productFamilyId") ?? ""}
            onChange={(v) => setFilter("productFamilyId", v)}
            options={families}
          />
          <FilterSelect
            label={translate("ddc.dashboard.sales_channel")}
            value={params.get("salesChannelId") ?? ""}
            onChange={(v) => setFilter("salesChannelId", v)}
            options={channels}
          />
          <FilterSelect
            label={translate("ddc.dashboard.territory")}
            value={params.get("territoryId") ?? ""}
            onChange={(v) => setFilter("territoryId", v)}
            options={territories}
          />
          <label className="flex min-w-0 flex-col justify-end gap-2 text-xs">
            <span className="text-muted-foreground">
              {translate("ddc.dashboard.country")}
            </span>
            <Input
              value={params.get("country") ?? ""}
              placeholder="TH"
              onChange={(e) => setFilter("country", e.target.value)}
            />
          </label>
          <FilterSelect
            label={translate("ddc.dashboard.salesperson")}
            value={params.get("salesId") ?? ""}
            onChange={(v) => setFilter("salesId", v)}
            options={sales}
          />
          <FilterSelect
            label={translate("ddc.dashboard.customer_status")}
            value={params.get("lifecycleStatusId") ?? ""}
            onChange={(v) => setFilter("lifecycleStatusId", v)}
            options={lifecycle}
          />
          <FilterSelect
            label={translate("ddc.dashboard.customer_category")}
            value={params.get("categoryId") ?? ""}
            onChange={(v) => setFilter("categoryId", v)}
            options={categories}
          />
        </CardContent>
        <CardContent className="flex justify-end border-t pt-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setParams(new URLSearchParams(), { replace: true })}
          >
            {translate("ra.navigation.clear_filters")}
          </Button>
        </CardContent>
      </Card>

      {isPending || !kpis ? (
        <p className="text-sm text-muted-foreground">
          {translate("ra.page.loading")}
        </p>
      ) : (
        <>
          {data?.truncated ? (
            <p className="text-sm text-amber-700">
              {translate("ddc.dashboard.truncated")}
            </p>
          ) : null}
          <DesignSlots page="dashboard">
            <section
              aria-label={translate("ddc.dashboard.sales_section")}
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
            >
              <Kpi
                label={translate("ddc.dashboard.customers")}
                value={count(kpis.customers)}
                hint={`${translate("ddc.dashboard.active_customers")}: ${count(kpis.activeCustomers)}`}
                to="/companies"
              />
              <Kpi
                label={translate("ddc.dashboard.new_leads")}
                value={count(kpis.newLeads)}
                hint={`${translate("ddc.dashboard.open_leads")}: ${count(kpis.openLeads)}`}
                to={listLink("leads", { status: "new" })}
              />
              <Kpi
                label={translate("ddc.dashboard.open_opportunities")}
                value={count(kpis.openOpportunities)}
                hint={
                  kpis.opportunitiesWithoutAmount
                    ? translate("ddc.dashboard.without_amount", {
                        count: kpis.opportunitiesWithoutAmount,
                      })
                    : undefined
                }
                to="/deals"
              />
              <Kpi
                label={translate("ddc.dashboard.overdue")}
                value={count(kpis.overdueFollowUps)}
                to={listLink("action_items", { status: "open" })}
              />
              <Kpi
                label={translate("ddc.dashboard.estimated_pipeline")}
                value={money(kpis.estimatedPipeline)}
                hint={`${translate("ddc.dashboard.weighted_pipeline")}: ${money(kpis.weightedPipeline)}`}
                to="/deals"
              />
              <Kpi
                label={translate("ddc.dashboard.quoted_value")}
                value={money(kpis.quotedValue)}
                hint={`${translate("ddc.dashboard.quotations_sent")}: ${count(kpis.quotationsSent)}`}
                to={listLink("quotations", { status: "sent" })}
              />
              <Kpi
                label={translate("ddc.dashboard.quotation_conversion")}
                value={percent(kpis.quotationConversionRate)}
                hint={`${translate("ddc.dashboard.win_rate")}: ${percent(kpis.winRate)} (${kpis.wonOpportunities}/${kpis.wonOpportunities + kpis.lostOpportunities})`}
              />
              <Kpi
                label={translate("ddc.dashboard.customer_visits")}
                value={count(kpis.customerVisits)}
                hint={`${translate("ddc.dashboard.completed_activities")}: ${count(kpis.completedActivities)}`}
                to={listLink("activities", { status: "completed" })}
              />
            </section>

            {ERP_ENABLED && (
              <section
                aria-label={translate("ddc.dashboard.erp_section")}
                className="flex flex-col gap-2"
              >
                <h2 className="text-sm font-semibold">
                  {translate("ddc.dashboard.erp_section")}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {translate("ddc.dashboard.erp_hint")}
                </p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Kpi
                    label={translate("ddc.dashboard.confirmed_orders")}
                    value={money(kpis.confirmedOrders)}
                    to="/erp_sales_orders"
                  />
                  <Kpi
                    label={translate("ddc.dashboard.invoiced_revenue")}
                    value={money(kpis.invoicedRevenue)}
                    to="/erp_invoices"
                  />
                  <Kpi
                    label={translate("ddc.dashboard.collected_revenue")}
                    value={money(kpis.collectedRevenue)}
                    to="/erp_invoices"
                  />
                  <Kpi
                    label={translate("ddc.dashboard.retention")}
                    value={percent(kpis.customerRetentionRate)}
                    hint={translate("ddc.dashboard.retention_hint")}
                  />
                </div>
              </section>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {translate("ddc.dashboard.trend")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="h-72">
                  {kpis.trend.length ? (
                    <ResponsiveBar
                      data={kpis.trend.map((point) => ({ ...point }))}
                      keys={["leads", "opportunities", "won"]}
                      indexBy="month"
                      groupMode="grouped"
                      margin={{ top: 10, right: 10, bottom: 40, left: 40 }}
                      padding={0.3}
                      colors={["#64748b", "#0ea5e9", "#10b981"]}
                      enableLabel={false}
                      legendLabel={(d) =>
                        translate(`ddc.dashboard.series.${String(d.id)}`)
                      }
                      legends={[
                        {
                          dataFrom: "keys",
                          anchor: "bottom",
                          direction: "row",
                          translateY: 38,
                          itemWidth: 110,
                          itemHeight: 14,
                          symbolSize: 10,
                        },
                      ]}
                      theme={{ text: { fill: "currentColor" } }}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {translate("ddc.common.no_records")}
                    </p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {translate("ddc.dashboard.product_interest")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="h-72">
                  {kpis.productInterest.length ? (
                    <ResponsiveBar
                      data={kpis.productInterest.slice(0, 10).map((row) => ({
                        family: familyName(row.productFamilyId),
                        count: row.count,
                      }))}
                      keys={["count"]}
                      indexBy="family"
                      layout="horizontal"
                      margin={{ top: 10, right: 20, bottom: 30, left: 140 }}
                      padding={0.3}
                      colors={["#0ea5e9"]}
                      theme={{ text: { fill: "currentColor" } }}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {translate("ddc.common.no_records")}
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          </DesignSlots>
        </>
      )}
    </div>
  );
};
