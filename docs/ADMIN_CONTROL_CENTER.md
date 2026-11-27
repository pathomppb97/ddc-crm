# DDC Agriculture CRM — Admin Control Center Specification

> **Application Root**: `apps/admin-control-center/`
> **Independent Dev Server**: `npm run dev:admin` (`http://127.0.0.1:5179`)
> **Independent Production Build**: `npm run build:admin` → `dist-admin/`

---

## 1. Purpose & Independence

The **Admin Control Center** is a standalone enterprise management application built and deployed independently from the CRM Web Application.

- **Separation of Concerns**: Administrative tasks (identity governance, RBAC, data administration, UI configuration publishing, feature flags, release/deployment orchestration, job monitoring, backups) are isolated from operational sales screens.
- **Independent Deployability**: Has its own HTML entrypoint, Vite config (`vite.admin.config.ts`), TypeScript project (`apps/admin-control-center/tsconfig.json`), and output artifact (`dist-admin/`).
- **Replaces Local `dev-admin/` for Production**: The existing Python `dev-admin/` tool remains for trusted local source-code editing only. Production configuration changes happen exclusively through the authenticated, audited Admin Control Center backed by `/admin/v1/*` and PostgreSQL.

---

## 2. The 15 Admin Control Center Modules

| # | Module | Route | Required Permission | Primary Capabilities | Rollout Phase |
|---|---|---|---|---|---|
| 1 | **System Overview** | `/` | `admin_console:read` | Health status, active release version, active UI config version, feature flag status, job queue counters, recent audit & security posture | **Phase 1 (Scaffold + Live Posture)** → Phase 4 |
| 2 | **User Management** | `/users` | `users:read\|create\|update` | Invite users, activate/suspend, assign roles/teams/territories/data scopes, MFA status, active sessions, force logout, login history | Phase 3–4 |
| 3 | **Role & Permission Management** | `/roles` | `roles:read\|create\|update` | Manage 13 system roles + custom roles, resource×action×scope matrix, field-level permission rules (`hidden`/`masked`/`read`/`write`) | Phase 3–4 |
| 4 | **Data Management** | `/data` | `data_management:read\|update` | Browse normalized tables with soft-delete filter, duplicate review, bulk operations, async Excel/CSV import & export jobs, retention status | Phase 4 |
| 5 | **Query Builder** | `/query-builder` | `data_management:read` | Visual allowlisted query composer (resource, columns, typed filters, sorting, aggregations, saved views, CSV export) — **zero raw SQL** | Phase 4 |
| 6 | **API Management** | `/api-management` | `api_management:read\|create\|delete` | OpenAPI 3.1 explorer, service accounts, hashed API key creation (one-time copy) & revocation, rate-limit policy visibility | Phase 4 |
| 7 | **Web Design Studio** | `/design-studio` | `ui_config:read\|create\|update\|approve` | Typed UI config editor (branding, logo, theme, typography, login background, navigation, dashboard widgets, table columns, dynamic forms, notification templates), Draft → Validate → Preview → Approve → Publish → Rollback | Phase 6 |
| 8 | **Feature Flag Management** | `/feature-flags` | `feature_flags:read\|create\|update` | Create/toggle flags, target users/roles/teams, deterministic % rollout slider, schedule enable/disable (Asia/Bangkok), emergency kill switch, change history | Phase 6 |
| 9 | **Release Management** | `/releases` | `releases:read\|create\|approve` | Immutable release catalog across Dev/Staging/Prod, git SHA & checksum verification, build status, approval workflow | Phase 5 |
| 10 | **Deployment Scheduler** | `/deployments` | `deployments:read\|create\|approve` | Immediate & scheduled deployments (`Asia/Bangkok` UI / UTC DB), blue-green switch progress, health checks, smoke test results, one-click rollback, logs | Phase 5 & 7 |
| 11 | **Background Job Management** | `/jobs` | `jobs:read\|update` | Monitor `Pending`, `Scheduled`, `Running`, `Completed`, `Failed`, `Cancelled`, `Retrying` queues, inspect execution logs, manual retry/cancel | Phase 7 |
| 12 | **Audit Logs** | `/audit-logs` | `audit_log:read` | Filterable immutable audit trail (actor, table, record, action, request ID, before/after diff, reason) with masked sensitive fields | Phase 3–4 |
| 13 | **Backup & Recovery** | `/backups` | `backups:read\|create` | View automated & manual backups, checksums, verification timestamps, retention dates, trigger orchestrated backup jobs, recovery runbook checklist | Phase 4 & 7 |
| 14 | **Integration Management** | `/integrations` | `erp_integration:read\|update` | Dynamics 365 F&O connector approval status, legal entities, entity contracts, sync runs/errors, webhook/SMTP health (secrets never displayed) | Phase 4 |
| 15 | **System Settings** | `/settings` | `system_settings:read\|update` | Global defaults (currency, timezone display, quotation self-approval policy, retention days, rate-limit overrides, security policies) | Phase 4 |

---

## 3. UX & Governance Standards

- **Consistent Shared Design System**: Consumes `packages/shared-ui` tokens, typography (Inter + IBM Plex Sans Thai), accessible focus rings, keyboard navigation, and responsive sidebar/drawer navigation.
- **Timezone Discipline**: Every timestamp is persisted in UTC and rendered in `Asia/Bangkok` (with explicit `ICT / UTC+7` label on schedulers).
- **Safety Dialogs**: High-impact actions (user suspension, role mutation, kill switch, publish, production deploy, rollback, bulk delete) require a confirmation dialog with impact summary and optional/mandatory audit reason.
- **Deny-by-Default Shell**: Navigation items are hidden when unauthorized, AND direct URL entry renders an explicit Access Denied screen while backend APIs enforce `403 FORBIDDEN`.
