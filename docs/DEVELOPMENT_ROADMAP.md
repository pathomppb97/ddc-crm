# DDC Agriculture CRM — Development Roadmap, Phase 0 Audit & Gap Analysis

> **Document Status**: Phase 0 Audit & Architecture Baseline (2026-11-27)
> **Scope**: Evolving the existing DDC Agriculture CRM (`ddc-crm/`, branch `ddc-crm`) into a production-ready, API-first enterprise CRM platform with an independent Admin Control Center.

---

## 1. Phase 0 — Existing Codebase Audit

### 1.1 Workspace Inventory

The workspace (`c:\Users\peace\Desktop\CRM`) contains:

| Path | Purpose | Production Role |
|---|---|---|
| `ddc-crm/` | Primary Git repository (forked from `marmelab/atomic-crm`, branch `ddc-crm`) with React 19 CRM SPA, Supabase PostgreSQL migrations (47 SQL migrations), 7 Supabase Edge Functions, Vitest + PGlite + Playwright test suites, GitHub Actions CI/CD | **Core production codebase** (evolved in place) |
| `dev-admin/` | Local developer-only Python 3.11 HTTP tool (`127.0.0.1:5178`) that directly edits files under `ddc-crm/src` and `ddc-crm/demo` (pages, introductions, page designs) | **Developer-only local tool** — NOT a production admin app; superseded in production by `apps/admin-control-center` |
| `Document-Pilot/` | Legacy SQLite pilot (`crm.sqlite3`) + Python RFQ MCP server (ports 5176/5177) | **Legacy pilot** — preserved untouched; isolated from enterprise platform |
| `pilot-backup/` & `*.zip` | Historical source archives and backup snapshots | **Archive** — preserved untouched |

### 1.2 Existing Technology Stack (`ddc-crm/`)

| Layer | Current Stack |
|---|---|
| Frontend Runtime | React 19.1, TypeScript 5.8, Vite 8.3 (Rolldown), React Router v7, TanStack Query v5, React Hook Form v7 |
| Application Framework | `ra-core` v5.15 (react-admin headless) + `ra-supabase-core` v3.5 + mutable `shadcn-admin-kit` (`src/components/admin/`) |
| Design System & Styling | Tailwind CSS v4.1, shadcn/ui (`base-vega`), `@base-ui/react` v1.8, Lucide icons, `@nivo/bar`, IBM Plex Sans Thai + Inter |
| Validation & Files | Zod v4.1, ExcelJS v4.4, PapaParse v5.5, DOMPurify v3.4 |
| Backend & Database | Supabase (PostgreSQL 15+, PostgREST, GoTrue Auth, Supabase Storage, Deno Edge Functions) |
| Testing | Vitest v5 with 4 projects: `db` (PGlite WASM PostgreSQL — 106/106 passing), `functions` (Node — 210/210 passing), `app` (Playwright browser), `claude` (harness hooks), plus Playwright E2E (`e2e/*.spec.ts`) |
| CI/CD | GitHub Actions (`check.yml`: lint, typecheck, unit tests, E2E, build; `deploy.yml`: doc, demo GitHub Pages, Supabase push + functions deploy + GitHub Pages) |
| Local Evaluation Mode | `npm run dev:demo` using `ra-data-fakerest` + IndexedDB atomic workspace (`src/ddc/providers/localWorkspace.ts`) |

### 1.3 Existing Business Functionality (Preserved)

