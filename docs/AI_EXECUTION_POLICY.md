# DDC Agriculture CRM — AI Risk Classification & Execution Policy (L0–L5)

> **Implementation**: `packages/shared-auth/src/policyEngine.ts`, `packages/shared-services/src/approvalService.ts`, `supabase/migrations/20261127150000_ddc_mcp_platform.sql`

---

## 1. Risk Levels & Execution Modes

Every MCP tool and sensitive REST operation is assigned a risk level (`L0`–`L5`) and an execution policy (`direct`, `confirm`, `approve`, `privileged_approve`). Effective execution policy is always the **strictest** of the tool default, role threshold (`require_approval_from_level`), and tool override:

| Level | Classification | Default Execution Policy | Representative Tools | Guardrails |
|---|---|---|---|---|
| **L0** | Read-only queries, lookups, analytics | `direct` | `search_customers`, `find_compatible_parts`, `get_sales_pipeline`, `query_sales_summary` | RBAC + RLS + PDPA field masking + 10s SQL timeout + untrusted-data framing |
| **L1** | Routine record creation | `direct` | `create_customer`, `create_customer_contact`, `register_machine`, `create_visit_report`, `create_opportunity`, `create_quotation`, `create_theme_draft` | Strict Zod validation + duplicate prevention + `Idempotency-Key` + `audit_log` |
| **L2** | Routine record updates & job lifecycle | `direct` | `update_customer`, `update_machine`, `update_opportunity`, `update_quotation_draft`, `submit_quotation_for_approval`, `create_automation_job`, `cancel_authorized_job` | `own`/`all` record scope + write-field allowlist + optimistic `expected_version` |
| **L3** | Bulk updates, bulk imports, large exports | `confirm` | `execute_approved_import`, `execute_approved_bulk_update`, `generate_export` (>50 rows) | Preview/validation step issues payload-bound HMAC/SHA-256 `confirmation_token`; executing with a modified payload fails with `CONFIRMATION_REQUIRED` |
| **L4** | Administrative, user/permission changes, UI config publish | `approve` | `invite_user`, `update_user_status`, `request_permission_change`, `request_configuration_publish`, `schedule_configuration_publish` | Creates `pending` row in `public.mcp_approval_requests`; requires independent human administrator approval via Admin Control Center |
| **L5** | Production deployments, scheduled deployments, rollbacks | `privileged_approve` | `request_deployment`, `schedule_deployment`, `request_rollback` | Creates `pending` L5 request; requires independent `super_admin` or `release_manager` approval + explicit human execution |

---

## 2. L3 Confirmation Flow (Preview → Confirm → Execute)

1. AI calls `validate_import` or `preview_bulk_update`.
2. Server validates rows/fields, checks permissions, computes before/after diff preview, and returns `confirmationToken = computeConfirmationToken(userId, toolName, canonicalPayload)`.
3. AI presents the exact summary and affected records to the user and obtains explicit confirmation.
4. AI invokes `execute_approved_import` or `execute_approved_bulk_update` with the exact payload and `confirmation_token`.
5. Server recomputes the token from `(authenticatedUserId, toolName, submittedPayload)`. Any tampering (e.g., altering a city, record ID, or row) causes immediate rejection with `CONFIRMATION_REQUIRED`.

---

## 3. L4–L5 Approval Binding & Anti-Self-Approval Controls

`ApprovalService` (`packages/shared-services/src/approvalService.ts`) enforces **five cryptographic and database-level invariants**:

1. **Canonical Payload Hash Binding**: `payload_hash = SHA-256(canonicalJson(payload))`. If a single argument changes after approval, execution fails with `APPROVAL_REQUIRED` (`reason: "payload_or_version_changed"`) and logs a `high` severity `approval_payload_mismatch` security event.
2. **Requester Identity Binding**: Only the original `requesting_user_id` may execute the approved request.
3. **Target Record Version Binding**: If `target_record_version` was recorded, execution fails if the target record changed in the meantime.
4. **Strict Expiration Window**: Pending approvals expire automatically (`expires_at`, default 30 minutes for L4/L5). Expired approvals cannot be approved or executed.
5. **Dual-Layer Anti-Self-Approval**:
   - **Service Layer**: `ApprovalService.decideApproval()` rejects `approver.salesId === req.requesting_sales_id` with `403 PERMISSION_DENIED`.
   - **PostgreSQL Constraint**: `CHECK (decided_by_sales_id IS NULL OR decided_by_sales_id <> requesting_sales_id)` (`mcp_approval_no_self_decision`) guarantees even direct SQL cannot self-approve a request.
   - **Privileged L5 Gate**: L5 approvals additionally require `approver.roleKey === 'super_admin' || approver.roleKey === 'release_manager'`.
   - **One-Time Consumption**: Once executed, `status` transitions atomically to `executed` (`executed_at = now()`), preventing replay.
