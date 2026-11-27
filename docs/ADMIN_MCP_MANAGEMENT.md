# DDC Agriculture CRM — Admin Control Center: AI & MCP Management Guide

> **Application**: `apps/admin-control-center/` (independently built to `dist-admin/`)  
> **UI Implementation**: `apps/admin-control-center/src/McpManagementSection.tsx`, `apps/admin-control-center/src/mcpApiClient.ts`, `apps/admin-control-center/src/modules.ts`  
> **Backend API**: `/admin/v1/mcp/*` (`apps/api/src/platformRouter.ts` + `packages/shared-services/src/mcpGovernanceService.ts`)

---

## 1. Zero-Fabricated-Telemetry Principle

Every metric, table row, and status indicator inside the **AI & MCP Management** section is retrieved live from PostgreSQL via `/admin/v1/mcp/*`. When no live API base URL or admin bearer token is configured in the Admin Control Center session bar, the UI explicitly indicates disconnected status rather than displaying placeholder or fabricated numbers.

---

## 2. All 9 AI & MCP Management Pages

### 1. MCP Overview (`/mcp/overview` — requires `mcp_admin:read`)
- Displays live server status, protocol version (`2025-11-25`), organization policy version, registered vs enabled tool counts, active user connections, registered AI clients, 24-hour request volume, denial rate, error rate, and average latency (`ms`) computed directly from `mcp_execution_logs`.
- Provides the **Organization MCP Kill Switch** (`PUT /admin/v1/mcp/organization-policy`) to disable/re-enable MCP across the entire organization immediately.

### 2. Tool Registry (`/mcp/tools` — requires `mcp_admin:read` / `update`)
- Lists all **71 server-side allowlisted operational tools** across 13 business domains, filterable by domain and search term.
- Shows risk level (`L0`–`L5`), execution policy, required CRM permissions, required OAuth scopes, rate limit, timeout, 24h invocation counts, and full JSON input/output schemas.
- Supports dynamic **Enable / Disable** toggles and rate-limit adjustments (`PATCH /admin/v1/mcp/tools/:toolName`) with immediate cache invalidation — never allows registering arbitrary UI code.

### 3. Role Permission Matrix (`/mcp/roles` — requires `mcp_admin:read` / `update`)
- Configures per-role `mcp_enabled`, `max_risk_level` (`L0`–`L5`), `default_data_scope`, `allowed_oauth_scopes`, `require_approval_from_level`, and `rate_limit_per_min` (`PUT /admin/v1/mcp/roles/:roleKey/policy`).
- Configures tool-level **ALLOW / DENY** overrides (`PUT /admin/v1/mcp/roles/:roleKey/tools/:toolName`), where explicit `DENY` always takes precedence.
- Includes live **Effective Permission Preview** (`GET /admin/v1/mcp/roles/:roleKey/preview`) showing exact 8-layer effective access per tool before/after edits.

### 4. User MCP Access (`/mcp/users` — requires `mcp_admin:read` / `update`)
- Lists organization users with role, account status, effective MCP toggle, active connection count, and last MCP activity (`Asia/Bangkok`).
- Allows enabling/disabling MCP per user (`PUT /admin/v1/mcp/users/:salesId/policy`) and **Revoke All Access** (`POST /admin/v1/mcp/users/:salesId/revoke`) with required audit reason.

### 5. AI Client Management (`/mcp/clients` — requires `mcp_admin:read` / `create` / `update`)
- Lists registered OAuth 2.1 AI clients, verification badges, allowed scopes, PKCE enforcement, rate limits, and status.
- Supports registering new AI clients (`POST /admin/v1/mcp/clients`) with server-side HTTPS/loopback redirect URI validation, and one-click **Revoke Client** (`POST /admin/v1/mcp/clients/:clientId/revoke`).

### 6. Approval Center (`/mcp/approvals` — requires `mcp_approvals:read` / `approve`)
- Displays pending, approved, rejected, expired, and executed L3–L5 requests with requester identity, risk badge, canonical SHA-256 payload hash prefix, before/after preview diff, and UTC/Bangkok expiration timestamp.
- Supports **Approve** and **Reject** actions with mandatory comment; database constraint `mcp_approval_no_self_decision` prevents requesters from approving their own requests.

### 7. MCP Execution Logs (`/mcp/logs` — requires `mcp_admin:read`)
- Filterable immutable trace of every MCP tool invocation (`mcp_execution_logs`) showing timestamp (`Asia/Bangkok`), user, AI client, tool name, action/resource, risk level, authorization result, execution result, error code, duration (`ms`), and correlated `X-Request-Id`.

### 8. Security Center (`/mcp/security` — requires `mcp_admin:read`)
- Severity-ranked feed of `mcp_security_events` (`low`, `medium`, `high`, `critical`) covering invalid tokens, revoked connections, suspended users, hidden tool invocations, unauthorized exports, scope violations, approval payload mismatches, prompt injection signals, rate-limit violations, and privilege escalation attempts.

### 9. MCP Connection Setup (`/mcp/setup` — requires `mcp_access:read`)
- Displays canonical Remote MCP endpoint URL, RFC 9728 Protected Resource Metadata URL, RFC 8414 Authorization Server Metadata URL, copyable Streamable HTTP + OAuth 2.1 config templates, honest Verified vs Unverified AI client compatibility table, live `/health` endpoint tester, and active session revocation controls.