The existing `ddc-crm` codebase already provides substantial, well-tested Agriculture CRM functionality:
- **Customer Master** (`companies`, `companies_summary`, `company_business_models`, `company_addresses`, `company_territories`, `company_product_interests`, 5 Agriculture customer groups, GPS coordinates, duplicate detection, Excel/CSV import-export)
- **Contacts** (`contacts`, `contacts_summary`, `contact_notes`, Thai single-name support, LINE ID, nickname, secondary emails)
- **Leads & Opportunities** (`leads`, atomic `convert_lead()` RPC, `deals` Kanban with configurable `pipelines` / `pipeline_stages`, `deal_products`, `deal_competitors`)
- **Field Sales & Visits** (`FieldVisitPage`, `VisitTimelinePage`, `PartCatalogPage`, `Customer360Panel`, `activities`, `activity_participants`, `activity_products`, `activity_photos`, `action_items`, `customer_capacity_profiles`, `customer_part_usage`, `ActivityCalendar`)
- **Products & Agriculture Applications** (`product_hierarchy_nodes` family→category→type→model, `products`, `product_specifications`, `product_customer_references`, `product_revisions`, `product_relations`, `manufacturers`, `brands`, `machine_models`, `product_machine_applications` with mandatory verification evidence)
- **RFQ & Quotation Approval Workflow** (`rfqs`, `rfq_items`, `quotations`, `quotation_items`, `approval_rules`, `quotation_approvals`, DB-enforced locking, segregation of duties, revision creation)
- **OEM/ODM Development Projects, Aftermarket Dealer Network, Service Cases / Complaints** (`dev_projects*`, `dealer_networks*`, `service_cases*`)
- **ERP Integration Layer (Disabled by default, mock-tested)** (`erp_*` tables + `erp_sync` Edge Function + D365 F&O OData adapter)
- **Customer List Excel Evidence Tables** (`customer_source_rows`, `customer_fleets`, `customer_requirements`, `customer_samples`, `customer_purchase_history`)
- **RBAC & Database Audit Trail** (`ddc_roles`, `permission_resources`, `role_permissions`, `table_permission_map`, `ddc_can()`, `audit_log` trigger, `PermissionsPage`)

### 1.4 Security Audit Findings (Phase 0 Baseline)

