import {
  applyFieldPermissions,
  enforceWriteFieldAllowlist,
  evaluateAccess,
  markUntrustedContent,
  PlatformError,
  type AuthPrincipal,
  type DataScopeType,
} from "../../shared-auth/src/index";
import {
  compileAllowlistedQuery,
  type CompiledAllowlistedQuery,
} from "../../shared-api/src/index";
import {
  canonicalJson,
  normalizePgError,
  sha256Hex,
  withRlsTransaction,
  type ServiceContext,
  type SqlExecutor,
} from "./sqlExecutor";

export interface MissingFieldDetail {
  field: string;
  reason: string;
}

function assertRequiredFields(
  input: Record<string, unknown>,
  required: Array<{ field: string; label: string }>,
): void {
  const missing: MissingFieldDetail[] = [];
  for (const item of required) {
    const val = input[item.field];
    if (
      val === undefined ||
      val === null ||
      (typeof val === "string" && val.trim() === "")
    ) {
      missing.push({ field: item.field, reason: `${item.label} is required` });
    }
  }
  if (missing.length > 0) {
    throw new PlatformError(
      "VALIDATION_FAILED",
      `Missing required fields: ${missing.map((m) => m.field).join(", ")}`,
      { details: { missingFields: missing } },
    );
  }
}

function requireCrmPermission(
  principal: AuthPrincipal,
  resource: string,
  action:
    "read" | "create" | "update" | "delete" | "approve" | "export" | "import",
  ownerCtx?: {
    ownerSalesId?: number | null;
    recordTerritoryId?: number | null;
    recordOrganizationId?: number | null;
  },
): void {
  const ok = evaluateAccess(principal, {
    resource,
    action,
    ownerSalesId: ownerCtx?.ownerSalesId,
    recordTerritoryId: ownerCtx?.recordTerritoryId,
    recordOrganizationId:
      ownerCtx?.recordOrganizationId ?? principal.organizationId ?? 1,
  });
  if (!ok) {
    if (
      ownerCtx?.recordOrganizationId !== undefined &&
      ownerCtx.recordOrganizationId !== (principal.organizationId ?? 1)
    ) {
      throw new PlatformError(
        "DATA_SCOPE_DENIED",
        "Record belongs to a different organization",
      );
    }
    throw new PlatformError(
      ownerCtx?.ownerSalesId !== undefined
        ? "DATA_SCOPE_DENIED"
        : "PERMISSION_DENIED",
      `Not authorized for ${resource}:${action}`,
    );
  }
}

function clampLimit(val: unknown, fallback = 25, max = 100): number {
  const n = Number(val ?? fallback);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(max, Math.trunc(n));
}

function clampPage(val: unknown): number {
  const n = Number(val ?? 1);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(1000, Math.trunc(n));
}

