import {
  applyFieldPermissions,
  assertDelegationAllowed,
  evaluateAccess,
  PlatformError,
  redactSecrets,
  type AuthPrincipal,
} from "../../shared-auth/src/index";
import { validateUiConfigPayload } from "../../shared-config/src/index";
import { QUERY_ALLOWLIST } from "../../shared-api/src/index";
import {
  ApprovalService,
  computeConfirmationToken,
  computePayloadHash,
} from "./approvalService";
import {
  normalizePgError,
  withRlsTransaction,
  type ServiceContext,
  type SqlExecutor,
} from "./sqlExecutor";

function requirePerm(
  principal: AuthPrincipal,
  resource: string,
  action:
    "read" | "create" | "update" | "delete" | "approve" | "export" | "import",
): void {
  if (
    !evaluateAccess(principal, {
      resource,
      action,
      recordOrganizationId: principal.organizationId ?? 1,
    })
  ) {
    throw new PlatformError(
      "PERMISSION_DENIED",
      `Permission ${resource}:${action} is required`,
    );
  }
}

/**
 * Shared Business Services — Governance, Analytics & Control Domains 8–13:
 * Data Management, Analytics & Reporting, Administration,
 * Web Design & Configuration, Release Management, and Automation.
 */
export class CrmControlServices {
  readonly approvals: ApprovalService;

  constructor(private readonly db: SqlExecutor) {
    this.approvals = new ApprovalService(db);
  }

  // ============================================================================
  // Domain 8: Data Management (Imports, Bulk Updates, Exports, Jobs)
  // ============================================================================

  async validateImport(
    principal: AuthPrincipal,
    _ctx: ServiceContext,
    input: {
      resource: "companies" | "contacts" | "products";
      rows: Array<Record<string, unknown>>;
    },
  ) {
    const permRes =
      input.resource === "companies"
        ? "customers"
        : input.resource === "contacts"
          ? "contacts"
          : "products";
    requirePerm(principal, permRes, "import");

    if (!Array.isArray(input.rows) || input.rows.length === 0) {
      throw new PlatformError(
        "VALIDATION_FAILED",
        "At least one import row is required",
      );
    }
    if (input.rows.length > 500) {
      throw new PlatformError(
        "VALIDATION_FAILED",
        "Interactive validation supports up to 500 rows per batch",
      );
    }

    const errors: Array<{ rowIndex: number; field: string; message: string }> =
      [];
    const requiredByRes: Record<string, string[]> = {
      companies: ["name"],
      contacts: ["first_name", "company_id"],
      products: ["part_number", "name"],
    };

    input.rows.forEach((row, idx) => {
      for (const reqField of requiredByRes[input.resource]) {
        const val = row[reqField];
        if (
          val === undefined ||
          val === null ||
          (typeof val === "string" && val.trim() === "")
        ) {
          errors.push({
            rowIndex: idx,
            field: reqField,
            message: `Missing required field "${reqField}"`,
          });
        }
      }
    });

    const payloadHash = await computePayloadHash("execute_approved_import", {
      resource: input.resource,
      rows: input.rows,
    });
    const confirmationToken =
      errors.length === 0
        ? await computeConfirmationToken({
            userId: principal.userId,
            organizationId: principal.organizationId ?? 1,
            toolName: "execute_approved_import",
            payloadHash,
          })
        : null;

    return {
      resource: input.resource,
      rowCount: input.rows.length,
      valid: errors.length === 0,
      errorCount: errors.length,
      errors: errors.slice(0, 50),
      confirmationToken,
    };
  }

  async previewBulkUpdate(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    input: {
      resource: "companies" | "deals";
      recordIds: number[];
      patch: Record<string, unknown>;
    },
  ) {
    const permRes =
      input.resource === "companies" ? "customers" : "opportunities";
    requirePerm(principal, permRes, "update");

    if (!Array.isArray(input.recordIds) || input.recordIds.length === 0) {
      throw new PlatformError(
        "VALIDATION_FAILED",
        "At least one recordId is required for bulk update preview",
      );
    }
    if (input.recordIds.length > 100) {
      throw new PlatformError(
        "VALIDATION_FAILED",
        "Bulk updates are capped at 100 records per request",
      );
    }

    const allowedPatchFields =
      input.resource === "companies"
        ? ["province", "city", "territory_id", "customer_group_id"]
        : ["stage", "follow_up_date", "probability"];

    const badFields = Object.keys(input.patch).filter(
      (k) => !allowedPatchFields.includes(k),
    );
    if (badFields.length > 0) {
      throw new PlatformError(
        "FIELD_ACCESS_DENIED",
        `Fields not allowlisted for bulk update: ${badFields.join(", ")}`,
      );
    }

    const orgId = principal.organizationId ?? 1;
    const beforeRows = await withRlsTransaction(
      this.db,
      principal,
      ctx,
      async (tx) => {
        if (input.resource === "companies") {
          const r = await tx.query<Record<string, unknown>>(
            `select id, name, province, city, territory_id, customer_group_id, version
             from public.companies
             where id = any($1::bigint[]) and organization_id = $2 and deleted_at is null`,
            [input.recordIds, orgId],
          );
          return r.rows;
        }
        const r = await tx.query<Record<string, unknown>>(
          `select d.id, d.name, d.stage, d.follow_up_date, d.probability, d.version
           from public.deals d
           join public.companies c on c.id = d.company_id
           where d.id = any($1::bigint[]) and c.organization_id = $2 and d.deleted_at is null`,
          [input.recordIds, orgId],
        );
        return r.rows;
      },
      { readOnly: true },
    );

    const payloadHash = await computePayloadHash(
      "execute_approved_bulk_update",
      {
        resource: input.resource,
        recordIds: [...input.recordIds].sort((a, b) => a - b),
        patch: input.patch,
      },
    );
    const confirmationToken = await computeConfirmationToken({
      userId: principal.userId,
      organizationId: orgId,
      toolName: "execute_approved_bulk_update",
      payloadHash,
    });

    return {
      resource: input.resource,
      matchedCount: beforeRows.length,
      before: beforeRows,
      proposedPatch: input.patch,
      confirmationToken,
    };
  }

