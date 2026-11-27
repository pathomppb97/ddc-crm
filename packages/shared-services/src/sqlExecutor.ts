import {
  PlatformError,
  type AuthChannel,
  type AuthPrincipal,
} from "../../shared-auth/src/index";

export interface SqlQueryResult<T = Record<string, unknown>> {
  rows: T[];
}

export interface SqlExecutor {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<SqlQueryResult<T>>;
  transaction?<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

export interface ServiceContext {
  requestId: string;
  channel: AuthChannel;
  aiClientId?: string;
  mcpToolName?: string;
  approvalRequestId?: number;
  auditReason?: string;
  actorIp?: string;
  actorUserAgent?: string;
  idempotencyKey?: string;
  confirmationToken?: string;
  approvalId?: number;
}

export function createServiceContext(
  partial?: Partial<ServiceContext>,
): ServiceContext {
  return {
    requestId:
      partial?.requestId ?? `req_${crypto.randomUUID().replace(/-/g, "")}`,
    channel: partial?.channel ?? "rest_api",
    aiClientId: partial?.aiClientId,
    mcpToolName: partial?.mcpToolName,
    approvalRequestId: partial?.approvalRequestId,
    auditReason: partial?.auditReason,
    actorIp: partial?.actorIp,
    actorUserAgent: partial?.actorUserAgent,
    idempotencyKey: partial?.idempotencyKey,
    confirmationToken: partial?.confirmationToken,
    approvalId: partial?.approvalId,
  };
}

/**
 * Executes a callback inside an RLS-scoped PostgreSQL transaction stamped with
 * authenticated JWT subject, channel attribution, request ID, and statement timeout.
 *
 * Works identically on both PGlite and node-postgres (pg) executors.
 */
export async function withRlsTransaction<T>(
  db: SqlExecutor,
  principal: AuthPrincipal,
  ctx: ServiceContext,
  fn: (tx: SqlExecutor) => Promise<T>,
  options?: { readOnly?: boolean; statementTimeoutMs?: number },
): Promise<T> {
  if (principal.disabled) {
    throw new PlatformError(
      "ACCOUNT_SUSPENDED",
      "Account is suspended or disabled",
    );
  }

  const runScoped = async (tx: SqlExecutor): Promise<T> => {
    const timeoutMs = Math.max(
      1000,
      Math.min(30000, options?.statementTimeoutMs ?? 8000),
    );
    await tx.query("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [
      principal.userId,
    ]);
    await tx.query("select set_config('app.channel', $1, true)", [ctx.channel]);
    await tx.query("select set_config('app.request_id', $1, true)", [
      ctx.requestId,
    ]);
    await tx.query("select set_config('app.ai_client_id', $1, true)", [
      ctx.aiClientId ?? "",
    ]);
    await tx.query("select set_config('app.mcp_tool_name', $1, true)", [
      ctx.mcpToolName ?? "",
    ]);
    await tx.query("select set_config('app.approval_request_id', $1, true)", [
      ctx.approvalRequestId ? String(ctx.approvalRequestId) : "",
    ]);
    await tx.query("select set_config('app.audit_reason', $1, true)", [
      ctx.auditReason ?? "",
    ]);
    await tx.query(`set local statement_timeout = '${timeoutMs}ms'`);
    if (options?.readOnly) {
      await tx.query("set transaction read only");
    }
    return fn(tx);
  };

  if (db.transaction) {
    return db.transaction(runScoped);
  }

  await db.query("begin");
  try {
    const result = await runScoped(db);
    await db.query("commit");
    return result;
  } catch (err) {
    await db.query("rollback").catch(() => undefined);
    throw err;
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Deterministic JSON stringification for payload hashing & approval binding. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

export function normalizePgError(err: unknown): PlatformError {
  if (err instanceof PlatformError) return err;
  const pgErr = err as { code?: string; message?: string } | undefined;
  const code = pgErr?.code;
  const msg = pgErr?.message ?? "Operation could not be completed";

  if (code === "42501") {
    return new PlatformError(
      "PERMISSION_DENIED",
      "Operation denied by server authorization policy",
    );
  }
  if (code === "23505") {
    return new PlatformError(
      "DUPLICATE_REQUEST",
      "A conflicting record with the same unique key already exists",
    );
  }
  if (
    code === "23503" ||
    code === "23514" ||
    code === "22023" ||
    code === "22P02"
  ) {
    return new PlatformError(
      "VALIDATION_FAILED",
      msg.includes("SQL") ? "Input failed business validation" : msg,
    );
  }
  if (code === "P0002") {
    return new PlatformError(
      "RESOURCE_NOT_AVAILABLE",
      "Requested resource is unavailable or outside your scope",
    );
  }
  return new PlatformError(
    "RESOURCE_NOT_AVAILABLE",
    "Operation failed due to an internal error",
    { httpStatus: 500, retryable: false },
  );
}