function escapeLike(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function effectiveScopeFor(
  principal: AuthPrincipal,
  resource: string,
  action: "read" | "update",
): DataScopeType {
  if (principal.administrator || principal.roleKey === "super_admin") {
    return "all";
  }
  const match = principal.permissions.find(
    (p) => p.resource === resource && p.action === action,
  );
  return match?.scope ?? "own";
}

/**
 * Shared Business Services — Operational Domains 1–7:
 * Identity, Customer Management, Agriculture Equipment, Product Management,
 * Sales Management, Customer Activities & Follow-ups, Quotation, and
 * Allowlisted Dynamic Query / Idempotency helpers.
 *
 * Used identically by REST API (/api/v1/*), Integration API (/integrations/v1/*),
 * Admin API (/admin/v1/*), and Remote MCP Server (/mcp).
 */
export class CrmDomainServices {
  constructor(private readonly db: SqlExecutor) {}

  // --- Idempotency Store Helpers ---

  async checkIdempotency<T>(
    principal: AuthPrincipal,
    endpoint: string,
    idempotencyKey: string | undefined,
    payload: unknown,
  ): Promise<
    { hit: true; status: number; body: T } | { hit: false; hash: string }
  > {
    const hash = await sha256Hex(canonicalJson(payload));
    if (!idempotencyKey) return { hit: false, hash };

    const { rows } = await this.db.query<{
      request_hash: string;
      response_status: number;
      response_body: T;
    }>(
      `select request_hash, response_status, response_body
       from public.api_idempotency_keys
       where actor_user_id = $1::uuid
         and endpoint = $2
         and idempotency_key = $3
         and expires_at > now()`,
      [principal.userId, endpoint, idempotencyKey],
    );
    const existing = rows[0];
    if (!existing) return { hit: false, hash };
    if (existing.request_hash !== hash) {
      throw new PlatformError(
        "DUPLICATE_REQUEST",
        "Idempotency key was already used with a different request payload",
      );
    }
    return {
      hit: true,
      status: Number(existing.response_status),
      body: existing.response_body,
    };
  }

  async saveIdempotency(
    principal: AuthPrincipal,
    endpoint: string,
    idempotencyKey: string | undefined,
    requestHash: string,
    responseStatus: number,
    responseBody: unknown,
  ): Promise<void> {
    if (!idempotencyKey) return;
    await this.db.query(
      `insert into public.api_idempotency_keys (
         idempotency_key, actor_user_id, endpoint, request_hash, response_status, response_body
       ) values ($1, $2::uuid, $3, $4, $5, $6::jsonb)
       on conflict (actor_user_id, endpoint, idempotency_key) do nothing`,
      [
        idempotencyKey,
        principal.userId,
        endpoint,
        requestHash,
        responseStatus,
        JSON.stringify(responseBody),
      ],
    );
  }

  // --- Allowlisted Dynamic Query Execution ---

  async executeDynamicQuery(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    rawQuery: unknown,
  ): Promise<{
    rows: Record<string, unknown>[];
    total: number;
    compiled: CompiledAllowlistedQuery;
  }> {
    const compiled = compileAllowlistedQuery(rawQuery);
    requireCrmPermission(principal, compiled.permissionResource, "read");

    const colsSql = compiled.columns.map((c) => `"${c}"`).join(", ");
    const orgId = principal.organizationId ?? 1;

    // Enforce organization boundary when the table carries organization_id
    const hasOrgCol = compiled.table === "companies";
    const whereParams = [...compiled.params];
    let whereSql = compiled.whereSql;
    if (hasOrgCol) {
      whereParams.push(orgId);
      whereSql = `(${whereSql}) AND "organization_id" = $${whereParams.length}`;
    }

    try {
      return await withRlsTransaction(
        this.db,
        principal,
        ctx,
        async (tx) => {
          const countRes = await tx.query<{ n: number }>(
            `select count(*) as n from public."${compiled.table}" where ${whereSql}`,
            whereParams,
          );
          const listParams = [...whereParams, compiled.limit, compiled.offset];
          const dataRes = await tx.query<Record<string, unknown>>(
            `select ${colsSql} from public."${compiled.table}"
             where ${whereSql}
             order by ${compiled.orderBySql}
             limit $${whereParams.length + 1} offset $${whereParams.length + 2}`,
            listParams,
          );
          const masked = dataRes.rows.map((row) =>
            applyFieldPermissions(row, compiled.permissionResource, principal),
          );
          return {
            rows: masked,
            total: Number(countRes.rows[0]?.n ?? 0),
            compiled,
          };
        },
        { readOnly: true },
      );
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  // ============================================================================
  // Domain 1: Identity
  // ============================================================================

  async getMyProfile(principal: AuthPrincipal, ctx: ServiceContext) {
    return withRlsTransaction(
      this.db,
      principal,
      ctx,
      async (tx) => {
        const res = await tx.query<{
          id: number;
          email: string;
          first_name: string;
          last_name: string;
          role_key: string | null;
          administrator: boolean;
          organization_id: number;
          primary_territory_id: number | null;
        }>(
          `select id, email::text as email, first_name, last_name, role_key,
                  administrator, organization_id, primary_territory_id
           from public.sales
           where user_id = $1::uuid`,
          [principal.userId],
        );
        const s = res.rows[0];
        if (!s) {
          throw new PlatformError(
            "RESOURCE_NOT_AVAILABLE",
            "User profile not found",
          );
        }
        return {
          userId: principal.userId,
          salesId: Number(s.id),
          email: s.email,
          firstName: s.first_name,
          lastName: s.last_name,
          roleKey: s.role_key,
          administrator: Boolean(s.administrator),
          organizationId: Number(s.organization_id),
          primaryTerritoryId:
            s.primary_territory_id !== null
              ? Number(s.primary_territory_id)
              : null,
          channel: principal.channel ?? ctx.channel,
        };
      },
      { readOnly: true },
    );
  }

  getMyCapabilities(
    principal: AuthPrincipal,
    allowedTools: Array<{
      toolName: string;
      domain: string;
      riskLevel: string;
      executionPolicy: string;
    }>,
  ) {
    return {
      userId: principal.userId,
      salesId: principal.salesId,
      roleKey: principal.roleKey,
      organizationId: principal.organizationId ?? 1,
      oauthScopes: principal.oauthScopes ?? [],
      crmPermissions: principal.permissions,
      availableTools: allowedTools,
      availableToolCount: allowedTools.length,
    };
  }

  getMyDataScope(principal: AuthPrincipal) {
    return {
      userId: principal.userId,
      salesId: principal.salesId,
      organizationId: principal.organizationId ?? 1,
      roleKey: principal.roleKey,
      teamIds: principal.teamIds ?? [],
      territoryIds: principal.territoryIds ?? [],
      resourceScopes: {
        customers: {
          read: effectiveScopeFor(principal, "customers", "read"),
          update: effectiveScopeFor(principal, "customers", "update"),
        },
        opportunities: {
          read: effectiveScopeFor(principal, "opportunities", "read"),
          update: effectiveScopeFor(principal, "opportunities", "update"),
        },
        activities: {
          read: effectiveScopeFor(principal, "activities", "read"),
          update: effectiveScopeFor(principal, "activities", "update"),
        },
        quotations: {
          read: effectiveScopeFor(principal, "quotations", "read"),
          update: effectiveScopeFor(principal, "quotations", "update"),
        },
      },
      fieldRestrictions: principal.fieldPermissions ?? [],
    };
  }

  // ============================================================================
  // Domain 2: Customer Management
  // ============================================================================

  async searchCustomers(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    input: {
      query?: string;
      province?: string;
      customerGroupCode?: string;
      page?: number;
      pageSize?: number;
      fields?: string[];
    },
  ) {
    requireCrmPermission(principal, "customers", "read");
    const page = clampPage(input.page);
    const pageSize = clampLimit(input.pageSize, 25, 100);
    const offset = (page - 1) * pageSize;
    const orgId = principal.organizationId ?? 1;

    const params: unknown[] = [orgId];
    const where: string[] = ["c.deleted_at is null", "c.organization_id = $1"];

    if (input.query?.trim()) {
      params.push(`%${escapeLike(input.query.trim())}%`);
      const p = `$${params.length}`;
      where.push(
        `(c.name ilike ${p} or c.customer_code ilike ${p} or c.province ilike ${p} or c.phone_number ilike ${p})`,
      );
    }
    if (input.province?.trim()) {
      params.push(`%${escapeLike(input.province.trim())}%`);
      where.push(`c.province ilike $${params.length}`);
    }
    if (input.customerGroupCode?.trim()) {
      params.push(input.customerGroupCode.trim());
      where.push(
        `exists (select 1 from public.master_options mo where mo.id = c.customer_group_id and mo.category = 'customer_group' and mo.code = $${params.length})`,
      );
    }

    try {
      return await withRlsTransaction(
        this.db,
        principal,
        ctx,
        async (tx) => {
          const countRes = await tx.query<{ n: number }>(
            `select count(*) as n from public.companies c where ${where.join(" and ")}`,
            params,
          );
          const listRes = await tx.query<Record<string, unknown>>(
            `select c.id, c.customer_code, c.name, c.legal_name, c.org_type,
                    c.province, c.city, c.country, c.phone_number, c.email,
                    c.tax_identifier, c.revenue, c.customer_group_id, c.territory_id,
                    c.sales_id, c.version, c.updated_at
             from public.companies c
             where ${where.join(" and ")}
             order by c.updated_at desc, c.id desc
             limit $${params.length + 1} offset $${params.length + 2}`,
            [...params, pageSize, offset],
          );

          const selectedSet =
            input.fields && input.fields.length > 0
              ? new Set(input.fields)
              : null;

          const items = listRes.rows.map((row) => {
            const masked = applyFieldPermissions(row, "customers", principal);
            if (!selectedSet) return masked;
            return Object.fromEntries(
              Object.entries(masked).filter(([k]) => selectedSet.has(k)),
            );
          });

          return {
            items,
            total: Number(countRes.rows[0]?.n ?? 0),
            page,
            pageSize,
          };
        },
        { readOnly: true },
      );
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  async getCustomer(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    customerId: number,
  ) {
    requireCrmPermission(principal, "customers", "read");
    const orgId = principal.organizationId ?? 1;

    try {
      return await withRlsTransaction(
        this.db,
        principal,
        ctx,
        async (tx) => {
          const res = await tx.query<Record<string, unknown>>(
            `select id, customer_code, name, legal_name, org_type, province, city,
                    country, address, zipcode, phone_number, email, website::text as website,
                    tax_identifier, revenue, description, location_note,
                    customer_group_id, territory_id, sales_id, organization_id,
                    version, created_at, updated_at
             from public.companies
             where id = $1 and organization_id = $2 and deleted_at is null`,
            [customerId, orgId],
          );
          const row = res.rows[0];
          if (!row) {
            throw new PlatformError(
              "RESOURCE_NOT_AVAILABLE",
              "Customer not found or outside your authorized scope",
            );
          }

          const contactsRes = await tx.query<Record<string, unknown>>(
            `select id, first_name, last_name, nickname, title, department, line_id,
                    is_primary, email_jsonb, phone_jsonb
             from public.contacts
             where company_id = $1 and deleted_at is null
             order by is_primary desc, id asc
             limit 50`,
            [customerId],
          );

          const customer = applyFieldPermissions(row, "customers", principal);
          const contacts = contactsRes.rows.map((c) =>
            applyFieldPermissions(c, "contacts", principal),
          );

          return {
            customer,
            contacts,
            untrustedNotes: markUntrustedContent({
              description: customer.description ?? null,
              locationNote: customer.location_note ?? null,
            }),
          };
        },
        { readOnly: true },
      );
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  async createCustomer(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    input: Record<string, unknown>,
  ) {
    requireCrmPermission(principal, "customers", "create");
    assertRequiredFields(input, [{ field: "name", label: "Customer name" }]);

    const clean = enforceWriteFieldAllowlist(
      input,
      "customers",
      [
        "name",
        "legal_name",
        "org_type",
        "province",
        "city",
        "country",
        "address",
        "zipcode",
        "phone_number",
        "email",
        "website",
        "tax_identifier",
        "description",
        "location_note",
        "customer_group_id",
        "territory_id",
        "latitude",
        "longitude",
        "google_maps_url",
      ],
      principal,
    );

    const idem = await this.checkIdempotency<Record<string, unknown>>(
      principal,
      "customers:create",
      ctx.idempotencyKey,
      clean,
    );
    if (idem.hit) return { ...idem.body, idempotentReplay: true };

    const orgId = principal.organizationId ?? 1;
    const name = String(clean.name).trim();

    try {
      const created = await withRlsTransaction(
        this.db,
        principal,
        ctx,
        async (tx) => {
          // Duplicate prevention check (by exact case-insensitive name + province or tax_identifier)
          const dupRes = await tx.query<{
            id: number;
            customer_code: string;
            name: string;
          }>(
            `select id, customer_code, name
             from public.companies
             where organization_id = $1
               and deleted_at is null
               and (
                 (lower(btrim(name)) = lower($2) and coalesce(lower(province), '') = coalesce(lower($3), ''))
                 or ($4::text is not null and tax_identifier = $4)
               )
             limit 1`,
            [orgId, name, clean.province ?? null, clean.tax_identifier ?? null],
          );
          if (dupRes.rows[0]) {
            throw new PlatformError(
              "DUPLICATE_REQUEST",
              `A matching customer already exists (${dupRes.rows[0].customer_code}: ${dupRes.rows[0].name})`,
              {
                details: {
                  existingCustomerId: Number(dupRes.rows[0].id),
                  existingCustomerCode: dupRes.rows[0].customer_code,
                },
              },
            );
          }

          const { rows } = await tx.query<Record<string, unknown>>(
            `insert into public.companies (
               name, legal_name, org_type, province, city, country, address, zipcode,
               phone_number, email, website, tax_identifier, description, location_note,
               customer_group_id, territory_id, latitude, longitude, google_maps_url,
               sales_id, organization_id
             ) values (
               $1, $2, coalesce($3, 'standalone'), $4, $5, coalesce($6, 'Thailand'), $7, $8,
               $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
             )
             returning id, customer_code, name, legal_name, org_type, province, city,
                       country, phone_number, email, sales_id, version, created_at`,
            [
              name,
              clean.legal_name ?? null,
              clean.org_type ?? null,
              clean.province ?? null,
              clean.city ?? null,
              clean.country ?? null,
              clean.address ?? null,
              clean.zipcode ?? null,
              clean.phone_number ?? null,
              clean.email ?? null,
              clean.website ?? null,
              clean.tax_identifier ?? null,
              clean.description ?? null,
              clean.location_note ?? null,
              clean.customer_group_id ?? null,
              clean.territory_id ?? null,
              clean.latitude ?? null,
              clean.longitude ?? null,
              clean.google_maps_url ?? null,
              principal.salesId,
              orgId,
            ],
          );
          return {
            status: "created",
            recordId: Number(rows[0].id),
            changedFields: Object.keys(clean),
            customer: applyFieldPermissions(rows[0], "customers", principal),
          };
        },
      );

      await this.saveIdempotency(
        principal,
        "customers:create",
        ctx.idempotencyKey,
        idem.hash,
        201,
        created,
      );
      return created;
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  async updateCustomer(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    customerId: number,
    patch: Record<string, unknown>,
    expectedVersion?: number,
  ) {
    const clean = enforceWriteFieldAllowlist(
      patch,
      "customers",
      [
        "name",
        "legal_name",
        "org_type",
        "province",
        "city",
        "country",
        "address",
        "zipcode",
        "phone_number",
        "email",
        "website",
        "tax_identifier",
        "description",
        "location_note",
        "customer_group_id",
        "territory_id",
        "latitude",
        "longitude",
        "google_maps_url",
      ],
      principal,
    );

    if (Object.keys(clean).length === 0) {
      throw new PlatformError(
        "VALIDATION_FAILED",
        "At least one updatable customer field is required",
      );
    }

    const orgId = principal.organizationId ?? 1;

    try {
      return await withRlsTransaction(this.db, principal, ctx, async (tx) => {
        const curRes = await tx.query<{
          id: number;
          sales_id: number | null;
          territory_id: number | null;
          organization_id: number;
          version: number;
        }>(
          `select id, sales_id, territory_id, organization_id, version
           from public.companies
           where id = $1 and organization_id = $2 and deleted_at is null`,
          [customerId, orgId],
        );
        const cur = curRes.rows[0];
        if (!cur) {
          throw new PlatformError(
            "RESOURCE_NOT_AVAILABLE",
            "Customer not found or outside your authorized scope",
          );
        }

        requireCrmPermission(principal, "customers", "update", {
          ownerSalesId: cur.sales_id !== null ? Number(cur.sales_id) : null,
          recordTerritoryId:
            cur.territory_id !== null ? Number(cur.territory_id) : null,
          recordOrganizationId: Number(cur.organization_id),
        });

        if (
          expectedVersion !== undefined &&
          Number(cur.version) !== expectedVersion
        ) {
          throw new PlatformError(
            "VERSION_CONFLICT",
            `Customer version conflict: expected ${expectedVersion}, current is ${cur.version}`,
            {
              details: {
                expectedVersion,
                currentVersion: Number(cur.version),
              },
            },
          );
        }

        const keys = Object.keys(clean);
        const setSql = keys.map((k, idx) => `"${k}" = $${idx + 1}`).join(", ");
        const values = keys.map((k) => clean[k]);
        values.push(customerId, orgId);

        const updatedRes = await tx.query<Record<string, unknown>>(
          `update public.companies
           set ${setSql}
           where id = $${values.length - 1} and organization_id = $${values.length}
           returning id, customer_code, name, province, city, phone_number, email, version, updated_at`,
          values,
        );

        if (updatedRes.rows.length === 0) {
          throw new PlatformError(
            "DATA_SCOPE_DENIED",
            "Not authorized to update this customer record",
          );
        }

        return {
          status: "updated",
          recordId: customerId,
          changedFields: keys,
          customer: applyFieldPermissions(
            updatedRes.rows[0],
            "customers",
            principal,
          ),
        };
      });
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  async createCustomerContact(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    input: {
      company_id: number;
      first_name: string;
      last_name?: string;
      nickname?: string;
      title?: string;
      department?: string;
      line_id?: string;
      email?: string;
      phone?: string;
      is_primary?: boolean;
    },
  ) {
    requireCrmPermission(principal, "contacts", "create");
    assertRequiredFields(input as Record<string, unknown>, [
      { field: "company_id", label: "Customer ID" },
      { field: "first_name", label: "Contact first name" },
    ]);

    const orgId = principal.organizationId ?? 1;
    const emailJson = input.email
      ? [{ email: input.email.trim().toLowerCase(), type: "Work" }]
      : [];
    const phoneJson = input.phone
      ? [{ number: input.phone.trim(), type: "Work" }]
      : [];

    try {
      return await withRlsTransaction(this.db, principal, ctx, async (tx) => {
        const comp = await tx.query<{ id: number }>(
          `select id from public.companies
           where id = $1 and organization_id = $2 and deleted_at is null`,
          [input.company_id, orgId],
        );
        if (!comp.rows[0]) {
          throw new PlatformError(
            "RESOURCE_NOT_AVAILABLE",
            "Customer not found or outside your scope",
          );
        }

        const { rows } = await tx.query<Record<string, unknown>>(
          `insert into public.contacts (
             company_id, first_name, last_name, nickname, title, department,
             line_id, email_jsonb, phone_jsonb, is_primary, first_seen, last_seen, sales_id
           ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, now(), now(), $11)
           returning id, company_id, first_name, last_name, nickname, title, department,
                     line_id, email_jsonb, phone_jsonb, is_primary, sales_id, version`,
          [
            input.company_id,
            input.first_name.trim(),
            (input.last_name ?? "").trim(),
            input.nickname ?? null,
            input.title ?? null,
            input.department ?? null,
            input.line_id ?? null,
            JSON.stringify(emailJson),
            JSON.stringify(phoneJson),
            Boolean(input.is_primary),
            principal.salesId,
          ],
        );
        return {
          status: "created",
          recordId: Number(rows[0].id),
          contact: applyFieldPermissions(rows[0], "contacts", principal),
        };
      });
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  async getCustomerHistory(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    customerId: number,
    limit = 25,
  ) {
    requireCrmPermission(principal, "customers", "read");
    const orgId = principal.organizationId ?? 1;
    const cap = clampLimit(limit, 25, 100);

    try {
      return await withRlsTransaction(
        this.db,
        principal,
        ctx,
        async (tx) => {
          const comp = await tx.query<{ id: number; name: string }>(
            `select id, name from public.companies
             where id = $1 and organization_id = $2 and deleted_at is null`,
            [customerId, orgId],
          );
          if (!comp.rows[0]) {
            throw new PlatformError(
              "RESOURCE_NOT_AVAILABLE",
              "Customer not found or outside your scope",
            );
          }

          const [visits, deals, quotes, cases] = await Promise.all([
            tx.query<Record<string, unknown>>(
              `select id, subject, status, start_at, outcome, discussion, follow_up_date
               from public.activities where company_id = $1
               order by start_at desc limit $2`,
              [customerId, cap],
            ),
            tx.query<Record<string, unknown>>(
              `select id, name, stage, amount, currency, expected_closing_date, updated_at
               from public.deals where company_id = $1 and deleted_at is null
               order by updated_at desc limit $2`,
              [customerId, cap],
            ),
            tx.query<Record<string, unknown>>(
              `select id, quotation_no, revision, subject, status, total_amount, currency, created_at
               from public.quotations where company_id = $1 and deleted_at is null
               order by created_at desc limit $2`,
              [customerId, cap],
            ),
            tx.query<Record<string, unknown>>(
              `select id, case_no, subject, status, priority, received_date, closed_at
               from public.service_cases where company_id = $1
               order by received_date desc limit $2`,
              [customerId, cap],
            ),
          ]);

          return {
            customerId,
            customerName: comp.rows[0].name,
            activities: markUntrustedContent(visits.rows),
            opportunities: deals.rows,
            quotations: quotes.rows,
            serviceCases: cases.rows,
          };
        },
        { readOnly: true },
      );
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  // ============================================================================
  // Domain 3: Agriculture Equipment
  // ============================================================================

  async searchMachines(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    input: {
      query?: string;
      manufacturerName?: string;
      companyId?: number;
      page?: number;
      pageSize?: number;
    },
  ) {
    requireCrmPermission(principal, "machine_applications", "read");
    const page = clampPage(input.page);
    const pageSize = clampLimit(input.pageSize, 25, 100);
    const offset = (page - 1) * pageSize;

    const params: unknown[] = [];
    const where: string[] = ["mm.is_active = true"];

    if (input.query?.trim()) {
      params.push(`%${escapeLike(input.query.trim())}%`);
      const p = `$${params.length}`;
      where.push(
        `(mm.model_name ilike ${p} or coalesce(mm.series, '') ilike ${p} or m.name ilike ${p})`,
      );
    }
    if (input.manufacturerName?.trim()) {
      params.push(`%${escapeLike(input.manufacturerName.trim())}%`);
      where.push(`m.name ilike $${params.length}`);
    }
    if (input.companyId) {
      params.push(input.companyId);
      where.push(
        `exists (select 1 from public.customer_machines cm where cm.machine_model_id = mm.id and cm.company_id = $${params.length} and cm.deleted_at is null)`,
      );
    }

    try {
      return await withRlsTransaction(
        this.db,
        principal,
        ctx,
        async (tx) => {
          const { rows } = await tx.query<Record<string, unknown>>(
            `select mm.id, mm.model_name, mm.series, mm.year_from, mm.year_to,
                    mm.notes, m.id as manufacturer_id, m.name as manufacturer_name,
                    mo.name as equipment_type_name
             from public.machine_models mm
             join public.manufacturers m on m.id = mm.manufacturer_id
             left join public.master_options mo on mo.id = mm.equipment_type_id
             where ${where.join(" and ")}
             order by m.name asc, mm.model_name asc
             limit $${params.length + 1} offset $${params.length + 2}`,
            [...params, pageSize, offset],
          );
          return { items: rows, page, pageSize };
        },
        { readOnly: true },
      );
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  async getMachine(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    machineId: number,
  ) {
    requireCrmPermission(principal, "customers", "read");
    const orgId = principal.organizationId ?? 1;

    try {
      return await withRlsTransaction(
        this.db,
        principal,
        ctx,
        async (tx) => {
          const res = await tx.query<Record<string, unknown>>(
            `select cm.id, cm.company_id, c.name as company_name, cm.machine_model_id,
                    mm.model_name, mm.series, m.name as manufacturer_name,
                    cm.serial_number, cm.unit_count, cm.model_year, cm.operating_hours,
                    cm.status, cm.location_note, cm.notes, cm.sales_id, cm.version,
                    cm.created_at, cm.updated_at
             from public.customer_machines cm
             join public.companies c on c.id = cm.company_id
             join public.machine_models mm on mm.id = cm.machine_model_id
             join public.manufacturers m on m.id = mm.manufacturer_id
             where cm.id = $1 and c.organization_id = $2 and cm.deleted_at is null`,
            [machineId, orgId],
          );
          if (!res.rows[0]) {
            throw new PlatformError(
              "RESOURCE_NOT_AVAILABLE",
              "Registered customer machine not found or outside your scope",
            );
          }
          const specs = await tx.query<Record<string, unknown>>(
            `select spec_group, name, value, unit, source
             from public.machine_specifications
             where machine_model_id = $1
             order by spec_group, sort_order`,
            [res.rows[0].machine_model_id],
          );
          return { machine: res.rows[0], specifications: specs.rows };
        },
        { readOnly: true },
      );
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  async registerMachine(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    input: {
      company_id: number;
      machine_model_id: number;
      serial_number?: string;
      unit_count?: number;
      model_year?: number;
      operating_hours?: number;
      status?: "active" | "seasonal_idle" | "under_repair" | "retired";
      location_note?: string;
      notes?: string;
    },
  ) {
    requireCrmPermission(principal, "customers", "create");
    assertRequiredFields(input as Record<string, unknown>, [
      { field: "company_id", label: "Customer ID" },
      { field: "machine_model_id", label: "Machine model ID" },
    ]);

    const orgId = principal.organizationId ?? 1;

    try {
      return await withRlsTransaction(this.db, principal, ctx, async (tx) => {
        const comp = await tx.query<{ id: number }>(
          `select id from public.companies
           where id = $1 and organization_id = $2 and deleted_at is null`,
          [input.company_id, orgId],
        );
        if (!comp.rows[0]) {
          throw new PlatformError(
            "RESOURCE_NOT_AVAILABLE",
            "Customer not found in your organization",
          );
        }
        const model = await tx.query<{ id: number }>(
          `select id from public.machine_models where id = $1`,
          [input.machine_model_id],
        );
        if (!model.rows[0]) {
          throw new PlatformError(
            "VALIDATION_FAILED",
            `Machine model ${input.machine_model_id} does not exist`,
          );
        }

        if (input.serial_number?.trim()) {
          const dup = await tx.query<{ id: number }>(
            `select id from public.customer_machines
             where company_id = $1 and lower(serial_number) = lower($2) and deleted_at is null`,
            [input.company_id, input.serial_number.trim()],
          );
          if (dup.rows[0]) {
            throw new PlatformError(
              "DUPLICATE_REQUEST",
              `Machine with serial number "${input.serial_number}" is already registered for this customer`,
            );
          }
        }

        const { rows } = await tx.query<Record<string, unknown>>(
          `insert into public.customer_machines (
             company_id, machine_model_id, serial_number, unit_count, model_year,
             operating_hours, status, location_note, notes, sales_id
           ) values ($1, $2, $3, coalesce($4, 1), $5, $6, coalesce($7, 'active'), $8, $9, $10)
           returning *`,
          [
            input.company_id,
            input.machine_model_id,
            input.serial_number?.trim() ?? null,
            input.unit_count ?? 1,
            input.model_year ?? null,
            input.operating_hours ?? null,
            input.status ?? "active",
            input.location_note ?? null,
            input.notes ?? null,
            principal.salesId,
          ],
        );
        return {
          status: "created",
          recordId: Number(rows[0].id),
          machine: rows[0],
        };
      });
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  async updateMachine(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    machineId: number,
    patch: Record<string, unknown>,
    expectedVersion?: number,
  ) {
    const clean = enforceWriteFieldAllowlist(
      patch,
      "customers",
      [
        "serial_number",
        "unit_count",
        "model_year",
        "operating_hours",
        "status",
        "location_note",
        "notes",
      ],
      principal,
    );
    if (Object.keys(clean).length === 0) {
      throw new PlatformError(
        "VALIDATION_FAILED",
        "Provide at least one machine field to update",
      );
    }
    const orgId = principal.organizationId ?? 1;

    try {
      return await withRlsTransaction(this.db, principal, ctx, async (tx) => {
        const curRes = await tx.query<{
          id: number;
          sales_id: number | null;
          version: number;
          organization_id: number;
        }>(
          `select cm.id, cm.sales_id, cm.version, c.organization_id
           from public.customer_machines cm
           join public.companies c on c.id = cm.company_id
           where cm.id = $1 and c.organization_id = $2 and cm.deleted_at is null`,
          [machineId, orgId],
        );
        const cur = curRes.rows[0];
        if (!cur) {
          throw new PlatformError(
            "RESOURCE_NOT_AVAILABLE",
            "Machine not found or outside your scope",
          );
        }
        requireCrmPermission(principal, "customers", "update", {
          ownerSalesId: cur.sales_id !== null ? Number(cur.sales_id) : null,
          recordOrganizationId: Number(cur.organization_id),
        });
        if (
          expectedVersion !== undefined &&
          Number(cur.version) !== expectedVersion
        ) {
          throw new PlatformError(
            "VERSION_CONFLICT",
            `Machine version conflict: expected ${expectedVersion}, current is ${cur.version}`,
          );
        }

        const keys = Object.keys(clean);
        const setSql = keys.map((k, i) => `"${k}" = $${i + 1}`).join(", ");
        const values = [...keys.map((k) => clean[k]), machineId];
        const { rows } = await tx.query<Record<string, unknown>>(
          `update public.customer_machines set ${setSql} where id = $${values.length} returning *`,
          values,
        );
        if (rows.length === 0) {
          throw new PlatformError(
            "DATA_SCOPE_DENIED",
            "Not authorized to update this machine",
          );
        }
        return {
          status: "updated",
          recordId: machineId,
          changedFields: keys,
          machine: rows[0],
        };
      });
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  async getCustomerMachines(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    companyId: number,
  ) {
    requireCrmPermission(principal, "customers", "read");
    const orgId = principal.organizationId ?? 1;

    try {
      return await withRlsTransaction(
        this.db,
        principal,
        ctx,
        async (tx) => {
          const { rows } = await tx.query<Record<string, unknown>>(
            `select cm.id, cm.company_id, cm.machine_model_id, mm.model_name, mm.series,
                    m.name as manufacturer_name, cm.serial_number, cm.unit_count,
                    cm.model_year, cm.operating_hours, cm.status, cm.version
             from public.customer_machines cm
             join public.companies c on c.id = cm.company_id
             join public.machine_models mm on mm.id = cm.machine_model_id
             join public.manufacturers m on m.id = mm.manufacturer_id
             where cm.company_id = $1 and c.organization_id = $2 and cm.deleted_at is null
             order by cm.updated_at desc`,
            [companyId, orgId],
          );
          return {
            companyId,
            machines: rows,
            totalUnits: rows.reduce((a, r) => a + Number(r.unit_count ?? 1), 0),
          };
        },
        { readOnly: true },
      );
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  async getMachineSummary(principal: AuthPrincipal, ctx: ServiceContext) {
    requireCrmPermission(principal, "customers", "read");
    const orgId = principal.organizationId ?? 1;

    try {
      return await withRlsTransaction(
        this.db,
        principal,
        ctx,
        async (tx) => {
          const byStatus = await tx.query<{
            status: string;
            records: number;
            units: number;
          }>(
            `select cm.status, count(*)::int as records, coalesce(sum(cm.unit_count), 0)::int as units
             from public.customer_machines cm
             join public.companies c on c.id = cm.company_id
             where c.organization_id = $1 and cm.deleted_at is null
             group by cm.status order by cm.status`,
            [orgId],
          );
          const byModel = await tx.query<{
            model_name: string;
            manufacturer_name: string;
            units: number;
          }>(
            `select mm.model_name, m.name as manufacturer_name, coalesce(sum(cm.unit_count), 0)::int as units
             from public.customer_machines cm
             join public.companies c on c.id = cm.company_id
             join public.machine_models mm on mm.id = cm.machine_model_id
             join public.manufacturers m on m.id = mm.manufacturer_id
             where c.organization_id = $1 and cm.deleted_at is null
             group by mm.model_name, m.name
             order by units desc limit 20`,
            [orgId],
          );
          return { byStatus: byStatus.rows, topModels: byModel.rows };
        },
        { readOnly: true },
      );
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  async getMachineServiceHistory(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    machineId: number,
  ) {
    requireCrmPermission(principal, "service_cases", "read");
    const orgId = principal.organizationId ?? 1;

    try {
      return await withRlsTransaction(
        this.db,
        principal,
        ctx,
        async (tx) => {
          const machine = await tx.query<{
            id: number;
            company_id: number;
            machine_model_id: number;
          }>(
            `select cm.id, cm.company_id, cm.machine_model_id
             from public.customer_machines cm
             join public.companies c on c.id = cm.company_id
             where cm.id = $1 and c.organization_id = $2 and cm.deleted_at is null`,
            [machineId, orgId],
          );
          if (!machine.rows[0]) {
            throw new PlatformError(
              "RESOURCE_NOT_AVAILABLE",
              "Machine not found or outside your scope",
            );
          }
          const companyId = Number(machine.rows[0].company_id);
          const cases = await tx.query<Record<string, unknown>>(
            `select id, case_no, subject, status, priority, received_date, closed_at, closure_summary
             from public.service_cases
             where company_id = $1
             order by received_date desc limit 25`,
            [companyId],
          );
          const visits = await tx.query<Record<string, unknown>>(
            `select id, subject, status, start_at, outcome
             from public.activities
             where company_id = $1
             order by start_at desc limit 25`,
            [companyId],
          );
          return {
            machineId,
            companyId,
            serviceCases: markUntrustedContent(cases.rows),
            relatedVisits: markUntrustedContent(visits.rows),
          };
        },
        { readOnly: true },
      );
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  // ============================================================================
  // Domain 4: Product Management
  // ============================================================================

  async searchProducts(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    input: {
      query?: string;
      material?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    requireCrmPermission(principal, "products", "read");
    const page = clampPage(input.page);
    const pageSize = clampLimit(input.pageSize, 25, 100);
    const offset = (page - 1) * pageSize;

    const params: unknown[] = [];
    const where: string[] = ["p.deleted_at is null"];
    if (input.query?.trim()) {
      params.push(`%${escapeLike(input.query.trim())}%`);
      const p = `$${params.length}`;
      where.push(
        `(p.part_number ilike ${p} or p.name ilike ${p} or coalesce(p.name_en, '') ilike ${p})`,
      );
    }
    if (input.material?.trim()) {
      params.push(`%${escapeLike(input.material.trim())}%`);
      where.push(`p.material ilike $${params.length}`);
    }

    try {
      return await withRlsTransaction(
        this.db,
        principal,
        ctx,
        async (tx) => {
          const { rows } = await tx.query<Record<string, unknown>>(
            `select p.id, p.part_number, p.name, p.name_en, p.material, p.uom,
                    p.current_revision, b.name as brand_name, p.version
             from public.products p
             left join public.brands b on b.id = p.brand_id
             where ${where.join(" and ")}
             order by p.part_number asc
             limit $${params.length + 1} offset $${params.length + 2}`,
            [...params, pageSize, offset],
          );
          return {
            items: rows.map((r) =>
              applyFieldPermissions(r, "products", principal),
            ),
            page,
            pageSize,
          };
        },
        { readOnly: true },
      );
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  async getProduct(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    productId: number,
  ) {
    requireCrmPermission(principal, "products", "read");

    try {
      return await withRlsTransaction(
        this.db,
        principal,
        ctx,
        async (tx) => {
          const res = await tx.query<Record<string, unknown>>(
            `select p.id, p.part_number, p.name, p.name_en, p.material, p.uom,
                    p.description, p.current_revision, p.version, b.name as brand_name
             from public.products p
             left join public.brands b on b.id = p.brand_id
             where p.id = $1 and p.deleted_at is null`,
            [productId],
          );
          if (!res.rows[0]) {
            throw new PlatformError(
              "RESOURCE_NOT_AVAILABLE",
              "Product not found",
            );
          }
          const specs = await tx.query<Record<string, unknown>>(
            `select spec_group, name, value, unit, tolerance, source
             from public.product_specifications
             where product_id = $1 order by spec_group, sort_order`,
            [productId],
          );
          return {
            product: applyFieldPermissions(res.rows[0], "products", principal),
            specifications: specs.rows,
          };
        },
        { readOnly: true },
      );
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  async findCompatibleParts(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    input: {
      machineModelId?: number;
      machineModelQuery?: string;
      verifiedOnly?: boolean;
    },
  ) {
    requireCrmPermission(principal, "machine_applications", "read");
    requireCrmPermission(principal, "products", "read");

    if (!input.machineModelId && !input.machineModelQuery?.trim()) {
      throw new PlatformError(
        "VALIDATION_FAILED",
        "Provide machineModelId or machineModelQuery to find compatible parts",
      );
    }

    const params: unknown[] = [];
    const where: string[] = ["p.deleted_at is null"];
    if (input.machineModelId) {
      params.push(input.machineModelId);
      where.push(`pma.machine_model_id = $${params.length}`);
    }
    if (input.machineModelQuery?.trim()) {
      params.push(`%${escapeLike(input.machineModelQuery.trim())}%`);
      where.push(`mm.model_name ilike $${params.length}`);
    }
    if (input.verifiedOnly !== false) {
      where.push(`pma.verification_status = 'verified'`);
    }

    try {
      return await withRlsTransaction(
        this.db,
        principal,
        ctx,
        async (tx) => {
          const { rows } = await tx.query<Record<string, unknown>>(
            `select p.id as product_id, p.part_number, p.name, p.material, p.uom,
                    mm.id as machine_model_id, mm.model_name, m.name as manufacturer_name,
                    pma.component_application, pma.verification_status, pma.verification_source
             from public.product_machine_applications pma
             join public.products p on p.id = pma.product_id
             join public.machine_models mm on mm.id = pma.machine_model_id
             join public.manufacturers m on m.id = mm.manufacturer_id
             where ${where.join(" and ")}
             order by pma.verification_status desc, p.part_number asc
             limit 50`,
            params,
          );
          return {
            verifiedOnly: input.verifiedOnly !== false,
            parts: rows,
            count: rows.length,
          };
        },
        { readOnly: true },
      );
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  async getProductPrice(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    input: { productId: number; quantity?: number; currency?: string },
  ) {
    requireCrmPermission(principal, "products", "read");
    const qty = Math.max(1, Number(input.quantity ?? 1));

    try {
      return await withRlsTransaction(
        this.db,
        principal,
        ctx,
        async (tx) => {
          const crmPrices = await tx.query<Record<string, unknown>>(
            `select pl.code as price_list_code, pl.name as price_list_name,
                    pl.currency, pli.min_qty, pli.unit_price, pli.discount_max_percent, pli.uom
             from public.price_list_items pli
             join public.price_lists pl on pl.id = pli.price_list_id
             where pli.product_id = $1
               and pl.is_active = true
               and pl.deleted_at is null
               and pli.min_qty <= $2
               and ($3::text is null or pl.currency = $3)
             order by pl.is_default desc, pli.min_qty desc
             limit 10`,
            [input.productId, qty, input.currency ?? null],
          );
          return {
            productId: input.productId,
            requestedQuantity: qty,
            priceEntries: crmPrices.rows,
            pricingAvailable: crmPrices.rows.length > 0,
            notice:
              crmPrices.rows.length === 0
                ? "No active price list entry found in CRM. Do not invent unit prices; request pricing from Sales/Costing."
                : undefined,
          };
        },
        { readOnly: true },
      );
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  async getInventoryAvailability(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    productId: number,
  ) {
    requireCrmPermission(principal, "erp_documents", "read");

    try {
      return await withRlsTransaction(
        this.db,
        principal,
        ctx,
        async (tx) => {
          const { rows } = await tx.query<Record<string, unknown>>(
            `select data_area_id, erp_item_number, site_id, warehouse_id,
                    available_quantity, on_hand_quantity, uom, as_of, synced_at
             from public.erp_inventory_availability
             where product_id = $1
             order by data_area_id, site_id, warehouse_id`,
            [productId],
          );
          return {
            productId,
            warehouses: rows,
            available: rows.length > 0,
            notice:
              rows.length === 0
                ? "No synced ERP inventory rows exist for this product (ERP connector may be disabled or not yet synced)."
                : undefined,
          };
        },
        { readOnly: true },
      );
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  // ============================================================================
  // Domain 5: Sales Management
  // ============================================================================

  async searchOpportunities(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    input: {
      query?: string;
      stage?: string;
      companyId?: number;
      page?: number;
      pageSize?: number;
    },
  ) {
    requireCrmPermission(principal, "opportunities", "read");
    const page = clampPage(input.page);
    const pageSize = clampLimit(input.pageSize, 25, 100);
    const offset = (page - 1) * pageSize;
    const orgId = principal.organizationId ?? 1;

    const params: unknown[] = [orgId];
    const where: string[] = ["d.deleted_at is null", "c.organization_id = $1"];
    if (input.query?.trim()) {
      params.push(`%${escapeLike(input.query.trim())}%`);
      where.push(
        `(d.name ilike $${params.length} or c.name ilike $${params.length})`,
      );
    }
    if (input.stage?.trim()) {
      params.push(input.stage.trim());
      where.push(`d.stage = $${params.length}`);
    }
    if (input.companyId) {
      params.push(input.companyId);
      where.push(`d.company_id = $${params.length}`);
    }

    try {
      return await withRlsTransaction(
        this.db,
        principal,
        ctx,
        async (tx) => {
          const { rows } = await tx.query<Record<string, unknown>>(
            `select d.id, d.name, d.company_id, c.name as company_name, d.stage,
                    d.amount, d.currency, d.probability, d.expected_closing_date,
                    d.follow_up_date, d.sales_id, d.version, d.updated_at
             from public.deals d
             join public.companies c on c.id = d.company_id
             where ${where.join(" and ")}
             order by d.updated_at desc
             limit $${params.length + 1} offset $${params.length + 2}`,
            [...params, pageSize, offset],
          );
          return {
            items: rows.map((r) =>
              applyFieldPermissions(r, "opportunities", principal),
            ),
            page,
            pageSize,
          };
        },
        { readOnly: true },
      );
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  async createOpportunity(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    input: {
      name: string;
      company_id: number;
      stage?: string;
      amount?: number;
      currency?: string;
      probability?: number;
      expected_closing_date?: string;
      description?: string;
      follow_up_date?: string;
    },
  ) {
    requireCrmPermission(principal, "opportunities", "create");
    assertRequiredFields(input as Record<string, unknown>, [
      { field: "name", label: "Opportunity name" },
      { field: "company_id", label: "Customer ID" },
    ]);

    const idem = await this.checkIdempotency<Record<string, unknown>>(
      principal,
      "opportunities:create",
      ctx.idempotencyKey,
      input,
    );
    if (idem.hit) return { ...idem.body, idempotentReplay: true };

    const orgId = principal.organizationId ?? 1;

    try {
      const created = await withRlsTransaction(
        this.db,
        principal,
        ctx,
        async (tx) => {
          const comp = await tx.query<{ id: number }>(
            `select id from public.companies
             where id = $1 and organization_id = $2 and deleted_at is null`,
            [input.company_id, orgId],
          );
          if (!comp.rows[0]) {
            throw new PlatformError(
              "RESOURCE_NOT_AVAILABLE",
              "Customer not found in your organization",
            );
          }

          const { rows } = await tx.query<Record<string, unknown>>(
            `insert into public.deals (
               name, company_id, stage, amount, currency, probability,
               expected_closing_date, description, follow_up_date, sales_id, index
             ) values ($1, $2, coalesce($3, 'opportunity'), $4, coalesce($5, 'THB'), $6, $7::date, $8, $9::date, $10, 0)
             returning id, name, company_id, stage, amount, currency, probability,
                       expected_closing_date, sales_id, version, created_at`,
            [
              input.name.trim(),
              input.company_id,
              input.stage ?? "opportunity",
              input.amount ?? null,
              input.currency ?? "THB",
              input.probability ?? null,
              input.expected_closing_date ?? null,
              input.description ?? null,
              input.follow_up_date ?? null,
              principal.salesId,
            ],
          );
          return {
            status: "created",
            recordId: Number(rows[0].id),
            opportunity: applyFieldPermissions(
              rows[0],
              "opportunities",
              principal,
            ),
          };
        },
      );

      await this.saveIdempotency(
        principal,
        "opportunities:create",
        ctx.idempotencyKey,
        idem.hash,
        201,
        created,
      );
      return created;
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  async updateOpportunity(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    opportunityId: number,
    patch: Record<string, unknown>,
    expectedVersion?: number,
  ) {
    const clean = enforceWriteFieldAllowlist(
      patch,
      "opportunities",
      [
        "name",
        "stage",
        "amount",
        "currency",
        "probability",
        "expected_closing_date",
        "description",
        "follow_up_date",
        "loss_notes",
      ],
      principal,
    );
    if (Object.keys(clean).length === 0) {
      throw new PlatformError(
        "VALIDATION_FAILED",
        "Provide at least one updatable opportunity field",
      );
    }
    const orgId = principal.organizationId ?? 1;

    try {
      return await withRlsTransaction(this.db, principal, ctx, async (tx) => {
        const curRes = await tx.query<{
          id: number;
          sales_id: number | null;
          version: number;
          organization_id: number;
        }>(
          `select d.id, d.sales_id, d.version, c.organization_id
           from public.deals d
           join public.companies c on c.id = d.company_id
           where d.id = $1 and c.organization_id = $2 and d.deleted_at is null`,
          [opportunityId, orgId],
        );
        const cur = curRes.rows[0];
        if (!cur) {
          throw new PlatformError(
            "RESOURCE_NOT_AVAILABLE",
            "Opportunity not found or outside your scope",
          );
        }
        requireCrmPermission(principal, "opportunities", "update", {
          ownerSalesId: cur.sales_id !== null ? Number(cur.sales_id) : null,
          recordOrganizationId: Number(cur.organization_id),
        });
        if (
          expectedVersion !== undefined &&
          Number(cur.version) !== expectedVersion
        ) {
          throw new PlatformError(
            "VERSION_CONFLICT",
            `Opportunity version conflict: expected ${expectedVersion}, current is ${cur.version}`,
          );
        }

        const keys = Object.keys(clean);
        const setSql = keys.map((k, i) => `"${k}" = $${i + 1}`).join(", ");
        const values = [...keys.map((k) => clean[k]), opportunityId];
        const { rows } = await tx.query<Record<string, unknown>>(
          `update public.deals set ${setSql} where id = $${values.length} returning id, name, stage, amount, currency, probability, version, updated_at`,
          values,
        );
        if (rows.length === 0) {
          throw new PlatformError(
            "DATA_SCOPE_DENIED",
            "Not authorized to update this opportunity",
          );
        }
        return {
          status: "updated",
          recordId: opportunityId,
          changedFields: keys,
          opportunity: applyFieldPermissions(
            rows[0],
            "opportunities",
            principal,
          ),
        };
      });
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  async getSalesPipeline(principal: AuthPrincipal, ctx: ServiceContext) {
    requireCrmPermission(principal, "opportunities", "read");
    const orgId = principal.organizationId ?? 1;

    try {
      return await withRlsTransaction(
        this.db,
        principal,
        ctx,
        async (tx) => {
          const { rows } = await tx.query<{
            stage: string;
            deal_count: number;
            estimated_value: number;
          }>(
            `select d.stage, count(*)::int as deal_count, coalesce(sum(d.amount), 0)::numeric as estimated_value
             from public.deals d
             join public.companies c on c.id = d.company_id
             where c.organization_id = $1 and d.deleted_at is null and d.archived_at is null
             group by d.stage order by d.stage`,
            [orgId],
          );
          return {
            note: "Pipeline amounts represent estimated opportunity values, not confirmed ERP revenue.",
            stages: rows.map((r) => ({
              stage: r.stage,
              dealCount: Number(r.deal_count),
              estimatedValue: Number(r.estimated_value),
            })),
          };
        },
        { readOnly: true },
      );
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  async getSalesTarget(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    filters?: { salesId?: number; periodType?: string },
  ) {
    requireCrmPermission(principal, "reports", "read");
    const params: unknown[] = [];
    const where: string[] = ["true"];
    if (filters?.salesId) {
      params.push(filters.salesId);
      where.push(`sales_id = $${params.length}`);
    }
    if (filters?.periodType) {
      params.push(filters.periodType);
      where.push(`period_type = $${params.length}`);
    }

    try {
      return await withRlsTransaction(
        this.db,
        principal,
        ctx,
        async (tx) => {
          const { rows } = await tx.query<Record<string, unknown>>(
            `select id, period_type, period_start, period_end, sales_id, team_id,
                    territory_id, currency, target_amount, target_units
             from public.sales_targets
             where ${where.join(" and ")}
             order by period_start desc limit 50`,
            params,
          );
          return { targets: rows, count: rows.length };
        },
        { readOnly: true },
      );
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  async getSalesForecast(principal: AuthPrincipal, ctx: ServiceContext) {
    requireCrmPermission(principal, "reports", "read");
    try {
      return await withRlsTransaction(
        this.db,
        principal,
        ctx,
        async (tx) => {
          const { rows } = await tx.query<Record<string, unknown>>(
            `select id, period_start, period_end, sales_id, team_id, territory_id,
                    currency, committed_amount, best_case_amount, pipeline_amount,
                    closed_amount, status, submitted_at
             from public.sales_forecasts
             order by period_start desc limit 50`,
          );
          return { forecasts: rows, count: rows.length };
        },
        { readOnly: true },
      );
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  // ============================================================================
  // Domain 6: Customer Activities & Follow-ups
  // ============================================================================

  async createVisitReport(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    input: {
      company_id: number;
      subject: string;
      start_at?: string;
      location?: string;
      objective?: string;
      discussion?: string;
      outcome?: string;
      follow_up_date?: string;
      activity_type_code?: string;
      checkin_lat?: number;
      checkin_lng?: number;
    },
  ) {
    requireCrmPermission(principal, "activities", "create");
    assertRequiredFields(input as Record<string, unknown>, [
      { field: "company_id", label: "Customer ID" },
      { field: "subject", label: "Visit subject" },
    ]);

    const orgId = principal.organizationId ?? 1;
    const typeCode = input.activity_type_code ?? "onsite_visit";

    try {
      return await withRlsTransaction(this.db, principal, ctx, async (tx) => {
        const comp = await tx.query<{ id: number }>(
          `select id from public.companies
           where id = $1 and organization_id = $2 and deleted_at is null`,
          [input.company_id, orgId],
        );
        if (!comp.rows[0]) {
          throw new PlatformError(
            "RESOURCE_NOT_AVAILABLE",
            "Customer not found in your organization",
          );
        }

        const optRes = await tx.query<{ id: number }>(
          `select id from public.master_options
           where category = 'activity_type' and code = $1`,
          [typeCode],
        );
        const typeId = optRes.rows[0]?.id;
        if (!typeId) {
          throw new PlatformError(
            "VALIDATION_FAILED",
            `Unknown activity_type_code "${typeCode}"`,
          );
        }

        const { rows } = await tx.query<Record<string, unknown>>(
          `insert into public.activities (
             activity_type_id, subject, company_id, start_at, location, objective,
             discussion, outcome, status, follow_up_date, checkin_lat, checkin_lng, sales_id
           ) values ($1, $2, $3, coalesce($4::timestamptz, now()), $5, $6, $7, $8, 'completed', $9::date, $10, $11, $12)
           returning id, company_id, subject, status, start_at, logged_at, follow_up_date, sales_id`,
          [
            typeId,
            input.subject.trim(),
            input.company_id,
            input.start_at ?? null,
            input.location ?? null,
            input.objective ?? null,
            input.discussion ?? null,
            input.outcome ?? null,
            input.follow_up_date ?? null,
            input.checkin_lat ?? null,
            input.checkin_lng ?? null,
            principal.salesId,
          ],
        );
        return {
          status: "created",
          recordId: Number(rows[0].id),
          visit: rows[0],
        };
      });
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  async getVisitHistory(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    input: { companyId?: number; limit?: number },
  ) {
    requireCrmPermission(principal, "activities", "read");
    const orgId = principal.organizationId ?? 1;
    const cap = clampLimit(input.limit, 25, 100);
    const params: unknown[] = [orgId];
    const where: string[] = ["c.organization_id = $1"];
    if (input.companyId) {
      params.push(input.companyId);
      where.push(`a.company_id = $${params.length}`);
    }

    try {
      return await withRlsTransaction(
        this.db,
        principal,
        ctx,
        async (tx) => {
          const { rows } = await tx.query<Record<string, unknown>>(
            `select a.id, a.company_id, c.name as company_name, a.subject, a.status,
                    a.start_at, a.logged_at, a.location, a.outcome, a.discussion,
                    a.follow_up_date, a.sales_id
             from public.activities a
             join public.companies c on c.id = a.company_id
             where ${where.join(" and ")}
             order by a.start_at desc limit $${params.length + 1}`,
            [...params, cap],
          );
          return {
            visits: markUntrustedContent(rows),
            count: rows.length,
          };
        },
        { readOnly: true },
      );
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  async createFollowUp(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    input: {
      company_id: number;
      description: string;
      due_date?: string;
      activity_id?: number;
    },
  ) {
    requireCrmPermission(principal, "activities", "create");
    assertRequiredFields(input as Record<string, unknown>, [
      { field: "company_id", label: "Customer ID" },
      { field: "description", label: "Follow-up description" },
    ]);
    const orgId = principal.organizationId ?? 1;

    try {
      return await withRlsTransaction(this.db, principal, ctx, async (tx) => {
        const comp = await tx.query<{ id: number }>(
          `select id from public.companies
           where id = $1 and organization_id = $2 and deleted_at is null`,
          [input.company_id, orgId],
        );
        if (!comp.rows[0]) {
          throw new PlatformError(
            "RESOURCE_NOT_AVAILABLE",
            "Customer not found in your organization",
          );
        }
        const { rows } = await tx.query<Record<string, unknown>>(
          `insert into public.action_items (
             company_id, activity_id, description, due_date, status, sales_id
           ) values ($1, $2, $3, $4::date, 'open', $5)
           returning *`,
          [
            input.company_id,
            input.activity_id ?? null,
            input.description.trim(),
            input.due_date ?? null,
            principal.salesId,
          ],
        );
        return {
          status: "created",
          recordId: Number(rows[0].id),
          followUp: rows[0],
        };
      });
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  async scheduleFollowUp(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    followUpId: number,
    dueDate: string,
  ) {
    if (!dueDate || Number.isNaN(Date.parse(dueDate))) {
      throw new PlatformError(
        "VALIDATION_FAILED",
        "A valid ISO due_date (YYYY-MM-DD) is required",
      );
    }
    const orgId = principal.organizationId ?? 1;

    try {
      return await withRlsTransaction(this.db, principal, ctx, async (tx) => {
        const cur = await tx.query<{
          id: number;
          sales_id: number | null;
          organization_id: number;
        }>(
          `select ai.id, ai.sales_id, coalesce(c.organization_id, 1) as organization_id
           from public.action_items ai
           left join public.companies c on c.id = ai.company_id
           where ai.id = $1`,
          [followUpId],
        );
        if (!cur.rows[0] || Number(cur.rows[0].organization_id) !== orgId) {
          throw new PlatformError(
            "RESOURCE_NOT_AVAILABLE",
            "Follow-up item not found",
          );
        }
        requireCrmPermission(principal, "activities", "update", {
          ownerSalesId:
            cur.rows[0].sales_id !== null ? Number(cur.rows[0].sales_id) : null,
          recordOrganizationId: orgId,
        });

        const { rows } = await tx.query<Record<string, unknown>>(
          `update public.action_items set due_date = $1::date where id = $2 returning *`,
          [dueDate, followUpId],
        );
        if (!rows[0]) {
          throw new PlatformError(
            "DATA_SCOPE_DENIED",
            "Not authorized to schedule this follow-up",
          );
        }
        return { status: "updated", recordId: followUpId, followUp: rows[0] };
      });
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  async completeFollowUp(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    followUpId: number,
  ) {
    const orgId = principal.organizationId ?? 1;

    try {
      return await withRlsTransaction(this.db, principal, ctx, async (tx) => {
        const cur = await tx.query<{
          id: number;
          sales_id: number | null;
          organization_id: number;
        }>(
          `select ai.id, ai.sales_id, coalesce(c.organization_id, 1) as organization_id
           from public.action_items ai
           left join public.companies c on c.id = ai.company_id
           where ai.id = $1`,
          [followUpId],
        );
        if (!cur.rows[0] || Number(cur.rows[0].organization_id) !== orgId) {
          throw new PlatformError(
            "RESOURCE_NOT_AVAILABLE",
            "Follow-up item not found",
          );
        }
        requireCrmPermission(principal, "activities", "update", {
          ownerSalesId:
            cur.rows[0].sales_id !== null ? Number(cur.rows[0].sales_id) : null,
          recordOrganizationId: orgId,
        });

        const { rows } = await tx.query<Record<string, unknown>>(
          `update public.action_items set status = 'done' where id = $1 returning *`,
          [followUpId],
        );
        if (!rows[0]) {
          throw new PlatformError(
            "DATA_SCOPE_DENIED",
            "Not authorized to complete this follow-up",
          );
        }
        return { status: "completed", recordId: followUpId, followUp: rows[0] };
      });
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  // ============================================================================
  // Domain 7: Quotation
  // ============================================================================

  async createQuotation(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    input: {
      company_id: number;
      subject: string;
      contact_id?: number;
      deal_id?: number;
      rfq_id?: number;
      currency?: string;
      valid_until?: string;
      payment_terms?: string;
      delivery_terms?: string;
      notes?: string;
      items?: Array<{
        product_id?: number;
        description?: string;
        quantity: number;
        uom?: string;
        unit_price: number;
        discount_percent?: number;
      }>;
    },
  ) {
    requireCrmPermission(principal, "quotations", "create");
    assertRequiredFields(input as Record<string, unknown>, [
      { field: "company_id", label: "Customer ID" },
      { field: "subject", label: "Quotation subject" },
    ]);

    const idem = await this.checkIdempotency<Record<string, unknown>>(
      principal,
      "quotations:create",
      ctx.idempotencyKey,
      input,
    );
    if (idem.hit) return { ...idem.body, idempotentReplay: true };

    const orgId = principal.organizationId ?? 1;

    try {
      const created = await withRlsTransaction(
        this.db,
        principal,
        ctx,
        async (tx) => {
          const comp = await tx.query<{ id: number }>(
            `select id from public.companies
             where id = $1 and organization_id = $2 and deleted_at is null`,
            [input.company_id, orgId],
          );
          if (!comp.rows[0]) {
            throw new PlatformError(
              "RESOURCE_NOT_AVAILABLE",
              "Customer not found in your organization",
            );
          }

          const qRes = await tx.query<Record<string, unknown>>(
            `insert into public.quotations (
               company_id, contact_id, deal_id, rfq_id, subject, currency,
               status, valid_until, payment_terms, delivery_terms, notes, sales_id
             ) values ($1, $2, $3, $4, $5, coalesce($6, 'THB'), 'draft', $7::date, $8, $9, $10, $11)
             returning *`,
            [
              input.company_id,
              input.contact_id ?? null,
              input.deal_id ?? null,
              input.rfq_id ?? null,
              input.subject.trim(),
              input.currency ?? "THB",
              input.valid_until ?? null,
              input.payment_terms ?? null,
              input.delivery_terms ?? null,
              input.notes ?? null,
              principal.salesId,
            ],
          );
          const quotationId = Number(qRes.rows[0].id);

          const insertedItems: Record<string, unknown>[] = [];
          for (let i = 0; i < (input.items ?? []).length; i += 1) {
            const item = input.items![i];
            const itemRes = await tx.query<Record<string, unknown>>(
              `insert into public.quotation_items (
                 quotation_id, line_no, product_id, description, quantity, uom,
                 unit_price, discount_percent
               ) values ($1, $2, $3, $4, $5, $6, $7, coalesce($8, 0))
               returning *`,
              [
                quotationId,
                i + 1,
                item.product_id ?? null,
                item.description ?? null,
                item.quantity,
                item.uom ?? "pcs",
                item.unit_price,
                item.discount_percent ?? 0,
              ],
            );
            insertedItems.push(itemRes.rows[0]);
          }

          const refreshed = await tx.query<Record<string, unknown>>(
            `select * from public.quotations where id = $1`,
            [quotationId],
          );

          return {
            status: "created",
            recordId: quotationId,
            quotation: refreshed.rows[0],
            items: insertedItems,
          };
        },
      );

      await this.saveIdempotency(
        principal,
        "quotations:create",
        ctx.idempotencyKey,
        idem.hash,
        201,
        created,
      );
      return created;
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  async updateQuotationDraft(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    quotationId: number,
    patch: Record<string, unknown>,
    expectedVersion?: number,
  ) {
    const clean = enforceWriteFieldAllowlist(
      patch,
      "quotations",
      [
        "subject",
        "valid_until",
        "payment_terms",
        "delivery_terms",
        "notes",
        "follow_up_date",
      ],
      principal,
    );
    if (Object.keys(clean).length === 0) {
      throw new PlatformError(
        "VALIDATION_FAILED",
        "Provide at least one editable quotation draft field",
      );
    }
    const orgId = principal.organizationId ?? 1;

    try {
      return await withRlsTransaction(this.db, principal, ctx, async (tx) => {
        const curRes = await tx.query<{
          id: number;
          sales_id: number | null;
          status: string;
          version: number;
          organization_id: number;
        }>(
          `select q.id, q.sales_id, q.status, q.version, c.organization_id
           from public.quotations q
           join public.companies c on c.id = q.company_id
           where q.id = $1 and c.organization_id = $2 and q.deleted_at is null`,
          [quotationId, orgId],
        );
        const cur = curRes.rows[0];
        if (!cur) {
          throw new PlatformError(
            "RESOURCE_NOT_AVAILABLE",
            "Quotation not found or outside your scope",
          );
        }
        requireCrmPermission(principal, "quotations", "update", {
          ownerSalesId: cur.sales_id !== null ? Number(cur.sales_id) : null,
          recordOrganizationId: orgId,
        });
        if (!["draft", "rejected"].includes(cur.status)) {
          throw new PlatformError(
            "VALIDATION_FAILED",
            `Quotation is locked in status "${cur.status}"`,
          );
        }
        if (
          expectedVersion !== undefined &&
          Number(cur.version) !== expectedVersion
        ) {
          throw new PlatformError(
            "VERSION_CONFLICT",
            `Quotation version conflict: expected ${expectedVersion}, current is ${cur.version}`,
          );
        }

        const keys = Object.keys(clean);
        const setSql = keys.map((k, i) => `"${k}" = $${i + 1}`).join(", ");
        const values = [...keys.map((k) => clean[k]), quotationId];
        const { rows } = await tx.query<Record<string, unknown>>(
          `update public.quotations set ${setSql} where id = $${values.length} returning *`,
          values,
        );
        return {
          status: "updated",
          recordId: quotationId,
          changedFields: keys,
          quotation: rows[0],
        };
      });
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  async getQuotation(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    quotationId: number,
  ) {
    requireCrmPermission(principal, "quotations", "read");
    const orgId = principal.organizationId ?? 1;

    try {
      return await withRlsTransaction(
        this.db,
        principal,
        ctx,
        async (tx) => {
          const qRes = await tx.query<Record<string, unknown>>(
            `select q.*, c.name as company_name
             from public.quotations q
             join public.companies c on c.id = q.company_id
             where q.id = $1 and c.organization_id = $2 and q.deleted_at is null`,
            [quotationId, orgId],
          );
          if (!qRes.rows[0]) {
            throw new PlatformError(
              "RESOURCE_NOT_AVAILABLE",
              "Quotation not found or outside your scope",
            );
          }
          const items = await tx.query<Record<string, unknown>>(
            `select * from public.quotation_items where quotation_id = $1 order by line_no`,
            [quotationId],
          );
          const approvals = await tx.query<Record<string, unknown>>(
            `select id, required_role_key, status, decided_by, decided_at, comment
             from public.quotation_approvals where quotation_id = $1 order by id`,
            [quotationId],
          );
          return {
            quotation: qRes.rows[0],
            items: items.rows,
            approvals: approvals.rows,
          };
        },
        { readOnly: true },
      );
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  async submitQuotationForApproval(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    quotationId: number,
  ) {
    requireCrmPermission(principal, "quotations", "update");
    const orgId = principal.organizationId ?? 1;

    try {
      return await withRlsTransaction(this.db, principal, ctx, async (tx) => {
        const check = await tx.query<{ id: number }>(
          `select q.id from public.quotations q
           join public.companies c on c.id = q.company_id
           where q.id = $1 and c.organization_id = $2 and q.deleted_at is null`,
          [quotationId, orgId],
        );
        if (!check.rows[0]) {
          throw new PlatformError(
            "RESOURCE_NOT_AVAILABLE",
            "Quotation not found or outside your scope",
          );
        }
        const { rows } = await tx.query<Record<string, unknown>>(
          `select * from public.submit_quotation($1)`,
          [quotationId],
        );
        return {
          status: "submitted",
          recordId: quotationId,
          quotation: rows[0],
        };
      });
    } catch (err) {
      throw normalizePgError(err);
    }
  }
}
