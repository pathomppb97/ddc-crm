# DDC Agriculture CRM — Permission Matrix & Authorization Specification

> **Enforcement Policy**: Server-side only (PostgreSQL RLS + API Gateway). **Deny-by-default** and **Least Privilege**. Feature flags NEVER replace server-side authorization.

---

## 1. Role Catalog

### 1.1 Enterprise Control Plane Roles (Added in Phase 1)
| Role Key | Display Name | Scope & Purpose |
|---|---|---|
| `super_admin` | Super Admin (ผู้ดูแลระบบสูงสุด) | Unrestricted platform & break-glass governance; manages admins, roles, security policies, production releases, backups |
| `system_admin` | System Admin (ผู้ดูแลระบบ) | System configuration, users, roles, UI config, feature flags, jobs, integrations, settings (cannot tamper with append-only audit logs) |
| `release_manager` | Release Manager (ผู้จัดการการปล่อยระบบ) | Manages releases, staging/production deployment approvals, deployment schedules, rollbacks, and runtime feature flags; no CRM PII write access |
| `data_admin` | Data Admin (ผู้ดูแลข้อมูล) | Master data governance, bulk imports/exports, query builder, backup verification, data quality/deduplication; no deployment or role-escalation rights |
| `executive_viewer` | Executive Viewer (ผู้บริหารดูรายงาน) | Read-only access to dashboards, KPIs, forecasts, targets, quotations, and executive exports; zero write rights |

### 1.2 Operational CRM Roles (Existing, Preserved)
| Role Key | Display Name | Purpose |
|---|---|---|
| `management` | Management (ผู้บริหาร) | Full business read, report exports, commercial quotation approval |
| `sales_manager` | Sales Manager (ผู้จัดการฝ่ายขาย) | Manages all sales records, approves quotations, manages team targets/forecasts, imports/exports sales data |
| `sales_rep` | Sales Staff / Representative (พนักงานขาย) | Reads catalog & accounts, creates records, updates/deletes `own` records (and team/territory scoped records when configured) |
| `marketing` | Marketing (การตลาด) | Leads, campaigns/activities, aftermarket network, lead imports |
| `engineering` | Engineering (วิศวกรรม) | Products, machine models/specifications, verified machine applications, RFQ technical review, OEM/ODM projects |
| `quality` | Quality (คุณภาพ) | Customer complaints & service cases, 8D/NCR/CAPA tracking |
| `finance` | Finance (การเงิน) | Commercial read, quotation approval, ERP documents & read-only ERP integration audit |
| `read_only` | Read-Only (อ่านอย่างเดียว) | Read-only business visibility |
| *(Custom Roles)* | Admin-defined (`is_system = false`) | Created via Admin Control Center → Role Management; starts with zero permissions (deny-by-default) |

---

## 2. Permission Resources & Actions

**Actions**: `read`, `create`, `update`, `delete`, `approve`, `export`, `import`
**Data Scopes**:
- `own`: Records where `sales_id = current_sales_id()`
- `team`: Records owned by any member of the user's `teams` (Phase 3 enforcement)
- `territory`: Records assigned to the user's `territories` (Phase 3 enforcement)
- `all`: All non-deleted records

### 2.1 High-Level Matrix Summary

