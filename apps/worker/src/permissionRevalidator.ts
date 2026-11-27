import {
  evaluateAccess,
  type PermissionAction,
} from "../../../packages/shared-auth/src/index";
import {
  McpGovernanceService,
  PrincipalResolver,
  type SqlExecutor,
} from "../../../packages/shared-services/src/index";
import type { ScheduledJobRecord } from "./jobMachine";

/**
 * Revalidates the requesting user's CURRENT authoritative permissions & active
 * status in PostgreSQL immediately before a queued or scheduled job executes.
 *
 * If the user was suspended, demoted, or lost the required permission after
 * scheduling the job, execution is blocked and recorded in mcp_security_events.
 */
export function createPostgresPermissionRevalidator(db: SqlExecutor) {
  const resolver = new PrincipalResolver(db);
  const governance = new McpGovernanceService(db, resolver);

  return async function revalidateJobPermission(
    job: ScheduledJobRecord,
  ): Promise<{ allowed: boolean; reason?: string }> {
    if (!job.requestedByUserId) {
      return { allowed: true };
    }

    const resolved = await resolver.resolveByUserId(job.requestedByUserId, {
      channel: "worker",
      bypassCache: true,
    });

    const orgId = job.organizationId ?? 1;

    if (!resolved) {
      return { allowed: false, reason: "Requesting CRM user no longer exists" };
    }

    if (resolved.principal.disabled) {
      await governance.recordSecurityEvent({
        requestId: `worker_job_${job.id}`,
        organizationId: orgId,
        userId: resolved.principal.userId,
        salesId: resolved.principal.salesId,
        eventType: "suspended_user",
        severity: "high",
        errorCode: "ACCOUNT_SUSPENDED",
        summary: `Blocked scheduled job #${job.id} (${job.jobType}) because requesting user is suspended`,
      });
      return {
        allowed: false,
        reason: "Requesting user account has been suspended",
      };
    }

    if (
      job.requiredPermissionResource &&
      job.requiredPermissionAction &&
      !evaluateAccess(resolved.principal, {
        resource: job.requiredPermissionResource,
        action: job.requiredPermissionAction as PermissionAction,
        recordOrganizationId: orgId,
      })
    ) {
      await governance.recordSecurityEvent({
        requestId: `worker_job_${job.id}`,
        organizationId: orgId,
        userId: resolved.principal.userId,
        salesId: resolved.principal.salesId,
        eventType: "unauthorized_tool",
        severity: "high",
        errorCode: "PERMISSION_DENIED",
        summary: `Blocked scheduled job #${job.id} (${job.jobType}): user lost ${job.requiredPermissionResource}:${job.requiredPermissionAction}`,
      });
      return {
        allowed: false,
        reason: `User no longer holds ${job.requiredPermissionResource}:${job.requiredPermissionAction}`,
      };
    }

    return { allowed: true };
  };
}
