import { useMemo } from "react";
import { useGetList } from "ra-core";
import { Factory, Handshake, Package, Tractor, Wrench } from "lucide-react";
import {
  CUSTOMER_GROUPS,
  getCustomerGroupMeta,
  inferCustomerGroupCode,
  type CustomerGroupCode,
  type CustomerGroupMeta,
} from "../../domain/fieldSales";
import { useDdcLocale } from "../../ui/labels";

const GROUP_ICONS: Record<CustomerGroupCode, typeof Factory> = {
  sugar_mill: Factory,
  dealer: Handshake,
  repair_shop: Wrench,
  parts_shop: Package,
  farm_owner: Tractor,
};

export interface CustomerGroupOption extends CustomerGroupMeta {
  optionId: number | string | null;
}

/** Loads the 5 customer_group master_options and pairs them with visual metadata. */
export function useCustomerGroupOptions() {
  const { data: options = [], isPending } = useGetList("master_options", {
    filter: { category: "customer_group" },
    pagination: { page: 1, perPage: 20 },
    sort: { field: "sort_order", order: "ASC" },
  });

  const groups = useMemo<CustomerGroupOption[]>(() => {
    const byCode = new Map(
      options.map((opt) => [String(opt.code), opt.id as number | string]),
    );
    return CUSTOMER_GROUPS.map((meta) => ({
      ...meta,
      optionId: byCode.get(meta.code) ?? null,
    }));
  }, [options]);

  const byId = useMemo(() => {
    const map = new Map<string, CustomerGroupOption>();
    for (const g of groups) {
      if (g.optionId != null) map.set(String(g.optionId), g);
    }
    return map;
  }, [groups]);

  const byCode = useMemo(
    () => new Map(groups.map((g) => [g.code, g])),
    [groups],
  );

  const resolveForCompany = (company: {
    customer_group_id?: unknown;
    name?: string | null;
  }): { group: CustomerGroupOption | null; inferred: boolean } => {
    if (company.customer_group_id != null) {
      const exact = byId.get(String(company.customer_group_id));
      if (exact) return { group: exact, inferred: false };
    }
    const inferredCode = inferCustomerGroupCode(company.name);
    if (inferredCode) {
      const suggested = byCode.get(inferredCode) ?? null;
      if (suggested) return { group: suggested, inferred: true };
    }
    return { group: null, inferred: false };
  };

  return { groups, byId, byCode, resolveForCompany, isPending };
}

export const CustomerGroupIcon = ({
  code,
  className = "size-3.5",
}: {
  code: CustomerGroupCode;
  className?: string;
}) => {
  const Icon = GROUP_ICONS[code] ?? Tractor;
  return <Icon className={className} />;
};

export const CustomerGroupBadge = ({
  code,
  inferred = false,
  className = "",
}: {
  code: CustomerGroupCode | string | null | undefined;
  inferred?: boolean;
  className?: string;
}) => {
  const locale = useDdcLocale();
  const meta = getCustomerGroupMeta(code);
  if (!meta) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${meta.badgeClass} ${inferred ? "border-dashed opacity-85" : ""} ${className}`}
      title={
        inferred
          ? locale === "th"
            ? "คาดการณ์จากชื่อ (ยังไม่ยืนยันกลุ่มลูกค้า)"
            : "Suggested from name (unconfirmed)"
          : undefined
      }
    >
      <CustomerGroupIcon code={meta.code} className="size-3 shrink-0" />
      <span>{locale === "en" ? meta.labelEn : meta.labelTh}</span>
    </span>
  );
};
