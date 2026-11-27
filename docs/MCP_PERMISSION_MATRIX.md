# DDC Agriculture CRM — Centralized Authorization & MCP Permission Matrix

> **Implementation**: `packages/shared-auth/src/policyEngine.ts`, `packages/shared-auth/src/rbac.ts`, `supabase/migrations/20261127150000_ddc_mcp_platform.sql`, `src/ddc/domain/defaultPermissions.ts`

---

## 1. Eight-Layer Authorization Intersection Model

Effective MCP permissions are computed by `evaluateMcpToolAuthorization()` as the **strict intersection** of 8 layers — **explicit DENY always wins, and MCP can never elevate a user above their authoritative CRM permissions**:

1. **Identity & Organization Isolation**: Active `sales` row (`disabled = false`), active `organizations` row, and strict `principal.organizationId === bundle.organization.id` match.
2. **Organization MCP Policy**: `organizations.mcp_enabled = true` (global kill switch).
3. **OAuth Scopes & AI Client Policy**: Token scopes ∩ `mcp_clients.allowed_scopes` ∩ `mcp_role_policies.allowed_oauth_scopes`, plus active client status and optional role/user client allowlists.
4. **MCP Channel Policy**: CRM grant `mcp_access:read`, `mcp_role_policies.mcp_enabled`, `mcp_user_policies.mcp_enabled`, and user `denied_tools`.
5. **Authoritative CRM RBAC**: Every `(resource, action)` in `tool.requiredPermissions` must pass `evaluateAccess()` against `public.role_permissions`.
6. **Tool Registry & Overrides**: `mcp_tools.is_enabled = true` and no `effect = 'deny'` row in `mcp_tool_permissions`.
7. **Data Scope & Field-Level Restrictions**: Narrowest record scope (`own < team < territory < all`) intersected across CRM RBAC, role default, and tool override; strictest PDPA field visibility (`hidden > masked > read > write`) applied on reads and write allowlists (`enforceWriteFieldAllowlist`).
8. **Risk Ceiling & Execution Policy**: `tool.riskLevel <= rolePolicy.maxRiskLevel`; strictest execution policy (`direct < confirm < approve < privileged_approve`) and lowest rate limit across tool, role, user, and client.

---

## 2. Default Enterprise Role × MCP Policy Matrix (13 Seeded Roles)

Seeded in `public.mcp_role_policies` and `public.role_permissions`:

| Role Key | MCP Enabled | Max Risk | Approval From | Default Scope | Rate Limit (/min) | Allowed OAuth Scopes | MCP Governance Grants |
|---|---|---|---|---|---|---|---|
| `super_admin` | Yes | `L5` | `L4` | `all` | 120 | `read`, `write`, `export`, `admin`, `config`, `release`, `automation` | `mcp_access:read`, `mcp_admin:*`, `mcp_approvals:read/approve` |
| `system_admin` | Yes | `L4` | `L4` | `all` | 90 | `read`, `write`, `export`, `admin`, `config`, `automation` | `mcp_access:read`, `mcp_admin:*`, `mcp_approvals:read/approve` |
| `admin` | Yes | `L4` | `L4` | `all` | 90 | `read`, `write`, `export`, `admin`, `config`, `automation` | `mcp_access:read`, `mcp_admin:read/create/update`, `mcp_approvals:read/approve` |
| `release_manager` | Yes | `L5` | `L4` | `all` | 60 | `read`, `config`, `release` | `mcp_access:read`, `mcp_approvals:read/approve` |
| `data_admin` | Yes | `L3` | `L3` | `all` | 60 | `read`, `write`, `export`, `automation` | `mcp_access:read`, `mcp_approvals:read` |
| `sales_manager` | Yes | `L3` | `L3` | `all` | 60 | `read`, `write`, `export` | `mcp_access:read`, `mcp_approvals:read/approve` |
| `sales_rep` | Yes | `L2` | `L3` | `own` | 45 | `read`, `write` | `mcp_access:read` |
| `technical_engineering` | Yes | `L2` | `L3` | `all` | 45 | `read`, `write` | `mcp_access:read` |
| `aftermarket_service` | Yes | `L2` | `L3` | `all` | 45 | `read`, `write` | `mcp_access:read` |
| `marketing` | Yes | `L1` | `L3` | `all` | 45 | `read`, `write` | `mcp_access:read` |
| `erp_finance` | Yes | `L0` | `L3` | `all` | 30 | `read` | `mcp_access:read` |
| `executive_viewer` | Yes | `L0` | `L3` | `all` | 30 | `read` | `mcp_access:read` |
| `read_only` | Yes | `L0` | `L3` | `all` | 30 | `read` | `mcp_access:read` |

---

## 3. Domain Visibility by Typical Persona

| Persona | Visible Domains | Explicitly Blocked / Hidden |
|---|---|---|
| `sales_rep` | Identity, Customers (create / read / update own), Equipment (register / read / update own), Products (search / verified fitment / price), Sales (own pipeline / create & update own deals), Activities, Quotations (draft & submit), Reports (read) | Admin tools (`get_users`, `update_user_status`), Web Design, Release Management, Bulk Export (`generate_export`), ERP Inventory (unless granted), any L3–L5 tools |
| `sales_manager` | All `sales_rep` domains with `all` scope + Team analytics, reports, and approved exports (`mcp:export`) | Admin user/role management, Web Design publish, Release deployments |
| `read_only` / `executive_viewer` | L0 read-only queries & analytics only | Every mutating tool (L1–L5) and every mutating MCP Prompt (`customer_visit_report`, `customer_data_entry`, etc.) |
| `system_admin` | Operational + Admin + Web Design + MCP Governance (L4 actions require independent human approval) | L5 production deployments/rollbacks (`super_admin` or `release_manager`), self-approval, assigning `super_admin` |
| `super_admin` | All 13 domains (L4 & L5 actions still require independent second-person human approval — DB constraint enforces zero self-approval) | Cross-organization data (isolated by RLS + Policy Engine), generic SQL/shell tools |

---

## 4. Anti-Escalation & Dynamic Revocation Guarantees

- **No Self-Escalation**: `assertDelegationAllowed()` prevents any administrator from modifying their own role/status, granting `administrator = true` or `super_admin` without `super_admin` authority, or delegating any permission they do not hold.
- **Immediate Effect Without Redeployment**: Updating any table (`organizations`, `mcp_tools`, `mcp_role_policies`, `mcp_tool_permissions`, `mcp_user_policies`, `mcp_clients`, `mcp_connections`, `oauth_grants`) calls `public.ddc_bump_policy_version(org_id)`, clears `AuthorizationPolicyCache`, and notifies open MCP streams via `tools/list_changed`.
- **Execution-Time Worker Revalidation**: Queued/scheduled jobs carry `requested_by_user_id`, `organization_id`, and `required_permission_resource/action`. `apps/worker/src/permissionRevalidator.ts` re-evaluates live PostgreSQL permissions immediately before executing each job and permanently fails the job if the requester was suspended or lost the permission.