| ID | Severity | Finding | Location | Phase Target |
|---|---|---|---|---|
| SEC-01 | **Critical** | `public.is_admin()` does not check `NOT disabled`; a disabled admin with an active JWT retains write access to RBAC, settings, approval rules, and ERP config tables | `supabase/schemas/02_functions.sql` (`is_admin`) | **Phase 1 (Fixed)** |
| SEC-02 | **Critical** | `supabase/functions/users/index.ts` does not reject `currentUserSale.disabled`, allowing a disabled admin to re-enable themselves or invite accounts while JWT is valid; `createSale()` also passes `password` into a `sales` table insert on fallback | `supabase/functions/users/index.ts` | **Phase 1 (Fixed)** |
| SEC-03 | **High** | `supabase/functions/merge_contacts/index.ts` interpolates `${userId}` directly into `CompiledQuery.raw(...)`, lacks disabled-user / RBAC verification, allows `loserId === winnerId`, and drops DDC contact fields (`line_id`, `nickname`, `department`, `is_primary`, `custom_fields`) | `supabase/functions/merge_contacts/index.ts` | **Phase 1 (Fixed)** |
| SEC-04 | **High** | `supabase/functions/mcp/index.ts` accepts arbitrary LLM-written SQL (`query` / `mutate`) and logs full SQL statements (PDPA/PII risk). Unrestricted SQL execution violates Section 4 requirements | `supabase/functions/mcp/index.ts` | **Phase 1 (Documented & isolated); Phase 2 (Disable/replace with allowlisted Query Builder)** |
| SEC-05 | **High** | Permissive RLS policies & excessive `anon` grants remain from upstream Atomic CRM: `tags` & `favicons_excluded_domains` writable by any authenticated (even disabled/read-only) user; `sales`, `configuration`, `ddc_roles`, `role_permissions`, `app_settings` readable by disabled users; `anon` retains `GRANT ALL` on `activity_log`, `favicons_excluded_domains`, `get_avatar_for_email` (triggers outbound `http_get`!), `merge_contacts`, and legacy sequences | `supabase/schemas/05_policies.sql`, `06_grants.sql`, `20261111120600_ddc_policies_grants.sql` | **Phase 1 (Fixed)** |
| SEC-06 | **High** | Storage bucket `attachments` policies allow ANY authenticated user (including disabled or read-only accounts) to delete any uploaded object; `uploadToBucket` uses `Math.random()` filenames and public URLs | `supabase/schemas/07_storage.sql`, `src/components/atomic-crm/providers/supabase/dataProvider.ts` | **Phase 1 (RLS hardened); Phase 2 (Signed URLs + UUID keys)** |
| SEC-07 | **High** | Wildcard CORS (`Access-Control-Allow-Origin: *`) on all Edge Functions; no `X-Request-Id`, `Idempotency-Key`, or rate limiting on Edge Functions | `supabase/functions/_shared/cors.ts`, `utils.ts` | **Phase 1 (Hardened)** |
| SEC-08 | **High** | `document_references` RLS uses `ddc_can_any_scope()` without parent-record ownership check, allowing `own`-scoped reps to read/edit/delete documents attached to other reps' customers | `supabase/migrations/20261111120600_ddc_policies_grants.sql` | **Phase 1 (Fixed)** |
| SEC-09 | **Medium** | `activity_photos.image_src` can store raw base64 data URIs which are copied verbatim into `audit_log.old_data`/`new_data`; `ddc_audit()` has no secret redaction | `supabase/migrations/20261111120000_ddc_rbac_audit.sql`, `20261127120000_ddc_field_sales_mobile.sql` | **Phase 1 (Redaction & truncation in `ddc_audit`)** |
| SEC-10 | **Medium** | Production builds (`vite.config.ts`) emit full `sourcemap: true` (`*.js.map` up to 7.3 MB) into `dist/` and GitHub Pages | `vite.config.ts` | **Phase 5 (CI/CD hardening)** |
| SEC-11 | **Medium** | `supabase/config.toml` caps PostgREST `[api] max_rows = 1000` while `supabaseDdc.ts` queries `.limit(10000)` and checks `rows.length >= 10000`, silently truncating dashboard KPIs without triggering the truncation banner | `supabase/config.toml`, `src/ddc/providers/supabaseDdc.ts` | **Phase 2 (Server-side aggregation API)** |
| SEC-12 | **Medium** | `authProvider.ts` caches `current_sale` indefinitely in `localStorage` without verifying `disabled` status or role updates; `handle_contact_saved()` leaks contact emails to Gravatar/favicon.show | `src/components/atomic-crm/providers/supabase/authProvider.ts`, `supabase/schemas/02_functions.sql` | **Phase 3 (Session/Auth overhaul)** |

### 1.5 Technical Debt Inventory

- **Oversized Component**: `src/ddc/features/field/FieldVisitPage.tsx` (109 KB single file) needs decomposition in Phase 2.
- **Client-Side KPI Aggregation**: `DdcDashboard.tsx` fires 15+ parallel full-table queries to the browser (`supabaseDdc.ts`).
- **Unrendered Custom Fields**: `custom_field_definitions` exists in DB, but `GenericResource.tsx` does not render dynamic custom fields yet.
- **File-Based Local Page Designs**: `dev-admin/` mutates source files under `src/ddc/pages/` on disk instead of versioned DB configurations (`ui_config_versions`).
- **24 ESLint Warnings**: `react-refresh/only-export-components` warnings in existing `src/ddc/` files (0 errors).
- **CI/CD Coupling**: `deploy.yml` pushes directly to `main` → Supabase + GitHub Pages with no staging environment, no immutable release artifacts, no approval gate, no health checks, and no rollback mechanism.
- **Uncommitted Working Tree Changes**: 5 modified files + `src/assets/login/` + `login-page.css` (login UI work-in-progress) — preserved untouched.

---

## 2. Gap Analysis Matrix (Current State vs. Enterprise Target)

