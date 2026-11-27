import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  KeyRound,
  Plug,
  RefreshCw,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  UserCheck,
  XCircle,
} from "lucide-react";
import { ENTERPRISE_ROLES } from "../../../packages/shared-auth/src/index";
import {
  formatBangkokDateTime,
  type StatusTone,
} from "../../../packages/shared-ui/src/index";
import {
  getToolRegistryMetadataList,
  MCP_SUPPORTED_OAUTH_SCOPES,
} from "../../mcp/src/toolRegistry";
import {
  adminApiFetch,
  type AdminApiConfig,
  type ApprovalRow,
  type ExecutionLogRow,
  type McpClientRow,
  type McpOverviewData,
  type McpToolRow,
  type RolePreviewRow,
  type SecurityEventRow,
  type UserMcpRow,
} from "./mcpApiClient";

const TONE_BADGE: Record<StatusTone, string> = {
  success: "bg-emerald-50 text-emerald-800 border-emerald-200",
  warning: "bg-amber-50 text-amber-800 border-amber-200",
  danger: "bg-red-50 text-red-800 border-red-200",
  info: "bg-sky-50 text-sky-800 border-sky-200",
  neutral: "bg-slate-100 text-slate-700 border-slate-200",
};

const RISK_TONE: Record<string, StatusTone> = {
  L0: "success",
  L1: "info",
  L2: "info",
  L3: "warning",
  L4: "danger",
  L5: "danger",
};

export interface McpManagementSectionProps {
  activeModuleId: string;
  apiConfig: AdminApiConfig;
  onApiConfigChange: (next: AdminApiConfig) => void;
}

