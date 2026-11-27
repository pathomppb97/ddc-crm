# DDC Agriculture CRM — Centralized MCP Tool Registry

> **Source of Truth**: `apps/mcp/src/toolRegistry.ts` (server-side allowlist — **71 registered operational tools across 13 business domains**)  
> **Database Mirror**: `public.mcp_tools` (synchronized via `mcpApp.syncRegistry()` for dynamic Admin enable/disable, rate-limit tuning, and telemetry)

---

## 1. Registry Governance Rules

1. **Strict Server-Side Allowlist**: Every tool must be authored in TypeScript, schema-validated with strict Zod (`z.object(...).strict()`), peer-reviewed, tested, and registered in `MCP_TOOL_REGISTRY`.
2. **No Dynamic Arbitrary Code**: Administrators can enable/disable existing registered tools, tune rate limits, tighten execution policies, and configure role overrides through the Admin Control Center — they can **never** upload or execute arbitrary SQL, shell scripts, HTTP requests, or JavaScript through the UI.
3. **Forbidden Generic Tools**: `execute_sql`, `query`, `mutate`, `get_schema`, `execute_shell`, `unrestricted_http_request`, and `unrestricted_admin_action` are permanently banned and trigger `critical` `privilege_escalation` security events if invoked.
4. **Metadata Completeness**: Every tool declares all 22 governance fields: `toolId`, `toolName`, `displayName`, `description`, `domain`, `inputSchema` (JSON Schema), `outputSchema`, `requiredPermissions`, `requiredOAuthScopes`, `supportedDataScopes`, `fieldRestrictions`, `riskLevel`, `executionPolicy`, `requiresConfirmation`, `requiresApproval`, `rateLimitPerMin`, `timeoutMs`, `requiresIdempotency`, `toolVersion`, `isEnabled`, `auditPolicy`, and `handlerRef`.

---

## 2. Complete Tool Catalog (71 Operational Tools across 13 Domains)

### Domain 1 — Identity (3 tools)
| Tool Name | Risk | Policy | Required CRM Permissions | OAuth Scope | Idempotent |
|---|---|---|---|---|---|
| `get_my_profile` | L0 | `direct` | Authenticated active user | `mcp:read` | Read |
| `get_my_capabilities` | L0 | `direct` | Authenticated active user | `mcp:read` | Read |
| `get_my_data_scope` | L0 | `direct` | Authenticated active user | `mcp:read` | Read |

### Domain 2 — Customer Management (6 tools)
| Tool Name | Risk | Policy | Required CRM Permissions | OAuth Scope | Idempotent |
|---|---|---|---|---|---|
| `search_customers` | L0 | `direct` | `customers:read` | `mcp:read` | Read |
| `get_customer` | L0 | `direct` | `customers:read` | `mcp:read` | Read |
| `create_customer` | L1 | `direct` | `customers:create` | `mcp:write` | Yes (`idempotency_key`) |
| `update_customer` | L2 | `direct` | `customers:update` | `mcp:write` | Optimistic `expected_version` |
| `create_customer_contact` | L1 | `direct` | `contacts:create` | `mcp:write` | Standard |
| `get_customer_history` | L0 | `direct` | `customers:read` | `mcp:read` | Read |

### Domain 3 — Agriculture Equipment (7 tools)
| Tool Name | Risk | Policy | Required CRM Permissions | OAuth Scope | Idempotent |
|---|---|---|---|---|---|
| `search_machines` | L0 | `direct` | `machine_applications:read` | `mcp:read` | Read |
| `get_machine` | L0 | `direct` | `customers:read` | `mcp:read` | Read |
| `register_machine` | L1 | `direct` | `customers:create` | `mcp:write` | Standard |
| `update_machine` | L2 | `direct` | `customers:update` | `mcp:write` | Optimistic `expected_version` |
| `get_customer_machines` | L0 | `direct` | `customers:read` | `mcp:read` | Read |
| `get_machine_summary` | L0 | `direct` | `customers:read` | `mcp:read` | Read |
| `get_machine_service_history` | L0 | `direct` | `service_cases:read` | `mcp:read` | Read |