| Capability Area | Current State | Enterprise Target | Gap / Action | Phase |
|---|---|---|---|---|
| **Application Topology** | Single SPA (`ddc-crm`) + local Python `dev-admin` | Independent CRM Web + Admin Control Center + Backend API + Background Worker + Shared Packages | Establish modular monorepo layout inside `ddc-crm/` with independent builds (`dist/`, `dist-admin/`) & shared packages | **Phase 1** |
| **Database Schema** | Strong core CRM + Agriculture machines/applications + RBAC + ERP copies | Add missing enterprise entities (`teams`, `team_members`, `data_scopes`, `role_field_permissions`, `customer_segments`, `customer_machines`, `machine_specifications`, `price_lists`, `sales_orders`, `sales_targets`, `sales_forecasts`, `saved_views`, `ui_config_versions`, `feature_flags`, `releases`, `deployments`, `scheduled_jobs`, `user_sessions`, `login_history`, `service_accounts`, `api_keys`, `backup_records`), soft delete (`deleted_at`), optimistic concurrency (`version`) | Additive backward-compatible SQL migration with RLS, indexes, triggers, and PGlite tests | **Phase 1** |
| **API-First Layer** | Direct PostgREST table access + 7 ad-hoc Edge Functions | Versioned `/api/v1/*` (business) & `/admin/v1/*` (admin), OpenAPI 3.1, allowlisted Dynamic Query Builder (no raw SQL), pagination, sorting, filtering, global search, aggregation, bulk ops, idempotency, rate limiting, request IDs | Build shared API contracts, OpenAPI 3.1 spec, allowlisted Query Builder AST/compiler, and `api_v1` gateway | **Phase 1–2** |
| **RBAC & Identity** | 9 roles, `all`/`own` scopes, `administrator` flag | 13+ roles (`super_admin`, `system_admin`, `release_manager`, `data_admin`, `sales_manager`, `sales_rep`, `executive_viewer`, custom), teams, territories, `data_scopes`, field-level permissions, MFA, session management, force logout, login history, API keys, service accounts | Add roles & schema in Phase 1; build full User/Session/MFA/API-Key management flows in Phase 3 | **Phase 1 & 3** |
| **Admin Control Center** | Embedded basic `PermissionsPage` + local `dev-admin` | Independent enterprise SPA with all 15 modules (System Overview → System Settings) | Independent app scaffold + System Overview + Security posture in Phase 1; full modules in Phases 3–7 | **Phase 1 & 4** |
| **Configuration-Driven UI** | Singleton `configuration` JSONB + static `designs/*.json` | Typed versioned schema (`Draft → Validate → Preview → Approve → Publish → Active`), atomic publish, scheduled publish, rollback, zero JS injection | Schema + validator + state machine in Phase 1; Web Design Studio & CRM runtime integration in Phase 6 | **Phase 1 & 6** |
| **Feature Flags** | Single build-time `VITE_ENABLE_ERP` env var | Runtime flags with user/role/team targeting, deterministic % rollout, schedule, kill switch, history & audit | DB schema + deterministic evaluator in Phase 1; UI & runtime delivery in Phase 6 | **Phase 1 & 6** |
| **Deployment Management** | Push-to-`main` GitHub Pages + direct `supabase db push` | Dev/Staging/Prod environments, immutable artifacts, approvals, blue-green/atomic switch, health checks, smoke tests, rollback, scheduled deploys | Schema in Phase 1; CI/CD pipelines & Release Management UI in Phase 5 | **Phase 1 & 5** |
| **Background Jobs & Scheduler** | None (synchronous UI/Edge execution) | Durable jobs (`Pending/Scheduled/Running/Completed/Failed/Cancelled/Retrying`), distributed locks, retries, idempotency, UTC storage / `Asia/Bangkok` display | DB schema + Worker state machine/locking package in Phase 1; full executors & cron triggers in Phase 7 | **Phase 1 & 7** |
| **Security & PDPA Governance** | Strong DDC RLS, weak upstream Atomic policies, no secret redaction | Deny-by-default server-side enforcement, secret redaction, data masking, retention policies, destructive confirmation, security test suite | Fix SEC-01..09 in Phase 1; PDPA masking/retention/verification in Phases 3 & 8 | **Phase 1, 3, 8** |

---

## 3. Architecture Decision Records (ADRs)

