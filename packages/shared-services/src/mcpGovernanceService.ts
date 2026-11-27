import {
  assertDelegationAllowed,
  evaluateAccess,
  evaluateMcpToolAuthorization,
  PlatformError,
  redactSecrets,
  type AuthChannel,
  type AuthPrincipal,
  type DataScopeType,
  type ExecutionPolicy,
  type FieldAccessLevel,
  type McpRolePolicy,
  type McpToolPermissionOverride,
  type RiskLevel,
  type ToolPolicySubject,
} from "../../shared-auth/src/index";
import type { PrincipalResolver } from "./principalResolver";
import type { SqlExecutor } from "./sqlExecutor";

export interface ToolRegistryMetadata {
  toolId: string;
  toolName: string;
  displayName: string;
  description: string;
  domain: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  requiredPermissions: Array<{ resource: string; action: string }>;
  requiredOAuthScopes: string[];
  supportedDataScopes: DataScopeType[];
  fieldRestrictions: Record<string, FieldAccessLevel>;
  riskLevel: RiskLevel;
  executionPolicy: ExecutionPolicy;
  requiresConfirmation: boolean;
  requiresApproval: boolean;
  rateLimitPerMin: number;
  timeoutMs: number;
  requiresIdempotency: boolean;
  toolVersion: string;
  isEnabled: boolean;
  auditPolicy: "minimal" | "standard" | "full";
  handlerRef: string;
}

export interface ExecutionLogEntry {
  requestId: string;
  organizationId: number;
  userId?: string | null;
  salesId?: number | null;
  serviceAccountId?: number | null;
  aiClientId?: string | null;
  connectionUuid?: string | null;
  channel: AuthChannel;
  toolName: string;
  toolVersion: string;
  action: string;
  resource: string;
  resourceId?: string | null;
  riskLevel: RiskLevel;
  authorizationResult:
    "allowed" | "denied" | "approval_required" | "confirmation_required";
  executionResult: "success" | "error" | "blocked" | "pending_approval";
  changedFields?: string[];
  approvalRequestId?: number | null;
  errorCode?: string | null;
  durationMs: number;
}

export interface SecurityEventEntry {
  requestId: string;
  organizationId: number;
  userId?: string | null;
  salesId?: number | null;
  aiClientId?: string | null;
  eventType:
    | "unauthorized_tool"
    | "hidden_tool_invocation"
    | "scope_violation"
    | "cross_org_attempt"
    | "privilege_escalation"
    | "rate_limit_exceeded"
    | "revoked_connection"
    | "suspended_user"
    | "prompt_injection_signal"
    | "invalid_token"
    | "self_approval_attempt"
    | "unauthorized_export"
    | "approval_payload_mismatch";
  severity: "low" | "medium" | "high" | "critical";
  toolName?: string | null;
  errorCode?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
}

const VALID_REDIRECT_URI_PATTERN =
  /^(https:\/\/[^\s]+|http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/[^\s]*)?)$/;

function requireMcpAdmin(
  principal: AuthPrincipal,
  action: "read" | "create" | "update" | "delete",
): void {
  if (
    !evaluateAccess(principal, {
      resource: "mcp_admin",
      action,
      recordOrganizationId: principal.organizationId ?? 1,
    })
  ) {
    throw new PlatformError(
      "PERMISSION_DENIED",
      `Permission mcp_admin:${action} is required`,
    );
  }
}

/**
 * Governance & Observability service powering:
 * - Centralized MCP Tool Registry synchronization (server allowlist ONLY)
 * - Dynamic role/user/client/organization policy updates with immediate cache invalidation
 * - Real telemetry & security event logging (zero fabricated metrics)
 */
export class McpGovernanceService {
  private readonly policyChangeListeners = new Set<(orgId: number) => void>();

  constructor(
    private readonly db: SqlExecutor,
    private readonly resolver: PrincipalResolver,
  ) {}

  onPolicyChanged(listener: (orgId: number) => void): () => void {
    this.policyChangeListeners.add(listener);
    return () => this.policyChangeListeners.delete(listener);
  }

  private async bumpPolicyVersion(orgId: number): Promise<number> {
    const { rows } = await this.db.query<{ policy_version: number }>(
      `update public.organizations
       set policy_version = policy_version + 1, updated_at = now()
       where id = $1 returning policy_version`,
      [orgId],
    );
    this.resolver.invalidateOrganization(orgId);
    for (const listener of this.policyChangeListeners) {
      try {
        listener(orgId);
      } catch {
        // non-fatal notification failure
      }
    }
    return Number(rows[0]?.policy_version ?? 1);
  }

