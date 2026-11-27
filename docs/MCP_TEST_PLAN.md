# DDC Agriculture CRM — Enterprise API & Remote MCP Test Plan

> **Automated Suites**:
> - `apps/mcp/src/mcpPlatform.test.ts` (14 end-to-end Streamable HTTP, OAuth 2.1, Policy Engine, Approval, REST/Integration API, and Worker Revalidation tests against real PGlite)
> - `packages/enterprise.test.ts` (15 unit tests for RBAC, field masking, redaction, Dynamic Query Builder, UI Config validation, Feature Flags, Rate Limiter, API Router, Worker state machine)
> - `supabase/tests/mcpPlatform.test.ts` (6 PostgreSQL PGlite schema, RLS, anon-denial, cross-org, append-only log, anti-self-approval constraint, and channel-audit tests)
> - `supabase/functions/mcp/mcpSecurity.test.ts` (2 static SEC-04 security regression tests)
> - Full existing CRM regression suites: 15 PGlite DB suites + 9 Edge Function suites

---

## 1. Traceability Matrix (All 24 Required Test Scenarios)

| # | Scenario | Test File & Verification Assertion | Status |
|---|---|---|---|
| 1 | Unauthenticated MCP connection attempt | `apps/mcp/src/mcpPlatform.test.ts` — expects HTTP `401`, RFC 9728 `WWW-Authenticate: ... resource_metadata=...`, `AUTHENTICATION_REQUIRED` | Verified |
| 2 | Invalid / expired / wrong-audience / wrong-issuer OAuth token | `apps/mcp/src/mcpPlatform.test.ts` — bad HMAC signature, wrong `aud`, wrong `iss` → `401`; expired `exp` → `401 TOKEN_EXPIRED` | Verified |
| 3 | Revoked OAuth token / revoked MCP connection | `apps/mcp/src/mcpPlatform.test.ts` — revoked `oauth_grants.token_jti_hash` → `401`; revoked `mcp_connections` → `403 MCP_ACCESS_DISABLED` | Verified |
| 4 | Disabled or suspended user | `apps/mcp/src/mcpPlatform.test.ts` — `sales.disabled = true` → `403 ACCOUNT_SUSPENDED` | Verified |
| 5 | User without MCP permission / disabled user policy | `apps/mcp/src/mcpPlatform.test.ts` — `PUT /admin/v1/mcp/users/:id/policy { mcpEnabled: false }` → immediate `403 MCP_ACCESS_DISABLED` | Verified |
| 6 | Read-only user attempting write tool | `apps/mcp/src/mcpPlatform.test.ts` — `read_only` `tools/list` excludes `create_customer`/`create_visit_report` and mutation prompts | Verified |
| 7 | Sales rep attempting hidden Admin tool | `apps/mcp/src/mcpPlatform.test.ts` — `tools/list` hides `get_users`/`update_user_status`/`request_deployment`; direct `tools/call` blocked + logs `hidden_tool_invocation` | Verified |
| 8 | User attempting unauthorized export | `apps/mcp/src/mcpPlatform.test.ts` — `sales_rep` direct `tools/call generate_export` → `PERMISSION_DENIED` + `unauthorized_export` security event | Verified |
| 9 | User attempting cross-user data access | `apps/mcp/src/mcpPlatform.test.ts` — `repA` updating `repB`'s customer (`update:own`) → `DATA_SCOPE_DENIED` | Verified |
| 10 | User attempting cross-organization access | `apps/mcp/src/mcpPlatform.test.ts` & `supabase/tests/mcpPlatform.test.ts` — Org 1 `super_admin` cannot read Org 2 customers via MCP or SQL RLS | Verified |
| 11 | User attempting restricted field read or write | `apps/mcp/src/mcpPlatform.test.ts` — `revenue` hidden, `tax_identifier` masked (`*********7654`), writing `revenue` → `FIELD_ACCESS_DENIED` | Verified |
| 12 | Direct invocation of hidden & forbidden generic SQL tools | `apps/mcp/src/mcpPlatform.test.ts` & `mcpSecurity.test.ts` — `execute_sql` blocked + `critical` `privilege_escalation`; raw SQL removed from Edge Function | Verified |
| 13 | Dynamic permission revocation during active connection | `apps/mcp/src/mcpPlatform.test.ts` — Admin denies `get_sales_pipeline` via REST API; exact same token immediately receives `PERMISSION_DENIED` | Verified |
| 14 | Prompt injection & spoofed identity claims | `apps/mcp/src/mcpPlatform.test.ts` — spoofed `user_id`/`role`/`organization_id` rejected (`PERMISSION_DENIED` + `critical`); injection string records `prompt_injection_signal`; notes framed as `untrusted_business_data` | Verified |
| 15 | SQL injection attempt via MCP tool arguments | `apps/mcp/src/mcpPlatform.test.ts` — `' OR 1=1; DROP TABLE companies; --` safely parameterized returning empty matches | Verified |
| 16 | Routine AI data entry workflow | `apps/mcp/src/mcpPlatform.test.ts` — customer → machine → verified compatible parts → price → visit → draft quotation → submit for approval | Verified |
| 17 | Duplicate record & idempotency enforcement | `apps/mcp/src/mcpPlatform.test.ts` — same `idempotency_key` + same payload replays cleanly; conflicting payload or duplicate `(name, province)` → `DUPLICATE_REQUEST` | Verified |
| 18 | Optimistic concurrency version conflict | `apps/mcp/src/mcpPlatform.test.ts` — `update_customer` with stale `expected_version: 99` → `VERSION_CONFLICT` | Verified |
| 19 | L3 confirmation token & L4 approval workflow + anti-self-approval + payload tampering | `apps/mcp/src/mcpPlatform.test.ts` & `supabase/tests/mcpPlatform.test.ts` — missing/tampered L3 token → `CONFIRMATION_REQUIRED`; L4 self-approval rejected (service + DB constraint); tampered payload rejected; exact approved payload executes | Verified |
| 20 | Scheduled job permission revalidation in worker | `apps/mcp/src/mcpPlatform.test.ts` — suspending user after job enqueue causes `runWorkerTick` + `createPostgresPermissionRevalidator` to block execution (`PERMISSION_DENIED`) | Verified |
| 21 | REST API, Admin API separation & Integration API keys | `apps/mcp/src/mcpPlatform.test.ts` — `sales_rep` blocked from `/admin/v1/*` (`403`); real live `/admin/v1/mcp/overview` telemetry; hashed Service Account `X-Api-Key` succeeds on `/integrations/v1/customers` | Verified |
| 22 | MCP protocol compatibility (Streamable HTTP + Discovery + Resources + Prompts) | `apps/mcp/src/mcpPlatform.test.ts` — RFC 9728, RFC 8414, `initialize`, `tools/list`, `resources/list`, `resources/read`, `prompts/list`, `prompts/get` over Streamable HTTP SSE/JSON | Verified |
| 23 | Rate limit enforcement | `apps/mcp/src/mcpPlatform.test.ts` — per-user override `rateLimitOverride: 1` allows first call and blocks second with `RATE_LIMIT_EXCEEDED` | Verified |
| 24 | Existing CRM regression & DB invariants | `npm run test:db` (16 files, 122 tests), `npm run test:unit:functions` (10 files, 212 tests), `npm run typecheck`, `npm run lint`, `npm run build`, `npm run build:admin` | Verified |

---

## 2. Running the Full Verification Suite

```bash
npm run typecheck
npm run typecheck:enterprise
npm run lint
npm run test:db
npm run test:enterprise
npm run test:unit:functions -- --run
npm run build
npm run build:admin
```