### Domain 4 — Product Management (5 tools)
| Tool Name | Risk | Policy | Required CRM Permissions | OAuth Scope | Idempotent |
|---|---|---|---|---|---|
| `search_products` | L0 | `direct` | `products:read` | `mcp:read` | Read |
| `get_product` | L0 | `direct` | `products:read` | `mcp:read` | Read |
| `find_compatible_parts` | L0 | `direct` | `machine_applications:read`, `products:read` | `mcp:read` | Read |
| `get_product_price` | L0 | `direct` | `products:read` | `mcp:read` | Read |
| `get_inventory_availability` | L0 | `direct` | `erp_documents:read` | `mcp:read` | Read |

### Domain 5 — Sales Management (6 tools)
| Tool Name | Risk | Policy | Required CRM Permissions | OAuth Scope | Idempotent |
|---|---|---|---|---|---|
| `search_opportunities` | L0 | `direct` | `opportunities:read` | `mcp:read` | Read |
| `create_opportunity` | L1 | `direct` | `opportunities:create` | `mcp:write` | Yes (`idempotency_key`) |
| `update_opportunity` | L2 | `direct` | `opportunities:update` | `mcp:write` | Optimistic `expected_version` |
| `get_sales_pipeline` | L0 | `direct` | `opportunities:read` | `mcp:read` | Read |
| `get_sales_target` | L0 | `direct` | `reports:read` | `mcp:read` | Read |
| `get_sales_forecast` | L0 | `direct` | `reports:read` | `mcp:read` | Read |

### Domain 6 — Customer Activities (5 tools)
| Tool Name | Risk | Policy | Required CRM Permissions | OAuth Scope | Idempotent |
|---|---|---|---|---|---|
| `create_visit_report` | L1 | `direct` | `activities:create` | `mcp:write` | Standard |
| `get_visit_history` | L0 | `direct` | `activities:read` | `mcp:read` | Read |
| `create_follow_up` | L1 | `direct` | `activities:create` | `mcp:write` | Standard |
| `schedule_follow_up` | L2 | `direct` | `activities:update` | `mcp:write` | Standard |
| `complete_follow_up` | L2 | `direct` | `activities:update` | `mcp:write` | Standard |

### Domain 7 — Quotation (4 tools)
| Tool Name | Risk | Policy | Required CRM Permissions | OAuth Scope | Idempotent |
|---|---|---|---|---|---|
| `create_quotation` | L1 | `direct` | `quotations:create` | `mcp:write` | Yes (`idempotency_key`) |
| `update_quotation_draft` | L2 | `direct` | `quotations:update` | `mcp:write` | Optimistic `expected_version` |
| `get_quotation` | L0 | `direct` | `quotations:read` | `mcp:read` | Read |
| `submit_quotation_for_approval` | L2 | `direct` | `quotations:update` | `mcp:write` | Workflow-guarded |

### Domain 8 — Data Management (6 tools)
| Tool Name | Risk | Policy | Required CRM Permissions | OAuth Scope | Idempotent |
|---|---|---|---|---|---|
| `validate_import` | L0 | `direct` | `customers:import` | `mcp:write` | Read + issues confirmation token |
| `preview_bulk_update` | L0 | `direct` | `data_management:read` | `mcp:write` | Read + issues confirmation token |
| `execute_approved_import` | L3 | `confirm` | `customers:import` | `mcp:write` | Yes (`idempotency_key` + `confirmation_token`) |
| `execute_approved_bulk_update` | L3 | `confirm` | `data_management:update` | `mcp:write` | Yes (`idempotency_key` + `confirmation_token`) |
| `generate_export` | L3 | `confirm` | `customers:export` | `mcp:export` | Yes (`idempotency_key` + `confirmation_token` for >50 rows) |
| `get_job_status` | L0 | `direct` | Own job or `jobs:read` | `mcp:read` | Read *(also serves Domain 13)* |

