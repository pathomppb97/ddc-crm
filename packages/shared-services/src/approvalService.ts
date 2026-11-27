import {
  evaluateAccess,
  PlatformError,
  redactSecrets,
  type AuthPrincipal,
  type RiskLevel,
} from "../../shared-auth/src/index";
import {
  canonicalJson,
  sha256Hex,
  type ServiceContext,
  type SqlExecutor,
} from "./sqlExecutor";

export interface ApprovalRequestRecord {
  id: number;
  requestUuid: string;
  organizationId: number;
  requestingUserId: string;
  requestingSalesId: number;
  aiClientId: string | null;
  toolName: string;
  toolVersion: string;
  operationSummary: string;
  riskLevel: "L3" | "L4" | "L5";
  targetResource: string;
  targetRecordId: string | null;
  resourceVersion: number | null;
  payloadHash: string;
  sanitizedPayload: Record<string, unknown>;
  previewBefore: Record<string, unknown> | null;
  previewAfter: Record<string, unknown> | null;
  status:
    "pending" | "approved" | "rejected" | "expired" | "executed" | "cancelled";
  expiresAt: string;
  decidedBySalesId: number | null;
  decidedAt: string | null;
  decisionComment: string | null;
  executedAt: string | null;
  executionResult: Record<string, unknown> | null;
  createdAt: string;
}

interface ApprovalRow {
  id: number;
  request_uuid: string;
  organization_id: number;
  requesting_user_id: string;
  requesting_sales_id: number;
  ai_client_id: string | null;
  tool_name: string;
  tool_version: string;
  operation_summary: string;
  risk_level: "L3" | "L4" | "L5";
  target_resource: string;
  target_record_id: string | null;
  resource_version: number | null;
  payload_hash: string;
  sanitized_payload: Record<string, unknown>;
  preview_before: Record<string, unknown> | null;
  preview_after: Record<string, unknown> | null;
  status: ApprovalRequestRecord["status"];
  expires_at: string;
  decided_by_sales_id: number | null;
  decided_at: string | null;
  decision_comment: string | null;
  executed_at: string | null;
  execution_result: Record<string, unknown> | null;
  created_at: string;
}

