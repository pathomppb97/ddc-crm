export const JOB_STATUSES = [
  "pending",
  "scheduled",
  "running",
  "completed",
  "failed",
  "cancelled",
  "retrying",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_TYPES = [
  "scheduled_deployment",
  "scheduled_config_publish",
  "scheduled_feature_flag",
  "data_import",
  "data_export",
  "bulk_update",
  "report_generation",
  "notification_dispatch",
  "erp_sync",
  "database_backup",
  "data_retention_cleanup",
  "ai_automation",
] as const;

export type JobType = (typeof JOB_TYPES)[number];

export interface ScheduledJobRecord {
  id: number;
  jobType: JobType;
  queueName: string;
  idempotencyKey?: string | null;
  status: JobStatus;
  payload: Record<string, unknown>;
  scheduledAtUtc: string;
  attemptCount: number;
  maxAttempts: number;
  nextRetryAtUtc?: string | null;
  lockedBy?: string | null;
  lockedUntilUtc?: string | null;
  organizationId?: number;
  channel?: string;
  requestedByUserId?: string | null;
  requiredPermissionResource?: string | null;
  requiredPermissionAction?: string | null;
}

const VALID_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  pending: ["running", "scheduled", "cancelled"],
  scheduled: ["running", "cancelled"],
  running: ["completed", "retrying", "failed", "cancelled"],
  retrying: ["running", "failed", "cancelled"],
  completed: [],
  failed: ["retrying"],
  cancelled: [],
};

export function canTransitionJobStatus(
  from: JobStatus,
  to: JobStatus,
): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

/** Computes bounded exponential backoff with deterministic jitter cap (seconds). */
export function computeRetryDelaySeconds(
  attemptCount: number,
  baseDelaySeconds = 30,
  maxDelaySeconds = 3600,
): number {
  const safeAttempt = Math.max(1, Math.trunc(attemptCount));
  const raw = baseDelaySeconds * Math.pow(2, safeAttempt - 1);
  return Math.min(maxDelaySeconds, Math.max(baseDelaySeconds, raw));
}

/** Determines next job status and retry timestamp after an execution failure. */
export function planJobFailureRecovery(
  job: Pick<ScheduledJobRecord, "attemptCount" | "maxAttempts">,
  nowUtc = new Date(),
): { nextStatus: "retrying" | "failed"; nextRetryAtUtc: string | null } {
  if (job.attemptCount < job.maxAttempts) {
    const delaySec = computeRetryDelaySeconds(job.attemptCount);
    return {
      nextStatus: "retrying",
      nextRetryAtUtc: new Date(
        nowUtc.getTime() + delaySec * 1000,
      ).toISOString(),
    };
  }
  return { nextStatus: "failed", nextRetryAtUtc: null };
}

/** True when a claimed job lease has expired and is eligible for safe recovery. */
export function isLeaseExpired(
  job: Pick<ScheduledJobRecord, "status" | "lockedUntilUtc">,
  nowUtc = new Date(),
): boolean {
  if (job.status !== "running" || !job.lockedUntilUtc) return false;
  return Date.parse(job.lockedUntilUtc) < nowUtc.getTime();
}

export interface JobHandlerContext {
  workerId: string;
  attemptNo: number;
  log: (
    level: "info" | "warn" | "error",
    message: string,
    details?: Record<string, unknown>,
  ) => Promise<void>;
}

export type JobHandler = (
  job: ScheduledJobRecord,
  ctx: JobHandlerContext,
) => Promise<Record<string, unknown>>;

export interface WorkerStore {
  claimNext(
    workerId: string,
    queueName: string,
    leaseSeconds: number,
  ): Promise<ScheduledJobRecord | null>;
  markCompleted(jobId: number, result: Record<string, unknown>): Promise<void>;
  markFailure(
    jobId: number,
    nextStatus: "retrying" | "failed",
    errorMessage: string,
    nextRetryAtUtc: string | null,
  ): Promise<void>;
  appendLog(
    jobId: number,
    attemptNo: number,
    level: "info" | "warn" | "error",
    message: string,
    details?: Record<string, unknown>,
  ): Promise<void>;
}

/** Processes at most one claimed job with distributed lease safety, execution-time permission revalidation, and retry recovery. */
export async function runWorkerTick(options: {
  workerId: string;
  queueName?: string;
  leaseSeconds?: number;
  store: WorkerStore;
  handlers: Partial<Record<JobType, JobHandler>>;
  revalidatePermission?: (
    job: ScheduledJobRecord,
  ) => Promise<{ allowed: boolean; reason?: string }>;
  nowUtc?: Date;
}): Promise<{ processed: boolean; jobId?: number; finalStatus?: JobStatus }> {
  const queueName = options.queueName ?? "default";
  const leaseSeconds = options.leaseSeconds ?? 300;
  const job = await options.store.claimNext(
    options.workerId,
    queueName,
    leaseSeconds,
  );
  if (!job) return { processed: false };

  // Revalidate authoritative permissions at execution time (never trust enqueue-time claims)
  if (options.revalidatePermission) {
    const authCheck = await options.revalidatePermission(job);
    if (!authCheck.allowed) {
      const msg = `PERMISSION_DENIED at execution time: ${authCheck.reason ?? "User no longer authorized"}`;
      await options.store.appendLog(job.id, job.attemptCount, "error", msg, {
        code: "PERMISSION_DENIED",
      });
      await options.store.markFailure(job.id, "failed", msg, null);
      return { processed: true, jobId: job.id, finalStatus: "failed" };
    }
  }

  const handler = options.handlers[job.jobType];
  if (!handler) {
    const msg = `No handler registered for job type "${job.jobType}"`;
    await options.store.appendLog(job.id, job.attemptCount, "error", msg);
    await options.store.markFailure(job.id, "failed", msg, null);
    return { processed: true, jobId: job.id, finalStatus: "failed" };
  }

  try {
    await options.store.appendLog(
      job.id,
      job.attemptCount,
      "info",
      `Worker ${options.workerId} started attempt ${job.attemptCount}/${job.maxAttempts}`,
    );
    const result = await handler(job, {
      workerId: options.workerId,
      attemptNo: job.attemptCount,
      log: (level, message, details) =>
        options.store.appendLog(
          job.id,
          job.attemptCount,
          level,
          message,
          details,
        ),
    });
    await options.store.markCompleted(job.id, result);
    await options.store.appendLog(
      job.id,
      job.attemptCount,
      "info",
      "Job completed successfully",
    );
    return { processed: true, jobId: job.id, finalStatus: "completed" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown job error";
    const recovery = planJobFailureRecovery(job, options.nowUtc);
    await options.store.appendLog(job.id, job.attemptCount, "error", message, {
      nextStatus: recovery.nextStatus,
      nextRetryAtUtc: recovery.nextRetryAtUtc,
    });
    await options.store.markFailure(
      job.id,
      recovery.nextStatus,
      message,
      recovery.nextRetryAtUtc,
    );
    return { processed: true, jobId: job.id, finalStatus: recovery.nextStatus };
  }
}
