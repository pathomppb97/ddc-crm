import { z } from "zod";

export type FieldType = "string" | "number" | "boolean" | "date";

export type QueryOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "contains"
  | "starts_with"
  | "is_null"
  | "between";

export interface ResourceQuerySchema {
  table: string;
  permissionResource: string;
  supportsSoftDelete: boolean;
  defaultSortField: string;
  fields: Record<string, FieldType>;
}

/**
 * Static allowlist of resources and columns exposed to the controlled Dynamic Query Builder.
 * Sensitive credential/hash columns (e.g. api_keys.key_hash) are NEVER registered here.
 */
export const QUERY_ALLOWLIST: Record<string, ResourceQuerySchema> = {
  companies: {
    table: "companies",
    permissionResource: "customers",
    supportsSoftDelete: true,
    defaultSortField: "updated_at",
    fields: {
      id: "number",
      customer_code: "string",
      name: "string",
      legal_name: "string",
      province: "string",
      city: "string",
      country: "string",
      org_type: "string",
      customer_group_id: "number",
      lifecycle_status_id: "number",
      territory_id: "number",
      sales_id: "number",
      created_at: "date",
      updated_at: "date",
    },
  },
  contacts: {
    table: "contacts",
    permissionResource: "contacts",
    supportsSoftDelete: true,
    defaultSortField: "id",
    fields: {
      id: "number",
      first_name: "string",
      last_name: "string",
      nickname: "string",
      title: "string",
      department: "string",
      line_id: "string",
      company_id: "number",
      sales_id: "number",
      is_primary: "boolean",
      last_seen: "date",
    },
  },
  leads: {
    table: "leads",
    permissionResource: "leads",
    supportsSoftDelete: true,
    defaultSortField: "created_at",
    fields: {
      id: "number",
      lead_no: "string",
      company_name: "string",
      status: "string",
      province: "string",
      territory_id: "number",
      estimated_value: "number",
      currency: "string",
      follow_up_date: "date",
      sales_id: "number",
      created_at: "date",
    },
  },
  deals: {
    table: "deals",
    permissionResource: "opportunities",
    supportsSoftDelete: true,
    defaultSortField: "updated_at",
    fields: {
      id: "number",
      name: "string",
      company_id: "number",
      pipeline_id: "number",
      stage: "string",
      amount: "number",
      currency: "string",
      probability: "number",
      sales_id: "number",
      expected_closing_date: "date",
      created_at: "date",
      updated_at: "date",
    },
  },
  products: {
    table: "products",
    permissionResource: "products",
    supportsSoftDelete: true,
    defaultSortField: "part_number",
    fields: {
      id: "number",
      part_number: "string",
      name: "string",
      name_en: "string",
      node_id: "number",
      brand_id: "number",
      material: "string",
      uom: "string",
      current_revision: "string",
      created_at: "date",
    },
  },
  machine_models: {
    table: "machine_models",
    permissionResource: "machine_applications",
    supportsSoftDelete: false,
    defaultSortField: "model_name",
    fields: {
      id: "number",
      manufacturer_id: "number",
      equipment_type_id: "number",
      model_name: "string",
      series: "string",
      year_from: "number",
      year_to: "number",
      is_active: "boolean",
    },
  },
  customer_machines: {
    table: "customer_machines",
    permissionResource: "customers",
    supportsSoftDelete: true,
    defaultSortField: "updated_at",
    fields: {
      id: "number",
      company_id: "number",
      machine_model_id: "number",
      serial_number: "string",
      unit_count: "number",
      model_year: "number",
      status: "string",
      sales_id: "number",
      updated_at: "date",
    },
  },
  quotations: {
    table: "quotations",
    permissionResource: "quotations",
    supportsSoftDelete: true,
    defaultSortField: "created_at",
    fields: {
      id: "number",
      quotation_no: "string",
      revision: "number",
      company_id: "number",
      status: "string",
      currency: "string",
      total_amount: "number",
      valid_until: "date",
      sales_id: "number",
      created_at: "date",
    },
  },
  sales_orders: {
    table: "sales_orders",
    permissionResource: "sales_orders",
    supportsSoftDelete: true,
    defaultSortField: "order_date",
    fields: {
      id: "number",
      order_no: "string",
      company_id: "number",
      quotation_id: "number",
      status: "string",
      currency: "string",
      total_amount: "number",
      order_date: "date",
      sales_id: "number",
    },
  },
  activities: {
    table: "activities",
    permissionResource: "activities",
    supportsSoftDelete: false,
    defaultSortField: "start_at",
    fields: {
      id: "number",
      subject: "string",
      company_id: "number",
      activity_type_id: "number",
      status: "string",
      start_at: "date",
      logged_at: "date",
      sales_id: "number",
    },
  },
  audit_log: {
    table: "audit_log",
    permissionResource: "audit_log",
    supportsSoftDelete: false,
    defaultSortField: "occurred_at",
    fields: {
      id: "number",
      occurred_at: "date",
      actor_sales_id: "number",
      table_name: "string",
      record_id: "string",
      action: "string",
      request_id: "string",
    },
  },
};

