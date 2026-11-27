import {
  AuthorizationPolicyCache,
  PlatformError,
  type AuthChannel,
  type AuthPrincipal,
  type DataScopeType,
  type ExecutionPolicy,
  type FieldAccessLevel,
  type FieldPermissionRule,
  type McpClientPolicy,
  type McpPolicyBundle,
  type McpRolePolicy,
  type McpToolPermissionOverride,
  type McpUserPolicy,
  type OrganizationPolicy,
  type PermissionAction,
  type PermissionGrant,
  type RiskLevel,
} from "../../shared-auth/src/index";
import { sha256Hex, type SqlExecutor } from "./sqlExecutor";

export interface ResolvedPolicyContext {
  principal: AuthPrincipal;
  bundle: McpPolicyBundle;
}

interface SalesRow {
  id: number;
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  role_key: string | null;
  administrator: boolean;
  disabled: boolean;
  organization_id: number;
  primary_territory_id: number | null;
}

interface OrgRow {
  id: number;
  code: string;
  name: string;
  is_active: boolean;
  mcp_enabled: boolean;
  policy_version: number;
}

/**
 * Authoritative live identity & policy resolver backed by PostgreSQL.
 *
 * Always checks current DB policy_version so role/permission/tool changes
 * take effect immediately without rebuilding, redeploying, or trusting stale JWT claims.
 */
export class PrincipalResolver {
  private readonly cache = new AuthorizationPolicyCache<{
    principal: AuthPrincipal;
    organization: OrganizationPolicy;
    rolePolicy: McpRolePolicy | null;
    userPolicy: McpUserPolicy | null;
    toolOverrides: McpToolPermissionOverride[];
  }>(30_000);

  constructor(private readonly db: SqlExecutor) {}

  invalidateOrganization(orgId: number): void {
    this.cache.invalidateOrganization(orgId);
  }

  invalidateUser(orgId: number, userId: string): void {
    this.cache.invalidateUser(orgId, userId);
  }

  clearCache(): void {
    this.cache.clear();
  }

