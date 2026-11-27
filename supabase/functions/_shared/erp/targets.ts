import type { MappedRecord } from "./mapping.ts";
import type { CrmRow, ErpEntityKey, SyncStore } from "./types.ts";

/** A record that must not be written, with the reason shown to the administrator. */
export class TargetRejection extends Error {
  readonly errorType: "validation" | "conflict";
  constructor(errorType: "validation" | "conflict", message: string) {
    super(message);
    this.name = "TargetRejection";
    this.errorType = errorType;
  }
}

export interface PreparedTarget {
  data: Record<string, unknown>;
  /** Existing CRM row to link instead of creating a new one. */
  existingRow?: CrmRow;
}

interface TargetContext {
  store: SyncStore;
  dataAreaId: string;
  /** True when the ERP record is already linked to a CRM row. */
  isLinked: boolean;
}

type Prepare = (
  mapped: MappedRecord,
  context: TargetContext,
) => Promise<PreparedTarget>;

const resolveLinkedId = async (
  { store, dataAreaId }: TargetContext,
  entity: ErpEntityKey,
  erpKey: unknown,
): Promise<number | string | null> => {
  if (erpKey === null || erpKey === undefined || erpKey === "") return null;
  const link = await store.findExternalId(entity, dataAreaId, String(erpKey));
  return link ? link.crm_id : null;
};

const withProduct = async (mapped: MappedRecord, context: TargetContext) => ({
  product_id: await resolveLinkedId(
    context,
    "released_products",
    mapped.data.erp_item_number,
  ),
});

const withCompany = async (mapped: MappedRecord, context: TargetContext) => ({
  company_id: await resolveLinkedId(
    context,
    "customers",
    mapped.data.erp_customer_account,
  ),
});

/**
 * ERP items are linked to the CRM product carrying the same part number.
 * The same item number in another legal entity is NOT assumed to be the same
 * product: that equivalence is a DDC decision, so it is reported as a conflict.
 */
const prepareProduct =
  (entity: ErpEntityKey): Prepare =>
  async (mapped, { store, isLinked }) => {
    if (isLinked) return { data: mapped.data };
    const partNumber = mapped.data.part_number;
    if (!partNumber) {
      throw new TargetRejection(
        "validation",
        "The ERP item has no item number",
      );
    }
    const [existing] = await store.findRows("products", {
      part_number: partNumber,
    });
    if (!existing) return { data: mapped.data };

    const links = await store.findRows("erp_external_ids", {
      crm_table: "products",
      crm_id: existing.id,
    });
    const linkedElsewhere = links.some((link) => link.entity === entity);
    if (linkedElsewhere) {
      throw new TargetRejection(
        "conflict",
        `Part number ${String(partNumber)} is already linked to an ERP item of another legal entity. ` +
          "Confirm whether both items are the same product before linking.",
      );
    }
    return { data: mapped.data, existingRow: existing };
  };

const prepareSalesOrderLine: Prepare = async (mapped, context) => {
  const [order] = await context.store.findRows("erp_sales_orders", {
    data_area_id: context.dataAreaId,
    sales_order_number: mapped.data.sales_order_number,
  });
  if (!order) {
    throw new TargetRejection(
      "validation",
      `Sales order ${String(mapped.data.sales_order_number)} is not synchronized yet`,
    );
  }
  return {
    data: {
      ...mapped.data,
      data_area_id: context.dataAreaId,
      sales_order_id: order.id,
      ...(await withProduct(mapped, context)),
    },
  };
};

const prepareDelivery: Prepare = async (mapped, context) => {
  const [order] = mapped.data.sales_order_number
    ? await context.store.findRows("erp_sales_orders", {
        data_area_id: context.dataAreaId,
        sales_order_number: mapped.data.sales_order_number,
      })
    : [];
  return {
    data: {
      ...mapped.data,
      data_area_id: context.dataAreaId,
      company_id: order?.company_id ?? null,
    },
  };
};

const scoped =
  (
    extra: (
      mapped: MappedRecord,
      context: TargetContext,
    ) => Promise<Record<string, unknown>>,
  ): Prepare =>
  async (mapped, context) => ({
    data: {
      ...mapped.data,
      data_area_id: context.dataAreaId,
      ...(await extra(mapped, context)),
    },
  });

const TARGETS: Partial<Record<ErpEntityKey, Prepare>> = {
  customers: async (mapped) => ({ data: mapped.data }),
  contacts: async (mapped) => ({ data: mapped.data }),
  products: prepareProduct("products"),
  released_products: prepareProduct("released_products"),
  inventory_availability: scoped(withProduct),
  price_lists: scoped(async (mapped, context) => ({
    price_key: mapped.erpKey,
    ...(await withProduct(mapped, context)),
  })),
  sales_orders: scoped(withCompany),
  sales_order_lines: prepareSalesOrderLine,
  deliveries: prepareDelivery,
  invoices: scoped(withCompany),
};

/** Entities the engine can read from the ERP. Others (e.g. quotations) are contract only. */
export const isInboundSupported = (entity: ErpEntityKey): boolean =>
  entity in TARGETS;

export const prepareTarget = (
  entity: ErpEntityKey,
  mapped: MappedRecord,
  context: TargetContext,
): Promise<PreparedTarget> => {
  const prepare = TARGETS[entity];
  if (!prepare) {
    throw new TargetRejection(
      "validation",
      `Inbound synchronization is not implemented for ${entity}`,
    );
  }
  return prepare(mapped, context);
};