### ADR-001: Preserve Technology Stack & Evolve into a Modular Monorepo inside `ddc-crm/`
- **Context**: `ddc-crm/` is an active Git repository with 47 PostgreSQL migrations, 316 passing unit/DB/function tests, React 19 + Vite 8 + Tailwind v4 + shadcn/ui + Supabase. Rewriting to a new framework (e.g. Next.js/NestJS) would destroy working domain logic, duplicate RBAC/RLS tests, and risk production regressions.
- **Decision**: Retain React 19, TypeScript 5.8, Vite 8, Tailwind v4, shadcn/ui, Supabase PostgreSQL, and Vitest + PGlite. Evolve `ddc-crm/` into a modular monolith monorepo with:
  - Existing CRM Web App (`src/`, `demo/` → builds to `dist/`)
  - Independent Admin Control Center (`apps/admin-control-center/` → builds to `dist-admin/`)
  - Versioned API-First Gateway (`apps/api/` + `supabase/functions/api_v1/`)
  - Durable Background Worker & Scheduler (`apps/worker/`)
  - Shared packages (`packages/shared-auth/`, `packages/shared-config/`, `packages/shared-api/`, `packages/shared-ui/`)
- **Consequences**: Zero disruption to existing CRM users, scripts, or tests; CRM and Admin build and deploy independently; shared types prevent contract drift.

### ADR-002: PostgreSQL RLS + Versioned API-First Gateway (Defense-in-Depth)
- **Context**: PostgREST directly exposes tables protected by RLS, which works well for standard CRUD, but enterprise features (versioned contracts, OpenAPI, rate limiting, idempotency, allowlisted dynamic queries, field-level masking, bulk jobs, deployment orchestration) require an API control plane.
- **Decision**: Keep PostgreSQL RLS (`ddc_can()`, `is_admin()`, `is_active_user()`) as the non-bypassable persistence enforcement layer AND introduce a versioned REST API layer (`/api/v1/*` for business APIs, `/admin/v1/*` for administrative APIs) with OpenAPI 3.1 contracts, request IDs, sliding-window rate limiting, idempotency keys, and an allowlisted Dynamic Query Builder.
- **Consequences**: Existing CRM screens continue operating seamlessly during incremental Phase 2 migration; unauthorized requests are rejected at BOTH API gateway and PostgreSQL layers.

### ADR-003: Strict Allowlisted Query Builder (Zero Raw SQL Execution)
- **Context**: Upstream Atomic CRM ships an `mcp` Edge Function that executes raw LLM-generated SQL. Section 4 prohibits unrestricted SQL execution via browser or administrative API.
- **Decision**: Implement a typed Query AST in `packages/shared-api/src/queryBuilder.ts` backed by a strict per-resource field allowlist, operator allowlist, max filter depth/count, forced pagination cap, and query timeout. Output compiles exclusively to parameterized predicates (`$1, $2, ...`) or PostgREST-safe filter objects — never string-concatenated SQL.
- **Consequences**: Eliminates SQL injection and unauthorized schema probing; enables safe saved queries and saved views in both CRM and Admin.

### ADR-004: Expand-and-Contract Backward-Compatible Database Migrations
- **Context**: Production CRM data must never be overwritten or dropped; active CRM versions must keep running during deployments.
- **Decision**: All schema changes follow additive expand-and-contract rules: new tables, nullable columns or columns with safe defaults (`version integer not null default 1`, `deleted_at timestamptz`), explicit RLS + policies + audit triggers + grants in every migration, verified via PGlite (`npm run test:db`) prior to staging/production.
- **Consequences**: Safe rolling/blue-green releases without breaking live queries.

### ADR-005: Immutable Atomic UI Configuration & Non-Executable Schema
- **Context**: Configuration-driven UI must update branding, navigation, dashboards, columns, dynamic forms, and templates without redeployment, while preventing XSS or arbitrary JS injection.
- **Decision**: Store versioned configurations in `ui_config_versions` validated by Zod schemas (`packages/shared-config`) that reject `<script>`, `javascript:`/`data:text/html` URLs, inline event handlers, and unknown CSS properties. Enforce atomic publishing via a single transactional RPC (`publish_ui_config_version`) with a partial unique index guaranteeing at most one active `published` row per environment.
- **Consequences**: Atomic switchover and instant one-click rollback with full audit history.

