# DDC Agriculture CRM — Enterprise API Reference

> **Machine-Readable Contract**: [`docs/openapi/v1.openapi.yaml`](./openapi/v1.openapi.yaml)  
> **Router Implementation**: `apps/api/src/platformRouter.ts`  
> **Timezone Standard**: All timestamps stored and transmitted in UTC ISO-8601; display timezone metadata reports `Asia/Bangkok`.

---

## 1. Authentication & Standard Headers

### Headers
| Header | Required | Description |
|---|---|---|
| `Authorization` | Required on `/api/v1/*`, `/admin/v1/*` | `Bearer <OAuth 2.1 / Supabase JWT>` |
| `X-Api-Key` | Supported on `/integrations/v1/*` | Scoped Service Account API key (verified via SHA-256 hash in `public.api_keys`) |
| `X-Request-Id` | Optional | Caller trace ID (`[A-Za-z0-9._-]{8,128}`); minted server-side if omitted |
| `Idempotency-Key` | Recommended on `POST` creates & jobs | Prevents duplicate writes on retries (4–128 chars) |
| `If-Match` | Recommended on `PATCH` updates | Expected integer `version` for optimistic concurrency control |
| `X-Audit-Reason` | Recommended on admin mutations | Business justification persisted into `audit_log.reason` |

### Standard Success Envelope
```json
{
  "data": { "id": 1042, "name": "Sukhothai Sugar Mill" },
  "meta": { "page": 1, "pageSize": 25, "total": 1, "totalPages": 1, "timezone": "Asia/Bangkok" },
  "requestId": "req_8f21b9d8c0a14e2e9a4c5b22e3d84110"
}
```

### Standard Error Envelope
```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "Record was modified concurrently; refresh and retry with latest version",
    "details": { "expectedVersion": 1, "currentVersion": 2 },
    "retryable": false,
    "remediation": "Reload the latest record version and retry your update.",
    "requestId": "req_8f21b9d8c0a14e2e9a4c5b22e3d84110"
  }
}
```

---

## 2. Business CRM API (`/api/v1/*`)

### Identity & Dynamic Query
| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/v1/health` | Public | Liveness, version, supported namespaces, MCP protocol version (`2025-11-25`) |
| `GET` | `/api/v1/me` | Authenticated | Caller profile, role, organization, effective CRM permissions, admin console flag |
| `GET` | `/api/v1/data-scope` | Authenticated | Organization boundary, team/territory IDs, field restrictions |
| `POST` | `/api/v1/query` | `{resource}:read` | Allowlisted Dynamic Query Builder (filters, sort, field selection, pagination; zero raw SQL) |
| `GET` | `/api/v1/saved-queries` | Authenticated | List shared and caller-owned saved structured queries |
| `POST` | `/api/v1/saved-queries` | Authenticated | Persist a structured query definition |

### Customer Management
| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/v1/customers` | `customers:read` | Search customers (`q`, `province`, `customer_group`, `fields`, `page`, `pageSize`) with PDPA field masking |
| `POST` | `/api/v1/customers` | `customers:create` | Create customer with duplicate check (`name`+`province`) and `Idempotency-Key` |
| `GET` | `/api/v1/customers/:id` | `customers:read` | Get customer profile, contacts, and untrusted-data wrapper on free-text notes |
| `PATCH` | `/api/v1/customers/:id` | `customers:update` | Update allowlisted fields with `If-Match` / `expected_version` and write-field restriction guard |
| `POST` | `/api/v1/customers/:id/contacts` | `contacts:create` | Add contact person (supports Thai `nickname` and `line_id`) |
| `GET` | `/api/v1/customers/:id/history` | `customers:read` | Chronological visits, opportunities, quotations, and service cases |
| `GET` | `/api/v1/customers/:id/machines` | `customers:read` | List agricultural machines registered to the customer |