| Resource | `super_admin` | `system_admin` | `release_mgr` | `data_admin` | `sales_mgr` | `sales_rep` | `exec_viewer` | `engineering` | `quality` | `finance` |
|---|---|---|---|---|---|---|---|---|---|---|
| `customers` / `contacts` | All | All | — | R,U,I,E | R,C,U,D,I,E | R,C,U(own) | R,E | R | R | R |
| `leads` / `opportunities` | All | All | — | R,U,I,E | R,C,U,D,I,E | R,C,U(own) | R,E | R (opps) | — | R (opps) |
| `activities` / `tasks` | All | All | — | R,E | R,C,U,D | R,C,U(own),D(own) | R | R,C,U(own) | R,C,U(own) | — |
| `products` / `machine_applications` | All | All | — | R,C,U,I,E | R | R | R | R,C,U,D,I,E | R | R (prod) |
| `rfqs` / `quotations` | All | All | — | R,E | R,C,U,D,A,E | R,C,U(own) | R,E | R,U(rfq) | R (rfq) | R,A,E |
| `sales_orders` | All | All | — | R,E | R,C,U,E | R,C,U(own) | R,E | R | — | R,E |
| `master_data` | All | All | — | R,C,U,I,E | R | R | R | R | R | R |
| `reports` (KPIs / Targets / Forecasts) | All | All | — | R,E | R,C,U,E | R | R,E | — | — | R,E |
| `users` | All | All | — | R | — | — | — | — | — | — |
| `roles` *(Phase 1)* | All | R,C,U | — | — | — | — | — | — | — | — |
| `ui_config` *(Phase 1)* | All | R,C,U,A | R,A | — | — | — | — | — | — | — |
| `feature_flags` *(Phase 1)* | All | R,C,U | R,C,U,A | — | — | — | — | — | — | — |
| `releases` / `deployments` *(Phase 1)* | All | R | R,C,U,A | — | — | — | — | — | — | — |
| `jobs` *(Phase 1)* | All | R,C,U | R,C | R,C,U | — | — | — | — | — | — |
| `api_management` *(Phase 1)* | All | R,C,U,D | — | — | — | — | — | — | — | — |
| `backups` *(Phase 1)* | All | R,C | — | R,C | — | — | — | — | — | — |
| `system_settings` *(Phase 1)* | All | R,U | — | — | — | — | — | — | — | — |
| `audit_log` | R,E | R,E | R | R,E | — | — | R | — | — | — |

*(Legend: `R`=read, `C`=create, `U`=update, `D`=delete, `A`=approve, `I`=import, `E`=export, `All`=all actions. Append-only tables like `audit_log` NEVER permit `U` or `D` for any role, including `super_admin`.)*

---

## 3. Field-Level Permissions (`role_field_permissions`)

Supported access levels per `(role_key, resource, field_name)`:
- `hidden`: Omitted from API responses and rejected in write payloads.
- `masked`: Returned masked (e.g., `tax_identifier` → `***********12`, `phone_number` → `08*-***-1234`, `email` → `s***@company.co.th`).
- `read`: Visible in plaintext, rejected on writes.
- `write`: Readable and writable (subject to record-level permission).

Default PDPA / commercial sensitive fields targeted for field-level governance:
- `companies.tax_identifier`, `companies.revenue`
- `contacts.email_jsonb`, `contacts.phone_jsonb`, `contacts.line_id`
- `quotations.unit_price`, `quotations.discount_percent`, `price_list_items.unit_price`
- `sales.email`, `sales.secondary_emails`

---

## 4. Critical Security Invariants

1. **Disabled Accounts**: `public.is_admin()`, `public.is_active_user()`, `public.ddc_can()`, and API middleware ALL reject accounts where `sales.disabled = true`, even before JWT expiration.
2. **No Self-Privilege Escalation**: Non-super-admin users cannot promote themselves to `super_admin`, flip `sales.administrator = true`, or grant permissions they do not hold.
3. **Segregation of Duties**:
   - Quotation submitter cannot approve their own quotation (`quotation_allow_self_approval = false`).
   - Production releases and UI configuration publications support maker-checker approval (`created_by_sales_id != approved_by_sales_id`).
4. **Admin Control Center Access**: Opening `/admin/*` or calling `/admin/v1/*` requires an active user holding at least one administrative control-plane permission (`users`, `roles`, `ui_config`, `feature_flags`, `releases`, `deployments`, `jobs`, `api_management`, `backups`, `system_settings`, or `audit_log`). Regular `sales_rep` accounts receive `403 FORBIDDEN`.