  /**
   * Synchronizes the server-side code-allowlisted Tool Registry into PostgreSQL.
   * Admin UI can NEVER register arbitrary executable code — only metadata of
   * server-allowlisted handlers is synced here.
   */
  async syncAllowlistedTools(
    tools: readonly ToolRegistryMetadata[],
  ): Promise<void> {
    for (const t of tools) {
      await this.db.query(
        `insert into public.mcp_tools (
           tool_id, tool_name, display_name, description, domain,
           input_schema, output_schema, required_permissions, required_oauth_scopes,
           supported_data_scopes, field_restrictions, risk_level, execution_policy,
           requires_confirmation, requires_approval, rate_limit_per_min, timeout_ms,
           requires_idempotency, tool_version, is_enabled, audit_policy, handler_ref
         ) values (
           $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::text[],
           $10::text[], $11::jsonb, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
         )
         on conflict (tool_id) do update set
           display_name = excluded.display_name,
           description = excluded.description,
           input_schema = excluded.input_schema,
           output_schema = excluded.output_schema,
           required_permissions = excluded.required_permissions,
           required_oauth_scopes = excluded.required_oauth_scopes,
           supported_data_scopes = excluded.supported_data_scopes,
           risk_level = excluded.risk_level,
           tool_version = excluded.tool_version,
           handler_ref = excluded.handler_ref`,
        [
          t.toolId,
          t.toolName,
          t.displayName,
          t.description,
          t.domain,
          JSON.stringify(t.inputSchema),
          JSON.stringify(t.outputSchema),
          JSON.stringify(t.requiredPermissions),
          t.requiredOAuthScopes,
          t.supportedDataScopes,
          JSON.stringify(t.fieldRestrictions),
          t.riskLevel,
          t.executionPolicy,
          t.requiresConfirmation,
          t.requiresApproval,
          t.rateLimitPerMin,
          t.timeoutMs,
          t.requiresIdempotency,
          t.toolVersion,
          t.isEnabled,
          t.auditPolicy,
          t.handlerRef,
        ],
      );
    }
  }

  async getToolRuntimeStates(): Promise<
    Map<
      string,
      {
        isEnabled: boolean;
        rateLimitPerMin: number;
        executionPolicy: ExecutionPolicy;
      }
    >
  > {
    const { rows } = await this.db.query<{
      tool_name: string;
      is_enabled: boolean;
      rate_limit_per_min: number;
      execution_policy: ExecutionPolicy;
    }>(
      `select tool_name, is_enabled, rate_limit_per_min, execution_policy from public.mcp_tools`,
    );
    return new Map(
      rows.map((r) => [
        r.tool_name,
        {
          isEnabled: Boolean(r.is_enabled),
          rateLimitPerMin: Number(r.rate_limit_per_min),
          executionPolicy: r.execution_policy,
        },
      ]),
    );
  }

  // --- Admin Control Center: MCP Overview (REAL metrics only) ---

