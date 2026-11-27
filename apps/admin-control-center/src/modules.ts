export interface AdminModuleDef {
  id: string;
  number: number;
  group: "control_plane" | "ai_mcp";
  title: string;
  titleTh: string;
  route: string;
  requiredResource: string;
  phase: string;
  summary: string;
  capabilities: string[];
}

export const ADMIN_MODULES: readonly AdminModuleDef[] = [
  {
    id: "overview",
    number: 1,
    group: "control_plane",
    title: "System Overview",
    titleTh: "ภาพรวมระบบ",
    route: "/",
    requiredResource: "admin_console",
    phase: "Active",
    summary:
      "Real-time platform posture, security controls, active release version, active UI configuration, and job queue health.",
    capabilities: [
      "Independent CRM, Admin & MCP build status",
      "Security hardening verification (SEC-01..SEC-09 + MCP OAuth 2.1)",
      "Active UI config & feature flag summary",
      "Asia/Bangkok scheduling clock (UTC persisted)",
    ],
  },
  {
    id: "users",
    number: 2,
    group: "control_plane",
    title: "User Management",
    titleTh: "จัดการผู้ใช้งาน",
    route: "/users",
    requiredResource: "users",
    phase: "Active",
    summary:
      "User invitations, activation/suspension, role/team/territory/scope assignment, MFA enforcement, sessions, force logout, and login history.",
    capabilities: [
      "Invite, activate, suspend users",
      "Assign teams, territories, data scopes",
      "Active session revocation & force logout",
      "Login history & MFA posture",
    ],
  },
  {
    id: "roles",
    number: 3,
    group: "control_plane",
    title: "Role & Permission Management",
    titleTh: "บทบาทและสิทธิ์การใช้งาน",
    route: "/roles",
    requiredResource: "roles",
    phase: "Active",
    summary:
      "Manage 13 system roles + custom roles, resource×action×scope matrix, and PDPA field-level permissions (hidden/masked/read/write).",
    capabilities: [
      "Super Admin, System Admin, Release Manager, Data Admin, Executive Viewer",
      "Custom role authoring (deny-by-default)",
      "Field-level PDPA masking policies",
    ],
  },
  {
    id: "data",
    number: 4,
    group: "control_plane",
    title: "Data Management",
    titleTh: "การจัดการข้อมูล",
    route: "/data",
    requiredResource: "data_management",
    phase: "Active",
    summary:
      "Enterprise master data browser with soft-delete recovery, deduplication review, bulk operations, and async Excel/CSV import-export.",
    capabilities: [
      "Soft-delete archive inspection",
      "Bulk update preview & confirmation jobs",
      "Excel/CSV import/export orchestration",
    ],
  },
  {
    id: "query-builder",
    number: 5,
    group: "control_plane",
    title: "Query Builder",
    titleTh: "ตัวสร้างคิวรีแบบปลอดภัย",
    route: "/query-builder",
    requiredResource: "data_management",
    phase: "Active",
    summary:
      "Allowlisted structured query composer backed by @ddc/shared-api. Strictly zero raw SQL execution.",
    capabilities: [
      "Allowlisted resources, fields & typed operators",
      "Parameterized compilation & pagination caps",
      "Saved queries & shared team views",
    ],
  },
  {
    id: "api-management",
    number: 6,
    group: "control_plane",
    title: "API Management",
    titleTh: "จัดการ API และคีย์",
    route: "/api-management",
    requiredResource: "api_management",
    phase: "Active",
    summary:
      "OpenAPI 3.1 contract explorer, service accounts, hashed API key lifecycle (SHA-256 only), and rate-limit observability.",
    capabilities: [
      "Business (/api/v1), Admin (/admin/v1) & Integration (/integrations/v1) isolation",
      "Service accounts & hashed API key rotation",
      "Per-tier sliding-window rate limits",
    ],
  },
  {
    id: "design-studio",
    number: 7,
    group: "control_plane",
    title: "Web Design Studio",
    titleTh: "สตูดิโอออกแบบหน้าเว็บ",
    route: "/design-studio",
    requiredResource: "ui_config",
    phase: "Active",
    summary:
      "Typed Configuration-Driven UI editor supporting Draft → Validate → Preview → Approve → Publish → Rollback with zero JS injection.",
    capabilities: [
      "Branding, logos, theme hex tokens, typography",
      "Login background, navigation, dashboard widgets",
      "Table columns, dynamic forms, notification templates",
      "Atomic publish & instant rollback",
    ],
  },
  {
    id: "feature-flags",
    number: 8,
    group: "control_plane",
    title: "Feature Flag Management",
    titleTh: "จัดการ Feature Flags",
    route: "/feature-flags",
    requiredResource: "feature_flags",
    phase: "Active",
    summary:
      "Runtime targeting by user, role, team, deterministic percentage rollout, schedule (Asia/Bangkok), and emergency kill switch.",
    capabilities: [
      "User / role / team targeting",
      "Deterministic FNV-1a % rollout",
      "Emergency kill switch & change history",
    ],
  },
  {
    id: "releases",
    number: 9,
    group: "control_plane",
    title: "Release Management",
    titleTh: "จัดการเวอร์ชัน (Release)",
    route: "/releases",
    requiredResource: "releases",
    phase: "Active",
    summary:
      "Immutable release registry across Development, Staging, and Production with SHA-256 artifact checksums and maker-checker approvals.",
    capabilities: [
      "Immutable build artifacts & git SHAs",
      "Release Manager approval gate",
      "Pre-production staging verification",
    ],
  },
  {
    id: "deployments",
    number: 10,
    group: "control_plane",
    title: "Deployment Scheduler",
    titleTh: "ตารางการ Deploy",
    route: "/deployments",
    requiredResource: "deployments",
    phase: "Active",
    summary:
      "Immediate and scheduled deployments (blue-green / atomic switch), health checks, smoke tests, deployment logs, and rollback.",
    capabilities: [
      "Immediate & scheduled Asia/Bangkok rollouts",
      "Health check & smoke test gating",
      "Atomic rollback to prior healthy release",
    ],
  },
  {
    id: "jobs",
    number: 11,
    group: "control_plane",
    title: "Background Job Management",
    titleTh: "งานเบื้องหลังและตัวตั้งเวลา",
    route: "/jobs",
    requiredResource: "jobs",
    phase: "Active",
    summary:
      "Monitor durable jobs (Pending, Scheduled, Running, Completed, Failed, Cancelled, Retrying), leases, retries, and execution-time permission revalidation.",
    capabilities: [
      "SKIP LOCKED distributed worker leases",
      "Execution-time permission revalidation",
      "Idempotency keys & exponential backoff",
    ],
  },
  {
    id: "audit-logs",
    number: 12,
    group: "control_plane",
    title: "Audit Logs",
    titleTh: "บันทึกการตรวจสอบ",
    route: "/audit-logs",
    requiredResource: "audit_log",
    phase: "Active",
    summary:
      "Immutable, secret-redacted audit trail distinguishing Web, REST API, Integration API, MCP, and Background Worker actions.",
    capabilities: [
      "Channel attribution (web / rest_api / mcp / integration_api / worker)",
      "Automatic secret & base64 redaction",
      "Append-only tamper resistance",
    ],
  },
  {
    id: "backups",
    number: 13,
    group: "control_plane",
    title: "Backup & Recovery",
    titleTh: "สำรองและกู้คืนข้อมูล",
    route: "/backups",
    requiredResource: "backups",
    phase: "Active",
    summary:
      "Automated/manual backup catalog, SHA-256 checksums, restore verification timestamps, retention policies, and disaster recovery runbook.",
    capabilities: [
      "Pre-migration & scheduled backup catalog",
      "Quarterly staging restore verification",
      "Retention window tracking",
    ],
  },
  {
    id: "integrations",
    number: 14,
    group: "control_plane",
    title: "Integration Management",
    titleTh: "จัดการการเชื่อมต่อระบบ",
    route: "/integrations",
    requiredResource: "erp_integration",
    phase: "Active",
    summary:
      "Govern Dynamics 365 F&O connector approval, legal entities, entity contracts, sync runs/errors, and external Integration API keys.",
    capabilities: [
      "ERP disabled-by-default approval guard",
      "Sync run metrics & conflict queue",
      "Zero secret exposure in UI or DB",
    ],
  },
  {
    id: "settings",
    number: 15,
    group: "control_plane",
    title: "System Settings",
    titleTh: "ตั้งค่าระบบองค์กร",
    route: "/settings",
    requiredResource: "system_settings",
    phase: "Active",
    summary:
      "Enterprise defaults: currency, quotation self-approval policy, retention days, rate-limit parameters, and security posture.",
    capabilities: [
      "Typed organization-wide policies",
      "Audited configuration changes",
      "PDPA retention controls",
    ],
  },
  // ============================================================================
  // AI & MCP Management Section (9 Required Pages — Section 16)
  // ============================================================================
  {
    id: "mcp-overview",
    number: 16,
    group: "ai_mcp",
    title: "MCP Overview",
    titleTh: "ภาพรวมเซิร์ฟเวอร์ MCP",
    route: "/mcp/overview",
    requiredResource: "mcp_admin",
    phase: "AI & MCP Platform",
    summary:
      "Live Remote MCP Server status, protocol version, registered & enabled tools, active user connections, clients, request volume, denial/error rates, and latency.",
    capabilities: [
      "Global organization MCP kill-switch toggle",
      "Real PostgreSQL execution telemetry (zero fabricated metrics)",
      "Live policy version & protocol compatibility indicator",
    ],
  },
  {
    id: "mcp-tools",
    number: 17,
    group: "ai_mcp",
    title: "Tool Registry",
    titleTh: "ทะเบียนเครื่องมือ MCP",
    route: "/mcp/tools",
    requiredResource: "mcp_admin",
    phase: "AI & MCP Platform",
    summary:
      "Server-allowlisted MCP Tool Registry across all 13 CRM domains with JSON schemas, risk levels (L0–L5), execution policies, dynamic enable/disable, and usage stats.",
    capabilities: [
      "71 server-side allowlisted operational tools (zero raw SQL/shell)",
      "Inspect JSON input/output schemas & required permissions",
      "Dynamic enable/disable & rate limits without redeployment",
    ],
  },
  {
    id: "mcp-role-matrix",
    number: 18,
    group: "ai_mcp",
    title: "Role Permission Matrix",
    titleTh: "เมทริกซ์สิทธิ์ MCP ตามบทบาท",
    route: "/mcp/roles",
    requiredResource: "mcp_admin",
    phase: "AI & MCP Platform",
    summary:
      "Configure role-level MCP access, tool allow/deny overrides, data scopes, field restrictions, execution policies, and preview effective permissions.",
    capabilities: [
      "Explicit DENY precedence over all grants",
      "8-layer effective permission preview per role",
      "Immediate policy cache invalidation & tools/list_changed notice",
    ],
  },
  {
    id: "mcp-users",
    number: 19,
    group: "ai_mcp",
    title: "User MCP Access",
    titleTh: "สิทธิ์ MCP รายผู้ใช้งาน",
    route: "/mcp/users",
    requiredResource: "mcp_admin",
    phase: "AI & MCP Platform",
    summary:
      "Inspect per-user roles, effective MCP status, connected AI clients, active sessions, last activity, and immediately revoke MCP access.",
    capabilities: [
      "Enable or disable MCP per user without touching CRM web access",
      "Revoke active OAuth grants & MCP connections immediately",
      "Audit-reason capture for every revocation",
    ],
  },
  {
    id: "mcp-clients",
    number: 20,
    group: "ai_mcp",
    title: "AI Client Management",
    titleTh: "จัดการไคลเอนต์ AI (OAuth)",
    route: "/mcp/clients",
    requiredResource: "mcp_admin",
    phase: "AI & MCP Platform",
    summary:
      "Register, verify, scope-restrict, and revoke OAuth 2.1 AI clients with strict PKCE (S256) and HTTPS/loopback redirect URI validation.",
    capabilities: [
      "Strict redirect URI validation (HTTPS or loopback only)",
      "Client-level scope ceilings & rate limits",
      "One-click client & connection revocation",
    ],
  },
  {
    id: "mcp-approvals",
    number: 21,
    group: "ai_mcp",
    title: "Approval Center",
    titleTh: "ศูนย์อนุมัติคำสั่ง AI",
    route: "/mcp/approvals",
    requiredResource: "mcp_approvals",
    phase: "AI & MCP Platform",
    summary:
      "Review, preview before/after diffs, and approve or reject pending high-risk (L3–L5) AI operations bound by canonical payload SHA-256 hash and expiry.",
    capabilities: [
      "Payload-hash, user, version & expiration binding",
      "Database-enforced anti-self-approval constraint",
      "Before & after diff preview with expiration countdown",
    ],
  },
  {
    id: "mcp-logs",
    number: 22,
    group: "ai_mcp",
    title: "MCP Execution Logs",
    titleTh: "บันทึกการทำงาน MCP",
    route: "/mcp/logs",
    requiredResource: "mcp_admin",
    phase: "AI & MCP Platform",
    summary:
      "Immutable, secret-redacted trace of every MCP tool invocation with timestamp (Asia/Bangkok), user, AI client, tool, result, duration, request ID, and error code.",
    capabilities: [
      "Filter by tool name and execution result",
      "Correlated X-Request-Id across MCP, API, and PostgreSQL audit_log",
      "Zero tokens, passwords, or secrets stored",
    ],
  },
  {
    id: "mcp-security",
    number: 23,
    group: "ai_mcp",
    title: "Security Center",
    titleTh: "ศูนย์ความปลอดภัย AI & MCP",
    route: "/mcp/security",
    requiredResource: "mcp_admin",
    phase: "AI & MCP Platform",
    summary:
      "Real-time security monitoring for unauthorized tool calls, hidden tool invocations, prompt-injection signals, rate-limit violations, and privilege escalation attempts.",
    capabilities: [
      "Severity-ranked security events (low / medium / high / critical)",
      "Hidden tool & spoofed identity argument detection",
      "Revoked connection & suspended account telemetry",
    ],
  },
  {
    id: "mcp-setup",
    number: 24,
    group: "ai_mcp",
    title: "MCP Connection Setup",
    titleTh: "ตั้งค่าการเชื่อมต่อ MCP",
    route: "/mcp/setup",
    requiredResource: "mcp_access",
    phase: "AI & MCP Platform",
    summary:
      "Endpoint URLs, OAuth 2.1 + PKCE discovery metadata, verified vs unverified AI client templates, live health tester, and troubleshooting.",
    capabilities: [
      "RFC 9728 Protected Resource Metadata & Streamable HTTP endpoint",
      "Explicit distinction between verified and unverified AI clients",
      "Live endpoint health check & connection revocation",
    ],
  },
];
