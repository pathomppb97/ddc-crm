# DDC Agriculture CRM — Enterprise Test Plan

> **Principle**: Every phase ships with automated verification covering type safety, linting, database integrity & RLS, security controls, business logic, API contracts, and independent frontend builds.

---

## 1. Test Pyramid & Suites

| Project / Command | Runner | Scope | Baseline / Target |
|---|---|---|---|
| `npm run typecheck` | TypeScript (`tsconfig.app.json`) | CRM Web App strict type checking | 0 errors |
| `npm run typecheck:enterprise` | TypeScript (`tsconfig.enterprise.json`) | Shared packages, API, Worker, Admin Control Center | 0 errors |
| `npm run lint` | ESLint 9 flat config | All `.ts`, `.tsx`, `.mjs` across CRM, Admin, API, Worker, Packages | 0 errors |
| `npm run test:db` | Vitest (`db` project) + PGlite WASM PostgreSQL | Real SQL schema + all DDC migrations, constraints, triggers, RLS per role, disabled-admin blocks, audit redaction, workflow functions, reference-data sync, resource/schema column sync, i18n parity | 100% passing |
| `npm run test:unit:functions -- --run` | Vitest (`functions` project) | Supabase Edge Functions (ERP sync, D365 adapter, Postmark, users secondary emails, MCP SQL validator, CORS/API gateway) | 100% passing |
| `npm run test:enterprise` | Vitest (`enterprise` project) | `packages/shared-auth`, `packages/shared-config` (UI config validation, anti-XSS, lifecycle, deterministic feature flags), `packages/shared-api` (allowlisted Dynamic Query Builder, SQL-injection rejection), `apps/api` (auth, RBAC, rate limiter, idempotency, request IDs), `apps/worker` (job state machine, retries, Bangkok time formatting) | 100% passing |
| `npm run build` & `npm run build:admin` | Vite 8 (Rolldown) | Independent production bundles (`dist/` and `dist-admin/`) | Both succeed cleanly |
| `npm run test:unit:app -- --run` | Vitest (`app` project, Playwright Chromium) | Component browser tests (note: 14 upstream Atomic CRM tests require internet for Gravatar/favicon — documented in `docs/ddc/OPEN-DECISIONS.md`) | Verified in CI |
| `e2e/*.spec.ts` | Playwright | End-to-end CRM + Admin Control Center flows against live Supabase stack | Phase 5 & Phase 8 |

---

## 2. Phase 1 Mandatory Verification Scenarios

### Database & Security (`supabase/tests/`)
- Every table in `public` has RLS enabled and explicit policies.
- Disabled administrator (`disabled = true`, `administrator = true`) is REJECTED by `is_admin()`, `ddc_can()`, `configuration`, `role_permissions`, `ui_config_versions`, `feature_flags`, `releases`, and `deployments`.
- Anonymous (`anon`) role is denied access to `companies`, `activity_log`, `sales`, `tags`, `favicons_excluded_domains`, `ui_config_versions`, `feature_flags`, `scheduled_jobs`, `api_keys`, and `get_avatar_for_email()`.
- `document_references` enforces parent customer ownership for `own`-scoped sales reps.
- `ddc_audit()` redacts secret keys (`key_hash`, `secret`, `token`, `password`) and truncates oversized base64 `data:image/...` strings in `audit_log`.
- `ui_config_versions` enforces single active `published` version per environment atomically via `publish_ui_config_version()` and supports rollback via `rollback_ui_config_version()`.
- `deployments` rejects production deployment of an unapproved release.
- `scheduled_jobs` enforces idempotency key uniqueness on active jobs and supports `claim_scheduled_job()` distributed leasing.
- Optimistic concurrency trigger increments `version` on update.

### Shared Packages, API Gateway & Worker (`enterprise` test suite)
- RBAC evaluator enforces deny-by-default and distinguishes `super_admin`, `system_admin`, `release_manager`, `data_admin`, `sales_manager`, `sales_rep`, `executive_viewer`, and custom roles.
- UI config schema rejects `<script>`, `javascript:` URLs, `data:text/html`, inline `onclick=`, invalid hex colors, and unknown fonts.
- Feature flag evaluator applies precedence: kill switch > disabled > schedule > user target > role target > team target > deterministic percentage rollout.
- Dynamic Query Builder rejects unknown resources, non-allowlisted fields, invalid operators, excessive filter count/depth, page sizes `>100`, and SQL injection payloads (`; DROP TABLE`, `--`, `UNION SELECT`), emitting exclusively parameterized bindings.
- API Gateway rejects missing/invalid auth (`401`), disabled accounts (`401`), insufficient permissions (`403`), enforces rate limiting (`429`), replays idempotent writes (`Idempotency-Key`), and propagates `X-Request-Id`.
- Worker job state machine enforces valid transitions, computes bounded exponential backoff, and converts UTC timestamps accurately to `Asia/Bangkok`.

---

## 3. Unverified Behaviors (Explicitly Documented)
- **Live Docker / Supabase Stack**: Local Windows environment does not run Docker; SQL verification runs on PGlite (PostgreSQL WASM) with Supabase auth/storage stubs. Real `supabase db reset --local` and live GoTrue JWT/MFA/Storage tests must be executed in Staging/CI before production go-live.
- **14 Upstream Atomic Browser Tests**: Fail offline due to external Gravatar/favicon requests (pre-existing upstream behavior).
- **Dynamics 365 F&O Sandbox**: Unverified external system; mock connector only.
