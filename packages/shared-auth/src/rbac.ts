export const ENTERPRISE_ROLES = [
  "super_admin",
  "system_admin",
  "release_manager",
  "data_admin",
  "management",
  "executive_viewer",
  "sales_manager",
  "sales_rep",
  "marketing",
  "engineering",
  "quality",
  "finance",
  "read_only",
] as const;

export type SystemRoleKey = (typeof ENTERPRISE_ROLES)[number];

export type PermissionAction =
  "read" | "create" | "update" | "delete" | "approve" | "export" | "import";

export type DataScopeType = "own" | "team" | "territory" | "all";
export type FieldAccessLevel = "hidden" | "masked" | "read" | "write";

export interface PermissionGrant {
  resource: string;
  action: PermissionAction;
  scope: DataScopeType;
}

export interface FieldPermissionRule {
  resource: string;
  fieldName: string;
  accessLevel: FieldAccessLevel;
}

export type AuthChannel =
  "web" | "rest_api" | "mcp" | "integration_api" | "worker";

export interface AuthPrincipal {
  userId: string;
  salesId: number | null;
  email: string;
  roleKey: string | null;
  administrator: boolean;
  disabled: boolean;
  organizationId?: number;
  channel?: AuthChannel;
  oauthScopes?: string[];
  aiClientId?: string;
  connectionUuid?: string;
  serviceAccountId?: number | null;
  policyVersion?: number;
  mfaVerified?: boolean;
  teamIds?: number[];
  territoryIds?: number[];
  permissions: PermissionGrant[];
  fieldPermissions?: FieldPermissionRule[];
}

export interface AccessContext {
  resource: string;
  action: PermissionAction;
  ownerSalesId?: number | null;
  ownerTeamIds?: number[];
  recordTerritoryId?: number | null;
  recordOrganizationId?: number | null;
}

export const ADMIN_CONTROL_RESOURCES = new Set([
  "admin_console",
  "users",
  "roles",
  "data_management",
  "api_management",
  "ui_config",
  "feature_flags",
  "releases",
  "deployments",
  "jobs",
  "backups",
  "system_settings",
  "audit_log",
  "erp_integration",
  "mcp_admin",
  "mcp_approvals",
]);

/** Deny-by-default server-side RBAC + organization + data scope evaluation. */
export function evaluateAccess(
  principal: AuthPrincipal | null | undefined,
  ctx: AccessContext,
): boolean {
  if (!principal || principal.disabled) return false;
  if (
    ctx.recordOrganizationId !== undefined &&
    ctx.recordOrganizationId !== null &&
    principal.organizationId !== undefined &&
    ctx.recordOrganizationId !== principal.organizationId
  ) {
    return false;
  }
  if (principal.administrator || principal.roleKey === "super_admin") {
    return true;
  }

  const matching = principal.permissions.filter(
    (g) => g.resource === ctx.resource && g.action === ctx.action,
  );
  if (matching.length === 0) return false;

  for (const grant of matching) {
    if (grant.scope === "all") return true;
    if (grant.scope === "own") {
      if (ctx.ownerSalesId === undefined) return true;
      if (
        ctx.ownerSalesId !== null &&
        principal.salesId !== null &&
        ctx.ownerSalesId === principal.salesId
      ) {
        return true;
      }
    }
    if (grant.scope === "team") {
      const userTeams = new Set(principal.teamIds ?? []);
      if (ctx.ownerSalesId !== null && ctx.ownerSalesId === principal.salesId) {
        return true;
      }
      if (ctx.ownerTeamIds?.some((tid) => userTeams.has(tid))) {
        return true;
      }
    }
    if (grant.scope === "territory") {
      const userTerritories = new Set(principal.territoryIds ?? []);
      if (
        ctx.recordTerritoryId !== null &&
        ctx.recordTerritoryId !== undefined &&
        userTerritories.has(ctx.recordTerritoryId)
      ) {
        return true;
      }
    }
  }

  return false;
}

/** True iff an active principal holds at least one Admin Control Center capability. */
export function hasAdminConsoleAccess(
  principal: AuthPrincipal | null | undefined,
): boolean {
  if (!principal || principal.disabled) return false;
  if (principal.administrator || principal.roleKey === "super_admin") {
    return true;
  }
  return principal.permissions.some((p) =>
    ADMIN_CONTROL_RESOURCES.has(p.resource),
  );
}

/** PDPA-aware masking for personal and commercial identifiers. */
export function maskSensitiveValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  const text = String(value);
  if (text.includes("@")) {
    const [local, domain] = text.split("@");
    const visible = local.slice(0, 1);
    return `${visible}***@${domain ?? "***"}`;
  }
  if (text.length <= 4) return "****";
  return `${"*".repeat(Math.max(4, text.length - 4))}${text.slice(-4)}`;
}

/** Applies field-level hidden/masked policies to an outbound record. */
export function applyFieldPermissions<T extends Record<string, unknown>>(
  record: T,
  resource: string,
  principal: AuthPrincipal,
): Record<string, unknown> {
  if (principal.administrator || principal.roleKey === "super_admin") {
    return { ...record };
  }
  const rules = (principal.fieldPermissions ?? []).filter(
    (r) => r.resource === resource,
  );
  if (rules.length === 0) return { ...record };

  const ruleMap = new Map(rules.map((r) => [r.fieldName, r.accessLevel]));
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    const level = ruleMap.get(key);
    if (level === "hidden") continue;
    if (level === "masked") {
      output[key] = maskSensitiveValue(value);
      continue;
    }
    output[key] = value;
  }

  return output;
}
