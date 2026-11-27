# DDC Agriculture CRM — Remote MCP Security Architecture

> **Compliance Baseline**: Thailand PDPA (B.E. 2562), OWASP API Security Top 10, OWASP LLM / Agentic AI Top 10, OAuth 2.1 + PKCE (`S256`)  
> **Primary Controls**: `packages/shared-auth/`, `apps/mcp/src/mcpServer.ts`, `supabase/migrations/20261127150000_ddc_mcp_platform.sql`, `supabase/functions/mcp/index.ts`

---

## 1. Security-by-Design Guarantees

| Control | Implementation | Verification |
|---|---|---|
| **SEC-04 Remediated (Zero Raw SQL)** | Removed `get_schema`, `query`, and `mutate` from `supabase/functions/mcp/index.ts`; replaced with server-side allowlisted operational tools (`apps/mcp/src/toolRegistry.ts`). | `supabase/functions/mcp/mcpSecurity.test.ts` + `apps/mcp/src/mcpPlatform.test.ts` |
| **Zero Generic Dangerous Tools** | `execute_sql`, `query`, `mutate`, `get_schema`, `execute_shell`, `unrestricted_http_request`, and `unrestricted_admin_action` are permanently rejected with `critical` `privilege_escalation` events. | Pre-dispatch guard in `apps/mcp/src/mcpServer.ts` |
| **OAuth 2.1 + PKCE (`S256`)** | Signature/JWKS, `iss`, `aud` (RFC 8707), `exp`, `sub`, grant revocation (`oauth_grants`), connection revocation (`mcp_connections`), user cutoff (`revoked_before`), and live `sales.disabled = false`. | `apps/mcp/src/oauthAuth.ts` + `PrincipalResolver` |
| **Anti-Identity Spoofing** | All 71 tool input schemas use Zod `.strict()`; pre-dispatch gate explicitly rejects `user_id`, `role`, `organization_id`, `administrator`, `permissions` arguments. | `apps/mcp/src/mcpPlatform.test.ts` |
| **Defense-in-Depth Isolation** | Every SQL statement runs inside `withRlsTransaction()` as PostgreSQL `authenticated` role with `request.jwt.claim.sub` and `statement_timeout = 10s`; cross-org and cross-user isolation enforced in both Policy Engine and RLS. | `supabase/tests/mcpPlatform.test.ts` + `apps/mcp/src/mcpPlatform.test.ts` |
| **PDPA Field-Level Protection** | `role_field_permissions` + tool field overrides enforce `hidden` (omitted) and `masked` (redacted) fields on reads, and block writes to un-allowlisted or restricted fields via `enforceWriteFieldAllowlist()`. | `packages/shared-auth/src/policyEngine.ts` |
| **Prompt Injection Defense** | Never relies on AI system prompts for security. Free-text records returned with `markUntrustedContent()` (`contentTrust: "untrusted_business_data"`). `detectPromptInjectionSignals()` records `prompt_injection_signal` telemetry into `mcp_security_events`. | `packages/shared-auth/src/policyEngine.ts` |
| **DNS Rebinding & Origin Protection** | Optional `allowedOriginHostnames` validated via `@modelcontextprotocol/server` `originValidationResponse()`; `Cache-Control: no-store` and `X-Content-Type-Options: nosniff` on all JSON responses. | `apps/mcp/src/mcpServer.ts` |
| **Immutable Audit & Secret Redaction** | `audit_log` records `channel`, `organization_id`, `ai_client_id`, `mcp_tool_name`, `approval_request_id`, `request_id`; `ddc_sanitize_audit_jsonb()` strips secrets/tokens/base64 blobs. `mcp_execution_logs` and `mcp_security_events` are append-only (no `UPDATE`/`DELETE` grants for `authenticated`, zero grants for `anon`). | `supabase/tests/mcpPlatform.test.ts` |

---

## 2. Security Monitoring & Telemetry Events

`public.mcp_security_events` records structured, severity-ranked alerts surfaced in Admin Control Center → **Security Center**:

| Event Type | Default Severity | Trigger Condition |
|---|---|---|
| `invalid_token` | `medium` / `high` | Missing/malformed/bad-signature/wrong-issuer/wrong-audience/expired OAuth token |
| `revoked_connection` | `high` | Request using a revoked OAuth grant, revoked connection, or disabled user/role/org MCP toggle |
| `suspended_user` | `high` | Account with `sales.disabled = true` attempts MCP connection or tool execution |
| `hidden_tool_invocation` | `high` | Direct `tools/call` targeting a tool hidden from the caller's `tools/list` |
| `unauthorized_tool` | `high` | Tool invocation blocked by live policy re-evaluation |
| `unauthorized_export` | `high` | Unauthorized caller attempts `generate_export` |
| `scope_violation` | `high` | Attempted cross-user or cross-organization record access (`DATA_SCOPE_DENIED`) |
| `approval_payload_mismatch` | `high` | Payload or record version tampered after L4/L5 approval was granted |
| `privilege_escalation` | `critical` | Invocation of forbidden generic tool (`execute_sql`, etc.) or spoofed identity claim arguments (`user_id`, `role`, `organization_id`) |
| `prompt_injection_signal` | `medium` | Prompt-injection patterns detected in tool arguments |
| `rate_limit_exceeded` | `medium` | Caller or AI client exceeded sliding-window rate limit |

---

## 3. Incident Response Controls

Administrators with `mcp_admin:update` can execute containment actions immediately without redeploying:
1. **Disable Single Tool**: `PATCH /admin/v1/mcp/tools/:toolName` (`{ "isEnabled": false }`).
2. **Deny Tool for a Role**: `PUT /admin/v1/mcp/roles/:roleKey/tools/:toolName` (`{ "effect": "deny" }`).
3. **Revoke User MCP Access**: `POST /admin/v1/mcp/users/:salesId/revoke` (revokes all active grants, connections, and invalidates tokens issued before `now()`).
4. **Revoke Compromised AI Client**: `POST /admin/v1/mcp/clients/:clientId/revoke`.
5. **Global Organization Kill Switch**: `PUT /admin/v1/mcp/organization-policy` (`{ "mcpEnabled": false }`).