  async getMcpOverview(
    principal: AuthPrincipal,
    protocolVersion = "2025-11-25",
  ) {
    requireMcpAdmin(principal, "read");
    const orgId = principal.organizationId ?? 1;

    const [orgRes, toolsRes, connRes, clientRes, logsRes, secRes, apprRes] =
      await Promise.all([
        this.db.query<{ mcp_enabled: boolean; policy_version: number }>(
          `select mcp_enabled, policy_version from public.organizations where id = $1`,
          [orgId],
        ),
        this.db.query<{ total: number; enabled: number }>(
          `select count(*)::int as total, count(*) filter (where is_enabled)::int as enabled
           from public.mcp_tools`,
        ),
        this.db.query<{ active_connections: number; connected_users: number }>(
          `select count(*)::int as active_connections,
                  count(distinct sales_id)::int as connected_users
           from public.mcp_connections
           where organization_id = $1 and status = 'active'`,
          [orgId],
        ),
        this.db.query<{ total: number; active: number }>(
          `select count(*)::int as total,
                  count(*) filter (where status = 'active')::int as active
           from public.mcp_clients where organization_id = $1`,
          [orgId],
        ),
        this.db.query<{
          total_requests: number;
          success_count: number;
          denied_count: number;
          error_count: number;
          avg_duration_ms: number;
        }>(
          `select count(*)::int as total_requests,
                  count(*) filter (where execution_result = 'success')::int as success_count,
                  count(*) filter (where authorization_result = 'denied')::int as denied_count,
                  count(*) filter (where execution_result = 'error')::int as error_count,
                  coalesce(round(avg(duration_ms)), 0)::int as avg_duration_ms
           from public.mcp_execution_logs
           where organization_id = $1`,
          [orgId],
        ),
        this.db.query<{ total_events: number; high_severity: number }>(
          `select count(*)::int as total_events,
                  count(*) filter (where severity in ('high', 'critical'))::int as high_severity
           from public.mcp_security_events where organization_id = $1`,
          [orgId],
        ),
        this.db.query<{ pending: number }>(
          `select count(*)::int as pending
           from public.mcp_approval_requests
           where organization_id = $1 and status = 'pending' and expires_at > now()`,
          [orgId],
        ),
      ]);

    const logStats = logsRes.rows[0];
    const totalReq = Number(logStats?.total_requests ?? 0);
    const successRate =
      totalReq > 0
        ? Number(((Number(logStats.success_count) / totalReq) * 100).toFixed(2))
        : null;
    const denialRate =
      totalReq > 0
        ? Number(((Number(logStats.denied_count) / totalReq) * 100).toFixed(2))
        : null;
    const errorRate =
      totalReq > 0
        ? Number(((Number(logStats.error_count) / totalReq) * 100).toFixed(2))
        : null;

    return {
      serverStatus: orgRes.rows[0]?.mcp_enabled ? "active" : "disabled",
      mcpEnabled: Boolean(orgRes.rows[0]?.mcp_enabled),
      policyVersion: Number(orgRes.rows[0]?.policy_version ?? 1),
      protocolVersion,
      registeredTools: Number(toolsRes.rows[0]?.total ?? 0),
      enabledTools: Number(toolsRes.rows[0]?.enabled ?? 0),
      activeConnections: Number(connRes.rows[0]?.active_connections ?? 0),
      connectedUsers: Number(connRes.rows[0]?.connected_users ?? 0),
      authorizedClients: Number(clientRes.rows[0]?.active ?? 0),
      totalClients: Number(clientRes.rows[0]?.total ?? 0),
      pendingApprovals: Number(apprRes.rows[0]?.pending ?? 0),
      requestVolume: totalReq,
      successRatePercent: successRate,
      permissionDenialRatePercent: denialRate,
      errorRatePercent: errorRate,
      avgLatencyMs: Number(logStats?.avg_duration_ms ?? 0),
      securityEventsTotal: Number(secRes.rows[0]?.total_events ?? 0),
      securityHighSeverity: Number(secRes.rows[0]?.high_severity ?? 0),
    };
  }

  async updateOrganizationMcpPolicy(
    principal: AuthPrincipal,
    input: { mcpEnabled: boolean },
  ) {
    requireMcpAdmin(principal, "update");
    const orgId = principal.organizationId ?? 1;
    await this.db.query(
      `update public.organizations set mcp_enabled = $1 where id = $2`,
      [input.mcpEnabled, orgId],
    );
    const policyVersion = await this.bumpPolicyVersion(orgId);
    return {
      organizationId: orgId,
      mcpEnabled: input.mcpEnabled,
      policyVersion,
    };
  }

  async listTools(principal: AuthPrincipal) {
    requireMcpAdmin(principal, "read");
    const orgId = principal.organizationId ?? 1;
    const { rows } = await this.db.query<Record<string, unknown>>(
      `select t.*,
              coalesce(s.calls, 0)::int as call_count,
              coalesce(s.denials, 0)::int as denial_count
       from public.mcp_tools t
       left join (
         select tool_name,
                count(*) as calls,
                count(*) filter (where authorization_result = 'denied') as denials
         from public.mcp_execution_logs
         where organization_id = $1
         group by tool_name
       ) s on s.tool_name = t.tool_name
       order by t.domain, t.tool_name`,
      [orgId],
    );
    return { tools: rows };
  }

  async updateToolConfig(
    principal: AuthPrincipal,
    toolName: string,
    patch: {
      isEnabled?: boolean;
      rateLimitPerMin?: number;
      executionPolicy?: ExecutionPolicy;
      requiresApproval?: boolean;
    },
  ) {
    requireMcpAdmin(principal, "update");
    const orgId = principal.organizationId ?? 1;
    const { rows } = await this.db.query<Record<string, unknown>>(
      `update public.mcp_tools
       set is_enabled = coalesce($1, is_enabled),
           rate_limit_per_min = coalesce($2, rate_limit_per_min),
           execution_policy = coalesce($3, execution_policy),
           requires_approval = coalesce($4, requires_approval)
       where tool_name = $5
       returning *`,
      [
        patch.isEnabled ?? null,
        patch.rateLimitPerMin ?? null,
        patch.executionPolicy ?? null,
        patch.requiresApproval ?? null,
        toolName,
      ],
    );
    if (!rows[0]) {
      throw new PlatformError("RESOURCE_NOT_AVAILABLE", "Tool not found");
    }
    const policyVersion = await this.bumpPolicyVersion(orgId);
    return { tool: rows[0], policyVersion };
  }

