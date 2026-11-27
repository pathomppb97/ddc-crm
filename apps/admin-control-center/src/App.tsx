import { useMemo, useState } from "react";
import {
  Activity,
  Bot,
  CheckCircle2,
  Clock,
  Database,
  Flag,
  KeyRound,
  Layers,
  Lock,
  Menu,
  Palette,
  Plug,
  Rocket,
  ScrollText,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  SlidersHorizontal,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import {
  formatBangkokDateTime,
  STATUS_TONE_MAP,
  type StatusTone,
} from "../../../packages/shared-ui/src/index";
import type { AdminApiConfig } from "./mcpApiClient";
import { McpManagementSection } from "./McpManagementSection";
import { ADMIN_MODULES, type AdminModuleDef } from "./modules";

const MODULE_ICONS: Record<string, typeof ShieldCheck> = {
  overview: Activity,
  users: Users,
  roles: ShieldCheck,
  data: Database,
  "query-builder": Search,
  "api-management": KeyRound,
  "design-studio": Palette,
  "feature-flags": Flag,
  releases: Layers,
  deployments: Rocket,
  jobs: Clock,
  "audit-logs": ScrollText,
  backups: Database,
  integrations: Sliders,
  settings: Settings,
  "mcp-overview": Bot,
  "mcp-tools": Layers,
  "mcp-role-matrix": SlidersHorizontal,
  "mcp-users": UserCheck,
  "mcp-clients": KeyRound,
  "mcp-approvals": ShieldCheck,
  "mcp-logs": ScrollText,
  "mcp-security": ShieldAlert,
  "mcp-setup": Plug,
};

const TONE_CLASSES: Record<StatusTone, string> = {
  success: "bg-emerald-50 text-emerald-800 border-emerald-200",
  warning: "bg-amber-50 text-amber-800 border-amber-200",
  danger: "bg-red-50 text-red-800 border-red-200",
  info: "bg-sky-50 text-sky-800 border-sky-200",
  neutral: "bg-slate-100 text-slate-700 border-slate-200",
};

const PLATFORM_SECURITY_CONTROLS = [
  {
    id: "SEC-01",
    label: "Disabled admin blocked in is_admin(), Policy Engine & RLS",
    status: "verified",
  },
  {
    id: "SEC-04",
    label: "Raw-SQL MCP tools removed; 71 allowlisted tools enforced",
    status: "verified",
  },
  {
    id: "MCP-AUTH",
    label: "OAuth 2.1 + PKCE + RFC 9728 Protected Resource Metadata",
    status: "verified",
  },
  {
    id: "MCP-RBAC",
    label: "8-layer intersection policy + immediate cache invalidation",
    status: "verified",
  },
  {
    id: "MCP-APPR",
    label: "L3-L5 confirmation/approval binding + DB anti-self-approval",
    status: "verified",
  },
  {
    id: "SEC-09",
    label: "Channel-attributed immutable audit trail & secret redaction",
    status: "verified",
  },
] as const;

export function App() {
  const [activeId, setActiveId] = useState<string>("overview");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmReason, setConfirmReason] = useState("");
  const [lastPreviewNotice, setLastPreviewNotice] = useState<string | null>(
    null,
  );
  const [apiConfig, setApiConfig] = useState<AdminApiConfig>({
    apiBaseUrl: "",
    mcpEndpointUrl: "https://mcp.ddc.example.test/mcp",
    accessToken: "",
  });

  const activeModule: AdminModuleDef = useMemo(
    () => ADMIN_MODULES.find((m) => m.id === activeId) ?? ADMIN_MODULES[0],
    [activeId],
  );

  const controlPlaneModules = useMemo(
    () => ADMIN_MODULES.filter((m) => m.group === "control_plane"),
    [],
  );
  const mcpModules = useMemo(
    () => ADMIN_MODULES.filter((m) => m.group === "ai_mcp"),
    [],
  );

  const bangkokNow = formatBangkokDateTime(new Date(), "en");

  const renderGroup = (heading: string, items: readonly AdminModuleDef[]) => (
    <div className="mb-3">
      <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
        {heading}
      </p>
      <div className="space-y-0.5">
        {items.map((mod) => {
          const Icon = MODULE_ICONS[mod.id] ?? ShieldCheck;
          const isActive = mod.id === activeModule.id;
          return (
            <button
              key={mod.id}
              type="button"
              onClick={() => {
                setActiveId(mod.id);
                setMobileMenuOpen(false);
              }}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition ${
                isActive
                  ? "bg-emerald-900 text-white font-semibold shadow-xs"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <Icon className="size-4 shrink-0" />
              <span className="truncate">{mod.title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const renderNav = () => (
    <nav aria-label="Admin Control Center modules" className="p-3">
      {renderGroup("AI & MCP Management", mcpModules)}
      {renderGroup("Enterprise Control Plane", controlPlaneModules)}
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* Desktop sidebar */}
      <aside className="hidden w-72 shrink-0 border-r border-slate-200 bg-white lg:flex lg:flex-col">
        <div className="flex h-14 items-center gap-2 border-b border-slate-200 px-4">
          <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-900 text-white">
            <Lock className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-900">
              DDC Admin Control Center
            </p>
            <p className="truncate text-[11px] text-slate-500">
              API &amp; Remote MCP Governance
            </p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">{renderNav()}</div>
      </aside>

      {/* Mobile drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-10 flex w-72 flex-col bg-white shadow-xl">
            <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4">
              <span className="text-sm font-bold">DDC Admin Modules</span>
              <button
                type="button"
                aria-label="Close navigation menu"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-md p-1.5 hover:bg-slate-100"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">{renderNav()}</div>
          </aside>
        </div>
      )}

      {/* Main workspace */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Open navigation menu"
              onClick={() => setMobileMenuOpen(true)}
              className="rounded-md border border-slate-200 p-1.5 hover:bg-slate-100 lg:hidden"
            >
              <Menu className="size-5" />
            </button>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
              API &amp; MCP PLATFORM
            </span>
            <span className="hidden text-xs text-slate-500 sm:inline">
              Namespaces:{" "}
              <code className="font-mono">/api/v1 · /admin/v1 · /mcp</code>
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-600">
            <span className="hidden font-mono tabular-nums sm:inline">
              {bangkokNow}
            </span>
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-medium">
              Artifact: <code className="font-mono">dist-admin/</code>
            </span>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 p-4 md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                {activeModule.group === "ai_mcp"
                  ? "AI & MCP Management"
                  : `Control Plane Module ${activeModule.number}`}{" "}
                · {activeModule.phase}
              </p>
              <h1 className="mt-1 text-2xl font-bold text-slate-900">
                {activeModule.title}
                <span className="ml-2 text-base font-normal text-slate-500">
                  ({activeModule.titleTh})
                </span>
              </h1>
              <p className="mt-1 max-w-3xl text-sm text-slate-600">
                {activeModule.summary}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50"
            >
              <ShieldCheck className="size-4 text-emerald-800" />
              Test Confirmation Guard
            </button>
          </div>

          {lastPreviewNotice && (
            <div
              role="status"
              className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900"
            >
              <span>{lastPreviewNotice}</span>
              <button
                type="button"
                onClick={() => setLastPreviewNotice(null)}
                className="text-xs font-semibold underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {activeModule.group === "ai_mcp" ? (
            <McpManagementSection
              activeModuleId={activeModule.id}
              apiConfig={apiConfig}
              onApiConfigChange={setApiConfig}
            />
          ) : activeModule.id === "overview" ? (
            <>
              <section
                aria-label="Platform architecture summary"
                className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
              >
                {[
                  {
                    label: "Admin & MCP Modules",
                    value: `${ADMIN_MODULES.length}`,
                    hint: "15 Control Plane + 9 AI/MCP pages",
                    tone: "info" as StatusTone,
                  },
                  {
                    label: "System RBAC Roles",
                    value: "13 + Custom",
                    hint: "Deny-by-default Policy Engine + RLS",
                    tone: "success" as StatusTone,
                  },
                  {
                    label: "Remote MCP Protocol",
                    value: "2025-11-25",
                    hint: "Streamable HTTP · OAuth 2.1 + PKCE",
                    tone: "success" as StatusTone,
                  },
                  {
                    label: "Scheduling Timezone",
                    value: "Asia/Bangkok",
                    hint: "UTC stored in PostgreSQL",
                    tone: "neutral" as StatusTone,
                  },
                ].map((kpi) => (
                  <div
                    key={kpi.label}
                    className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs"
                  >
                    <p className="text-xs font-medium text-slate-500">
                      {kpi.label}
                    </p>
                    <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
                      {kpi.value}
                    </p>
                    <span
                      className={`mt-2 inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium ${TONE_CLASSES[kpi.tone]}`}
                    >
                      {kpi.hint}
                    </span>
                  </div>
                ))}
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
                <h2 className="text-base font-semibold text-slate-900">
                  Enterprise API &amp; MCP Security Hardening Posture
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Enforced server-side across PostgreSQL RLS, triggers, REST
                  API, Integration API, Background Worker, and Remote MCP
                  Server.
                </p>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {PLATFORM_SECURITY_CONTROLS.map((item) => {
                    const tone = STATUS_TONE_MAP[item.status] ?? "neutral";
                    return (
                      <div
                        key={item.id}
                        className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 p-3"
                      >
                        <div className="flex items-start gap-2.5">
                          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-700" />
                          <div>
                            <p className="font-mono text-xs font-semibold text-slate-700">
                              {item.id}
                            </p>
                            <p className="text-sm text-slate-800">
                              {item.label}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase ${TONE_CLASSES[tone]}`}
                        >
                          {item.status}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>
            </>
          ) : (
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500">
                    Required Server-Side Permission
                  </p>
                  <code className="mt-0.5 inline-block rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-800">
                    {activeModule.requiredResource}:read
                  </code>
                </div>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                  API-Backed · {activeModule.phase}
                </span>
              </div>
              <h2 className="mt-4 text-sm font-semibold text-slate-900">
                Capabilities
              </h2>
              <ul className="mt-2 space-y-2 text-sm text-slate-700">
                {activeModule.capabilities.map((cap) => (
                  <li key={cap} className="flex items-center gap-2">
                    <CheckCircle2 className="size-4 shrink-0 text-emerald-700" />
                    <span>{cap}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </main>
      </div>

      {/* Shared High-Impact Action Confirmation Dialog Primitive */}
      {confirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h2
              id="confirm-dialog-title"
              className="text-base font-bold text-slate-900"
            >
              Confirm High-Impact Administrative Action
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              All sensitive Control Center mutations require explicit
              confirmation and an audit reason recorded in{" "}
              <code className="font-mono">audit_log.reason</code>.
            </p>
            <label className="mt-4 block text-xs font-medium text-slate-700">
              Audit Reason (required)
              <input
                type="text"
                value={confirmReason}
                onChange={(e) => setConfirmReason(e.target.value)}
                placeholder="e.g. Approved change ticket CHG-2026-042"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-700 focus:outline-none"
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirmOpen(false);
                  setConfirmReason("");
                }}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={confirmReason.trim().length < 5}
                onClick={() => {
                  setLastPreviewNotice(
                    `Confirmation guard verified with audit reason: "${confirmReason.trim()}"`,
                  );
                  setConfirmOpen(false);
                  setConfirmReason("");
                }}
                className="rounded-lg bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Confirm Action
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