### ADR-006: Durable Database-Backed Job Queue & Distributed Leases
- **Context**: Scheduled deployments, scheduled config/flag activation, imports/exports, reports, backups, and sync jobs require durable state and crash recovery without introducing mandatory external Redis infrastructure in Phase 1.
- **Decision**: Persist jobs in PostgreSQL (`scheduled_jobs` + `scheduled_job_logs`) using `FOR UPDATE SKIP LOCKED` distributed lease claiming (`claim_scheduled_job` RPC), idempotency keys, exponential backoff retries, UTC storage, and `Asia/Bangkok` UI formatting.
- **Consequences**: Transactional consistency with CRM data, zero extra infrastructure dependencies, horizontally scalable workers.

### ADR-007: Independent Hosting & Atomic Switching Strategy for CRM & Admin
- **Context**: Existing `deploy.yml` deploys only to GitHub Pages on push to `main` with no staging or rollback.
- **Decision**: Build immutable versioned static bundles (`dist/` for CRM, `dist-admin/` for Admin) with SHA-256 manifests and separate environment targets (`development`, `staging`, `production`). Prefer blue-green / atomic pointer switch on the chosen enterprise host (e.g., Cloudflare Pages / Vercel / Nginx atomic symlink / S3+CloudFront immutable release prefix) — keeping the prior healthy release active until health checks and smoke tests pass. Zero-downtime is NOT promised until hosting infrastructure and expand-and-contract migrations are verified end-to-end.

---

## 4. Prioritized Implementation Backlog (Phases 0–8)

### Phase 0 — Existing System Audit & Gap Analysis *(Complete)*
- [x] Full codebase, schema, Edge Function, CI/CD, and test baseline audit
- [x] Security vulnerability inventory (`SEC-01` through `SEC-12`)
- [x] Gap analysis matrix & ADRs (`ADR-001` through `ADR-007`)
- [x] Initialize all 15 required documentation artifacts in `docs/` + `AGENTS.md`

### Phase 1 — Architecture, Database & Security Foundation *(Current Phase)*
- [x] **P0 Security Hardening Migration** (`20261127140000_ddc_enterprise_foundation.sql`): fix `is_admin()` (`NOT disabled`), add `is_active_user()`, revoke excess `anon` grants, harden `tags`/`sales`/`configuration`/`storage.objects`/`document_references` RLS, add secret redaction & photo truncation to `ddc_audit()`
- [x] **P0 Enterprise Relational Schema Expansion**: add `teams`, `team_members`, `data_scopes`, `role_field_permissions`, `user_sessions`, `login_history`, `service_accounts`, `api_keys`, `customer_segments`, `company_segments`, `customer_machines`, `machine_specifications`, `price_lists`, `price_list_items`, `sales_orders`, `sales_order_items`, `sales_targets`, `sales_forecasts`, `saved_views`, `ui_config_versions`, `feature_flags`, `feature_flag_history`, `releases`, `deployments`, `scheduled_jobs`, `scheduled_job_logs`, `api_idempotency_keys`, `backup_records`, plus `version` + `deleted_at` on core CRM entities
- [x] **P0 Enterprise Roles**: add `super_admin`, `release_manager`, `data_admin`, `executive_viewer` and sync `defaultPermissions.ts` + `referenceData.json`
- [x] **P0 Edge Function Security Fixes**: harden `users/index.ts`, `merge_contacts/index.ts`, `_shared/cors.ts`, `_shared/utils.ts`
- [x] **P1 Modular Monorepo & Shared Packages**: `packages/shared-auth`, `packages/shared-config`, `packages/shared-api` (with allowlisted Dynamic Query Builder & OpenAPI 3.1 spec), `packages/shared-ui`
- [x] **P1 Independent Applications Foundation**: `apps/admin-control-center` (independent Vite build → `dist-admin/`), `apps/api` + `supabase/functions/api_v1`, `apps/worker`
- [x] **P1 Automated Verification**: PGlite DB/security tests, package unit tests, typecheck, lint, CRM build, Admin build

