# AGENTS.md — DDC Agriculture CRM, Enterprise API & Remote MCP Platform

## Project Overview

DDC Agriculture CRM is an **AI-native, API-first enterprise Agriculture CRM platform** evolved from [Atomic CRM](https://github.com/marmelab/atomic-crm) inside a modular monorepo (`ddc-crm/`). Every channel — CRM Web, Admin Control Center, REST API, Integration API, Remote MCP Server, and Background Worker — shares the same authoritative Business Services, Centralized Authorization Policy Engine, and PostgreSQL RLS rules:

1. **CRM Web Application** (`src/`, `demo/` → `dist/`): React 19 + TypeScript + Vite 8 + `ra-core` + Tailwind v4 + shadcn/ui — field sales visits, 5 Agriculture customer groups, Customer 360, agriculture machine models & verified parts compatibility, RFQs, quotation approval workflow, OEM/ODM projects, aftermarket network, and service cases.
2. **Independent Admin Control Center** (`apps/admin-control-center/` → `dist-admin/`): Standalone React 19 + Vite 8 + Tailwind v4 control plane with **15 Enterprise Control Plane modules** + **9 AI & MCP Management pages** (MCP Overview, Tool Registry, Role Permission Matrix, User MCP Access, AI Client Management, Approval Center, MCP Execution Logs, Security Center, MCP Connection Setup).
3. **Versioned REST & Integration API Gateway** (`apps/api/` + `supabase/functions/api_v1/`): Separates Business APIs (`/api/v1/*`), Administrative & MCP Governance APIs (`/admin/v1/*`), and External Integration APIs (`/integrations/v1/*`), backed by OpenAPI 3.1 (`docs/openapi/v1.openapi.yaml`), Idempotency-Key, If-Match optimistic concurrency, rate limiting, and an allowlisted Dynamic Query Builder (**zero raw SQL execution**).
4. **Remote MCP Server** (`apps/mcp/` + `supabase/functions/mcp/`): Built on the official `@modelcontextprotocol/server@2.4.0` SDK using Streamable HTTP (`2025-11-25`), OAuth 2.1 + PKCE (`S256`) + RFC 9728 Protected Resource Metadata + RFC 8414 Authorization Server Metadata, a centralized server-side allowlisted Registry of **71 operational tools across 13 business domains**, 6 permission-controlled MCP Resources, and 7 permission-controlled MCP Prompts.
5. **Background Worker & Job Scheduler** (`apps/worker/`): Durable PostgreSQL-backed job processor with distributed leases (`SKIP LOCKED`), idempotency keys, retries, UTC storage, `Asia/Bangkok` display, and **execution-time permission revalidation** (`createPostgresPermissionRevalidator`).
6. **Shared Packages** (`packages/shared-auth`, `packages/shared-services`, `packages/shared-config`, `packages/shared-api`, `packages/shared-ui`).
7. **PostgreSQL + Supabase Persistence** (`supabase/schemas/`, `supabase/migrations/`, `supabase/functions/`).

---

## Documentation Index

Always keep all docs in `docs/` synchronized with code changes:

### Enterprise API & Remote MCP Platform Documentation
- `docs/API_ARCHITECTURE.md` · `docs/API_REFERENCE.md` · `docs/openapi/v1.openapi.yaml`
- `docs/MCP_ARCHITECTURE.md` · `docs/MCP_TOOL_REGISTRY.md` · `docs/MCP_AUTHENTICATION.md`
- `docs/MCP_PERMISSION_MATRIX.md` · `docs/MCP_CONNECTION_GUIDE.md` · `docs/MCP_SECURITY.md`
- `docs/AI_EXECUTION_POLICY.md` · `docs/AI_WORKFLOW_GUIDE.md` · `docs/ADMIN_MCP_MANAGEMENT.md`
- `docs/MCP_DEPLOYMENT_RUNBOOK.md` · `docs/MCP_TEST_PLAN.md` · `docs/THREAT_MODEL.md`

### Core CRM & Control Plane Documentation
- `docs/ARCHITECTURE.md` · `docs/ERD.md` · `docs/DATABASE_SCHEMA.md` · `docs/API_SPECIFICATION.md`
- `docs/PERMISSION_MATRIX.md` · `docs/DESIGN_SYSTEM.md` · `docs/ADMIN_CONTROL_CENTER.md`
- `docs/CONFIGURATION_MANAGEMENT.md` · `docs/DEPLOYMENT_RUNBOOK.md` · `docs/SECURITY.md`
- `docs/BACKUP_RECOVERY.md` · `docs/TEST_PLAN.md` · `docs/DEVELOPMENT_ROADMAP.md` · `docs/CHANGELOG.md`

---

## Development Commands

### CRM Web App (Preserved)
```bash
npm run dev                  # CRM dev server (Supabase mode, port 5173)
npm run dev:demo             # CRM evaluation mode (FakeRest + IndexedDB, port 5174)
npm run build                # Build CRM production bundle (tsc + vite build -> dist/)
npm run build:demo           # Build CRM demo bundle
```

### Independent Admin Control Center
```bash
npm run dev:admin            # Admin Control Center dev server (port 5179)
npm run build:admin          # Independent production build (-> dist-admin/)
```

### Code Quality, Type Checks & Automated Tests
```bash
npm run typecheck            # Typecheck CRM app (tsconfig.app.json)
npm run typecheck:enterprise # Typecheck packages/*, apps/* (tsconfig.enterprise.json)
npm run lint                 # ESLint across CRM, Admin, API, MCP, Worker, Packages
npm run test:db              # PGlite real PostgreSQL schema, RLS, security, workflow & MCP DB tests
npm run test:unit:functions -- --run   # Supabase Edge Function tests (incl. SEC-04 MCP security test)
npm run test:enterprise      # Shared packages, REST/Integration API, Remote MCP Server & Worker tests
npm run ddc:export-reference-data      # Regenerate src/ddc/demo/referenceData.json after seed changes
```

---

## Mandatory Security, API & MCP Engineering Rules

1. **Preserve Existing Functionality & Data**: Never delete or overwrite production data. Follow expand-and-contract backward-compatible migrations.
2. **Server-Side Enforcement & Deny-by-Default**: Every table in `public` MUST enable RLS and declare explicit policies (`schema.test.ts` enforces this) with zero `anon` grants on operational or MCP governance tables. Disabled accounts (`sales.disabled = true`) MUST be denied at PostgreSQL, REST API, Integration API, Worker, and MCP layers.
3. **Zero Unrestricted SQL, Shell, or Arbitrary Code Tools**: Never expose `execute_sql`, `query`, `mutate`, `get_schema`, `execute_shell`, `unrestricted_http_request`, or `unrestricted_admin_action`. All dynamic queries MUST pass through the allowlisted AST validator (`packages/shared-api/src/queryBuilder.ts`). Never allow Admin users to upload or execute arbitrary tool code through the UI; new MCP tools must be implemented, reviewed, tested, and registered in `apps/mcp/src/toolRegistry.ts`.
4. **OAuth 2.1 User-Delegated MCP Auth (Never Shared Admin Keys)**: Every MCP request must verify OAuth 2.1 Bearer JWT signature/JWKS, issuer, audience/RFC 8707 resource, expiration, revocation (`oauth_grants` & `mcp_connections`), client status, and active CRM user. Never trust `user_id`, `role`, `organization_id`, `administrator`, or `permissions` supplied inside MCP tool arguments.
5. **8-Layer Authorization Intersection & Explicit DENY Precedence**: Effective MCP access is strictly the intersection of active user/org, org policy, OAuth scopes, MCP channel policy, authoritative CRM RBAC, tool status/overrides, record/field scopes, and L0–L5 execution policies. Explicit `deny` always overrides `allow`. MCP policies MUST NEVER elevate a user above their authoritative CRM RBAC permissions.
6. **Dynamic Permission Revocation & Worker Revalidation**: Policy mutations bump `organizations.policy_version`, invalidate `AuthorizationPolicyCache`, and notify open MCP streams (`tools/list_changed`). Every tool execution re-checks live permissions; queued/scheduled jobs revalidate permissions at worker execution time.
7. **L3–L5 Confirmation, Approval Binding & Anti-Self-Approval**: L3 operations require preview + payload-bound confirmation tokens. L4–L5 operations require independent human approval bound to canonical SHA-256 payload hash, requester, target version, and expiration, backed by PostgreSQL constraint `mcp_approval_no_self_decision`.
8. **Zero Fabricated Data or Unverified Claims**: Never return fabricated success responses for unimplemented functionality or fake Admin dashboard telemetry. AI workflows must never invent missing customer names, prices, or machine serial numbers. Always distinguish verified vs unverified AI client integrations.
9. **Secrets, PDPA & Channel-Attributed Audit Hygiene**: Never store secrets/tokens in client bundles (`VITE_*`), DB config tables, or logs. Apply `role_field_permissions` masking/hiding consistently across REST API, MCP, and exports. Record `channel` (`web`, `rest_api`, `mcp`, `integration_api`, `worker`), `ai_client_id`, `mcp_tool_name`, `approval_request_id`, and `request_id` on mutations.
10. **Timezone, Reference Data Parity & Dependency Hygiene**: Store UTC (`timestamptz`), display `Asia/Bangkok`. Update `src/ddc/domain/defaultPermissions.ts` and run `npm run ddc:export-reference-data` whenever migrations modify reference/permission seeds. Never bypass `.npmrc` (`min-release-age`). Never execute production deployments or destructive DB operations without explicit human approval.

---

## Path Aliases

- `@/*` → `src/*` (CRM app)
- `@ddc/shared-auth` → `packages/shared-auth/src/index.ts`
- `@ddc/shared-services` → `packages/shared-services/src/index.ts`
- `@ddc/shared-config` → `packages/shared-config/src/index.ts`
- `@ddc/shared-api` → `packages/shared-api/src/index.ts`
- `@ddc/shared-ui` → `packages/shared-ui/src/index.ts`