### Domain 9 — Analytics & Reporting (6 tools)
| Tool Name | Risk | Policy | Required CRM Permissions | OAuth Scope | Idempotent |
|---|---|---|---|---|---|
| `query_customer_summary` | L0 | `direct` | `reports:read`, `customers:read` | `mcp:read` | Read |
| `query_machine_summary` | L0 | `direct` | `reports:read`, `customers:read` | `mcp:read` | Read |
| `query_sales_summary` | L0 | `direct` | `reports:read`, `opportunities:read` | `mcp:read` | Read |
| `query_replacement_demand` | L0 | `direct` | `reports:read`, `customers:read` | `mcp:read` | Read |
| `generate_report` | L1 | `direct` | `reports:read` | `mcp:read` | Snapshot creation |
| `get_saved_report` | L0 | `direct` | `reports:read` | `mcp:read` | Read |

### Domain 10 — Administration (7 tools)
| Tool Name | Risk | Policy | Required CRM Permissions | OAuth Scope | Idempotent |
|---|---|---|---|---|---|
| `get_users` | L0 | `direct` | `users:read` | `mcp:admin` | Read |
| `invite_user` | L4 | `approve` | `users:create` | `mcp:admin` | Approval-bound |
| `update_user_status` | L4 | `approve` | `users:update` | `mcp:admin` | Approval-bound (no self-mod) |
| `get_roles` | L0 | `direct` | `roles:read` | `mcp:admin` | Read |
| `get_permissions` | L0 | `direct` | `roles:read` | `mcp:admin` | Read |
| `request_permission_change` | L4 | `approve` | `roles:update` | `mcp:admin` | Creates pending L4 request only |
| `get_audit_history` | L0 | `direct` | `audit_log:read` | `mcp:admin` | Read |

### Domain 11 — Web Design & Configuration (7 tools)
| Tool Name | Risk | Policy | Required CRM Permissions | OAuth Scope | Idempotent |
|---|---|---|---|---|---|
| `get_active_configuration` | L0 | `direct` | `ui_config:read` | `mcp:config` | Read |
| `create_theme_draft` | L1 | `direct` | `ui_config:create` | `mcp:config` | Anti-XSS validated |
| `update_configuration_draft` | L2 | `direct` | `ui_config:update` | `mcp:config` | Anti-XSS validated |
| `validate_configuration` | L0 | `direct` | `ui_config:read` | `mcp:config` | Read |
| `preview_configuration` | L0 | `direct` | `ui_config:read` | `mcp:config` | Read |
| `request_configuration_publish` | L4 | `approve` | `ui_config:update` | `mcp:config` | Creates L4/L5 approval request |
| `schedule_configuration_publish` | L4 | `approve` | `ui_config:update` | `mcp:config` | Creates L4/L5 approval request |

### Domain 12 — Release Management (6 tools)
| Tool Name | Risk | Policy | Required CRM Permissions | OAuth Scope | Idempotent |
|---|---|---|---|---|---|
| `get_release_status` | L0 | `direct` | `releases:read` | `mcp:release` | Read |
| `get_deployment_history` | L0 | `direct` | `deployments:read` | `mcp:release` | Read |
| `get_available_releases` | L0 | `direct` | `releases:read` | `mcp:release` | Read |
| `request_deployment` | L5 | `privileged_approve` | `deployments:create` | `mcp:release` | Creates L5 approval request |
| `schedule_deployment` | L5 | `privileged_approve` | `deployments:create` | `mcp:release` | Creates L5 approval request |
| `request_rollback` | L5 | `privileged_approve` | `deployments:update` | `mcp:release` | Creates L5 approval request |

### Domain 13 — Automation (3 unique tools + shared `get_job_status`)
| Tool Name | Risk | Policy | Required CRM Permissions | OAuth Scope | Idempotent |
|---|---|---|---|---|---|
| `create_automation_job` | L2 | `direct` | `jobs:create` | `mcp:automation` | Yes (`idempotency_key`) |
| `get_automation_jobs` | L0 | `direct` | Own or `jobs:read` | `mcp:read` | Read |
| `cancel_authorized_job` | L2 | `direct` | Own or `jobs:update` | `mcp:automation` | Standard |
| *(shared)* `get_job_status` | L0 | `direct` | Own or `jobs:read` | `mcp:read` | Read |