  async upsertRolePolicy(
    principal: AuthPrincipal,
    roleKey: string,
    input: Partial<Omit<McpRolePolicy, "organizationId" | "roleKey">>,
  ) {
    requireMcpAdmin(principal, "update");
    assertDelegationAllowed({ actor: principal, targetRoleKey: roleKey });
    const orgId = principal.organizationId ?? 1;

    const { rows } = await this.db.query<Record<string, unknown>>(
      `insert into public.mcp_role_policies (
         organization_id, role_key, mcp_enabled, max_risk_level, allowed_oauth_scopes,
         default_data_scope, rate_limit_per_min, require_approval_from_level,
         allowed_client_ids, updated_by_sales_id
       ) values ($1, $2, coalesce($3, true), coalesce($4, 'L0'), coalesce($5::text[], array['mcp:read']::text[]),
                 coalesce($6, 'inherit'), coalesce($7, 60), coalesce($8, 'L4'),
                 coalesce($9::text[], '{}'::text[]), $10)
       on conflict (organization_id, role_key) do update set
         mcp_enabled = coalesce($3, mcp_role_policies.mcp_enabled),
         max_risk_level = coalesce($4, mcp_role_policies.max_risk_level),
         allowed_oauth_scopes = coalesce($5::text[], mcp_role_policies.allowed_oauth_scopes),
         default_data_scope = coalesce($6, mcp_role_policies.default_data_scope),
         rate_limit_per_min = coalesce($7, mcp_role_policies.rate_limit_per_min),
         require_approval_from_level = coalesce($8, mcp_role_policies.require_approval_from_level),
         allowed_client_ids = coalesce($9::text[], mcp_role_policies.allowed_client_ids),
         updated_by_sales_id = $10
       returning *`,
      [
        orgId,
        roleKey,
        input.mcpEnabled ?? null,
        input.maxRiskLevel ?? null,
        input.allowedOAuthScopes ?? null,
        input.defaultDataScope ?? null,
        input.rateLimitPerMin ?? null,
        input.requireApprovalFromLevel ?? null,
        input.allowedClientIds ?? null,
        principal.salesId,
      ],
    );
    const policyVersion = await this.bumpPolicyVersion(orgId);
    return { rolePolicy: rows[0], policyVersion };
  }

  async upsertRoleToolPermission(
    principal: AuthPrincipal,
    roleKey: string,
    toolName: string,
    input: {
      effect: "allow" | "deny";
      dataScope?: DataScopeType | "inherit";
      fieldRestrictions?: Record<string, FieldAccessLevel>;
      executionPolicyOverride?: ExecutionPolicy | null;
      rateLimitOverride?: number | null;
      requireApprovalOverride?: boolean | null;
    },
  ) {
    requireMcpAdmin(principal, "update");
    assertDelegationAllowed({ actor: principal, targetRoleKey: roleKey });
    const orgId = principal.organizationId ?? 1;

    const { rows } = await this.db.query<Record<string, unknown>>(
      `insert into public.mcp_tool_permissions (
         organization_id, role_key, tool_name, effect, data_scope,
         field_restrictions, execution_policy_override, rate_limit_override,
         require_approval_override, updated_by_sales_id
       ) values ($1, $2, $3, $4, coalesce($5, 'inherit'), coalesce($6::jsonb, '{}'::jsonb), $7, $8, $9, $10)
       on conflict (organization_id, role_key, tool_name) do update set
         effect = excluded.effect,
         data_scope = excluded.data_scope,
         field_restrictions = excluded.field_restrictions,
         execution_policy_override = excluded.execution_policy_override,
         rate_limit_override = excluded.rate_limit_override,
         require_approval_override = excluded.require_approval_override,
         updated_by_sales_id = excluded.updated_by_sales_id
       returning *`,
      [
        orgId,
        roleKey,
        toolName,
        input.effect,
        input.dataScope ?? "inherit",
        JSON.stringify(input.fieldRestrictions ?? {}),
        input.executionPolicyOverride ?? null,
        input.rateLimitOverride ?? null,
        input.requireApprovalOverride ?? null,
        principal.salesId,
      ],
    );
    const policyVersion = await this.bumpPolicyVersion(orgId);
    return { override: rows[0], policyVersion };
  }