  async executeApprovedImport(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    input: {
      resource: "companies" | "contacts" | "products";
      rows: Array<Record<string, unknown>>;
      confirmation_token?: string;
    },
  ) {
    const permRes =
      input.resource === "companies"
        ? "customers"
        : input.resource === "contacts"
          ? "contacts"
          : "products";
    requirePerm(principal, permRes, "import");

    const validation = await this.validateImport(principal, ctx, {
      resource: input.resource,
      rows: input.rows,
    });
    if (!validation.valid) {
      throw new PlatformError(
        "VALIDATION_FAILED",
        "Import rows failed validation; resolve errors before executing",
        { details: { errors: validation.errors } },
      );
    }
    if (
      !input.confirmation_token ||
      input.confirmation_token !== validation.confirmationToken
    ) {
      throw new PlatformError(
        "CONFIRMATION_REQUIRED",
        "Bulk import requires explicit user confirmation bound to the validated payload",
        {
          details: {
            rowCount: validation.rowCount,
            confirmationToken: validation.confirmationToken,
          },
        },
      );
    }

    const orgId = principal.organizationId ?? 1;
    const { rows } = await this.db.query<Record<string, unknown>>(
      `insert into public.scheduled_jobs (
         job_type, queue_name, idempotency_key, status, payload,
         created_by_sales_id, organization_id, channel, requested_by_user_id,
         required_permission_resource, required_permission_action
       ) values ('data_import', 'imports', $1, 'pending', $2::jsonb, $3, $4, $5, $6::uuid, $7, 'import')
       returning id, job_type, status, queue_name, scheduled_at, created_at`,
      [
        ctx.idempotencyKey ?? null,
        JSON.stringify({ resource: input.resource, rows: input.rows }),
        principal.salesId,
        orgId,
        ctx.channel,
        principal.userId,
        permRes,
      ],
    );
    return {
      status: "queued",
      job: rows[0],
      rowCount: input.rows.length,
    };
  }

  async executeApprovedBulkUpdate(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    input: {
      resource: "companies" | "deals";
      recordIds: number[];
      patch: Record<string, unknown>;
      confirmation_token?: string;
    },
  ) {
    const permRes =
      input.resource === "companies" ? "customers" : "opportunities";
    requirePerm(principal, permRes, "update");

    const preview = await this.previewBulkUpdate(principal, ctx, {
      resource: input.resource,
      recordIds: input.recordIds,
      patch: input.patch,
    });
    if (
      !input.confirmation_token ||
      input.confirmation_token !== preview.confirmationToken
    ) {
      throw new PlatformError(
        "CONFIRMATION_REQUIRED",
        "Bulk update requires explicit user confirmation matching the preview",
        {
          details: {
            matchedCount: preview.matchedCount,
            confirmationToken: preview.confirmationToken,
            before: preview.before,
            proposedPatch: preview.proposedPatch,
          },
        },
      );
    }

    const orgId = principal.organizationId ?? 1;
    const { rows } = await this.db.query<Record<string, unknown>>(
      `insert into public.scheduled_jobs (
         job_type, queue_name, idempotency_key, status, payload,
         created_by_sales_id, organization_id, channel, requested_by_user_id,
         required_permission_resource, required_permission_action
       ) values ('bulk_update', 'default', $1, 'pending', $2::jsonb, $3, $4, $5, $6::uuid, $7, 'update')
       returning id, job_type, status, queue_name, scheduled_at, created_at`,
      [
        ctx.idempotencyKey ?? null,
        JSON.stringify({
          resource: input.resource,
          recordIds: input.recordIds,
          patch: input.patch,
        }),
        principal.salesId,
        orgId,
        ctx.channel,
        principal.userId,
        permRes,
      ],
    );
    return {
      status: "queued",
      job: rows[0],
      affectedCount: preview.matchedCount,
    };
  }

  async generateExport(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    input: {
      resource: string;
      format?: "csv" | "json";
      maxRows?: number;
      confirmation_token?: string;
    },
  ) {
    const schema = QUERY_ALLOWLIST[input.resource];
    if (!schema) {
      throw new PlatformError(
        "VALIDATION_FAILED",
        `Resource "${input.resource}" is not allowlisted for export`,
      );
    }
    requirePerm(principal, schema.permissionResource, "export");

    const maxRows = Math.max(1, Math.min(1000, Number(input.maxRows ?? 100)));
    const orgId = principal.organizationId ?? 1;

    // L3 confirmation gate for large exports (>50 rows)
    if (maxRows > 50) {
      const hash = await computePayloadHash("generate_export", {
        resource: input.resource,
        format: input.format ?? "json",
        maxRows,
      });
      const expectedToken = await computeConfirmationToken({
        userId: principal.userId,
        organizationId: orgId,
        toolName: "generate_export",
        payloadHash: hash,
      });
      if (input.confirmation_token !== expectedToken) {
        throw new PlatformError(
          "CONFIRMATION_REQUIRED",
          `Exporting up to ${maxRows} rows from ${input.resource} requires explicit confirmation`,
          { details: { confirmationToken: expectedToken, maxRows } },
        );
      }
    }

    const { rows } = await this.db.query<Record<string, unknown>>(
      `insert into public.scheduled_jobs (
         job_type, queue_name, idempotency_key, status, payload,
         created_by_sales_id, organization_id, channel, requested_by_user_id,
         required_permission_resource, required_permission_action
       ) values ('data_export', 'exports', $1, 'pending', $2::jsonb, $3, $4, $5, $6::uuid, $7, 'export')
       returning id, job_type, status, queue_name, scheduled_at, created_at`,
      [
        ctx.idempotencyKey ?? null,
        JSON.stringify({
          resource: input.resource,
          format: input.format ?? "json",
          maxRows,
        }),
        principal.salesId,
        orgId,
        ctx.channel,
        principal.userId,
        schema.permissionResource,
      ],
    );
    return { status: "queued", job: rows[0] };
  }