### Agriculture Equipment & Products
| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/v1/machines` | `machine_applications:read` | Search machine models (`q`, `manufacturer`, `company_id`) |
| `POST` | `/api/v1/machines` | `customers:create` | Register a customer-owned agricultural machine |
| `GET` | `/api/v1/machines/summary` | `customers:read` | Fleet summary grouped by status and model |
| `GET` | `/api/v1/machines/:id` | `customers:read` | Registered machine detail |
| `PATCH` | `/api/v1/machines/:id` | `customers:update` | Update operating hours, status, or notes (`If-Match`) |
| `GET` | `/api/v1/machines/:id/service-history` | `service_cases:read` | Service cases and field visits linked to a machine |
| `GET` | `/api/v1/products` | `products:read` | Search DDC agricultural spare parts (`q`, `material`) |
| `GET` | `/api/v1/products/compatible-parts` | `machine_applications:read` + `products:read` | Compatible wear parts for a machine model (defaults to `verified_only=true`) |
| `GET` | `/api/v1/products/:id` | `products:read` | Product specifications |
| `GET` | `/api/v1/products/:id/price` | `products:read` | Official CRM price list lookup (`quantity`, `currency`) |
| `GET` | `/api/v1/products/:id/inventory` | `erp_documents:read` | Synchronized ERP warehouse stock availability |

### Sales, Activities & Quotations
| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/v1/opportunities` | `opportunities:read` | Search sales opportunities (`q`, `stage`, `company_id`) |
| `POST` | `/api/v1/opportunities` | `opportunities:create` | Create opportunity (`Idempotency-Key`) |
| `PATCH` | `/api/v1/opportunities/:id` | `opportunities:update` | Update stage/amount/probability/follow-up (`If-Match`) |
| `GET` | `/api/v1/sales/pipeline` | `opportunities:read` | Aggregated pipeline counts and estimated amounts by stage |
| `GET` | `/api/v1/sales/targets` | `reports:read` | Configured sales targets |
| `GET` | `/api/v1/sales/forecasts` | `reports:read` | Sales forecast snapshots |
| `GET` | `/api/v1/visits` | `activities:read` | Customer visit history |
| `POST` | `/api/v1/visits` | `activities:create` | Record field sales visit report (discussion, outcome, GPS, follow-up date) |
| `POST` | `/api/v1/follow-ups` | `activities:create` | Create follow-up action item |
| `POST` | `/api/v1/follow-ups/:id/complete` | `activities:update` | Complete follow-up action item |
| `POST` | `/api/v1/quotations` | `quotations:create` | Create draft quotation with line items (`Idempotency-Key`) |
| `GET` | `/api/v1/quotations/:id` | `quotations:read` | Get quotation, items, and approval history |
| `PATCH` | `/api/v1/quotations/:id` | `quotations:update` | Update draft quotation (`If-Match`) |
| `POST` | `/api/v1/quotations/:id/submit` | `quotations:update` | Submit quotation into DB-enforced approval workflow |

