import { useListContext } from "ra-core";
import { Link } from "react-router";
import { MapPin, Phone, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDdcLocale } from "../../ui/labels";
import {
  CustomerGroupBadge,
  CustomerGroupIcon,
  useCustomerGroupOptions,
} from "./CustomerGroupBadge";

/**
 * 1-tap 5-Group filter chips for the Customers list + responsive Mobile touch cards
 * above the desktop DataTable so sales reps can browse customers cleanly on phones.
 */
export const CustomerGroupFilterBar = () => {
  const locale = useDdcLocale();
  const { data = [], filterValues, setFilters } = useListContext();
  const { groups, resolveForCompany } = useCustomerGroupOptions();

  const activeGroupId =
    filterValues?.customer_group_id != null
      ? String(filterValues.customer_group_id)
      : "all";

  const selectGroup = (optionId: number | string | null) => {
    const next = { ...filterValues };
    if (optionId == null) delete next.customer_group_id;
    else next.customer_group_id = optionId;
    setFilters(next, undefined);
  };

  return (
    <div className="mb-3 space-y-3">
      {/* 5 Customer Group Quick Filter Chips (Desktop & Mobile) */}
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 max-w-full flex-wrap gap-1.5 pb-1">
          <button
            type="button"
            onClick={() => selectGroup(null)}
            className={`min-h-9 shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition ${
              activeGroupId === "all"
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-background hover:bg-secondary"
            }`}
          >
            {locale === "th" ? "ทุกกลุ่มลูกค้า" : "All groups"}
          </button>
          {groups.map((g) => {
            const active =
              g.optionId != null && activeGroupId === String(g.optionId);
            return (
              <button
                key={g.code}
                type="button"
                disabled={g.optionId == null}
                onClick={() => selectGroup(g.optionId)}
                className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background hover:bg-secondary"
                }`}
              >
                <CustomerGroupIcon code={g.code} className="size-3.5" />
                <span>
                  {g.order}. {locale === "en" ? g.labelEn : g.labelTh}
                </span>
              </button>
            );
          })}
        </div>
        <Button
          size="sm"
          className="shrink-0"
          render={<Link to="/field-visit" />}
        >
          <Plus className="size-4" />
          {locale === "th" ? "บันทึกเข้าพบลูกค้า" : "Log visit"}
        </Button>
      </div>

      {/* Mobile Touch Cards (hidden on md+ where DataTable shines) */}
      <div className="space-y-2 md:hidden">
        {data.map((company) => {
          const groupRes = resolveForCompany(company);
          return (
            <div
              key={String(company.id)}
              className="rounded-xl border bg-card p-3.5 shadow-xs space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <Link
                  to={`/companies/${company.id}/show`}
                  className="min-w-0 flex-1"
                >
                  <div className="text-xs font-mono text-muted-foreground">
                    {company.customer_code || `#${company.id}`}
                  </div>
                  <div className="truncate text-sm font-bold">
                    {company.name}
                  </div>
                </Link>
                {groupRes.group && (
                  <CustomerGroupBadge
                    code={groupRes.group.code}
                    inferred={groupRes.inferred}
                  />
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-xs text-muted-foreground">
                <div className="flex flex-wrap items-center gap-3">
                  {(company.city || company.province) && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3" />
                      {[company.city, company.province]
                        .filter(Boolean)
                        .join(", ")}
                    </span>
                  )}
                  {company.phone_number && (
                    <span className="inline-flex items-center gap-1">
                      <Phone className="size-3" />
                      {company.phone_number}
                    </span>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 text-xs"
                  render={<Link to={`/field-visit?companyId=${company.id}`} />}
                >
                  <Plus className="size-3.5" />
                  {locale === "th" ? "พบลูกค้า" : "Visit"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
