# DDC Agriculture CRM — Security & Data Governance

> **Compliance Posture**: PDPA-aware (Thailand Personal Data Protection Act B.E. 2562), OWASP API Security Top 10, Deny-by-Default RBAC + PostgreSQL RLS.

---

## 1. Phase 0 Audit Findings & Phase 1 Remediation Status

The test-only LAN account service has a separate security boundary and storage
model documented in [LAN Demo accounts](LAN_DEMO_ACCOUNTS.md).

| ID | Severity | Vulnerability Summary | Remediation | Status |
|---|---|---|---|---|
| SEC-01 | Critical | `public.is_admin()` ignored `sales.disabled` | Updated `is_admin()` in `20261127140000_ddc_enterprise_foundation.sql` to require `NOT s.disabled` | **Fixed (Phase 1)** |
| SEC-02 | Critical | `users` Edge Function ignored `currentUserSale.disabled` and leaked `password` key into `createSale()` fallback | Added disabled-account check (`401/403`), removed `password` from `sales` insert, added `X-Request-Id` | **Fixed (Phase 1)** |
| SEC-03 | High | `merge_contacts` Edge Function used raw SQL string interpolation for `userId`, lacked active-user check, allowed self-merge, and dropped DDC contact fields | Replaced with parameterized `set_config($1)`, added active-user + self-merge guards, preserved DDC fields | **Fixed (Phase 1)** |
| SEC-04 | High | Upstream `mcp` Edge Function executes raw SQL statements & logs SQL text | Replaced `supabase/functions/mcp/index.ts` with allowlisted parameterized MCP tools + live policy checks (`mcpSecurity.test.ts`); full 71-tool Remote MCP server in `apps/mcp/` with zero raw SQL | **Fixed** |
| SEC-05 | High | Upstream Atomic CRM `anon` grants (`activity_log`, `get_avatar_for_email`, `merge_contacts`, `favicons_excluded_domains`, sequences) and permissive `using (true)` policies on `tags`, `sales`, `configuration`, RBAC tables | Revoked excessive `anon` grants; tightened policies with `is_active_user()` and permission checks in Phase 1 migration | **Fixed (Phase 1)** |
| SEC-06 | High | `storage.objects` allowed disabled/read-only users to delete any attachment; predictable `Math.random()` paths | Hardened `storage.objects` RLS policies in Phase 1 migration; UUID paths & signed URLs queued for Phase 2 | **Hardened (Phase 1) / Phase 2** |
| SEC-07 | High | Wildcard CORS (`*`) across all Edge Functions; no request IDs or rate limiting | Configurable origin allowlist in `_shared/cors.ts`, `X-Request-Id` in `_shared/utils.ts`, rate limiter + idempotency in `apps/api` | **Fixed (Phase 1)** |
| SEC-08 | High | `document_references` RLS used `ddc_can_any_scope()` without parent ownership check | Added parent-owner verification helper `ddc_can_document_reference()` in Phase 1 migration | **Fixed (Phase 1)** |
| SEC-09 | Medium | `ddc_audit()` copied unredacted JSON and huge base64 `image_src` blobs into `audit_log` | Added `ddc_sanitize_audit_jsonb()` to redact secret keys and replace oversized base64 data URIs with metadata summaries | **Fixed (Phase 1)** |
| SEC-10 | Medium | Production Vite builds output full source maps (`*.js.map`) | Admin build disables public source maps (`sourcemap: false`); CRM CI hardening in Phase 5 | **Partial (Phase 1) / Phase 5** |

---

## 2. Defense-in-Depth Security Controls

### 2.1 Authentication & Session Security
- **JWT Verification**: Remote JWKS validation (`jose.jwtVerify`) + issuer verification + active `sales` row check (`disabled = false`).
- **MFA**: `sales.mfa_enabled` and `sales.mfa_enforced` flags supported; high-privilege roles (`super_admin`, `system_admin`, `release_manager`) target mandatory TOTP MFA (Phase 3 enforcement).
- **Session Registry & Force Logout**: `user_sessions` tracks active sessions with IP/UA and `revoked_at`. Force logout revokes refresh tokens via Supabase Auth Admin API and marks `user_sessions.revoked_at = now()`.
- **Login History**: `login_history` records all login successes, failures, MFA events, logouts, and force logouts.

### 2.2 Authorization & Isolation
- Every API request passes through: `RequestId` → `CORS` → `RateLimit` → `Auth` → `ActiveUserCheck` → `ServerSideRBAC` → `InputValidation (Zod)` → `PostgreSQL RLS`.
- Administrative APIs (`/admin/v1/*`) are strictly separated from Business APIs (`/api/v1/*`) and require explicit control-plane permissions.
- Service accounts authenticate with prefixed, SHA-256 hashed API keys (`api_keys.key_hash`); plaintext keys are shown once at creation and never stored or logged.

### 2.3 Secret Management & Log Hygiene
- **Never log**: passwords, JWTs, refresh tokens, `SUPABASE_SERVICE_ROLE_KEY`, `D365_CLIENT_SECRET`, deployment tokens, or API keys.
- `packages/shared-auth/src/redaction.ts` provides recursive secret/PII redaction for all application & worker structured logs.
- Deployment credentials exist ONLY in CI/CD secret stores or server environment variables — NEVER in Vite client bundles (`VITE_*` env vars are strictly limited to public URLs and publishable keys).

### 2.4 Configuration Anti-Injection Policy
- `packages/shared-config` strictly validates all UI configurations with Zod:
  - Rejects `<script`, `javascript:`, `vbscript:`, `data:text/html`, inline `on*=` attributes, and arbitrary CSS `expression()` / `url(javascript:...)`.
  - Only allows `https://`, relative `/assets/...`, or safe image data URIs (`data:image/png|jpeg|webp;base64,...` — explicitly disallowing raw `data:image/svg+xml` from untrusted editors).
  - Never calls `eval`, `new Function`, or `dangerouslySetInnerHTML` on configuration values.

### 2.5 Destructive & High-Impact Operations
Operations requiring explicit double-confirmation, reason capture (`audit_log.reason`), and (where applicable) maker-checker approval:
- Suspending/demoting an administrator or force-logging out all users
- Publishing UI Configuration to production or rolling back
- Activating emergency feature flag kill switch
- Promoting a release to production or triggering deployment rollback
- Bulk deletion (`>10` records) or initiating database restore

### 2.6 PDPA Data Governance (Thailand B.E. 2562)
- **Data Classification**: Personal data (`contacts`: name, phone, email, LINE ID; `sales`: email, IP, login history; `leads`: contact info).
- **Minimization & Masking**: Field-level permissions (`role_field_permissions`) mask or hide personal identifiers for non-authorized roles and exports.
- **No Unnecessary External Leakage**: Eliminating outbound Gravatar/favicon lookups for contact emails prevents unconsented PII disclosure to third-party services.
- **Retention & Right to Erasure**: Soft deletion (`deleted_at`) preserves referential integrity while allowing scheduled anonymization jobs (Phase 7) to scrub PII after statutory retention periods expire.
- **Auditability**: Every access/export of sensitive data and every admin configuration mutation is logged with actor, timestamp (UTC), request ID, and before/after diffs.

### 2.7 Required Production HTTP Security Headers
Configure on the static host / reverse proxy for both CRM Web and Admin Control Center:
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: geolocation=(self), camera=(self), microphone=()` (CRM) / `geolocation=(), camera=(), microphone=()` (Admin)
- `Content-Security-Policy`: strict `default-src 'self'`, explicit `connect-src` allowlisting only the Supabase / API origins, `object-src 'none'`, `frame-ancestors 'none'`.