  async getRoleEffectivePreview(
    principal: AuthPrincipal,
    roleKey: string,
    tools: readonly ToolPolicySubject[],
  ) {
    requireMcpAdmin(principal, "read");
    const orgId = principal.organizationId ?? 1;

    const [orgRes, permsRes, rpRes, ovRes] = await Promise.all([
      this.db.query<{
        id: number;
        code: string;
        name: string;
        is_active: boolean;
        mcp_enabled: boolean;
        policy_version: number;
      }>(`select * from public.organizations where id = $1`, [orgId]),
      this.db.query<{ resource: string; action: string; scope: DataScopeType }>(
        `select resource, action, scope from public.role_permissions where role_key = $1`,
        [roleKey],
      ),
      this.db.query<Record<string, unknown>>(
        `select * from public.mcp_role_policies where organization_id = $1 and role_key = $2`,
        [orgId, roleKey],
      ),
      this.db.query<Record<string, unknown>>(
        `select * from public.mcp_tool_permissions where organization_id = $1 and role_key = $2`,
        [orgId, roleKey],
      ),
    ]);

    const rpRow = rpRes.rows[0];
    const rolePolicy: McpRolePolicy | null = rpRow
      ? {
          organizationId: orgId,
          roleKey,
          mcpEnabled: Boolean(rpRow.mcp_enabled),
          maxRiskLevel: rpRow.max_risk_level as RiskLevel,
          allowedOAuthScopes: (rpRow.allowed_oauth_scopes as string[]) ?? [],
          defaultDataScope:
            (rpRow.default_data_scope as DataScopeType | "inherit") ??
            "inherit",
          rateLimitPerMin: Number(rpRow.rate_limit_per_min),
          requireApprovalFromLevel:
            rpRow.require_approval_from_level as Exclude<RiskLevel, "L0">,
          allowedClientIds: (rpRow.allowed_client_ids as string[]) ?? [],
        }
      : null;

    const overrides: McpToolPermissionOverride[] = ovRes.rows.map((o) => ({
      roleKey: String(o.role_key),
      toolName: String(o.tool_name),
      effect: o.effect as "allow" | "deny",
      dataScope: o.data_scope as DataScopeType | "inherit",
      fieldRestrictions:
        (o.field_restrictions as Record<string, FieldAccessLevel>) ?? {},
      executionPolicyOverride:
        (o.execution_policy_override as ExecutionPolicy | null) ?? null,
      rateLimitOverride:
        o.rate_limit_override !== null ? Number(o.rate_limit_override) : null,
      requireApprovalOverride: o.require_approval_override as boolean | null,
    }));

    const syntheticPrincipal: AuthPrincipal = {
      userId: "00000000-0000-4000-8000-000000000000",
      salesId: 0,
      email: `${roleKey}@preview.local`,
      roleKey,
      administrator: roleKey === "super_admin",
      disabled: false,
      organizationId: orgId,
      oauthScopes: rolePolicy?.allowedOAuthScopes ?? ["mcp:read"],
      permissions: permsRes.rows.map((p) => ({
        resource: p.resource,
        action: p.action as AuthPrincipal["permissions"][number]["action"],
        scope: p.scope,
      })),
    };

    const org = orgRes.rows[0];
    const runtimeStates = await this.getToolRuntimeStates();

    const preview = tools.map((tool) => {
      const state = runtimeStates.get(tool.toolName);
      const effectiveTool: ToolPolicySubject = state
        ? {
            ...tool,
            isEnabled: state.isEnabled,
            rateLimitPerMin: state.rateLimitPerMin,
            executionPolicy: state.executionPolicy,
          }
        : tool;
      const decision = evaluateMcpToolAuthorization(
        syntheticPrincipal,
        effectiveTool,
        {
          organization: {
            id: orgId,
            code: org?.code ?? "ddc_th",
            name: org?.name ?? "DDC",
            isActive: Boolean(org?.is_active ?? true),
            mcpEnabled: Boolean(org?.mcp_enabled ?? true),
            policyVersion: Number(org?.policy_version ?? 1),
          },
          rolePolicy,
          userPolicy: null,
          toolOverrides: overrides,
          client: null,
        },
      );
      return {
        toolName: tool.toolName,
        domain: tool.domain,
        riskLevel: tool.riskLevel,
        allowed: decision.allowed,
        reason: decision.reason ?? null,
        effectiveDataScope: decision.effectiveDataScope ?? null,
        effectiveExecutionPolicy: decision.effectiveExecutionPolicy ?? null,
        effectiveRateLimitPerMin: decision.effectiveRateLimitPerMin ?? null,
      };
    });

    return {
      roleKey,
      rolePolicy,
      overrides,
      effectiveTools: preview,
    };
  }

