export interface AdminApiConfig {
  apiBaseUrl: string;
  mcpEndpointUrl: string;
  accessToken: string;
}

export interface McpOverviewData {
  serverStatus: "active" | "disabled";
  mcpEnabled: boolean;
  policyVersion: number;
  protocolVersion: string;
  registeredTools: number;
  enabledTools: number;
  activeConnections: number;
  connectedUsers: number;
  authorizedClients: number;
  totalClients: number;
  pendingApprovals: number;
  requestVolume: number;
  successRatePercent: number | null;
  permissionDenialRatePercent: number | null;
  errorRatePercent: number | null;
  avgLatencyMs: number;
  securityEventsTotal: number;
  securityHighSeverity: number;
}

export interface McpToolRow {
  tool_id: string;
  tool_name: string;
  display_name: string;
  description: string;
  domain: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  required_permissions: Array<{ resource: string; action: string }>;
  required_oauth_scopes: string[];
  risk_level: string;
  execution_policy: string;
  rate_limit_per_min: number;
  tool_version: string;
  is_enabled: boolean;
  call_count: number;
  denial_count: number;
}

export interface RolePreviewRow {
  toolName: string;
  domain: string;
  riskLevel: string;
  allowed: boolean;
  reason: string | null;
  effectiveDataScope: string | null;
  effectiveExecutionPolicy: string | null;
  effectiveRateLimitPerMin: number | null;
}

export interface UserMcpRow {
  sales_id: number;
  email: string;
  first_name: string;
  last_name: string;
  role_key: string | null;
  disabled: boolean;
  mcp_enabled: boolean;
  denied_tools: string[];
  active_connections: number;
  last_mcp_activity: string | null;
}

export interface McpClientRow {
  id: number;
  client_id: string;
  name: string;
  description: string | null;
  client_type: string;
  status: "active" | "suspended" | "revoked";
  allowed_scopes: string[];
  redirect_uris: string[];
  pkce_required: boolean;
  is_verified_client: boolean;
  rate_limit_per_min: number;
  created_at: string;
}

export interface ApprovalRow {
  id: number;
  requestUuid: string;
  requestingSalesId: number;
  aiClientId: string | null;
  toolName: string;
  operationSummary: string;
  riskLevel: "L3" | "L4" | "L5";
  targetResource: string;
  targetRecordId: string | null;
  previewBefore: Record<string, unknown> | null;
  previewAfter: Record<string, unknown> | null;
  status: string;
  expiresAt: string;
  createdAt: string;
}

export interface ExecutionLogRow {
  id: number;
  request_id: string;
  user_email: string | null;
  ai_client_id: string | null;
  tool_name: string;
  action: string;
  resource: string;
  risk_level: string;
  authorization_result: string;
  execution_result: string;
  duration_ms: number;
  error_code: string | null;
  occurred_at: string;
}

export interface SecurityEventRow {
  id: number;
  request_id: string;
  user_email: string | null;
  ai_client_id: string | null;
  event_type: string;
  severity: "low" | "medium" | "high" | "critical";
  tool_name: string | null;
  error_code: string | null;
  summary: string;
  occurred_at: string;
}

export async function adminApiFetch<T>(
  cfg: AdminApiConfig,
  path: string,
  init?: RequestInit & { auditReason?: string },
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  if (!cfg.apiBaseUrl.trim()) {
    return {
      ok: false,
      error: "Configure API Base URL to load live Admin API telemetry.",
    };
  }
  const url = `${cfg.apiBaseUrl.replace(/\/$/, "")}${path}`;
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (cfg.accessToken.trim()) {
    headers.set("Authorization", `Bearer ${cfg.accessToken.trim()}`);
  }
  if (init?.auditReason) {
    headers.set("X-Audit-Reason", init.auditReason);
  }

  try {
    const res = await fetch(url, { ...init, headers });
    const json = (await res.json().catch(() => ({}))) as {
      data?: T;
      error?: { code?: string; message?: string };
    };
    if (!res.ok) {
      return {
        ok: false,
        error: json.error
          ? `${json.error.code ?? res.status}: ${json.error.message ?? res.statusText}`
          : `HTTP ${res.status} ${res.statusText}`,
      };
    }
    return { ok: true, data: json.data as T };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Network request failed",
    };
  }
}
