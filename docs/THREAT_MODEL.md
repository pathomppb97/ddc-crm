# DDC Agriculture CRM — Enterprise API & Remote MCP Threat Model

> **Methodology**: STRIDE + OWASP API Security Top 10 (2023) + OWASP Top 10 for LLM & Agentic Applications  
> **Scope**: Remote MCP Server (`/mcp`), Business REST API (`/api/v1/*`), Admin API (`/admin/v1/*`), Integration API (`/integrations/v1/*`), Admin Control Center (`dist-admin/`), Background Worker (`apps/worker`), and PostgreSQL/Supabase persistence.

---

## 1. Trust Boundaries

1. **Boundary A — Untrusted AI Client / LLM Runtime → Remote MCP Server**: AI prompts, user conversations, and retrieved business text are untrusted. The server never relies on LLM prompt compliance for authorization.
2. **Boundary B — External Applications → Integration API**: External systems authenticate via scoped SHA-256 hashed Service Account API keys and are strictly isolated to `/integrations/v1/*`.
3. **Boundary C — CRM Web / Admin Web → Business & Admin APIs**: Browser clients hold only user-scoped tokens; `/admin/v1/*` enforces independent `hasAdminConsoleAccess()` + resource RBAC.
4. **Boundary D — Shared Business Services / Worker → PostgreSQL**: Every query runs parameterized inside `withRlsTransaction()` as the non-superuser `authenticated` role with RLS and `statement_timeout = 10s`.

---

## 2. Threat Analysis & Implemented Mitigations

| ID | Threat Category | Attack Scenario | Implemented Mitigation | Residual Risk |
|---|---|---|---|---|
| **TM-01** | **Prompt Injection (Direct & Indirect)** | Malicious text inside a customer's `description` or visit note instructs the AI client to invoke `update_user_status`, export all customers, or change permissions. | Server-side 8-layer Policy Engine enforces strict RBAC/scopes/risk ceilings regardless of AI intent; unauthorized tools are absent from `tools/list` and blocked at pre-dispatch; business notes are tagged `untrusted_business_data`; `detectPromptInjectionSignals()` alerts Security Center; L3/L4/L5 require out-of-band confirmation/human approval. | Low — AI could still perform an L1/L2 action the user IS authorized for if tricked by indirect text; mitigated by untrusted-data framing and immutable `mcp_execution_logs`. |
| **TM-02** | **Broken Object Level Authorization (BOLA / IDOR)** | Sales Rep A passes Sales Rep B's `customer_id` or an Organization 2 `customer_id` into `update_customer` or `get_customer`. | Both `CrmDomainServices` (`DATA_SCOPE_DENIED`) and PostgreSQL RLS (`same_organization()` + `sales_id = current_sales_id()`) independently enforce record-level and cross-org boundaries. | Very Low (verified by PGlite + MCP tests). |
| **TM-03** | **Broken Function Level Authorization (BFLA) / Hidden Tool Replay** | AI client caches or guesses `get_users`, `generate_export`, or `execute_sql` and sends a raw `tools/call` JSON-RPC request. | Pre-dispatch gate blocks forbidden generic tools (`critical` alert) and re-evaluates live policy for every tool (`hidden_tool_invocation` / `unauthorized_export` alert). | Very Low. |
| **TM-04** | **Identity Spoofing & Mass Assignment** | Caller injects `user_id`, `role`, `organization_id`, `administrator`, or `revenue` into MCP tool arguments or REST `PATCH` payloads. | Zod `.strict()` rejects unknown fields; pre-dispatch gate explicitly rejects identity claim keys (`privilege_escalation`); `enforceWriteFieldAllowlist()` rejects hidden/masked/un-allowlisted fields (`FIELD_ACCESS_DENIED`). | Very Low. |
| **TM-05** | **SQL Injection / Arbitrary Code Execution** | Attacker supplies `' OR 1=1; DROP TABLE companies; --` in search filters, or attempts to execute arbitrary SQL via legacy MCP endpoint (SEC-04). | Legacy raw-SQL MCP tools permanently removed (`mcpSecurity.test.ts`); all queries strictly parameterized; Dynamic Query Builder uses an allowlisted AST; Admin UI cannot upload executable tool code. | Very Low. |
| **TM-06** | **Privilege Escalation & Self-Approval** | Compromised admin session attempts to self-approve an L4/L5 request, tamper with approved arguments, suspend themselves, or grant `super_admin`. | `assertDelegationAllowed()` blocks self-modification and out-of-authority delegation; `ApprovalService` binds approvals to canonical SHA-256 `payload_hash`, user, version, and expiry; PostgreSQL `CHECK` constraint `mcp_approval_no_self_decision` prevents self-approval at DB level. | Low (collusion between two distinct compromised admin accounts still requires MFA + audit review). |
| **TM-07** | **Stale Token / Revocation Bypass & Delayed Job Abuse** | Suspended user or revoked AI client continues issuing MCP calls with an unexpired JWT, or queued job runs after user lost permission. | Live DB check on `sales.disabled`, `oauth_grants.revoked_at`, `mcp_connections.status`, and `mcp_user_policies.revoked_before` on every request; policy cache invalidated via `organizations.policy_version`; Worker runs `createPostgresPermissionRevalidator` immediately before executing every job. | Very Low. |
| **TM-08** | **Token Phishing, Redirect Hijacking & DNS Rebinding** | Attacker registers `http://evil.example/cb` as OAuth redirect URI or sends cross-origin browser requests to localhost MCP server. | `registerClient()` enforces PKCE (`S256`) and allows only `https://` or loopback `127.0.0.1`/`localhost` redirect URIs; `originValidationResponse()` enforces `allowedOriginHostnames`. | Low (requires configuring `MCP_ALLOWED_ORIGIN_HOSTNAMES` in production). |
| **TM-09** | **DoS / Resource Exhaustion & Scraping** | Compromised AI client floods `tools/call` or requests huge exports/queries. | Per-user/tool and per-client `SlidingWindowRateLimiter`, tool execution timeout (`timeoutMs`), PostgreSQL `statement_timeout = 10s`, pagination caps (`<=100`), and L3 confirmation on bulk/exports. | Medium in multi-instance deployments (in-memory rate limiter should be backed by Redis/shared store when scaling horizontally). |
| **TM-10** | **Audit Tampering & Secret Leakage** | Compromised user attempts to delete `mcp_execution_logs` or exfiltrate secrets from `audit_log`. | `REVOKE UPDATE, DELETE` on `mcp_execution_logs` & `mcp_security_events`; zero `anon` grants; `ddc_sanitize_audit_jsonb()` + `packages/shared-auth/src/redaction.ts` strip tokens/secrets/base64 payloads. | Very Low. |

---

## 3. Open Residual Risks & Recommended Production Hardening

1. **Distributed Rate Limiter & Multi-Node Event Bus**: Current `SlidingWindowRateLimiter` and `InMemoryServerEventBus` are process-local. Before horizontal autoscaling across multiple MCP server replicas, back both with Redis or PostgreSQL `LISTEN/NOTIFY`.
2. **Live External AI Client Staging Validation**: End-to-end OAuth 2.1 consent and token refresh with external commercial clients (Claude Desktop/Web, ChatGPT Connectors, Cursor) must be executed in staging with real TLS certificates and registered client redirect URIs.
3. **Mandatory MFA Enforcement for L4/L5 Approvers**: Enforce Supabase TOTP MFA (`aal2`) verification for `super_admin`, `system_admin`, and `release_manager` accounts approving L4/L5 requests in production.