  async listUserMcpAccess(principal: AuthPrincipal) {
    requireMcpAdmin(principal, "read");
    const orgId = principal.organizationId ?? 1;
    const { rows } = await this.db.query<Record<string, unknown>>(
      `select s.id as sales_id, s.email::text as email, s.first_name, s.last_name,
              s.role_key, s.disabled, coalesce(up.mcp_enabled, true) as mcp_enabled,
              coalesce(up.denied_tools, '{}'::text[]) as denied_tools,
              (select count(*)::int from public.mcp_connections c
               where c.sales_id = s.id and c.status = 'active') as active_connections,
              (select max(c.last_activity_at) from public.mcp_connections c
               where c.sales_id = s.id) as last_mcp_activity
       from public.sales s
       left join public.mcp_user_policies up
         on up.sales_id = s.id and up.organization_id = s.organization_id
       where s.organization_id = $1
       order by s.id asc`,
      [orgId],
    );
    return { users: rows };
  }

  async upsertUserMcpPolicy(
    principal: AuthPrincipal,
    targetSalesId: number,
    input: {
      mcpEnabled?: boolean;
      deniedTools?: string[];
      rateLimitOverride?: number | null;
      notes?: string;
    },
  ) {
    requireMcpAdmin(principal, "update");
    assertDelegationAllowed({
      actor: principal,
      targetSalesId,
    });
    const orgId = principal.organizationId ?? 1;

    const { rows } = await this.db.query<Record<string, unknown>>(
      `insert into public.mcp_user_policies (
         organization_id, sales_id, mcp_enabled, denied_tools, rate_limit_override, notes, updated_by_sales_id
       ) values ($1, $2, coalesce($3, true), coalesce($4::text[], '{}'::text[]), $5, $6, $7)
       on conflict (organization_id, sales_id) do update set
         mcp_enabled = coalesce($3, mcp_user_policies.mcp_enabled),
         denied_tools = coalesce($4::text[], mcp_user_policies.denied_tools),
         rate_limit_override = coalesce($5, mcp_user_policies.rate_limit_override),
         notes = coalesce($6, mcp_user_policies.notes),
         updated_by_sales_id = $7
       returning *`,
      [
        orgId,
        targetSalesId,
        input.mcpEnabled ?? null,
        input.deniedTools ?? null,
        input.rateLimitOverride ?? null,
        input.notes ?? null,
        principal.salesId,
      ],
    );
    const policyVersion = await this.bumpPolicyVersion(orgId);
    return { userPolicy: rows[0], policyVersion };
  }

  async revokeUserMcpAccess(
    principal: AuthPrincipal,
    targetSalesId: number,
    reason: string,
  ) {
    requireMcpAdmin(principal, "update");
    const orgId = principal.organizationId ?? 1;

    await this.db.query(
      `update public.mcp_connections
       set status = 'revoked', revoked_at = now(), revoked_by_sales_id = $1, revoke_reason = $2
       where organization_id = $3 and sales_id = $4 and status = 'active'`,
      [principal.salesId, reason, orgId, targetSalesId],
    );
    await this.db.query(
      `update public.oauth_grants
       set revoked_at = now(), revoked_by_sales_id = $1, revoke_reason = $2
       where organization_id = $3 and sales_id = $4 and revoked_at is null`,
      [principal.salesId, reason, orgId, targetSalesId],
    );
    await this.db.query(
      `insert into public.mcp_user_policies (organization_id, sales_id, mcp_enabled, revoked_before, notes, updated_by_sales_id)
       values ($1, $2, false, now(), $3, $4)
       on conflict (organization_id, sales_id) do update set
         mcp_enabled = false, revoked_before = now(), notes = $3, updated_by_sales_id = $4`,
      [orgId, targetSalesId, reason, principal.salesId],
    );
    const policyVersion = await this.bumpPolicyVersion(orgId);
    return { status: "revoked", salesId: targetSalesId, policyVersion };
  }

  // --- AI Clients & Connections ---

  async listClients(principal: AuthPrincipal) {
    requireMcpAdmin(principal, "read");
    const orgId = principal.organizationId ?? 1;
    const { rows } = await this.db.query<Record<string, unknown>>(
      `select * from public.mcp_clients where organization_id = $1 order by created_at desc`,
      [orgId],
    );
    return { clients: rows };
  }