const OPERATORS_BY_TYPE: Record<FieldType, readonly QueryOperator[]> = {
  string: ["eq", "neq", "in", "contains", "starts_with", "is_null"],
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "in", "between", "is_null"],
  boolean: ["eq", "neq", "is_null"],
  date: ["eq", "neq", "gt", "gte", "lt", "lte", "between", "is_null"],
};

export const FilterClauseSchema = z.object({
  field: z.string().regex(/^[a-z][a-z0-9_]*$/),
  op: z.enum([
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "in",
    "contains",
    "starts_with",
    "is_null",
    "between",
  ]),
  value: z.unknown().optional(),
});

export const DynamicQueryRequestSchema = z.object({
  resource: z.string().regex(/^[a-z][a-z0-9_]*$/),
  select: z
    .array(z.string().regex(/^[a-z][a-z0-9_]*$/))
    .min(1)
    .max(40)
    .optional(),
  filters: z.array(FilterClauseSchema).max(25).default([]),
  sort: z
    .array(
      z.object({
        field: z.string().regex(/^[a-z][a-z0-9_]*$/),
        direction: z.enum(["asc", "desc"]).default("asc"),
      }),
    )
    .max(5)
    .default([]),
  page: z.number().int().min(1).max(10000).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
  includeDeleted: z.boolean().default(false),
});

export type DynamicQueryRequest = z.infer<typeof DynamicQueryRequestSchema>;

export interface CompiledAllowlistedQuery {
  resource: string;
  table: string;
  permissionResource: string;
  columns: string[];
  whereSql: string;
  orderBySql: string;
  params: unknown[];
  limit: number;
  offset: number;
}

export class QueryValidationError extends Error {
  readonly code: "INVALID_QUERY" | "INVALID_FILTER_FIELD" | "INVALID_OPERATOR";

  constructor(
    code: "INVALID_QUERY" | "INVALID_FILTER_FIELD" | "INVALID_OPERATOR",
    message: string,
  ) {
    super(message);
    this.code = code;
  }
}

function escapeLike(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function coerceScalar(fieldType: FieldType, value: unknown, field: string) {
  if (fieldType === "string") {
    if (typeof value !== "string" || value.length > 500) {
      throw new QueryValidationError(
        "INVALID_QUERY",
        `Expected string (<=500 chars) for ${field}`,
      );
    }
    return value;
  }
  if (fieldType === "number") {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) {
      throw new QueryValidationError(
        "INVALID_QUERY",
        `Expected finite number for ${field}`,
      );
    }
    return n;
  }
  if (fieldType === "boolean") {
    if (typeof value !== "boolean") {
      throw new QueryValidationError(
        "INVALID_QUERY",
        `Expected boolean for ${field}`,
      );
    }
    return value;
  }
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new QueryValidationError(
      "INVALID_QUERY",
      `Expected ISO date string for ${field}`,
    );
  }
  return value;
}

/**
 * Compiles an untrusted DynamicQueryRequest into strictly parameterized SQL fragments.
 * Every table and column identifier comes ONLY from QUERY_ALLOWLIST.
 */
