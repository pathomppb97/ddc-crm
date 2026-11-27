# DDC Agriculture CRM — Enterprise Changelog

All notable changes to the DDC Agriculture CRM Enterprise Platform and Admin Control Plane are documented in this file.

---

## [Phase 1] - 2026-11-27 — Architecture, Database & Security Foundation

### Phase 0 — Audit, Gap Analysis & Documentation
- Audited full workspace (`ddc-crm/`, `dev-admin/`, `Document-Pilot/`), 47 SQL migrations, 7 Supabase Edge Functions, CI/CD workflows, and baseline test suites (316 passing DB + Function tests).
- Documented 12 security findings (`SEC-01` through `SEC-12`), technical debt inventory, Architecture Decision Records (`ADR-001` through `ADR-007`), and prioritized Phases 0–8 roadmap.
- Created all 15 required enterprise documentation artifacts (`AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/ERD.md`, `docs/DATABASE_SCHEMA.md`, `docs/API_SPECIFICATION.md`, `docs/PERMISSION_MATRIX.md`, `docs/DESIGN_SYSTEM.md`, `docs/ADMIN_CONTROL_CENTER.md`, `docs/CONFIGURATION_MANAGEMENT.md`, `docs/DEPLOYMENT_RUNBOOK.md`, `docs/SECURITY.md`, `docs/BACKUP_RECOVERY.md`, `docs/TEST_PLAN.md`, `docs/DEVELOPMENT_ROADMAP.md`, `docs/CHANGELOG.md`) plus OpenAPI 3.1 contract (`docs/openapi/v1.openapi.yaml`).

### Security Hardening
- **SEC-01**: Hardened `public.is_admin()` to reject disabled accounts (`NOT s.disabled`) and recognize `super_admin`. Added `public.is_active_user()`.
- **SEC-02**: Hardened `supabase/functions/users/index.ts` to reject disabled callers (`401`), removed invalid `password` field from `createSale()`, added `X-Request-Id` correlation.
- **SEC-03**: Fixed raw SQL string interpolation in `supabase/functions/merge_contacts/index.ts`, added active-user and self-merge guards, and preserved DDC contact fields (`line_id`, `nickname`, `department`, `is_primary`, `custom_fields`).
- **SEC-05 & SEC-06**: Revoked excessive `anon` grants (`activity_log`, `favicons_excluded_domains`, `get_avatar_for_email`, `merge_contacts`, legacy sequences) and hardened RLS on `tags`, `sales`, `configuration`, RBAC tables, and `storage.objects`.
- **SEC-07**: Replaced unconditional wildcard CORS in `supabase/functions/_shared/cors.ts` with configurable origin allowlist (`ALLOWED_ORIGINS`) and added `X-Request-Id` / `Idempotency-Key` support.
- **SEC-08**: Hardened `document_references` RLS with parent-record ownership checks (`ddc_can_document_reference()`).
- **SEC-09**: Enhanced `public.ddc_audit()` with automatic secret redaction, oversized base64 payload truncation, and request correlation fields (`request_id`, `actor_ip`, `actor_user_agent`, `reason`).

### Database Foundation (`20261127140000_ddc_enterprise_foundation.sql`)
- Added enterprise control-plane roles (`super_admin`, `release_manager`, `data_admin`, `executive_viewer`) and control-plane permission resources (`roles`, `sales_orders`, `ui_config`, `feature_flags`, `releases`, `deployments`, `jobs`, `api_management`, `backups`, `system_settings`, `data_management`, `admin_console`).
- Added normalized backward-compatible tables: `teams`, `team_members`, `data_scopes`, `role_field_permissions`, `user_sessions`, `login_history`, `service_accounts`, `api_keys`, `customer_segments`, `company_segments`, `customer_machines`, `machine_specifications`, `price_lists`, `price_list_items`, `sales_orders`, `sales_order_items`, `sales_targets`, `sales_forecasts`, `saved_views`, `ui_config_versions`, `feature_flags`, `feature_flag_history`, `releases`, `deployments`, `scheduled_jobs`, `scheduled_job_logs`, `api_idempotency_keys`, `backup_records`.
- Added optimistic concurrency (`version`) and soft deletion (`deleted_at`) columns to core CRM tables (`companies`, `contacts`, `leads`, `deals`, `products`, `rfqs`, `quotations`).
- Added atomic transactional RPCs: `publish_ui_config_version()`, `rollback_ui_config_version()`, and `claim_scheduled_job()`.
- Synchronized `src/ddc/domain/defaultPermissions.ts` and `src/ddc/demo/referenceData.json`.

### Modular Monorepo & Independent Applications Foundation
- Created shared packages: `packages/shared-auth`, `packages/shared-config`, `packages/shared-api` (including allowlisted Dynamic Query Builder), `packages/shared-ui`.
- Scaffolded independent Admin Control Center SPA (`apps/admin-control-center/`, `vite.admin.config.ts` → `dist-admin/`) with responsive 15-module navigation shell, RBAC guard, and Phase 1 System Overview & Security Posture view.
- Scaffolded versioned API-First Gateway (`apps/api/` + `supabase/functions/api_v1/`) separating `/api/v1/*` and `/admin/v1/*` with auth, RBAC, rate limiting, idempotency, request IDs, and allowlisted query validation.
- Scaffolded Durable Background Worker & Scheduler foundation (`apps/worker/`) with UTC/Asia/Bangkok time handling, job state machine, distributed lease contract, and exponential retry policies.