function mapApprovalRow(r: ApprovalRow): ApprovalRequestRecord {
  return {
    id: Number(r.id),
    requestUuid: r.request_uuid,
    organizationId: Number(r.organization_id),
    requestingUserId: r.requesting_user_id,
    requestingSalesId: Number(r.requesting_sales_id),
    aiClientId: r.ai_client_id,
    toolName: r.tool_name,
    toolVersion: r.tool_version,
    operationSummary: r.operation_summary,
    riskLevel: r.risk_level,
    targetResource: r.target_resource,
    targetRecordId: r.target_record_id,
    resourceVersion:
      r.resource_version !== null ? Number(r.resource_version) : null,
    payloadHash: r.payload_hash,
    sanitizedPayload: r.sanitized_payload ?? {},
    previewBefore: r.preview_before,
    previewAfter: r.preview_after,
    status: r.status,
    expiresAt: new Date(r.expires_at).toISOString(),
    decidedBySalesId:
      r.decided_by_sales_id !== null ? Number(r.decided_by_sales_id) : null,
    decidedAt: r.decided_at ? new Date(r.decided_at).toISOString() : null,
    decisionComment: r.decision_comment,
    executedAt: r.executed_at ? new Date(r.executed_at).toISOString() : null,
    executionResult: r.execution_result,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export async function computePayloadHash(
  toolName: string,
  payload: Record<string, unknown>,
  resourceVersion?: number | null,
): Promise<string> {
  // Strip control fields that are supplied at execution time after approval
  const clean = { ...payload };
  delete clean.approval_id;
  delete clean.confirmation_token;
  delete clean.idempotency_key;
  return sha256Hex(
    canonicalJson({
      toolName,
      resourceVersion: resourceVersion ?? null,
      payload: clean,
    }),
  );
}

/**
 * Deterministic confirmation token for L3 operations bound to user, tool,
 * canonical payload hash, and organization.
 */
export async function computeConfirmationToken(params: {
  userId: string;
  organizationId: number;
  toolName: string;
  payloadHash: string;
}): Promise<string> {
  const raw = await sha256Hex(
    `ddc-l3-confirm:${params.organizationId}:${params.userId}:${params.toolName}:${params.payloadHash}`,
  );
  return `cfm_${raw.slice(0, 32)}`;
}

export class ApprovalService {
  constructor(private readonly db: SqlExecutor) {}

  async createApprovalRequest(
    principal: AuthPrincipal,
    ctx: ServiceContext,
    input: {
      toolName: string;
      toolVersion?: string;
      operationSummary: string;
      riskLevel: Extract<RiskLevel, "L3" | "L4" | "L5">;
      targetResource: string;
      targetRecordId?: string | null;
      resourceVersion?: number | null;
      payload: Record<string, unknown>;
      previewBefore?: Record<string, unknown> | null;
      previewAfter?: Record<string, unknown> | null;
      expiresInMinutes?: number;
    },
  ): Promise<ApprovalRequestRecord> {
    if (!principal.salesId) {
      throw new PlatformError(
        "PERMISSION_DENIED",
        "Approval requests require an active CRM user identity",
      );
    }
    const orgId = principal.organizationId ?? 1;
    const payloadHash = await computePayloadHash(
      input.toolName,
      input.payload,
      input.resourceVersion,
    );
    const sanitized = redactSecrets(input.payload) as Record<string, unknown>;
    const ttlMinutes = Math.max(
      5,
      Math.min(1440, input.expiresInMinutes ?? 240),
    );
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();

    const { rows } = await this.db.query<ApprovalRow>(
      `insert into public.mcp_approval_requests (
         organization_id, requesting_user_id, requesting_sales_id, ai_client_id,
         tool_name, tool_version, operation_summary, risk_level,
         target_resource, target_record_id, resource_version,
         payload_hash, sanitized_payload, preview_before, preview_after,
         status, expires_at
       ) values ($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15::jsonb, 'pending', $16::timestamptz)
       returning *`,
      [
        orgId,
        principal.userId,
        principal.salesId,
        ctx.aiClientId ?? principal.aiClientId ?? null,
        input.toolName,
        input.toolVersion ?? "1.0.0",
        input.operationSummary,
        input.riskLevel,
        input.targetResource,
        input.targetRecordId ?? null,
        input.resourceVersion ?? null,
        payloadHash,
        JSON.stringify(sanitized),
        input.previewBefore
          ? JSON.stringify(redactSecrets(input.previewBefore))
          : null,
        input.previewAfter
          ? JSON.stringify(redactSecrets(input.previewAfter))
          : null,
        expiresAt,
      ],
    );

    return mapApprovalRow(rows[0]);
  }

  async listApprovalRequests(
    principal: AuthPrincipal,
    filters?: { status?: string; limit?: number },
  ): Promise<ApprovalRequestRecord[]> {
    const orgId = principal.organizationId ?? 1;
    const canViewAll =
      evaluateAccess(principal, {
        resource: "mcp_approvals",
        action: "read",
        recordOrganizationId: orgId,
      }) ||
      evaluateAccess(principal, {
        resource: "mcp_admin",
        action: "read",
        recordOrganizationId: orgId,
      });

    const params: unknown[] = [orgId];
    const where: string[] = ["organization_id = $1"];

    if (!canViewAll) {
      if (!principal.salesId) return [];
      params.push(principal.salesId);
      where.push(`requesting_sales_id = $${params.length}`);
    }
    if (filters?.status) {
      params.push(filters.status);
      where.push(`status = $${params.length}`);
    }
    const limit = Math.max(1, Math.min(100, filters?.limit ?? 50));
    params.push(limit);

    const { rows } = await this.db.query<ApprovalRow>(
      `select * from public.mcp_approval_requests
       where ${where.join(" and ")}
       order by created_at desc
       limit $${params.length}`,
      params,
    );
    return rows.map(mapApprovalRow);
  }

  /**
   * Decides (approves or rejects) a pending AI approval request.
   * Strictly enforces:
   * - Caller holds mcp_approvals:approve (or admin)
   * - Caller is NOT the requesting user (AI/requester cannot self-approve!)
   * - Same organization
   * - Request is pending and not expired
   */
  async decideApproval(
    approver: AuthPrincipal,
    approvalId: number,
    decision: "approved" | "rejected",
    comment?: string,
  ): Promise<ApprovalRequestRecord> {
    if (approver.disabled || !approver.salesId) {
      throw new PlatformError("ACCOUNT_SUSPENDED", "Approver account inactive");
    }
    const orgId = approver.organizationId ?? 1;

    if (
      !evaluateAccess(approver, {
        resource: "mcp_approvals",
        action: "approve",
        recordOrganizationId: orgId,
      })
    ) {
      throw new PlatformError(
        "PERMISSION_DENIED",
        "Permission mcp_approvals:approve is required to decide AI approval requests",
      );
    }

    const existingRes = await this.db.query<ApprovalRow>(
      `select * from public.mcp_approval_requests
       where id = $1 and organization_id = $2`,
      [approvalId, orgId],
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      throw new PlatformError(
        "RESOURCE_NOT_AVAILABLE",
        "Approval request not found",
      );
    }

    // Strict anti-self-approval (also enforced by DB CHECK constraint)
    if (Number(existing.requesting_sales_id) === approver.salesId) {
      throw new PlatformError(
        "PERMISSION_DENIED",
        "Requesters and AI agents cannot approve their own privileged operations",
      );
    }

    // L5 privileged operations require super_admin or release_manager
    if (
      existing.risk_level === "L5" &&
      !(
        approver.administrator ||
        approver.roleKey === "super_admin" ||
        approver.roleKey === "release_manager"
      )
    ) {
      throw new PlatformError(
        "PERMISSION_DENIED",
        "L5 production/security operations require Super Admin or Release Manager approval",
      );
    }

    if (existing.status !== "pending") {
      throw new PlatformError(
        "VALIDATION_FAILED",
        `Approval request is already in status "${existing.status}"`,
      );
    }

    if (Date.parse(existing.expires_at) <= Date.now()) {
      await this.db.query(
        `update public.mcp_approval_requests set status = 'expired' where id = $1`,
        [approvalId],
      );
      throw new PlatformError(
        "APPROVAL_REQUIRED",
        "Approval request has expired; submit a new approval request",
      );
    }

    if (decision === "rejected" && (!comment || comment.trim().length < 3)) {
      throw new PlatformError(
        "VALIDATION_FAILED",
        "A rejection comment is required",
      );
    }

    const { rows } = await this.db.query<ApprovalRow>(
      `update public.mcp_approval_requests
       set status = $1,
           decided_by_sales_id = $2,
           decided_at = now(),
           decision_comment = $3
       where id = $4
       returning *`,
      [decision, approver.salesId, comment?.trim() ?? null, approvalId],
    );
    return mapApprovalRow(rows[0]);
  }

  /**
   * Verifies that an approved request matches the exact user, organization,
   * tool, canonical payload hash, resource version, and has not expired or been consumed.
   */
  async verifyApprovedExecution(params: {
    principal: AuthPrincipal;
    approvalId: number;
    toolName: string;
    payload: Record<string, unknown>;
    currentResourceVersion?: number | null;
  }): Promise<ApprovalRequestRecord> {
    const orgId = params.principal.organizationId ?? 1;
    const res = await this.db.query<ApprovalRow>(
      `select * from public.mcp_approval_requests
       where id = $1 and organization_id = $2`,
      [params.approvalId, orgId],
    );
    const rec = res.rows[0];
    if (!rec) {
      throw new PlatformError(
        "APPROVAL_REQUIRED",
        "Approval reference not found in this organization",
      );
    }

    if (rec.requesting_user_id !== params.principal.userId) {
      throw new PlatformError(
        "PERMISSION_DENIED",
        "Approval is bound to a different requesting user",
      );
    }

    if (rec.tool_name !== params.toolName) {
      throw new PlatformError(
        "APPROVAL_REQUIRED",
        "Approval is bound to a different tool operation",
      );
    }

    if (rec.status !== "approved") {
      throw new PlatformError(
        "APPROVAL_REQUIRED",
        `Approval request is "${rec.status}" (must be "approved" before execution)`,
      );
    }

    if (Date.parse(rec.expires_at) <= Date.now()) {
      await this.db.query(
        `update public.mcp_approval_requests set status = 'expired' where id = $1`,
        [params.approvalId],
      );
      throw new PlatformError(
        "APPROVAL_REQUIRED",
        "Approval has expired; request a new approval",
      );
    }

    if (
      rec.decided_by_sales_id === null ||
      Number(rec.decided_by_sales_id) === Number(rec.requesting_sales_id)
    ) {
      throw new PlatformError(
        "PERMISSION_DENIED",
        "Approval lacks a valid independent human approver",
      );
    }

    const expectedHash = await computePayloadHash(
      params.toolName,
      params.payload,
      params.currentResourceVersion ?? rec.resource_version,
    );
    if (expectedHash !== rec.payload_hash) {
      throw new PlatformError(
        "APPROVAL_REQUIRED",
        "Operation payload or resource version changed after approval; a new approval is required",
        { details: { reason: "payload_or_version_changed" } },
      );
    }

    return mapApprovalRow(rec);
  }

  async markExecuted(
    approvalId: number,
    executionResult: Record<string, unknown>,
  ): Promise<void> {
    await this.db.query(
      `update public.mcp_approval_requests
       set status = 'executed',
           executed_at = now(),
           execution_result = $1::jsonb
       where id = $2`,
      [JSON.stringify(redactSecrets(executionResult)), approvalId],
    );
  }
}