### Analytics, Data Management & Background Jobs
| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/v1/analytics/customers` | `reports:read` + `customers:read` | Customer totals by customer group & province |
| `GET` | `/api/v1/analytics/machines` | `reports:read` + `customers:read` | Fleet counts by manufacturer & model |
| `GET` | `/api/v1/analytics/sales` | `reports:read` + `opportunities:read` | Opportunities by stage & quotations by status |
| `GET` | `/api/v1/analytics/replacement-demand` | `reports:read` + `customers:read` | Seasonal agricultural wear-part demand |
| `POST` | `/api/v1/reports` | `reports:read` | Generate & save structured report snapshot (`saved_reports`) |
| `GET` | `/api/v1/reports/:id` | `reports:read` | Retrieve saved report |
| `POST` | `/api/v1/data/imports/validate` | `customers:import` | Validate bulk import rows & return confirmation token |
| `POST` | `/api/v1/data/bulk-updates/preview` | `data_management:read` | Preview before/after diffs & issue confirmation token |
| `POST` | `/api/v1/data/exports` | `customers:export` | Queue field-masked export job (confirmation required when `max_rows > 50`) |
| `GET` / `POST` | `/api/v1/jobs` | Own / `jobs:create` | List or enqueue automation jobs (permissions revalidated by worker) |
| `GET` | `/api/v1/jobs/:id` | Own / `jobs:read` | Poll durable job status & sanitized output |
| `POST` | `/api/v1/jobs/:id/cancel` | Own / `jobs:update` | Cancel pending or scheduled job |

---

## 3. External Integration API (`/integrations/v1/*`)

Accepts `X-Api-Key: <service_account_key>` (hashed lookup against `public.api_keys` + active `service_accounts` check) or Bearer JWT:

| Method | Path | Permission |
|---|---|---|
| `GET` | `/integrations/v1/health` | Public |
| `GET` | `/integrations/v1/customers` | `customers:read` |
| `POST` | `/integrations/v1/customers` | `customers:create` |
| `GET` | `/integrations/v1/products` | `products:read` |
| `GET` | `/integrations/v1/products/:id/inventory` | `erp_documents:read` |
| `GET` | `/integrations/v1/jobs/:id` | `jobs:read` or creator |

---

## 4. Admin Control Plane & MCP Governance API (`/admin/v1/*`)

All `/admin/v1/*` routes enforce `hasAdminConsoleAccess(principal)` in addition to per-endpoint RBAC checks:

| Method | Path | Permission | Purpose |
|---|---|---|---|
| `GET` | `/admin/v1/overview` | `admin_console:read` | System overview + live MCP overview |
| `GET` | `/admin/v1/users` | `users:read` | Organization user directory |
| `GET` | `/admin/v1/roles` | `roles:read` | Enterprise + custom role list |
| `GET` | `/admin/v1/permissions` | `roles:read` | Role permission grants |
| `GET` | `/admin/v1/audit-logs` | `audit_log:read` | Channel-attributed immutable audit log (`?table=&channel=`) |
| `POST` | `/admin/v1/query/execute` | `data_management:read` | Admin allowlisted Dynamic Query Builder |
| `GET` | `/admin/v1/mcp/overview` | `mcp_admin:read` | Real PostgreSQL MCP telemetry (tools, connections, volume, errors, latency) |
| `PUT` | `/admin/v1/mcp/organization-policy` | `mcp_admin:update` | Organization-wide MCP kill switch (`mcpEnabled`) |
| `GET` | `/admin/v1/mcp/tools` | `mcp_admin:read` | Tool Registry metadata + 24h usage stats |
| `PATCH` | `/admin/v1/mcp/tools/:toolName` | `mcp_admin:update` | Enable/disable tool, rate limit, or execution policy |
| `PUT` | `/admin/v1/mcp/roles/:roleKey/policy` | `mcp_admin:update` | Role MCP enablement, max risk level, OAuth scopes, rate limit |
| `PUT` | `/admin/v1/mcp/roles/:roleKey/tools/:toolName` | `mcp_admin:update` | Explicit ALLOW/DENY override, scope, field restrictions |
| `GET` | `/admin/v1/mcp/roles/:roleKey/preview` | `mcp_admin:read` | 8-layer effective tool preview for a role |
| `GET` | `/admin/v1/mcp/users` | `mcp_admin:read` | Per-user MCP status, active connections, last activity |
| `PUT` | `/admin/v1/mcp/users/:salesId/policy` | `mcp_admin:update` | Per-user MCP toggle, denied tools, rate limit override |
| `POST` | `/admin/v1/mcp/users/:salesId/revoke` | `mcp_admin:update` | Immediately revoke all OAuth grants & MCP connections for user |
| `GET` / `POST` | `/admin/v1/mcp/clients` | `mcp_admin:read` / `create` | List or register OAuth 2.1 AI clients (strict HTTPS/loopback redirect URIs) |
| `POST` | `/admin/v1/mcp/clients/:clientId/revoke` | `mcp_admin:update` | Revoke client and terminate its active connections |
| `GET` | `/admin/v1/mcp/connections` | `mcp_admin:read` | Active & historical MCP connections |
| `POST` | `/admin/v1/mcp/connections/:uuid/revoke` | `mcp_admin:update` | Immediately revoke individual MCP connection |
| `GET` | `/admin/v1/mcp/approvals` | `mcp_approvals:read` | List pending/decided L3–L5 approval requests |
| `POST` | `/admin/v1/mcp/approvals/:id/approve` | `mcp_approvals:approve` | Independent human approval (DB blocks self-approval) |
| `POST` | `/admin/v1/mcp/approvals/:id/reject` | `mcp_approvals:approve` | Reject pending approval request |
| `GET` | `/admin/v1/mcp/logs` | `mcp_admin:read` | Query immutable `mcp_execution_logs` (`?tool=&result=`) |
| `GET` | `/admin/v1/mcp/security-events` | `mcp_admin:read` | Query immutable `mcp_security_events` (`?severity=&type=`) |