### Phase 2 — CRM Core & Standardized APIs *(Next)*
- [ ] Wire full CRUD + pagination + sorting + advanced allowlisted filtering + global search + server-side KPI aggregation on `/api/v1/*`
- [ ] Implement Saved Views / Saved Queries UI and API endpoints
- [ ] Implement Bulk Operations + async Excel/CSV Import/Export via job queue
- [ ] Render `custom_field_definitions` dynamically in CRM forms
- [ ] Decompose `FieldVisitPage.tsx` (109 KB) into focused modules
- [ ] Migrate `activity_photos` & attachments to private signed URLs with UUID paths
- [ ] Disable/replace raw-SQL `mcp` Edge Function with allowlisted Query Builder tools

### Phase 3 — User Management, Permissions & Audit Logs
- [ ] Complete User Lifecycle API (`/admin/v1/users`: invite, activate, suspend, force logout, role/team/territory/data-scope assignment)
- [ ] Enforce `team` and `territory` data scopes in `ddc_can()` and API query layer
- [ ] Implement Field-Level Permission masking/hiding middleware (`role_field_permissions`)
- [ ] Implement MFA enrollment/verification, active session management, login history logging
- [ ] Implement Service Accounts & hashed API Key issuance/rotation/revocation
- [ ] Build PDPA data masking, retention policy configuration, and immutable Audit Log explorer

### Phase 4 — Admin Control Center & Data Management
- [ ] Build interactive Admin Control Center modules: System Overview, User Management, Role & Permission Matrix (incl. Custom Roles & Field Permissions), Data Management, Visual Query Builder, API Management, Audit Logs, Backup & Recovery, Integration Management, System Settings
- [ ] Add destructive-action confirmation dialogs (typed confirmation + reason capture → `audit_log.reason`)
- [ ] Connect Admin Control Center exclusively to `/admin/v1/*` with server-side RBAC

### Phase 5 — CI/CD, Staging & Release Management
- [ ] Split GitHub Actions workflows for independent CRM, Admin, API, Worker, and DB migration artifacts
- [ ] Provision `development`, `staging`, and `production` environments with isolated secrets
- [ ] Disable public production sourcemaps (`sourcemap: "hidden"`) and enforce security headers (CSP, HSTS, X-Frame-Options)
- [ ] Implement Release Management & Deployment Scheduler UI backed by CI/CD webhooks, approval workflow, health checks, smoke tests, and atomic rollback

### Phase 6 — Configuration-Driven UI & Feature Flags
- [ ] Build Web Design Studio in Admin Control Center (Branding, Logo, Theme, Typography, Login background, Navigation, Dashboard widgets, Table columns, Dynamic forms, Notification templates)
- [ ] Implement live Preview mode, Approval gate, Atomic Publish, Scheduled Publish, and Version Rollback
- [ ] Connect CRM Web App runtime to published `ui_config_versions` and runtime `feature_flags` (with kill-switch propagation and cache invalidation)

### Phase 7 — Scheduler & Automation
- [ ] Deploy durable Worker runtime executing `scheduled_jobs` (scheduled deployments, scheduled config publish, scheduled flag toggles, async imports/exports, reports, email/in-app notifications, ERP sync, backup orchestration)
- [ ] Build Background Job Management UI (queue depths, retry/cancel controls, execution logs in `Asia/Bangkok`)

### Phase 8 — Integration Tests, Security Validation & Production Readiness
- [ ] End-to-end Playwright test suite covering CRM + Admin Control Center + RBAC denial + config publish/rollback + flag targeting
- [ ] Security penetration checklist (OWASP API Top 10, IDOR, privilege escalation, XSS/CSP, rate limiting, PDPA audit)
- [ ] Load & connection-pool tuning, monitoring/alerting hooks, backup & restore drill sign-off