  async registerClient(
    principal: AuthPrincipal,
    input: {
      clientId: string;
      name: string;
      description?: string;
      clientType?: "public_pkce" | "confidential" | "service_account";
      allowedScopes: string[];
      redirectUris: string[];
      isVerifiedClient?: boolean;
      rateLimitPerMin?: number;
    },
  ) {
    requireMcpAdmin(principal, "create");
    for (const uri of input.redirectUris) {
      if (!VALID_REDIRECT_URI_PATTERN.test(uri)) {
        throw new PlatformError(
          "VALIDATION_FAILED",
          `Unsafe OAuth redirect URI "${uri}". Only HTTPS or loopback (127.0.0.1/localhost) URIs are allowed.`,
        );
      }
    }
    const orgId = principal.organizationId ?? 1;
    const { rows } = await this.db.query<Record<string, unknown>>(
      `insert into public.mcp_clients (
         organization_id, client_id, name, description, client_type, status,
         allowed_scopes, redirect_uris, pkce_required, is_verified_client,
         rate_limit_per_min, created_by_sales_id
       ) values ($1, $2, $3, $4, coalesce($5, 'public_pkce'), 'active', $6::text[], $7::text[], true, $8, coalesce($9, 120), $10)
       returning *`,
      [
        orgId,
        input.clientId,
        input.name,
        input.description ?? null,
        input.clientType ?? "public_pkce",
        input.allowedScopes,
        input.redirectUris,
        Boolean(input.isVerifiedClient),
        input.rateLimitPerMin ?? 120,
        principal.salesId,
      ],
    );
    return { client: rows[0] };
  }

  async revokeClient(
    principal: AuthPrincipal,
    clientId: string,
    reason: string,
  ) {
    requireMcpAdmin(principal, "update");
    const orgId = principal.organizationId ?? 1;
    await this.db.query(
      `update public.mcp_clients
       set status = 'revoked', revoked_at = now(), revoked_by_sales_id = $1, revoke_reason = $2
       where organization_id = $3 and client_id = $4`,
      [principal.salesId, reason, orgId, clientId],
    );
    await this.db.query(
      `update public.mcp_connections
       set status = 'revoked', revoked_at = now(), revoked_by_sales_id = $1, revoke_reason = $2
       where organization_id = $3 and client_id = $4 and status = 'active'`,
      [principal.salesId, reason, orgId, clientId],
    );
    const policyVersion = await this.bumpPolicyVersion(orgId);
    return { status: "revoked", clientId, policyVersion };
  }

  async listConnections(principal: AuthPrincipal) {
    const orgId = principal.organizationId ?? 1;
    const isAdmin = evaluateAccess(principal, {
      resource: "mcp_admin",
      action: "read",
      recordOrganizationId: orgId,
    });
    const { rows } = isAdmin
      ? await this.db.query<Record<string, unknown>>(
          `select c.*, s.email::text as user_email, s.role_key, cl.name as client_name
           from public.mcp_connections c
           join public.sales s on s.id = c.sales_id
           join public.mcp_clients cl on cl.client_id = c.client_id
           where c.organization_id = $1
           order by c.last_activity_at desc limit 100`,
          [orgId],
        )
      : await this.db.query<Record<string, unknown>>(
          `select c.*, cl.name as client_name
           from public.mcp_connections c
           join public.mcp_clients cl on cl.client_id = c.client_id
           where c.organization_id = $1 and c.sales_id = $2
           order by c.last_activity_at desc limit 50`,
          [orgId, principal.salesId ?? -1],
        );
    return { connections: rows };
  }

  async revokeConnection(
    principal: AuthPrincipal,
    connectionUuid: string,
    reason: string,
  ) {
    const orgId = principal.organizationId ?? 1;
    const isAdmin = evaluateAccess(principal, {
      resource: "mcp_admin",
      action: "update",
      recordOrganizationId: orgId,
    });

    const { rows } = isAdmin
      ? await this.db.query<Record<string, unknown>>(
          `update public.mcp_connections
           set status = 'revoked', revoked_at = now(), revoked_by_sales_id = $1, revoke_reason = $2
           where connection_uuid = $3::uuid and organization_id = $4
           returning *`,
          [principal.salesId, reason, connectionUuid, orgId],
        )
      : await this.db.query<Record<string, unknown>>(
          `update public.mcp_connections
           set status = 'revoked', revoked_at = now(), revoked_by_sales_id = $1, revoke_reason = $2
           where connection_uuid = $3::uuid and organization_id = $4 and sales_id = $1
           returning *`,
          [principal.salesId, reason, connectionUuid, orgId],
        );

    if (!rows[0]) {
      throw new PlatformError(
        "RESOURCE_NOT_AVAILABLE",
        "MCP connection not found or not owned by caller",
      );
    }
    return { status: "revoked", connection: rows[0] };
  }