  async getJobStatus(
    principal: AuthPrincipal,
    _ctx: ServiceContext,
    jobId: number,
  ) {
    const orgId = principal.organizationId ?? 1;
    const canReadAllJobs = evaluateAccess(principal, {
      resource: "jobs",
      action: "read",
      recordOrganizationId: orgId,
    });

    const { rows } = await this.db.query<Record<string, unknown>>(
      `select id, job_type, queue_name, status, scheduled_at, started_at, finished_at,
              attempt_count, max_attempts, error_message, result, channel,
              created_by_sales_id, organization_id, created_at
       from public.scheduled_jobs
       where id = $1 and organization_id = $2`,
      [jobId, orgId],
    );
    const job = rows[0];
    if (!job) {
      throw new PlatformError("RESOURCE_NOT_AVAILABLE", "Job not found");
    }
    if (
      !canReadAllJobs &&
      Number(job.created_by_sales_id) !== principal.salesId
    ) {
      throw new PlatformError(
        "DATA_SCOPE_DENIED",
        "You can only inspect jobs you created",
      );
    }
    return { job };
  }

  // ============================================================================
  // Domain 9: Analytics & Reporting
  // ============================================================================

  async queryCustomerSummary(principal: AuthPrincipal, ctx: ServiceContext) {
    requirePerm(principal, "reports", "read");
    requirePerm(principal, "customers", "read");
    const orgId = principal.organizationId ?? 1;

    try {
      return await withRlsTransaction(
        this.db,
        principal,
        ctx,
        async (tx) => {
          const totalRes = await tx.query<{ total: number }>(
            `select count(*)::int as total from public.companies where organization_id = $1 and deleted_at is null`,
            [orgId],
          );
          const byGroup = await tx.query<{ group_name: string; count: number }>(
            `select coalesce(mo.name_en, 'Unassigned') as group_name, count(*)::int as count
             from public.companies c
             left join public.master_options mo on mo.id = c.customer_group_id
             where c.organization_id = $1 and c.deleted_at is null
             group by 1 order by count desc`,
            [orgId],
          );
          const byProvince = await tx.query<{
            province: string;
            count: number;
          }>(
            `select coalesce(province, 'Unknown') as province, count(*)::int as count
             from public.companies
             where organization_id = $1 and deleted_at is null
             group by 1 order by count desc limit 20`,
            [orgId],
          );
          return {
            totalCustomers: Number(totalRes.rows[0]?.total ?? 0),
            byCustomerGroup: byGroup.rows,
            topProvinces: byProvince.rows,
          };
        },
        { readOnly: true },
      );
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  async queryMachineSummary(principal: AuthPrincipal, ctx: ServiceContext) {
    requirePerm(principal, "reports", "read");
    requirePerm(principal, "customers", "read");
    const orgId = principal.organizationId ?? 1;

    try {
      return await withRlsTransaction(
        this.db,
        principal,
        ctx,
        async (tx) => {
          const rows = await tx.query<{
            manufacturer: string;
            model_name: string;
            customer_count: number;
            total_units: number;
          }>(
            `select m.name as manufacturer, mm.model_name,
                    count(distinct cm.company_id)::int as customer_count,
                    coalesce(sum(cm.unit_count), 0)::int as total_units
             from public.customer_machines cm
             join public.companies c on c.id = cm.company_id
             join public.machine_models mm on mm.id = cm.machine_model_id
             join public.manufacturers m on m.id = mm.manufacturer_id
             where c.organization_id = $1 and cm.deleted_at is null
             group by m.name, mm.model_name
             order by total_units desc limit 30`,
            [orgId],
          );
          return { fleetSummary: rows.rows };
        },
        { readOnly: true },
      );
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  async querySalesSummary(principal: AuthPrincipal, ctx: ServiceContext) {
    requirePerm(principal, "reports", "read");
    requirePerm(principal, "opportunities", "read");
    const orgId = principal.organizationId ?? 1;

    try {
      return await withRlsTransaction(
        this.db,
        principal,
        ctx,
        async (tx) => {
          const opps = await tx.query<{
            stage: string;
            count: number;
            estimated_amount: number;
          }>(
            `select d.stage, count(*)::int as count, coalesce(sum(d.amount), 0)::numeric as estimated_amount
             from public.deals d
             join public.companies c on c.id = d.company_id
             where c.organization_id = $1 and d.deleted_at is null
             group by d.stage order by d.stage`,
            [orgId],
          );
          const quotes = await tx.query<{
            status: string;
            count: number;
            quoted_amount: number;
          }>(
            `select q.status, count(*)::int as count, coalesce(sum(q.total_amount), 0)::numeric as quoted_amount
             from public.quotations q
             join public.companies c on c.id = q.company_id
             where c.organization_id = $1 and q.deleted_at is null
             group by q.status order by q.status`,
            [orgId],
          );
          return {
            opportunitiesByStage: opps.rows,
            quotationsByStatus: quotes.rows,
          };
        },
        { readOnly: true },
      );
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  async queryReplacementDemand(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    companyId?: number,
  ) {
    requirePerm(principal, "reports", "read");
    requirePerm(principal, "customers", "read");
    const orgId = principal.organizationId ?? 1;
    const params: unknown[] = [orgId];
    const where: string[] = ["c.organization_id = $1"];
    if (companyId) {
      params.push(companyId);
      where.push(`cpu.company_id = $${params.length}`);
    }

    try {
      return await withRlsTransaction(
        this.db,
        principal,
        ctx,
        async (tx) => {
          const { rows } = await tx.query<Record<string, unknown>>(
            `select cpu.part_label,
                    count(distinct cpu.company_id)::int as customer_count,
                    coalesce(sum(cpu.estimated_season_qty), 0)::numeric as total_estimated_season_qty,
                    avg(cpu.qty_per_change)::numeric as avg_qty_per_change
             from public.customer_part_usage cpu
             join public.companies c on c.id = cpu.company_id
             where ${where.join(" and ")}
             group by cpu.part_label
             order by total_estimated_season_qty desc
             limit 50`,
            params,
          );
          return { replacementDemand: rows };
        },
        { readOnly: true },
      );
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  async generateReport(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    input: {
      report_type:
        | "customer_summary"
        | "machine_summary"
        | "sales_summary"
        | "replacement_demand";
      title?: string;
      is_shared?: boolean;
    },
  ) {
    requirePerm(principal, "reports", "read");
    if (!principal.salesId) {
      throw new PlatformError(
        "PERMISSION_DENIED",
        "Active sales user required",
      );
    }

    let summaryData: Record<string, unknown>;
    if (input.report_type === "customer_summary") {
      summaryData = await this.queryCustomerSummary(principal, ctx);
    } else if (input.report_type === "machine_summary") {
      summaryData = await this.queryMachineSummary(principal, ctx);
    } else if (input.report_type === "sales_summary") {
      summaryData = await this.querySalesSummary(principal, ctx);
    } else {
      summaryData = await this.queryReplacementDemand(principal, ctx);
    }

    const orgId = principal.organizationId ?? 1;
    const title =
      input.title?.trim() ||
      `${input.report_type} (${new Date().toISOString().slice(0, 10)})`;

    try {
      return await withRlsTransaction(this.db, principal, ctx, async (tx) => {
        const { rows } = await tx.query<Record<string, unknown>>(
          `insert into public.saved_reports (
             organization_id, report_type, title, parameters, summary_data,
             row_count, owner_sales_id, is_shared
           ) values ($1, $2, $3, '{}'::jsonb, $4::jsonb, $5, $6, $7)
           returning *`,
          [
            orgId,
            input.report_type,
            title,
            JSON.stringify(summaryData),
            Object.keys(summaryData).length,
            principal.salesId,
            Boolean(input.is_shared),
          ],
        );
        return { status: "generated", report: rows[0] };
      });
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  async getSavedReport(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    reportId: number,
  ) {
    requirePerm(principal, "reports", "read");
    const orgId = principal.organizationId ?? 1;

    try {
      return await withRlsTransaction(
        this.db,
        principal,
        ctx,
        async (tx) => {
          const { rows } = await tx.query<Record<string, unknown>>(
            `select * from public.saved_reports
             where id = $1 and organization_id = $2`,
            [reportId, orgId],
          );
          if (!rows[0]) {
            throw new PlatformError(
              "RESOURCE_NOT_AVAILABLE",
              "Saved report not found or outside your scope",
            );
          }
          return { report: rows[0] };
        },
        { readOnly: true },
      );
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  // ============================================================================
  // Domain 10: Administration
  // ============================================================================

  async getUsers(principal: AuthPrincipal, ctx: ServiceContext) {
    requirePerm(principal, "users", "read");
    const orgId = principal.organizationId ?? 1;

    try {
      return await withRlsTransaction(
        this.db,
        principal,
        ctx,
        async (tx) => {
          const { rows } = await tx.query<Record<string, unknown>>(
            `select id, user_id::text as user_id, email::text as email,
                    first_name, last_name, role_key, administrator, disabled,
                    mfa_enabled, last_login_at, organization_id
             from public.sales
             where organization_id = $1
             order by id asc`,
            [orgId],
          );
          return {
            users: rows.map((u) =>
              applyFieldPermissions(u, "users", principal),
            ),
          };
        },
        { readOnly: true },
      );
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  async inviteUser(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    input: {
      email: string;
      first_name: string;
      last_name: string;
      role_key: string;
      approval_id?: number;
    },
  ) {
    requirePerm(principal, "users", "create");
    assertDelegationAllowed({
      actor: principal,
      targetRoleKey: input.role_key,
    });

    if (!input.approval_id) {
      const req = await this.approvals.createApprovalRequest(principal, ctx, {
        toolName: "invite_user",
        operationSummary: `Invite user ${input.email} with role ${input.role_key}`,
        riskLevel: "L4",
        targetResource: "users",
        payload: input as Record<string, unknown>,
        previewAfter: {
          email: input.email,
          first_name: input.first_name,
          last_name: input.last_name,
          role_key: input.role_key,
        },
      });
      throw new PlatformError(
        "APPROVAL_REQUIRED",
        `Inviting a new user requires administrator approval (request #${req.id})`,
        { details: { approvalRequestId: req.id, expiresAt: req.expiresAt } },
      );
    }

    await this.approvals.verifyApprovedExecution({
      principal,
      approvalId: input.approval_id,
      toolName: "invite_user",
      payload: input as Record<string, unknown>,
    });

    // Enqueue verified user invitation job (auth.users provisioning executes in trusted admin function)
    const orgId = principal.organizationId ?? 1;
    const { rows } = await this.db.query<Record<string, unknown>>(
      `insert into public.scheduled_jobs (
         job_type, queue_name, status, payload, created_by_sales_id,
         organization_id, channel, requested_by_user_id,
         required_permission_resource, required_permission_action, approval_request_id
       ) values ('notification_dispatch', 'admin', 'pending', $1::jsonb, $2, $3, $4, $5::uuid, 'users', 'create', $6)
       returning id, status, created_at`,
      [
        JSON.stringify({
          action: "user_invitation",
          email: input.email.trim().toLowerCase(),
          first_name: input.first_name.trim(),
          last_name: input.last_name.trim(),
          role_key: input.role_key,
        }),
        principal.salesId,
        orgId,
        ctx.channel,
        principal.userId,
        input.approval_id,
      ],
    );
    const result = {
      status: "approved_and_queued",
      approvalId: input.approval_id,
      job: rows[0],
    };
    await this.approvals.markExecuted(input.approval_id, result);
    return result;
  }

  async updateUserStatus(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    input: {
      target_sales_id: number;
      disabled: boolean;
      reason: string;
      approval_id?: number;
    },
  ) {
    requirePerm(principal, "users", "update");
    assertDelegationAllowed({
      actor: principal,
      targetSalesId: input.target_sales_id,
    });

    const orgId = principal.organizationId ?? 1;
    const targetRes = await this.db.query<{
      id: number;
      email: string;
      disabled: boolean;
      role_key: string | null;
      organization_id: number;
    }>(
      `select id, email::text as email, disabled, role_key, organization_id
       from public.sales where id = $1 and organization_id = $2`,
      [input.target_sales_id, orgId],
    );
    const target = targetRes.rows[0];
    if (!target) {
      throw new PlatformError(
        "RESOURCE_NOT_AVAILABLE",
        "Target user not found",
      );
    }

    if (!input.approval_id) {
      const req = await this.approvals.createApprovalRequest(principal, ctx, {
        toolName: "update_user_status",
        operationSummary: `${input.disabled ? "Suspend" : "Activate"} user #${target.id} (${target.email})`,
        riskLevel: "L4",
        targetResource: "users",
        targetRecordId: String(target.id),
        payload: input as Record<string, unknown>,
        previewBefore: { disabled: target.disabled, role_key: target.role_key },
        previewAfter: { disabled: input.disabled, reason: input.reason },
      });
      throw new PlatformError(
        "APPROVAL_REQUIRED",
        `Updating user status requires human approval (request #${req.id})`,
        { details: { approvalRequestId: req.id, expiresAt: req.expiresAt } },
      );
    }

    await this.approvals.verifyApprovedExecution({
      principal,
      approvalId: input.approval_id,
      toolName: "update_user_status",
      payload: input as Record<string, unknown>,
    });

    await this.db.query(
      `update public.sales set disabled = $1 where id = $2 and organization_id = $3`,
      [input.disabled, input.target_sales_id, orgId],
    );
    if (input.disabled) {
      await this.db.query(
        `update public.mcp_connections
         set status = 'revoked', revoked_at = now(), revoked_by_sales_id = $1, revoke_reason = $2
         where sales_id = $3 and status = 'active'`,
        [principal.salesId, input.reason, input.target_sales_id],
      );
      await this.db.query(
        `update public.oauth_grants
         set revoked_at = now(), revoked_by_sales_id = $1, revoke_reason = $2
         where sales_id = $3 and revoked_at is null`,
        [principal.salesId, input.reason, input.target_sales_id],
      );
    }

    const result = {
      status: "updated",
      salesId: input.target_sales_id,
      disabled: input.disabled,
      approvalId: input.approval_id,
    };
    await this.approvals.markExecuted(input.approval_id, result);
    return result;
  }

  async getRoles(principal: AuthPrincipal, ctx: ServiceContext) {
    requirePerm(principal, "roles", "read");
    return withRlsTransaction(
      this.db,
      principal,
      ctx,
      async (tx) => {
        const { rows } = await tx.query<Record<string, unknown>>(
          `select key, name, name_en, description, is_system, sort_order
           from public.ddc_roles order by sort_order asc`,
        );
        return { roles: rows };
      },
      { readOnly: true },
    );
  }

  async getPermissions(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    roleKey?: string,
  ) {
    requirePerm(principal, "roles", "read");
    return withRlsTransaction(
      this.db,
      principal,
      ctx,
      async (tx) => {
        const { rows } = roleKey
          ? await tx.query<Record<string, unknown>>(
              `select role_key, resource, action, scope
               from public.role_permissions
               where role_key = $1 order by resource, action`,
              [roleKey],
            )
          : await tx.query<Record<string, unknown>>(
              `select role_key, resource, action, scope
               from public.role_permissions order by role_key, resource, action`,
            );
        return { permissions: rows };
      },
      { readOnly: true },
    );
  }

  async requestPermissionChange(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    input: {
      role_key: string;
      resource: string;
      action:
        | "read"
        | "create"
        | "update"
        | "delete"
        | "approve"
        | "export"
        | "import";
      scope: "all" | "own";
      operation: "grant" | "revoke";
      reason: string;
    },
  ) {
    requirePerm(principal, "roles", "update");
    assertDelegationAllowed({
      actor: principal,
      targetRoleKey: input.role_key,
      requestedPermissions:
        input.operation === "grant"
          ? [
              {
                resource: input.resource,
                action: input.action,
                scope: input.scope,
              },
            ]
          : undefined,
    });

    const approval = await this.approvals.createApprovalRequest(
      principal,
      ctx,
      {
        toolName: "request_permission_change",
        operationSummary: `${input.operation.toUpperCase()} ${input.resource}:${input.action} (${input.scope}) on role ${input.role_key}`,
        riskLevel: "L4",
        targetResource: "roles",
        targetRecordId: input.role_key,
        payload: input as Record<string, unknown>,
        previewAfter: input as Record<string, unknown>,
      },
    );

    return {
      status: "pending_approval",
      approvalRequest: approval,
    };
  }

  async getAuditHistory(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    input: { tableName?: string; channel?: string; limit?: number },
  ) {
    requirePerm(principal, "audit_log", "read");
    const orgId = principal.organizationId ?? 1;
    const cap = Math.max(1, Math.min(100, Number(input.limit ?? 30)));
    const params: unknown[] = [orgId];
    const where: string[] = [
      "(organization_id = $1 or organization_id is null)",
    ];
    if (input.tableName?.trim()) {
      params.push(input.tableName.trim());
      where.push(`table_name = $${params.length}`);
    }
    if (input.channel?.trim()) {
      params.push(input.channel.trim());
      where.push(`channel = $${params.length}`);
    }

    return withRlsTransaction(
      this.db,
      principal,
      ctx,
      async (tx) => {
        const { rows } = await tx.query<Record<string, unknown>>(
          `select id, occurred_at, actor_sales_id, table_name, record_id, action,
                  changed_fields, request_id, channel, ai_client_id, mcp_tool_name,
                  approval_request_id, reason
           from public.audit_log
           where ${where.join(" and ")}
           order by occurred_at desc, id desc
           limit $${params.length + 1}`,
          [...params, cap],
        );
        return { entries: rows };
      },
      { readOnly: true },
    );
  }

  // ============================================================================
  // Domain 11: Web Design & Configuration
  // ============================================================================

  async getActiveConfiguration(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    environment: "development" | "staging" | "production" = "production",
  ) {
    return withRlsTransaction(
      this.db,
      principal,
      ctx,
      async (tx) => {
        const { rows } = await tx.query<Record<string, unknown>>(
          `select id, environment, version_number, status, config_payload,
                  change_summary, published_at
           from public.ui_config_versions
           where environment = $1 and status = 'published'
           limit 1`,
          [environment],
        );
        return {
          environment,
          activeConfiguration: rows[0] ?? null,
        };
      },
      { readOnly: true },
    );
  }

  async createThemeDraft(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    input: {
      environment: "development" | "staging" | "production";
      change_summary?: string;
      config_payload: unknown;
    },
  ) {
    requirePerm(principal, "ui_config", "create");
    const validation = validateUiConfigPayload(input.config_payload);
    if (!validation.valid) {
      throw new PlatformError(
        "VALIDATION_FAILED",
        "Configuration payload failed schema or security validation",
        { details: { errors: validation.errors } },
      );
    }

    try {
      return await withRlsTransaction(this.db, principal, ctx, async (tx) => {
        const verRes = await tx.query<{ next_ver: number }>(
          `select coalesce(max(version_number), 0) + 1 as next_ver
           from public.ui_config_versions where environment = $1`,
          [input.environment],
        );
        const nextVer = Number(verRes.rows[0]?.next_ver ?? 1);
        const { rows } = await tx.query<Record<string, unknown>>(
          `insert into public.ui_config_versions (
             environment, version_number, status, config_payload, change_summary,
             validation_errors, created_by_sales_id
           ) values ($1, $2, 'draft', $3::jsonb, $4, '[]'::jsonb, $5)
           returning *`,
          [
            input.environment,
            nextVer,
            JSON.stringify(validation.data),
            input.change_summary ?? "AI-assisted draft",
            principal.salesId,
          ],
        );
        return { status: "created", draft: rows[0] };
      });
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  async updateConfigurationDraft(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    versionId: number,
    configPayload: unknown,
    changeSummary?: string,
  ) {
    requirePerm(principal, "ui_config", "update");
    const validation = validateUiConfigPayload(configPayload);
    if (!validation.valid) {
      throw new PlatformError(
        "VALIDATION_FAILED",
        "Updated configuration payload failed security validation",
        { details: { errors: validation.errors } },
      );
    }

    try {
      return await withRlsTransaction(this.db, principal, ctx, async (tx) => {
        const { rows } = await tx.query<Record<string, unknown>>(
          `update public.ui_config_versions
           set config_payload = $1::jsonb,
               change_summary = coalesce($2, change_summary),
               validation_errors = '[]'::jsonb
           where id = $3 and status in ('draft', 'validated')
           returning *`,
          [JSON.stringify(validation.data), changeSummary ?? null, versionId],
        );
        if (!rows[0]) {
          throw new PlatformError(
            "RESOURCE_NOT_AVAILABLE",
            "Editable configuration draft not found",
          );
        }
        return { status: "updated", draft: rows[0] };
      });
    } catch (err) {
      throw normalizePgError(err);
    }
  }

  validateConfiguration(principal: AuthPrincipal, configPayload: unknown) {
    requirePerm(principal, "ui_config", "read");
    return validateUiConfigPayload(configPayload);
  }

  async previewConfiguration(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    versionId: number,
  ) {
    requirePerm(principal, "ui_config", "read");
    return withRlsTransaction(
      this.db,
      principal,
      ctx,
      async (tx) => {
        const { rows } = await tx.query<Record<string, unknown>>(
          `select id, environment, version_number, status, config_payload, change_summary
           from public.ui_config_versions where id = $1`,
          [versionId],
        );
        if (!rows[0]) {
          throw new PlatformError(
            "RESOURCE_NOT_AVAILABLE",
            "Configuration version not found",
          );
        }
        return {
          previewOnly: true,
          configuration: rows[0],
          validation: validateUiConfigPayload(rows[0].config_payload),
        };
      },
      { readOnly: true },
    );
  }

  async requestConfigurationPublish(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    input: { version_id: number; reason: string },
  ) {
    requirePerm(principal, "ui_config", "update");
    const ver = await this.db.query<{
      id: number;
      environment: string;
      version_number: number;
      status: string;
      config_payload: Record<string, unknown>;
    }>(
      `select id, environment, version_number, status, config_payload
       from public.ui_config_versions where id = $1`,
      [input.version_id],
    );
    if (!ver.rows[0]) {
      throw new PlatformError(
        "RESOURCE_NOT_AVAILABLE",
        "Configuration version not found",
      );
    }
    const approval = await this.approvals.createApprovalRequest(
      principal,
      ctx,
      {
        toolName: "request_configuration_publish",
        operationSummary: `Publish UI config v${ver.rows[0].version_number} to ${ver.rows[0].environment}`,
        riskLevel: ver.rows[0].environment === "production" ? "L5" : "L4",
        targetResource: "ui_config",
        targetRecordId: String(input.version_id),
        payload: input as Record<string, unknown>,
        previewAfter: {
          environment: ver.rows[0].environment,
          version_number: ver.rows[0].version_number,
          reason: input.reason,
        },
      },
    );
    return { status: "pending_approval", approvalRequest: approval };
  }

  async scheduleConfigurationPublish(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    input: {
      version_id: number;
      scheduled_publish_at_utc: string;
      reason: string;
    },
  ) {
    requirePerm(principal, "ui_config", "update");
    if (Number.isNaN(Date.parse(input.scheduled_publish_at_utc))) {
      throw new PlatformError(
        "VALIDATION_FAILED",
        "scheduled_publish_at_utc must be a valid ISO-8601 UTC timestamp",
      );
    }
    const approval = await this.approvals.createApprovalRequest(
      principal,
      ctx,
      {
        toolName: "schedule_configuration_publish",
        operationSummary: `Schedule UI config #${input.version_id} publish at ${input.scheduled_publish_at_utc}`,
        riskLevel: "L4",
        targetResource: "ui_config",
        targetRecordId: String(input.version_id),
        payload: input as Record<string, unknown>,
        previewAfter: input as Record<string, unknown>,
      },
    );
    return { status: "pending_approval", approvalRequest: approval };
  }

  // ============================================================================
  // Domain 12: Release Management
  // ============================================================================

  async getReleaseStatus(principal: AuthPrincipal, ctx: ServiceContext) {
    requirePerm(principal, "releases", "read");
    return withRlsTransaction(
      this.db,
      principal,
      ctx,
      async (tx) => {
        const latest = await tx.query<Record<string, unknown>>(
          `select distinct on (environment)
                  d.id as deployment_id, d.environment, d.status, d.finished_at,
                  r.release_tag, r.app_target, r.git_sha, r.approval_status
           from public.deployments d
           join public.releases r on r.id = d.release_id
           order by d.environment, d.created_at desc`,
        );
        return { environments: latest.rows };
      },
      { readOnly: true },
    );
  }

  async getDeploymentHistory(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    limit = 20,
  ) {
    requirePerm(principal, "deployments", "read");
    return withRlsTransaction(
      this.db,
      principal,
      ctx,
      async (tx) => {
        const { rows } = await tx.query<Record<string, unknown>>(
          `select d.id, d.environment, d.strategy, d.status, d.scheduled_at,
                  d.started_at, d.finished_at, d.health_check_status, d.smoke_test_status,
                  r.release_tag, r.app_target
           from public.deployments d
           join public.releases r on r.id = d.release_id
           order by d.created_at desc limit $1`,
          [Math.max(1, Math.min(100, limit))],
        );
        return { deployments: rows };
      },
      { readOnly: true },
    );
  }

  async getAvailableReleases(principal: AuthPrincipal, ctx: ServiceContext) {
    requirePerm(principal, "releases", "read");
    return withRlsTransaction(
      this.db,
      principal,
      ctx,
      async (tx) => {
        const { rows } = await tx.query<Record<string, unknown>>(
          `select id, release_tag, environment, app_target, git_sha,
                  build_status, approval_status, created_at
           from public.releases
           order by created_at desc limit 50`,
        );
        return { releases: rows };
      },
      { readOnly: true },
    );
  }

  async requestDeployment(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    input: {
      release_id: number;
      environment: "development" | "staging" | "production";
      reason: string;
    },
  ) {
    requirePerm(principal, "deployments", "create");
    const rel = await this.db.query<{
      id: number;
      release_tag: string;
      build_status: string;
      approval_status: string;
    }>(
      `select id, release_tag, build_status, approval_status from public.releases where id = $1`,
      [input.release_id],
    );
    if (!rel.rows[0]) {
      throw new PlatformError("RESOURCE_NOT_AVAILABLE", "Release not found");
    }
    if (rel.rows[0].build_status !== "succeeded") {
      throw new PlatformError(
        "VALIDATION_FAILED",
        "Cannot request deployment of an unbuilt or failed release artifact",
      );
    }

    const approval = await this.approvals.createApprovalRequest(
      principal,
      ctx,
      {
        toolName: "request_deployment",
        operationSummary: `Deploy ${rel.rows[0].release_tag} to ${input.environment}`,
        riskLevel: input.environment === "production" ? "L5" : "L4",
        targetResource: "deployments",
        targetRecordId: String(input.release_id),
        payload: input as Record<string, unknown>,
        previewAfter: {
          releaseTag: rel.rows[0].release_tag,
          environment: input.environment,
          reason: input.reason,
        },
      },
    );
    return { status: "pending_approval", approvalRequest: approval };
  }

  async scheduleDeployment(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    input: {
      release_id: number;
      environment: "development" | "staging" | "production";
      scheduled_at_utc: string;
      reason: string;
    },
  ) {
    requirePerm(principal, "deployments", "create");
    if (Number.isNaN(Date.parse(input.scheduled_at_utc))) {
      throw new PlatformError(
        "VALIDATION_FAILED",
        "scheduled_at_utc must be a valid ISO-8601 UTC timestamp",
      );
    }
    const approval = await this.approvals.createApprovalRequest(
      principal,
      ctx,
      {
        toolName: "schedule_deployment",
        operationSummary: `Schedule deployment of release #${input.release_id} to ${input.environment} at ${input.scheduled_at_utc}`,
        riskLevel: input.environment === "production" ? "L5" : "L4",
        targetResource: "deployments",
        targetRecordId: String(input.release_id),
        payload: input as Record<string, unknown>,
        previewAfter: input as Record<string, unknown>,
      },
    );
    return { status: "pending_approval", approvalRequest: approval };
  }

  async requestRollback(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    input: {
      target_deployment_id: number;
      environment: "development" | "staging" | "production";
      reason: string;
    },
  ) {
    requirePerm(principal, "deployments", "update");
    const approval = await this.approvals.createApprovalRequest(
      principal,
      ctx,
      {
        toolName: "request_rollback",
        operationSummary: `Rollback ${input.environment} to deployment #${input.target_deployment_id}`,
        riskLevel: "L5",
        targetResource: "deployments",
        targetRecordId: String(input.target_deployment_id),
        payload: input as Record<string, unknown>,
        previewAfter: input as Record<string, unknown>,
      },
    );
    return { status: "pending_approval", approvalRequest: approval };
  }

  // ============================================================================
  // Domain 13: Automation
  // ============================================================================

  async createAutomationJob(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    input: {
      job_type: "report_generation" | "notification_dispatch" | "ai_automation";
      scheduled_at_utc?: string;
      payload: Record<string, unknown>;
      required_permission_resource?: string;
      required_permission_action?: string;
    },
  ) {
    requirePerm(principal, "jobs", "create");
    const orgId = principal.organizationId ?? 1;
    const sanitized = redactSecrets(input.payload ?? {}) as Record<
      string,
      unknown
    >;

    const { rows } = await this.db.query<Record<string, unknown>>(
      `insert into public.scheduled_jobs (
         job_type, queue_name, idempotency_key, status, payload, scheduled_at,
         created_by_sales_id, organization_id, channel, requested_by_user_id,
         required_permission_resource, required_permission_action
       ) values (
         $1, 'automation', $2,
         case when $3::timestamptz is not null and $3::timestamptz > now() then 'scheduled' else 'pending' end,
         $4::jsonb, coalesce($3::timestamptz, now()), $5, $6, $7, $8::uuid, $9, $10
       )
       returning id, job_type, queue_name, status, scheduled_at, channel, created_at`,
      [
        input.job_type,
        ctx.idempotencyKey ?? null,
        input.scheduled_at_utc ?? null,
        JSON.stringify(sanitized),
        principal.salesId,
        orgId,
        ctx.channel,
        principal.userId,
        input.required_permission_resource ?? "jobs",
        input.required_permission_action ?? "create",
      ],
    );
    return { status: "created", job: rows[0] };
  }

  async getAutomationJobs(
    principal: AuthPrincipal,
    _ctx: ServiceContext,
    limit = 30,
  ) {
    const orgId = principal.organizationId ?? 1;
    const canReadAll = evaluateAccess(principal, {
      resource: "jobs",
      action: "read",
      recordOrganizationId: orgId,
    });
    const cap = Math.max(1, Math.min(100, limit));

    const { rows } = canReadAll
      ? await this.db.query<Record<string, unknown>>(
          `select id, job_type, queue_name, status, scheduled_at, started_at, finished_at,
                  attempt_count, max_attempts, channel, created_by_sales_id, created_at
           from public.scheduled_jobs
           where organization_id = $1
           order by created_at desc limit $2`,
          [orgId, cap],
        )
      : await this.db.query<Record<string, unknown>>(
          `select id, job_type, queue_name, status, scheduled_at, started_at, finished_at,
                  attempt_count, max_attempts, channel, created_by_sales_id, created_at
           from public.scheduled_jobs
           where organization_id = $1 and created_by_sales_id = $2
           order by created_at desc limit $3`,
          [orgId, principal.salesId ?? -1, cap],
        );

    return { jobs: rows };
  }

  async cancelAuthorizedJob(
    principal: AuthPrincipal,
    _ctx: ServiceContext,
    jobId: number,
  ) {
    const orgId = principal.organizationId ?? 1;
    const canManageJobs = evaluateAccess(principal, {
      resource: "jobs",
      action: "update",
      recordOrganizationId: orgId,
    });

    const cur = await this.db.query<{
      id: number;
      status: string;
      created_by_sales_id: number | null;
    }>(
      `select id, status, created_by_sales_id
       from public.scheduled_jobs
       where id = $1 and organization_id = $2`,
      [jobId, orgId],
    );
    const job = cur.rows[0];
    if (!job) {
      throw new PlatformError("RESOURCE_NOT_AVAILABLE", "Job not found");
    }
    if (
      !canManageJobs &&
      Number(job.created_by_sales_id) !== principal.salesId
    ) {
      throw new PlatformError(
        "PERMISSION_DENIED",
        "Not authorized to cancel this job",
      );
    }
    if (!["pending", "scheduled", "retrying"].includes(job.status)) {
      throw new PlatformError(
        "VALIDATION_FAILED",
        `Job in status "${job.status}" cannot be cancelled`,
      );
    }

    const { rows } = await this.db.query<Record<string, unknown>>(
      `update public.scheduled_jobs
       set status = 'cancelled', finished_at = now()
       where id = $1 returning id, status, finished_at`,
      [jobId],
    );
    return { status: "cancelled", job: rows[0] };
  }
}