  async resolveByUserId(
    userId: string,
    options?: {
      channel?: AuthChannel;
      oauthScopes?: string[];
      aiClientId?: string;
      connectionUuid?: string;
      bypassCache?: boolean;
    },
  ): Promise<ResolvedPolicyContext | null> {
    const saleRes = await this.db.query<SalesRow>(
      `select id, user_id::text as user_id, email::text as email, first_name, last_name,
              role_key, administrator, disabled, organization_id, primary_territory_id
       from public.sales
       where user_id = $1::uuid`,
      [userId],
    );
    const sale = saleRes.rows[0];
    if (!sale) return null;

    const orgId = Number(sale.organization_id);
    const orgRes = await this.db.query<OrgRow>(
      `select id, code, name, is_active, mcp_enabled, policy_version
       from public.organizations
       where id = $1`,
      [orgId],
    );
    const orgRow = orgRes.rows[0];
    if (!orgRow) return null;

    const organization: OrganizationPolicy = {
      id: Number(orgRow.id),
      code: orgRow.code,
      name: orgRow.name,
      isActive: Boolean(orgRow.is_active),
      mcpEnabled: Boolean(orgRow.mcp_enabled),
      policyVersion: Number(orgRow.policy_version),
    };

    const cached =
      !options?.bypassCache && !sale.disabled
        ? this.cache.get(orgId, userId, organization.policyVersion)
        : null;

    let basePrincipal: AuthPrincipal;
    let rolePolicy: McpRolePolicy | null;
    let userPolicy: McpUserPolicy | null;
    let toolOverrides: McpToolPermissionOverride[];

    if (
      cached &&
      cached.principal.roleKey === sale.role_key &&
      cached.principal.administrator === Boolean(sale.administrator) &&
      cached.principal.disabled === Boolean(sale.disabled)
    ) {
      basePrincipal = cached.principal;
      rolePolicy = cached.rolePolicy;
      userPolicy = cached.userPolicy;
      toolOverrides = cached.toolOverrides;
    } else {
      const [
        permsRes,
        fieldPermsRes,
        teamsRes,
        rolePolicyRes,
        userPolicyRes,
        overridesRes,
      ] = await Promise.all([
        sale.role_key
          ? this.db.query<{
              resource: string;
              action: PermissionAction;
              scope: DataScopeType;
            }>(
              `select resource, action, scope
               from public.role_permissions
               where role_key = $1`,
              [sale.role_key],
            )
          : Promise.resolve({ rows: [] }),
        sale.role_key
          ? this.db.query<{
              resource: string;
              field_name: string;
              access_level: FieldAccessLevel;
            }>(
              `select resource, field_name, access_level
               from public.role_field_permissions
               where role_key = $1`,
              [sale.role_key],
            )
          : Promise.resolve({ rows: [] }),
        this.db.query<{ team_id: number }>(
          `select team_id from public.team_members where sales_id = $1`,
          [sale.id],
        ),
        sale.role_key
          ? this.db.query<{
              organization_id: number;
              role_key: string;
              mcp_enabled: boolean;
              max_risk_level: RiskLevel;
              allowed_oauth_scopes: string[];
              default_data_scope: DataScopeType | "inherit";
              rate_limit_per_min: number;
              require_approval_from_level: Exclude<RiskLevel, "L0">;
              allowed_client_ids: string[];
            }>(
              `select organization_id, role_key, mcp_enabled, max_risk_level,
                      allowed_oauth_scopes, default_data_scope, rate_limit_per_min,
                      require_approval_from_level, allowed_client_ids
               from public.mcp_role_policies
               where organization_id = $1 and role_key = $2`,
              [orgId, sale.role_key],
            )
          : Promise.resolve({ rows: [] }),
        this.db.query<{
          sales_id: number;
          mcp_enabled: boolean;
          denied_tools: string[];
          allowed_client_ids: string[];
          rate_limit_override: number | null;
          revoked_before: string | null;
        }>(
          `select sales_id, mcp_enabled, denied_tools, allowed_client_ids,
                  rate_limit_override, revoked_before
           from public.mcp_user_policies
           where organization_id = $1 and sales_id = $2`,
          [orgId, sale.id],
        ),
        sale.role_key
          ? this.db.query<{
              role_key: string;
              tool_name: string;
              effect: "allow" | "deny";
              data_scope: DataScopeType | "inherit";
              field_restrictions: Record<string, FieldAccessLevel>;
              execution_policy_override: ExecutionPolicy | null;
              rate_limit_override: number | null;
              require_approval_override: boolean | null;
            }>(
              `select role_key, tool_name, effect, data_scope, field_restrictions,
                      execution_policy_override, rate_limit_override, require_approval_override
               from public.mcp_tool_permissions
               where organization_id = $1 and role_key = $2`,
              [orgId, sale.role_key],
            )
          : Promise.resolve({ rows: [] }),
      ]);

      const permissions: PermissionGrant[] = permsRes.rows.map((r) => ({
        resource: r.resource,
        action: r.action,
        scope: r.scope,
      }));
      const fieldPermissions: FieldPermissionRule[] = fieldPermsRes.rows.map(
        (r) => ({
          resource: r.resource,
          fieldName: r.field_name,
          accessLevel: r.access_level,
        }),
      );
      const teamIds = teamsRes.rows.map((r) => Number(r.team_id));
      const territoryIds =
        sale.primary_territory_id !== null
          ? [Number(sale.primary_territory_id)]
          : [];

      basePrincipal = {
        userId: sale.user_id,
        salesId: Number(sale.id),
        email: sale.email,
        roleKey: sale.role_key,
        administrator: Boolean(sale.administrator),
        disabled: Boolean(sale.disabled),
        organizationId: orgId,
        policyVersion: organization.policyVersion,
        teamIds,
        territoryIds,
        permissions,
        fieldPermissions,
      };

      const rp = rolePolicyRes.rows[0];
      rolePolicy = rp
        ? {
            organizationId: Number(rp.organization_id),
            roleKey: rp.role_key,
            mcpEnabled: Boolean(rp.mcp_enabled),
            maxRiskLevel: rp.max_risk_level,
            allowedOAuthScopes: rp.allowed_oauth_scopes ?? [],
            defaultDataScope: rp.default_data_scope,
            rateLimitPerMin: Number(rp.rate_limit_per_min),
            requireApprovalFromLevel: rp.require_approval_from_level,
            allowedClientIds: rp.allowed_client_ids ?? [],
          }
        : null;

      const up = userPolicyRes.rows[0];
      userPolicy = up
        ? {
            salesId: Number(up.sales_id),
            mcpEnabled: Boolean(up.mcp_enabled),
            deniedTools: up.denied_tools ?? [],
            allowedClientIds: up.allowed_client_ids ?? [],
            rateLimitOverride:
              up.rate_limit_override !== null
                ? Number(up.rate_limit_override)
                : null,
            revokedBefore: up.revoked_before,
          }
        : null;

      toolOverrides = overridesRes.rows.map((o) => ({
        roleKey: o.role_key,
        toolName: o.tool_name,
        effect: o.effect,
        dataScope: o.data_scope,
        fieldRestrictions: o.field_restrictions ?? {},
        executionPolicyOverride: o.execution_policy_override,
        rateLimitOverride:
          o.rate_limit_override !== null ? Number(o.rate_limit_override) : null,
        requireApprovalOverride: o.require_approval_override,
      }));

      if (!sale.disabled) {
        this.cache.set(orgId, userId, organization.policyVersion, {
          principal: basePrincipal,
          organization,
          rolePolicy,
          userPolicy,
          toolOverrides,
        });
      }
    }

    let client: McpClientPolicy | null = null;
    if (options?.aiClientId) {
      const clientRes = await this.db.query<{
        client_id: string;
        name: string;
        status: "active" | "suspended" | "revoked";
        allowed_scopes: string[];
        pkce_required: boolean;
        is_verified_client: boolean;
        rate_limit_per_min: number;
      }>(
        `select client_id, name, status, allowed_scopes, pkce_required,
                is_verified_client, rate_limit_per_min
         from public.mcp_clients
         where client_id = $1 and organization_id = $2`,
        [options.aiClientId, orgId],
      );
      const c = clientRes.rows[0];
      if (!c) {
        throw new PlatformError(
          "AUTHENTICATION_REQUIRED",
          "AI client is not registered for this organization",
        );
      }
      client = {
        clientId: c.client_id,
        name: c.name,
        status: c.status,
        allowedScopes: c.allowed_scopes ?? [],
        pkceRequired: Boolean(c.pkce_required),
        isVerifiedClient: Boolean(c.is_verified_client),
        rateLimitPerMin: Number(c.rate_limit_per_min),
      };
    }

    const principal: AuthPrincipal = {
      ...basePrincipal,
      channel: options?.channel ?? "rest_api",
      oauthScopes: options?.oauthScopes,
      aiClientId: options?.aiClientId,
      connectionUuid: options?.connectionUuid,
    };

    return {
      principal,
      bundle: {
        organization,
        rolePolicy,
        userPolicy,
        toolOverrides,
        client,
      },
    };
  }