export function McpManagementSection({
  activeModuleId,
  apiConfig,
  onApiConfigChange,
}: McpManagementSectionProps) {
  const staticCatalog = useMemo(() => getToolRegistryMetadataList(), []);

  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  const [overview, setOverview] = useState<McpOverviewData | null>(null);
  const [tools, setTools] = useState<McpToolRow[]>([]);
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [toolSearch, setToolSearch] = useState<string>("");
  const [selectedSchemaTool, setSelectedSchemaTool] =
    useState<McpToolRow | null>(null);

  const [selectedRole, setSelectedRole] = useState<string>("sales_rep");
  const [rolePreview, setRolePreview] = useState<RolePreviewRow[]>([]);

  const [users, setUsers] = useState<UserMcpRow[]>([]);
  const [clients, setClients] = useState<McpClientRow[]>([]);
  const [newClientId, setNewClientId] = useState("");
  const [newClientName, setNewClientName] = useState("");
  const [newClientRedirect, setNewClientRedirect] = useState(
    "https://claude.ai/api/mcp/auth_callback",
  );
  const [newClientScopes, setNewClientScopes] = useState<string[]>([
    "mcp:read",
  ]);

  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [rejectComments, setRejectComments] = useState<Record<number, string>>(
    {},
  );
  const [logs, setLogs] = useState<ExecutionLogRow[]>([]);
  const [logToolFilter, setLogToolFilter] = useState("");
  const [securityEvents, setSecurityEvents] = useState<SecurityEventRow[]>([]);
  const [healthProbe, setHealthProbe] = useState<string | null>(null);

  const loadActiveData = useCallback(async () => {
    setApiError(null);
    if (!apiConfig.apiBaseUrl.trim()) {
      return;
    }
    setLoading(true);
    try {
      if (activeModuleId === "mcp-overview") {
        const res = await adminApiFetch<McpOverviewData>(
          apiConfig,
          "/admin/v1/mcp/overview",
        );
        if (res.ok) setOverview(res.data);
        else setApiError(res.error);
      } else if (activeModuleId === "mcp-tools") {
        const res = await adminApiFetch<{ tools: McpToolRow[] }>(
          apiConfig,
          "/admin/v1/mcp/tools",
        );
        if (res.ok) setTools(res.data.tools);
        else setApiError(res.error);
      } else if (activeModuleId === "mcp-role-matrix") {
        const res = await adminApiFetch<{ effectiveTools: RolePreviewRow[] }>(
          apiConfig,
          `/admin/v1/mcp/roles/${encodeURIComponent(selectedRole)}/preview`,
        );
        if (res.ok) setRolePreview(res.data.effectiveTools);
        else setApiError(res.error);
      } else if (activeModuleId === "mcp-users") {
        const res = await adminApiFetch<{ users: UserMcpRow[] }>(
          apiConfig,
          "/admin/v1/mcp/users",
        );
        if (res.ok) setUsers(res.data.users);
        else setApiError(res.error);
      } else if (activeModuleId === "mcp-clients") {
        const res = await adminApiFetch<{ clients: McpClientRow[] }>(
          apiConfig,
          "/admin/v1/mcp/clients",
        );
        if (res.ok) setClients(res.data.clients);
        else setApiError(res.error);
      } else if (activeModuleId === "mcp-approvals") {
        const res = await adminApiFetch<{ approvals: ApprovalRow[] }>(
          apiConfig,
          "/admin/v1/mcp/approvals",
        );
        if (res.ok) setApprovals(res.data.approvals);
        else setApiError(res.error);
      } else if (activeModuleId === "mcp-logs") {
        const qs = logToolFilter.trim()
          ? `?tool=${encodeURIComponent(logToolFilter.trim())}`
          : "";
        const res = await adminApiFetch<{ logs: ExecutionLogRow[] }>(
          apiConfig,
          `/admin/v1/mcp/logs${qs}`,
        );
        if (res.ok) setLogs(res.data.logs);
        else setApiError(res.error);
      } else if (activeModuleId === "mcp-security") {
        const res = await adminApiFetch<{ events: SecurityEventRow[] }>(
          apiConfig,
          "/admin/v1/mcp/security-events",
        );
        if (res.ok) setSecurityEvents(res.data.events);
        else setApiError(res.error);
      }
    } finally {
      setLoading(false);
    }
  }, [activeModuleId, apiConfig, logToolFilter, selectedRole]);

  useEffect(() => {
    void loadActiveData();
  }, [loadActiveData]);

  // Displayed tools: live server rows if connected, otherwise static server-allowlisted definitions (with 0 calls, never fabricated)
  const displayedTools: McpToolRow[] = useMemo(() => {
    const source: McpToolRow[] =
      tools.length > 0
        ? tools
        : staticCatalog.map((t) => ({
            tool_id: t.toolId,
            tool_name: t.toolName,
            display_name: t.displayName,
            description: t.description,
            domain: t.domain,
            input_schema: t.inputSchema,
            output_schema: t.outputSchema,
            required_permissions: t.requiredPermissions,
            required_oauth_scopes: t.requiredOAuthScopes,
            risk_level: t.riskLevel,
            execution_policy: t.executionPolicy,
            rate_limit_per_min: t.rateLimitPerMin,
            tool_version: t.toolVersion,
            is_enabled: t.isEnabled,
            call_count: 0,
            denial_count: 0,
          }));
    return source.filter((t) => {
      if (domainFilter !== "all" && t.domain !== domainFilter) return false;
      if (
        toolSearch.trim() &&
        !`${t.tool_name} ${t.display_name} ${t.domain}`
          .toLowerCase()
          .includes(toolSearch.trim().toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [tools, staticCatalog, domainFilter, toolSearch]);

  const domains = useMemo(
    () => [...new Set(staticCatalog.map((t) => t.domain))].sort(),
    [staticCatalog],
  );

  const handleToggleOrgMcp = async (enabled: boolean) => {
    const res = await adminApiFetch(
      apiConfig,
      "/admin/v1/mcp/organization-policy",
      {
        method: "PUT",
        body: JSON.stringify({ mcpEnabled: enabled }),
        auditReason: enabled
          ? "Enable organization MCP access"
          : "Disable organization MCP access",
      },
    );
    if (res.ok) {
      setNotice(
        `Organization MCP access ${enabled ? "enabled" : "disabled"} and policy cache invalidated.`,
      );
      await loadActiveData();
    } else {
      setApiError(res.error);
    }
  };

  const handleToggleTool = async (toolName: string, nextEnabled: boolean) => {
    const res = await adminApiFetch(
      apiConfig,
      `/admin/v1/mcp/tools/${encodeURIComponent(toolName)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ isEnabled: nextEnabled }),
        auditReason: `${nextEnabled ? "Enable" : "Disable"} MCP tool ${toolName}`,
      },
    );
    if (res.ok) {
      setNotice(
        `Tool "${toolName}" ${nextEnabled ? "enabled" : "disabled"} dynamically (no redeployment required).`,
      );
      await loadActiveData();
    } else {
      setApiError(res.error);
    }
  };

  const handleRoleToolOverride = async (
    toolName: string,
    effect: "allow" | "deny",
  ) => {
    const res = await adminApiFetch(
      apiConfig,
      `/admin/v1/mcp/roles/${encodeURIComponent(selectedRole)}/tools/${encodeURIComponent(toolName)}`,
      {
        method: "PUT",
        body: JSON.stringify({ effect }),
        auditReason: `Set role ${selectedRole} override on ${toolName} to ${effect}`,
      },
    );
    if (res.ok) {
      setNotice(
        `Updated ${selectedRole} → ${toolName} (${effect.toUpperCase()}). Policy cache invalidated.`,
      );
      await loadActiveData();
    } else {
      setApiError(res.error);
    }
  };

  const handleRevokeUser = async (salesId: number, email: string) => {
    const res = await adminApiFetch(
      apiConfig,
      `/admin/v1/mcp/users/${salesId}/revoke`,
      {
        method: "POST",
        body: JSON.stringify({
          reason: `Admin revoked MCP access for ${email}`,
        }),
        auditReason: `Revoke MCP access for ${email}`,
      },
    );
    if (res.ok) {
      setNotice(`Revoked all active MCP connections and grants for ${email}.`);
      await loadActiveData();
    } else {
      setApiError(res.error);
    }
  };

  const handleRegisterClient = async () => {
    setApiError(null);
    const res = await adminApiFetch(apiConfig, "/admin/v1/mcp/clients", {
      method: "POST",
      body: JSON.stringify({
        clientId: newClientId.trim(),
        name: newClientName.trim(),
        allowedScopes: newClientScopes,
        redirectUris: [newClientRedirect.trim()],
        isVerifiedClient: false,
      }),
      auditReason: `Register OAuth MCP client ${newClientId.trim()}`,
    });
    if (res.ok) {
      setNotice(`Registered AI OAuth client "${newClientName.trim()}".`);
      setNewClientId("");
      setNewClientName("");
      await loadActiveData();
    } else {
      setApiError(res.error);
    }
  };

  const handleRevokeClient = async (clientId: string) => {
    const res = await adminApiFetch(
      apiConfig,
      `/admin/v1/mcp/clients/${encodeURIComponent(clientId)}/revoke`,
      {
        method: "POST",
        body: JSON.stringify({ reason: "Revoked via Admin Control Center" }),
        auditReason: `Revoke AI client ${clientId}`,
      },
    );
    if (res.ok) {
      setNotice(
        `Revoked AI client "${clientId}" and terminated active sessions.`,
      );
      await loadActiveData();
    } else {
      setApiError(res.error);
    }
  };

  const handleDecideApproval = async (
    id: number,
    action: "approve" | "reject",
  ) => {
    const comment =
      rejectComments[id]?.trim() ||
      (action === "approve" ? "Approved by administrator" : "");
    const res = await adminApiFetch(
      apiConfig,
      `/admin/v1/mcp/approvals/${id}/${action}`,
      {
        method: "POST",
        body: JSON.stringify({ comment }),
        auditReason: `${action} MCP approval #${id}`,
      },
    );
    if (res.ok) {
      setNotice(
        `Approval request #${id} ${action === "approve" ? "approved" : "rejected"}.`,
      );
      await loadActiveData();
    } else {
      setApiError(res.error);
    }
  };

  const handleProbeMcpHealth = async () => {
    setHealthProbe("Probing...");
    try {
      const base = apiConfig.mcpEndpointUrl.replace(/\/mcp\/?$/, "");
      const res = await fetch(`${base}/health`);
      const text = await res.text();
      setHealthProbe(`HTTP ${res.status}: ${text}`);
    } catch (err) {
      setHealthProbe(
        `Connection error: ${err instanceof Error ? err.message : "Failed to reach endpoint"}`,
      );
    }
  };

  return (
    <div className="space-y-5">
      {/* Live Admin API Connection Bar (no fabricated telemetry) */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid flex-1 gap-3 sm:grid-cols-3">
            <label className="block text-xs font-medium text-slate-700">
              Admin API Base URL
              <input
                type="url"
                value={apiConfig.apiBaseUrl}
                onChange={(e) =>
                  onApiConfigChange({
                    ...apiConfig,
                    apiBaseUrl: e.target.value,
                  })
                }
                placeholder="https://api.ddc.example.test"
                className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs focus:border-emerald-700 focus:outline-none"
              />
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Remote MCP Endpoint
              <input
                type="url"
                value={apiConfig.mcpEndpointUrl}
                onChange={(e) =>
                  onApiConfigChange({
                    ...apiConfig,
                    mcpEndpointUrl: e.target.value,
                  })
                }
                placeholder="https://mcp.ddc.example.test/mcp"
                className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs focus:border-emerald-700 focus:outline-none"
              />
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Admin Bearer Token (session-only, never persisted)
              <input
                type="password"
                value={apiConfig.accessToken}
                onChange={(e) =>
                  onApiConfigChange({
                    ...apiConfig,
                    accessToken: e.target.value,
                  })
                }
                placeholder="Paste verified OAuth/JWT token"
                className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs focus:border-emerald-700 focus:outline-none"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={() => void loadActiveData()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            <RefreshCw
              className={`size-3.5 ${loading ? "animate-spin" : ""}`}
            />
            Refresh Live Data
          </button>
        </div>
      </section>

      {notice && (
        <div
          role="status"
          className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900"
        >
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-xs font-semibold underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {apiError && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900"
        >
          <AlertTriangle className="size-4 shrink-0" />
          <span>{apiError}</span>
        </div>
      )}

      {/* 1. MCP Overview */}
      {activeModuleId === "mcp-overview" && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                label: "MCP Server Status",
                value: overview
                  ? overview.serverStatus.toUpperCase()
                  : "UNCONNECTED",
                hint: overview
                  ? `Protocol ${overview.protocolVersion} · Policy v${overview.policyVersion}`
                  : "Connect Admin API above for live status",
                tone: (overview?.mcpEnabled
                  ? "success"
                  : "neutral") as StatusTone,
              },
              {
                label: "Registered / Enabled Tools",
                value: overview
                  ? `${overview.enabledTools} / ${overview.registeredTools}`
                  : `${staticCatalog.length} allowlisted`,
                hint: "Server-side code allowlist only",
                tone: "info" as StatusTone,
              },
              {
                label: "Connected Users / Clients",
                value: overview
                  ? `${overview.connectedUsers} users · ${overview.authorizedClients} clients`
                  : "—",
                hint: overview
                  ? `${overview.activeConnections} active connections`
                  : "Live database count",
                tone: "info" as StatusTone,
              },
              {
                label: "Requests / Denial / Latency",
                value: overview
                  ? `${overview.requestVolume} req · ${overview.avgLatencyMs}ms`
                  : "—",
                hint: overview
                  ? `Success ${overview.successRatePercent ?? "—"}% · Denied ${overview.permissionDenialRatePercent ?? "—"}% · Error ${overview.errorRatePercent ?? "—"}%`
                  : "Zero fabricated metrics",
                tone: (overview && overview.securityHighSeverity > 0
                  ? "warning"
                  : "neutral") as StatusTone,
              },
            ].map((card) => (
              <div
                key={card.label}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs"
              >
                <p className="text-xs font-medium text-slate-500">
                  {card.label}
                </p>
                <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">
                  {card.value}
                </p>
                <span
                  className={`mt-2 inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium ${TONE_BADGE[card.tone]}`}
                >
                  {card.hint}
                </span>
              </div>
            ))}
          </div>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Global Organization MCP Access Control
                </h2>
                <p className="mt-0.5 text-xs text-slate-600">
                  Disabling MCP access immediately blocks all AI clients across
                  every role and increments organization policy version.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void handleToggleOrgMcp(true)}
                  className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-900 hover:bg-emerald-100"
                >
                  Enable Global MCP
                </button>
                <button
                  type="button"
                  onClick={() => void handleToggleOrgMcp(false)}
                  className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-900 hover:bg-red-100"
                >
                  Emergency Disable MCP
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* 2. Tool Registry */}
      {activeModuleId === "mcp-tools" && (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Filter by business domain"
                value={domainFilter}
                onChange={(e) => setDomainFilter(e.target.value)}
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
              >
                <option value="all">
                  All 13 Domains ({staticCatalog.length})
                </option>
                {domains.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <input
                type="search"
                value={toolSearch}
                onChange={(e) => setToolSearch(e.target.value)}
                placeholder="Search tool name..."
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
              />
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
              <Bot className="size-3.5 text-emerald-800" />
              Server Allowlist Only · Zero Arbitrary Code Registration
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-3 font-semibold">Tool</th>
                  <th className="py-2 pr-3 font-semibold">Domain</th>
                  <th className="py-2 pr-3 font-semibold">Permissions</th>
                  <th className="py-2 pr-3 font-semibold">Risk / Policy</th>
                  <th className="py-2 pr-3 font-semibold">Calls / Denials</th>
                  <th className="py-2 pr-3 font-semibold">Status</th>
                  <th className="py-2 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayedTools.map((t) => (
                  <tr key={t.tool_name} className="hover:bg-slate-50">
                    <td className="py-2.5 pr-3">
                      <p className="font-mono font-semibold text-slate-900">
                        {t.tool_name}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        v{t.tool_version} · {t.display_name}
                      </p>
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-[11px] text-slate-600">
                      {t.domain}
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-[11px] text-slate-700">
                      {t.required_permissions.length > 0
                        ? t.required_permissions
                            .map((p) => `${p.resource}:${p.action}`)
                            .join(", ")
                        : "authenticated"}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={`inline-block rounded border px-1.5 py-0.5 font-mono text-[11px] font-semibold ${TONE_BADGE[RISK_TONE[t.risk_level] ?? "neutral"]}`}
                      >
                        {t.risk_level} · {t.execution_policy}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 font-mono tabular-nums text-slate-700">
                      {t.call_count} / {t.denial_count}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TONE_BADGE[t.is_enabled ? "success" : "danger"]}`}
                      >
                        {t.is_enabled ? "Enabled" : "Disabled"}
                      </span>
                    </td>
                    <td className="py-2.5">
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSelectedSchemaTool(t)}
                          className="rounded border border-slate-300 px-2 py-1 text-[11px] font-medium hover:bg-slate-100"
                        >
                          Schema
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void handleToggleTool(t.tool_name, !t.is_enabled)
                          }
                          className="rounded border border-slate-300 px-2 py-1 text-[11px] font-medium hover:bg-slate-100"
                        >
                          {t.is_enabled ? "Disable" : "Enable"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selectedSchemaTool && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between">
                <h3 className="font-mono text-xs font-bold text-slate-900">
                  JSON Schema: {selectedSchemaTool.tool_name} (
                  {selectedSchemaTool.required_oauth_scopes.join(", ")})
                </h3>
                <button
                  type="button"
                  onClick={() => setSelectedSchemaTool(null)}
                  className="text-xs font-semibold text-slate-600 underline"
                >
                  Close
                </button>
              </div>
              <pre className="mt-2 max-h-64 overflow-auto rounded bg-slate-900 p-3 font-mono text-[11px] text-emerald-200">
                {JSON.stringify(
                  {
                    inputSchema: selectedSchemaTool.input_schema,
                    outputSchema: selectedSchemaTool.output_schema,
                  },
                  null,
                  2,
                )}
              </pre>
            </div>
          )}
        </section>
      )}

      {/* 3. Role Permission Matrix */}
      {activeModuleId === "mcp-role-matrix" && (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="size-4 text-emerald-800" />
              <label className="text-xs font-semibold text-slate-700">
                Role:
                <select
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value)}
                  className="ml-2 rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs"
                >
                  {ENTERPRISE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <span className="text-xs text-slate-500">
              Explicit DENY overrides all grants · MCP never elevates above CRM
              RBAC
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-3 font-semibold">MCP Tool</th>
                  <th className="py-2 pr-3 font-semibold">Domain</th>
                  <th className="py-2 pr-3 font-semibold">Risk</th>
                  <th className="py-2 pr-3 font-semibold">Effective Preview</th>
                  <th className="py-2 pr-3 font-semibold">Scope / Policy</th>
                  <th className="py-2 font-semibold">Role Override</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(rolePreview.length > 0
                  ? rolePreview
                  : staticCatalog.map((t) => ({
                      toolName: t.toolName,
                      domain: t.domain,
                      riskLevel: t.riskLevel,
                      allowed: false,
                      reason: "Connect Admin API to compute live preview",
                      effectiveDataScope: null,
                      effectiveExecutionPolicy: null,
                      effectiveRateLimitPerMin: null,
                    }))
                ).map((row) => (
                  <tr key={row.toolName}>
                    <td className="py-2 pr-3 font-mono font-medium text-slate-900">
                      {row.toolName}
                    </td>
                    <td className="py-2 pr-3 font-mono text-[11px] text-slate-500">
                      {row.domain}
                    </td>
                    <td className="py-2 pr-3 font-mono text-[11px]">
                      {row.riskLevel}
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TONE_BADGE[row.allowed ? "success" : "danger"]}`}
                      >
                        {row.allowed ? "Allowed" : "Denied"}
                      </span>
                      {row.reason && (
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          {row.reason}
                        </p>
                      )}
                    </td>
                    <td className="py-2 pr-3 font-mono text-[11px] text-slate-700">
                      {row.effectiveDataScope
                        ? `${row.effectiveDataScope} · ${row.effectiveExecutionPolicy}`
                        : "—"}
                    </td>
                    <td className="py-2">
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            void handleRoleToolOverride(row.toolName, "allow")
                          }
                          className="rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-900 hover:bg-emerald-100"
                        >
                          Allow
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void handleRoleToolOverride(row.toolName, "deny")
                          }
                          className="rounded border border-red-300 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-900 hover:bg-red-100"
                        >
                          Deny
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 4. User MCP Access */}
      {activeModuleId === "mcp-users" && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
          <div className="mb-3 flex items-center gap-2">
            <UserCheck className="size-4 text-emerald-800" />
            <h2 className="text-sm font-semibold text-slate-900">
              User MCP Access & Active Connections
            </h2>
          </div>
          {users.length === 0 ? (
            <p className="text-xs text-slate-500">
              No live user records loaded. Configure Admin API Base URL & token
              above.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 pr-3">User</th>
                    <th className="py-2 pr-3">Role</th>
                    <th className="py-2 pr-3">MCP Status</th>
                    <th className="py-2 pr-3">Active Conns</th>
                    <th className="py-2 pr-3">Last Activity (ICT)</th>
                    <th className="py-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((u) => (
                    <tr key={u.sales_id}>
                      <td className="py-2 pr-3">
                        <p className="font-medium text-slate-900">
                          {u.first_name} {u.last_name}
                        </p>
                        <p className="font-mono text-[11px] text-slate-500">
                          {u.email}
                        </p>
                      </td>
                      <td className="py-2 pr-3 font-mono text-[11px]">
                        {u.role_key ?? "none"}
                      </td>
                      <td className="py-2 pr-3">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TONE_BADGE[u.disabled || !u.mcp_enabled ? "danger" : "success"]}`}
                        >
                          {u.disabled
                            ? "Account Suspended"
                            : u.mcp_enabled
                              ? "Enabled"
                              : "MCP Disabled"}
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-mono">
                        {u.active_connections}
                      </td>
                      <td className="py-2 pr-3 font-mono text-[11px] text-slate-600">
                        {u.last_mcp_activity
                          ? formatBangkokDateTime(u.last_mcp_activity, "en")
                          : "—"}
                      </td>
                      <td className="py-2">
                        <button
                          type="button"
                          onClick={() =>
                            void handleRevokeUser(u.sales_id, u.email)
                          }
                          className="rounded border border-red-300 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-900 hover:bg-red-100"
                        >
                          Revoke Access
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* 5. AI Client Management */}
      {activeModuleId === "mcp-clients" && (
        <div className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
            <div className="mb-3 flex items-center gap-2">
              <KeyRound className="size-4 text-emerald-800" />
              <h2 className="text-sm font-semibold text-slate-900">
                Register OAuth 2.1 AI Client (PKCE S256 Required)
              </h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <input
                type="text"
                value={newClientId}
                onChange={(e) => setNewClientId(e.target.value)}
                placeholder="client_id (e.g. claude-desktop-ddc)"
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs"
              />
              <input
                type="text"
                value={newClientName}
                onChange={(e) => setNewClientName(e.target.value)}
                placeholder="Client Display Name"
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
              />
              <input
                type="url"
                value={newClientRedirect}
                onChange={(e) => setNewClientRedirect(e.target.value)}
                placeholder="HTTPS or loopback redirect URI"
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs"
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {MCP_SUPPORTED_OAUTH_SCOPES.map((sc) => {
                const checked = newClientScopes.includes(sc);
                return (
                  <label
                    key={sc}
                    className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px]"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setNewClientScopes(
                          e.target.checked
                            ? [...newClientScopes, sc]
                            : newClientScopes.filter((x) => x !== sc),
                        )
                      }
                    />
                    {sc}
                  </label>
                );
              })}
              <button
                type="button"
                disabled={!newClientId.trim() || !newClientName.trim()}
                onClick={() => void handleRegisterClient()}
                className="ml-auto rounded-lg bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-40"
              >
                Register Client
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
            <h3 className="text-sm font-semibold text-slate-900">
              Registered AI Clients ({clients.length})
            </h3>
            {clients.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">
                No registered clients loaded.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {clients.map((c) => (
                  <div
                    key={c.client_id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 text-xs"
                  >
                    <div>
                      <p className="font-semibold text-slate-900">
                        {c.name}{" "}
                        <span className="font-mono text-slate-500">
                          ({c.client_id})
                        </span>
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-600">
                        Scopes: {c.allowed_scopes.join(", ")} · Redirects:{" "}
                        {c.redirect_uris.join(", ")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TONE_BADGE[c.status === "active" ? "success" : "danger"]}`}
                      >
                        {c.status}
                      </span>
                      {c.status === "active" && (
                        <button
                          type="button"
                          onClick={() => void handleRevokeClient(c.client_id)}
                          className="rounded border border-red-300 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-900"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* 6. Approval Center */}
      {activeModuleId === "mcp-approvals" && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-emerald-800" />
              <h2 className="text-sm font-semibold text-slate-900">
                High-Risk AI Approval Queue (L3–L5)
              </h2>
            </div>
            <span className="text-[11px] text-slate-500">
              Anti-self-approval enforced in PostgreSQL & API · Bound by SHA-256
              payload hash
            </span>
          </div>
          {approvals.length === 0 ? (
            <p className="text-xs text-slate-500">
              No pending or recent AI approval requests loaded.
            </p>
          ) : (
            <div className="space-y-3">
              {approvals.map((a) => (
                <div
                  key={a.id}
                  className="rounded-lg border border-slate-200 p-4 text-xs"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <span
                        className={`mr-2 inline-block rounded border px-1.5 py-0.5 font-mono text-[11px] font-semibold ${TONE_BADGE[RISK_TONE[a.riskLevel] ?? "warning"]}`}
                      >
                        {a.riskLevel}
                      </span>
                      <span className="font-mono font-bold text-slate-900">
                        #{a.id} · {a.toolName}
                      </span>
                      <p className="mt-1 text-slate-700">
                        {a.operationSummary}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                        Requester Sales #{a.requestingSalesId} · Client:{" "}
                        {a.aiClientId ?? "n/a"} · Expires:{" "}
                        {formatBangkokDateTime(a.expiresAt, "en")}
                      </p>
                    </div>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase ${TONE_BADGE[a.status === "approved" || a.status === "executed" ? "success" : a.status === "pending" ? "warning" : "danger"]}`}
                    >
                      {a.status}
                    </span>
                  </div>

                  {(a.previewBefore || a.previewAfter) && (
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      <pre className="overflow-auto rounded bg-slate-50 p-2 font-mono text-[11px] text-slate-700">
                        Before: {JSON.stringify(a.previewBefore ?? {}, null, 2)}
                      </pre>
                      <pre className="overflow-auto rounded bg-emerald-50/60 p-2 font-mono text-[11px] text-emerald-950">
                        After: {JSON.stringify(a.previewAfter ?? {}, null, 2)}
                      </pre>
                    </div>
                  )}

                  {a.status === "pending" && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={rejectComments[a.id] ?? ""}
                        onChange={(e) =>
                          setRejectComments({
                            ...rejectComments,
                            [a.id]: e.target.value,
                          })
                        }
                        placeholder="Approval/rejection comment..."
                        className="flex-1 rounded border border-slate-300 px-2.5 py-1 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          void handleDecideApproval(a.id, "approve")
                        }
                        className="inline-flex items-center gap-1 rounded bg-emerald-900 px-3 py-1 font-semibold text-white hover:bg-emerald-800"
                      >
                        <CheckCircle2 className="size-3.5" />
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void handleDecideApproval(a.id, "reject")
                        }
                        className="inline-flex items-center gap-1 rounded border border-red-300 bg-red-50 px-3 py-1 font-semibold text-red-900 hover:bg-red-100"
                      >
                        <XCircle className="size-3.5" />
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 7. MCP Execution Logs */}
      {activeModuleId === "mcp-logs" && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ScrollText className="size-4 text-emerald-800" />
              <h2 className="text-sm font-semibold text-slate-900">
                MCP Execution Logs (Asia/Bangkok)
              </h2>
            </div>
            <input
              type="search"
              value={logToolFilter}
              onChange={(e) => setLogToolFilter(e.target.value)}
              placeholder="Filter by tool_name..."
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs"
            />
          </div>
          {logs.length === 0 ? (
            <p className="text-xs text-slate-500">No execution logs loaded.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 pr-3">Timestamp (ICT)</th>
                    <th className="py-2 pr-3">User / Client</th>
                    <th className="py-2 pr-3">Tool</th>
                    <th className="py-2 pr-3">Auth / Result</th>
                    <th className="py-2 pr-3">Duration</th>
                    <th className="py-2">Request ID / Error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                  {logs.map((l) => (
                    <tr key={l.id}>
                      <td className="py-2 pr-3 text-slate-600">
                        {formatBangkokDateTime(l.occurred_at, "en")}
                      </td>
                      <td className="py-2 pr-3">
                        {l.user_email ?? "unknown"} ·{" "}
                        {l.ai_client_id ?? "direct"}
                      </td>
                      <td className="py-2 pr-3 font-semibold text-slate-900">
                        {l.tool_name}
                      </td>
                      <td className="py-2 pr-3">
                        <span
                          className={`rounded border px-1.5 py-0.5 font-semibold ${TONE_BADGE[l.execution_result === "success" ? "success" : l.authorization_result === "denied" ? "danger" : "warning"]}`}
                        >
                          {l.authorization_result} / {l.execution_result}
                        </span>
                      </td>
                      <td className="py-2 pr-3">{l.duration_ms}ms</td>
                      <td className="py-2 text-slate-600">
                        {l.request_id}
                        {l.error_code ? ` · ${l.error_code}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* 8. Security Center */}
      {activeModuleId === "mcp-security" && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
          <div className="flex items-center gap-2">
            <ShieldAlert className="size-4 text-red-700" />
            <h2 className="text-sm font-semibold text-slate-900">
              AI & MCP Security Events Stream
            </h2>
          </div>
          {securityEvents.length === 0 ? (
            <p className="text-xs text-slate-500">
              No security denial or escalation events loaded.
            </p>
          ) : (
            <div className="space-y-2">
              {securityEvents.map((e) => (
                <div
                  key={e.id}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-slate-200 p-3 text-xs"
                >
                  <div>
                    <span
                      className={`mr-2 rounded border px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase ${TONE_BADGE[e.severity === "critical" || e.severity === "high" ? "danger" : "warning"]}`}
                    >
                      {e.severity}
                    </span>
                    <span className="font-mono font-semibold text-slate-900">
                      {e.event_type}
                    </span>
                    {e.tool_name && (
                      <span className="ml-1.5 font-mono text-slate-500">
                        ({e.tool_name})
                      </span>
                    )}
                    <p className="mt-1 text-slate-700">{e.summary}</p>
                  </div>
                  <div className="text-right font-mono text-[11px] text-slate-500">
                    <p>{formatBangkokDateTime(e.occurred_at, "en")}</p>
                    <p>{e.request_id}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 9. MCP Connection Setup */}
      {activeModuleId === "mcp-setup" && (
        <div className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Plug className="size-4 text-emerald-800" />
                <h2 className="text-sm font-semibold text-slate-900">
                  Remote MCP Endpoint & OAuth 2.1 Discovery
                </h2>
              </div>
              <button
                type="button"
                onClick={() => void handleProbeMcpHealth()}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Test Endpoint Health
              </button>
            </div>
            <div className="mt-3 space-y-2 font-mono text-xs text-slate-700">
              <p>
                <strong>Streamable HTTP Endpoint:</strong>{" "}
                {apiConfig.mcpEndpointUrl}
              </p>
              <p>
                <strong>RFC 9728 Protected Resource Metadata:</strong>{" "}
                {apiConfig.mcpEndpointUrl.replace(/\/mcp\/?$/, "")}
                /.well-known/oauth-protected-resource
              </p>
              <p>
                <strong>OAuth 2.1 Flow:</strong> Authorization Code + PKCE
                (S256) + RFC 8707 Resource Indicator
              </p>
              <p>
                <strong>Supported Scopes:</strong>{" "}
                {MCP_SUPPORTED_OAUTH_SCOPES.join(" ")}
              </p>
            </div>
            {healthProbe && (
              <pre className="mt-3 rounded bg-slate-900 p-3 font-mono text-[11px] text-emerald-200">
                {healthProbe}
              </pre>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
            <h3 className="text-sm font-semibold text-slate-900">
              AI Client Compatibility Matrix (Verified vs Unverified)
            </h3>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 pr-3">Client</th>
                    <th className="py-2 pr-3">Transport</th>
                    <th className="py-2 pr-3">Auth Flow</th>
                    <th className="py-2">Verification Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td className="py-2 pr-3 font-medium">
                      MCP SDK v2 Streamable HTTP Client (Automated Suite)
                    </td>
                    <td className="py-2 pr-3 font-mono">Streamable HTTP</td>
                    <td className="py-2 pr-3">OAuth 2.1 Bearer + RFC 9728</td>
                    <td className="py-2">
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                        Verified in CI
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-3 font-medium">
                      Claude Desktop / Claude Web Remote Connector
                    </td>
                    <td className="py-2 pr-3 font-mono">Streamable HTTP</td>
                    <td className="py-2 pr-3">
                      OAuth 2.1 + PKCE + RFC 9728 Discovery
                    </td>
                    <td className="py-2">
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                        Compatible Spec · Unverified in Production Env
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-3 font-medium">
                      ChatGPT / Custom MCP Connectors / Cursor / VS Code
                    </td>
                    <td className="py-2 pr-3 font-mono">Streamable HTTP</td>
                    <td className="py-2 pr-3">OAuth 2.1 + PKCE</td>
                    <td className="py-2">
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                        Requires Client-Specific Staging Verification
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