export function compileAllowlistedQuery(
  raw: unknown,
): CompiledAllowlistedQuery {
  const parsed = DynamicQueryRequestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new QueryValidationError(
      "INVALID_QUERY",
      parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    );
  }
  const req = parsed.data;
  const schema = QUERY_ALLOWLIST[req.resource];
  if (!schema) {
    throw new QueryValidationError(
      "INVALID_QUERY",
      `Resource "${req.resource}" is not allowlisted for dynamic queries`,
    );
  }

  const allowedFields = Object.keys(schema.fields);
  const columns = req.select ?? allowedFields;
  for (const col of columns) {
    if (!(col in schema.fields)) {
      throw new QueryValidationError(
        "INVALID_FILTER_FIELD",
        `Column "${col}" is not allowlisted on resource "${req.resource}"`,
      );
    }
  }

  const clauses: string[] = [];
  const params: unknown[] = [];

  if (schema.supportsSoftDelete && !req.includeDeleted) {
    clauses.push(`"deleted_at" IS NULL`);
  }

  for (const filter of req.filters) {
    const fieldType = schema.fields[filter.field];
    if (!fieldType) {
      throw new QueryValidationError(
        "INVALID_FILTER_FIELD",
        `Filter field "${filter.field}" is not allowlisted on "${req.resource}"`,
      );
    }
    if (!OPERATORS_BY_TYPE[fieldType].includes(filter.op)) {
      throw new QueryValidationError(
        "INVALID_OPERATOR",
        `Operator "${filter.op}" is not allowed for ${fieldType} field "${filter.field}"`,
      );
    }

    const colIdent = `"${filter.field}"`;
    switch (filter.op) {
      case "is_null": {
        if (typeof filter.value !== "boolean") {
          throw new QueryValidationError(
            "INVALID_QUERY",
            `Operator is_null requires a boolean value for ${filter.field}`,
          );
        }
        clauses.push(`${colIdent} IS ${filter.value ? "" : "NOT "}NULL`);
        break;
      }
      case "in": {
        if (
          !Array.isArray(filter.value) ||
          filter.value.length === 0 ||
          filter.value.length > 100
        ) {
          throw new QueryValidationError(
            "INVALID_QUERY",
            `Operator in requires 1..100 elements for ${filter.field}`,
          );
        }
        const coerced = filter.value.map((v) =>
          coerceScalar(fieldType, v, filter.field),
        );
        params.push(coerced);
        clauses.push(`${colIdent} = ANY($${params.length})`);
        break;
      }
      case "between": {
        if (!Array.isArray(filter.value) || filter.value.length !== 2) {
          throw new QueryValidationError(
            "INVALID_QUERY",
            `Operator between requires [min, max] tuple for ${filter.field}`,
          );
        }
        const lo = coerceScalar(fieldType, filter.value[0], filter.field);
        const hi = coerceScalar(fieldType, filter.value[1], filter.field);
        params.push(lo, hi);
        clauses.push(
          `${colIdent} BETWEEN $${params.length - 1} AND $${params.length}`,
        );
        break;
      }
      case "contains": {
        const str = String(coerceScalar("string", filter.value, filter.field));
        params.push(`%${escapeLike(str)}%`);
        clauses.push(`${colIdent} ILIKE $${params.length} ESCAPE '\\'`);
        break;
      }
      case "starts_with": {
        const str = String(coerceScalar("string", filter.value, filter.field));
        params.push(`${escapeLike(str)}%`);
        clauses.push(`${colIdent} ILIKE $${params.length} ESCAPE '\\'`);
        break;
      }
      default: {
        const sqlOp: Record<string, string> = {
          eq: "=",
          neq: "<>",
          gt: ">",
          gte: ">=",
          lt: "<",
          lte: "<=",
        };
        const val = coerceScalar(fieldType, filter.value, filter.field);
        params.push(val);
        clauses.push(`${colIdent} ${sqlOp[filter.op]} $${params.length}`);
        break;
      }
    }
  }

  const sortSpecs =
    req.sort.length > 0
      ? req.sort
      : [{ field: schema.defaultSortField, direction: "desc" as const }];

  const orderParts = sortSpecs.map((s) => {
    if (!(s.field in schema.fields)) {
      throw new QueryValidationError(
        "INVALID_FILTER_FIELD",
        `Sort field "${s.field}" is not allowlisted on "${req.resource}"`,
      );
    }
    return `"${s.field}" ${s.direction === "desc" ? "DESC" : "ASC"}`;
  });

  return {
    resource: req.resource,
    table: schema.table,
    permissionResource: schema.permissionResource,
    columns,
    whereSql: clauses.length > 0 ? clauses.join(" AND ") : "TRUE",
    orderBySql: orderParts.join(", "),
    params,
    limit: req.pageSize,
    offset: (req.page - 1) * req.pageSize,
  };
}