  /**
   * Resolves a Service Account or User API key (SHA-256 hash lookup only;
   * plaintext keys are never persisted or logged).
   */
  async resolveByApiKey(rawKey: string): Promise<AuthPrincipal | null> {
    if (!rawKey || rawKey.length < 16) return null;
    const keyHash = await sha256Hex(rawKey);
    const keyRes = await this.db.query<{
      id: number;
      owner_sales_id: number | null;
      service_account_id: number | null;
      scopes: string[];
      expires_at: string | null;
      revoked_at: string | null;
    }>(
      `select id, owner_sales_id, service_account_id, scopes, expires_at, revoked_at
       from public.api_keys
       where key_hash = $1`,
      [keyHash],
    );
    const key = keyRes.rows[0];
    if (!key || key.revoked_at) return null;
    if (key.expires_at && Date.parse(key.expires_at) <= Date.now()) {
      throw new PlatformError("TOKEN_EXPIRED", "API key has expired");
    }

    await this.db.query(
      "update public.api_keys set last_used_at = now() where id = $1",
      [key.id],
    );

    if (key.owner_sales_id) {
      const userRes = await this.db.query<{ user_id: string }>(
        "select user_id::text as user_id from public.sales where id = $1",
        [key.owner_sales_id],
      );
      if (!userRes.rows[0]) return null;
      const resolved = await this.resolveByUserId(userRes.rows[0].user_id, {
        channel: "integration_api",
        oauthScopes: key.scopes ?? [],
      });
      return resolved?.principal ?? null;
    }

    if (key.service_account_id) {
      const saRes = await this.db.query<{
        id: number;
        code: string;
        name: string;
        role_key: string;
        is_active: boolean;
        deleted_at: string | null;
      }>(
        `select id, code, name, role_key, is_active, deleted_at
         from public.service_accounts
         where id = $1`,
        [key.service_account_id],
      );
      const sa = saRes.rows[0];
      if (!sa || !sa.is_active || sa.deleted_at) {
        throw new PlatformError(
          "ACCOUNT_SUSPENDED",
          "Service account is inactive",
        );
      }

      const permsRes = await this.db.query<{
        resource: string;
        action: PermissionAction;
        scope: DataScopeType;
      }>(
        `select resource, action, scope from public.role_permissions where role_key = $1`,
        [sa.role_key],
      );

      return {
        userId: `00000000-0000-4000-8000-${String(sa.id).padStart(12, "0")}`,
        salesId: null,
        serviceAccountId: Number(sa.id),
        email: `${sa.code}@service.ddc.internal`,
        roleKey: sa.role_key,
        administrator: false,
        disabled: false,
        organizationId: 1,
        channel: "integration_api",
        oauthScopes: key.scopes ?? [],
        permissions: permsRes.rows,
      };
    }

    return null;
  }