  // --- Execution Logs & Security Events (Append-only) ---

  async recordExecutionLog(entry: ExecutionLogEntry): Promise<void> {
    await this.db.query(
      `insert into public.mcp_execution_logs (
         request_id, organization_id, user_id, sales_id, service_account_id,
         ai_client_id, connection_uuid, channel, tool_name, tool_version,
         action, resource, resource_id, risk_level, authorization_result,
         execution_result, changed_fields, approval_request_id, error_code, duration_ms
       ) values (
         $1, $2, $3::uuid, $4, $5, $6, $7::uuid, $8, $9, $10,
         $11, $12, $13, $14, $15, $16, $17::text[], $18, $19, $20
       )`,
      [
        entry.requestId,
        entry.organizationId,
        entry.userId ?? null,
        entry.salesId ?? null,
        entry.serviceAccountId ?? null,
        entry.aiClientId ?? null,
        entry.connectionUuid ?? null,
        entry.channel,
        entry.toolName,
        entry.toolVersion,
        entry.action,
        entry.resource,
        entry.resourceId ?? null,
        entry.riskLevel,
        entry.authorizationResult,
        entry.executionResult,
        entry.changedFields ?? [],
        entry.approvalRequestId ?? null,
        entry.errorCode ?? null,
        Math.max(0, Math.trunc(entry.durationMs)),
      ],
    );
  }

  async listExecutionLogs(
    principal: AuthPrincipal,
    filters?: { toolName?: string; result?: string; limit?: number },
  ) {
    requireMcpAdmin(principal, "read");
    const orgId = principal.organizationId ?? 1;
    const params: unknown[] = [orgId];
    const where: string[] = ["l.organization_id = $1"];
    if (filters?.toolName) {
      params.push(filters.toolName);
      where.push(`l.tool_name = $${params.length}`);
    }
    if (filters?.result) {
      params.push(filters.result);
      where.push(`l.execution_result = $${params.length}`);
    }
    const cap = Math.max(1, Math.min(200, filters?.limit ?? 50));
    params.push(cap);

    const { rows } = await this.db.query<Record<string, unknown>>(
      `select l.*, s.email::text as user_email
       from public.mcp_execution_logs l
       left join public.sales s on s.id = l.sales_id
       where ${where.join(" and ")}
       order by l.occurred_at desc, l.id desc
       limit $${params.length}`,
      params,
    );
    return { logs: rows };
  }

  async recordSecurityEvent(entry: SecurityEventEntry): Promise<void> {
    const sanitizedMeta = redactSecrets(entry.metadata ?? {}) as Record<
      string,
      unknown
    >;
    await this.db.query(
      `insert into public.mcp_security_events (
         request_id, organization_id, user_id, sales_id, ai_client_id,
         event_type, severity, tool_name, error_code, summary, metadata
       ) values ($1, $2, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
      [
        entry.requestId,
        entry.organizationId,
        entry.userId ?? null,
        entry.salesId ?? null,
        entry.aiClientId ?? null,
        entry.eventType,
        entry.severity,
        entry.toolName ?? null,
        entry.errorCode ?? null,
        entry.summary,
        JSON.stringify(sanitizedMeta),
      ],
    );
  }

  async listSecurityEvents(
    principal: AuthPrincipal,
    filters?: { severity?: string; eventType?: string; limit?: number },
  ) {
    requireMcpAdmin(principal, "read");
    const orgId = principal.organizationId ?? 1;
    const params: unknown[] = [orgId];
    const where: string[] = ["e.organization_id = $1"];
    if (filters?.severity) {
      params.push(filters.severity);
      where.push(`e.severity = $${params.length}`);
    }
    if (filters?.eventType) {
      params.push(filters.eventType);
      where.push(`e.event_type = $${params.length}`);
    }
    const cap = Math.max(1, Math.min(200, filters?.limit ?? 50));
    params.push(cap);

    const { rows } = await this.db.query<Record<string, unknown>>(
      `select e.*, s.email::text as user_email
       from public.mcp_security_events e
       left join public.sales s on s.id = e.sales_id
       where ${where.join(" and ")}
       order by e.occurred_at desc, e.id desc
       limit $${params.length}`,
      params,
    );
    return { events: rows };
  }
}