  /**
   * Validates that an OAuth grant (by jti hash) and optional MCP connection
   * are active, non-expired, and not revoked.
   */
  async verifyGrantAndConnection(params: {
    userId: string;
    tokenJti?: string;
    connectionUuid?: string;
    issuedAtSec?: number;
  }): Promise<{ grantId?: number; revokedReason?: string }> {
    if (params.tokenJti) {
      const jtiHash = await sha256Hex(params.tokenJti);
      const grantRes = await this.db.query<{
        id: number;
        revoked_at: string | null;
        expires_at: string;
      }>(
        `select id, revoked_at, expires_at
         from public.oauth_grants
         where token_jti_hash = $1 and user_id = $2::uuid`,
        [jtiHash, params.userId],
      );
      const grant = grantRes.rows[0];
      if (grant) {
        if (grant.revoked_at) {
          throw new PlatformError(
            "AUTHENTICATION_REQUIRED",
            "OAuth grant has been revoked",
          );
        }
        if (Date.parse(grant.expires_at) <= Date.now()) {
          throw new PlatformError("TOKEN_EXPIRED", "OAuth grant has expired");
        }
      }
    }

    if (params.connectionUuid) {
      const connRes = await this.db.query<{
        id: number;
        status: string;
        revoked_at: string | null;
      }>(
        `select id, status, revoked_at
         from public.mcp_connections
         where connection_uuid = $1::uuid and user_id = $2::uuid`,
        [params.connectionUuid, params.userId],
      );
      const conn = connRes.rows[0];
      if (conn && (conn.status !== "active" || conn.revoked_at)) {
        throw new PlatformError(
          "MCP_ACCESS_DISABLED",
          "This MCP connection has been revoked",
        );
      }
      if (conn) {
        await this.db.query(
          "update public.mcp_connections set last_activity_at = now() where id = $1",
          [conn.id],
        );
      }
    }

    return {};
  }
}
