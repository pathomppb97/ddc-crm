export type CrmErrorCategory =
  "network" | "permission" | "validation" | "schema" | "unknown";

export interface CrmErrorContext {
  resource?: string;
  operation?: string;
  locale?: "th" | "en";
}

export interface NormalizedCrmError {
  category: CrmErrorCategory;
  retryable: boolean;
  requestId: string;
  code?: string;
  status?: number;
  resource?: string;
  operation?: string;
  technicalMessage: string;
  userMessageTh: string;
  userMessageEn: string;
  dedupeKey: string;
}

export interface CrmErrorLogEntry {
  timestamp: string;
  requestId: string;
  category: CrmErrorCategory;
  code?: string;
  status?: number;
  resource?: string;
  operation?: string;
  technicalMessage: string;
  count: number;
}

const LOG_BUFFER_LIMIT = 50;
const LOG_DEDUPE_WINDOW_MS = 3_000;
const CORRELATION_WINDOW_MS = 6_000;
const TOAST_DEDUPE_WINDOW_MS = 6_000;
const errorLogBuffer: CrmErrorLogEntry[] = [];
const lastLoggedAt = new Map<string, number>();
const recentRequestIds = new Map<string, { requestId: string; ts: number }>();
const recentToasts = new Map<string, number>();

export const resetNotificationDedupe = (): void => {
  recentToasts.clear();
};

export const shouldSuppressDuplicateToast = (key: string): boolean => {
  const now = Date.now();
  for (const [k, ts] of recentToasts.entries()) {
    if (now - ts >= TOAST_DEDUPE_WINDOW_MS) {
      recentToasts.delete(k);
    }
  }
  const previous = recentToasts.get(key);
  if (previous != null && now - previous < TOAST_DEDUPE_WINDOW_MS) {
    return true;
  }
  recentToasts.set(key, now);
  return false;
};

const SCHEMA_CODES = new Set([
  "PGRST204",
  "PGRST205",
  "42P01",
  "42703",
  "42883",
  "42P02",
]);

const PERMISSION_CODES = new Set([
  "42501",
  "PGRST301",
  "PGRST302",
  "UNAUTHENTICATED",
  "AUTHENTICATION_REQUIRED",
  "TOKEN_EXPIRED",
  "ACCOUNT_DISABLED",
  "ACCOUNT_SUSPENDED",
  "FORBIDDEN",
  "PERMISSION_DENIED",
  "SCOPE_DENIED",
  "DATA_SCOPE_DENIED",
  "FIELD_ACCESS_DENIED",
  "ADMIN_REQUIRED",
]);

const VALIDATION_CODES = new Set([
  "22P02",
  "23502",
  "23503",
  "23505",
  "23514",
  "VALIDATION_ERROR",
  "VALIDATION_FAILED",
  "INVALID_QUERY",
  "INVALID_FILTER_FIELD",
  "INVALID_OPERATOR",
  "WORKFLOW_VIOLATION",
  "NOT_FOUND",
  "CONFLICT",
]);

const RETRYABLE_HTTP_STATUS = new Set([408, 429, 500, 502, 503, 504]);

const MESSAGES: Record<
  CrmErrorCategory,
  { th: string; en: string; retryable: boolean }
> = {
  schema: {
    th: "ข้อมูลบางส่วนไม่สามารถโหลดได้เนื่องจากโครงสร้างข้อมูลไม่สอดคล้องกัน กรุณาแจ้งผู้ดูแลระบบ",
    en: "Some data could not be loaded due to a schema mismatch. Please contact an administrator.",
    retryable: false,
  },
  permission: {
    th: "คุณไม่มีสิทธิ์เข้าถึงหรือดำเนินการกับข้อมูลส่วนนี้",
    en: "You do not have permission to access or modify this data.",
    retryable: false,
  },
  validation: {
    th: "ข้อมูลไม่ถูกต้องหรือไม่ครบถ้วน กรุณาตรวจสอบและลองใหม่อีกครั้ง",
    en: "The submitted data is invalid or incomplete. Please review and try again.",
    retryable: false,
  },
  network: {
    th: "ไม่สามารถเชื่อมต่อระบบได้ชั่วคราว กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่อีกครั้ง",
    en: "Temporary network or server issue. Please check your connection and try again.",
    retryable: true,
  },
  unknown: {
    th: "เกิดข้อผิดพลาดระหว่างดำเนินการ กรุณาลองใหม่อีกครั้ง",
    en: "An unexpected error occurred. Please try again.",
    retryable: false,
  },
};

export const generateRequestId = (): string => {
  const uuid =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `req_${uuid.slice(0, 8)}`;
};

interface ExtractedMeta {
  name?: string;
  message: string;
  code?: string;
  status?: number;
  requestId?: string;
  cached?: NormalizedCrmError;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;

const extractMeta = (error: unknown): ExtractedMeta => {
  if (typeof error === "string") {
    return { message: error };
  }
  const obj = asRecord(error);
  if (!obj) {
    return { message: String(error ?? "Unknown error") };
  }
  const cached = asRecord(obj.__ddcNormalized) as NormalizedCrmError | null;
  const body = asRecord(obj.body);
  const nestedError = asRecord(body?.error) ?? asRecord(obj.error);
  const name = typeof obj.name === "string" ? obj.name : undefined;
  const message =
    (typeof obj.message === "string" && obj.message) ||
    (typeof nestedError?.message === "string" && nestedError.message) ||
    (typeof body?.message === "string" && body.message) ||
    String(error);
  const codeRaw = obj.code ?? nestedError?.code ?? body?.code ?? undefined;
  const code = typeof codeRaw === "string" ? codeRaw : undefined;
  const statusRaw = obj.status ?? obj.statusCode ?? nestedError?.status;
  const status = typeof statusRaw === "number" ? statusRaw : undefined;
  const requestIdRaw =
    obj.requestId ?? nestedError?.requestId ?? body?.requestId ?? undefined;
  const requestId =
    typeof requestIdRaw === "string" && requestIdRaw.length > 0
      ? requestIdRaw
      : undefined;

  return {
    name,
    message,
    code,
    status,
    requestId,
    cached: cached ?? undefined,
  };
};

const normalizeSignature = (message: string): string =>
  message
    .replace(/\breq_[a-z0-9-]+\b/gi, "req")
    .replace(/\(รหัสอ้างอิง:[^)]+\)/g, "")
    .replace(/\(Ref:[^)]+\)/g, "")
    .replace(/\b\d+\b/g, "#")
    .trim()
    .slice(0, 120);

/**
 * Classifies an error into a deterministic production category so UI & QueryClient
 * never retry permanent schema/permission failures and always show clear guidance.
 */
export const classifyCrmError = (
  error: unknown,
  context: CrmErrorContext = {},
): NormalizedCrmError => {
  const meta = extractMeta(error);
  if (
    meta.cached &&
    (!context.resource || meta.cached.resource === context.resource)
  ) {
    return meta.cached;
  }

  const msg = meta.message;
  const code = meta.code?.toUpperCase();
  const status = meta.status;
  const name = meta.name ?? "";

  let category: CrmErrorCategory = "unknown";

  if (
    name === "UndefinedResourceError" ||
    (code != null && SCHEMA_CODES.has(code)) ||
    /undefined collection|could not find the table|relation .* does not exist|column .* does not exist|schema cache|ra\.notification\.data_provider_error/i.test(
      msg,
    )
  ) {
    category = "schema";
  } else if (
    status === 401 ||
    status === 403 ||
    (code != null && PERMISSION_CODES.has(code)) ||
    /not allowed|permission denied|row-level security|insufficient privilege|unauthorized|forbidden|ra\.notification\.not_authorized|ra\.message\.access_denied/i.test(
      msg,
    )
  ) {
    category = "permission";
  } else if (
    status === 400 ||
    status === 404 ||
    status === 409 ||
    status === 422 ||
    name === "WorkflowError" ||
    name === "QueryValidationError" ||
    (code != null && VALIDATION_CODES.has(code)) ||
    /invalid|required|already exists|not found|cannot be|constraint|violates|ra\.notification\.bad_item|ra\.notification\.item_doesnt_exist/i.test(
      msg,
    )
  ) {
    category = "validation";
  } else if (
    (status != null && RETRYABLE_HTTP_STATUS.has(status)) ||
    name === "AbortError" ||
    (name === "TypeError" && /fetch|network/i.test(msg)) ||
    (typeof navigator !== "undefined" && navigator.onLine === false) ||
    /failed to fetch|networkerror|network request failed|load failed|timed out|timeout|econnrefused|econnreset|ra\.notification\.http_error|ra\.notification\.offline/i.test(
      msg,
    )
  ) {
    category = "network";
  }

  const descriptor = MESSAGES[category];
  const resource = context.resource ?? meta.cached?.resource;
  const sigKey = `${category}:${code ?? normalizeSignature(msg)}`;
  const dedupeKey = `${sigKey}:${resource ?? ""}`;
  const now = Date.now();
  const cachedReq = recentRequestIds.get(sigKey);
  const requestId =
    meta.requestId ??
    (cachedReq && now - cachedReq.ts < CORRELATION_WINDOW_MS
      ? cachedReq.requestId
      : generateRequestId());
  recentRequestIds.set(sigKey, { requestId, ts: now });
  if (recentRequestIds.size > 100) {
    const oldest = recentRequestIds.keys().next().value;
    if (oldest !== undefined) recentRequestIds.delete(oldest);
  }

  const normalized: NormalizedCrmError = {
    category,
    retryable: descriptor.retryable,
    requestId,
    code,
    status,
    resource,
    operation: context.operation,
    technicalMessage: msg,
    userMessageTh: descriptor.th,
    userMessageEn: descriptor.en,
    dedupeKey,
  };

  const obj = asRecord(error);
  if (obj && Object.isExtensible(obj)) {
    try {
      Object.defineProperty(obj, "__ddcNormalized", {
        value: normalized,
        configurable: true,
        enumerable: false,
      });
    } catch {
      // Ignore frozen or non-configurable error instances
    }
  }

  return normalized;
};

/**
 * Only transient network/availability errors may be retried, bounded to 2 attempts.
 * Permanent schema, permission, validation, and unknown bugs fail fast on attempt 1.
 */
export const shouldRetryCrmError = (
  error: unknown,
  failureCount: number,
): boolean => {
  if (failureCount >= 2) return false;
  return classifyCrmError(error).retryable;
};

export const formatUserErrorMessage = (
  errorOrNormalized: unknown,
  locale: "th" | "en" = "th",
  context: CrmErrorContext = {},
): string => {
  const info =
    asRecord(errorOrNormalized) &&
    "userMessageTh" in (errorOrNormalized as object) &&
    "requestId" in (errorOrNormalized as object)
      ? (errorOrNormalized as NormalizedCrmError)
      : classifyCrmError(errorOrNormalized, context);

  const text = locale === "en" ? info.userMessageEn : info.userMessageTh;
  const refLabel = locale === "en" ? "Ref" : "รหัสอ้างอิง";
  return `${text} (${refLabel}: ${info.requestId})`;
};

/**
 * Records technical diagnostics in a bounded in-memory log buffer and emits
 * deduplicated console errors with correlation IDs (never logging credentials).
 */
export const logCrmError = (
  error: unknown,
  context: CrmErrorContext = {},
): NormalizedCrmError => {
  const normalized = classifyCrmError(error, context);
  const now = Date.now();
  const prevAt = lastLoggedAt.get(normalized.dedupeKey);

  if (prevAt != null && now - prevAt < LOG_DEDUPE_WINDOW_MS) {
    const existing = [...errorLogBuffer]
      .reverse()
      .find(
        (entry) =>
          entry.requestId === normalized.requestId ||
          (entry.category === normalized.category &&
            entry.resource === normalized.resource &&
            entry.technicalMessage === normalized.technicalMessage),
      );
    if (existing) existing.count += 1;
    return normalized;
  }

  lastLoggedAt.set(normalized.dedupeKey, now);
  if (lastLoggedAt.size > 100) {
    const oldestKey = lastLoggedAt.keys().next().value;
    if (oldestKey !== undefined) lastLoggedAt.delete(oldestKey);
  }

  const entry: CrmErrorLogEntry = {
    timestamp: new Date(now).toISOString(),
    requestId: normalized.requestId,
    category: normalized.category,
    code: normalized.code,
    status: normalized.status,
    resource: normalized.resource,
    operation: normalized.operation,
    technicalMessage: normalized.technicalMessage,
    count: 1,
  };

  errorLogBuffer.push(entry);
  if (errorLogBuffer.length > LOG_BUFFER_LIMIT) {
    errorLogBuffer.shift();
  }

  console.error("[DDC-CRM]", {
    requestId: entry.requestId,
    category: entry.category,
    code: entry.code,
    status: entry.status,
    resource: entry.resource,
    operation: entry.operation,
    message: entry.technicalMessage,
  });

  return normalized;
};

export const getRecentErrorLogs = (): readonly CrmErrorLogEntry[] => [
  ...errorLogBuffer,
];

export const clearRecentErrorLogs = (): void => {
  errorLogBuffer.length = 0;
  lastLoggedAt.clear();
  recentRequestIds.clear();
};

export const isTechnicalNotificationMessage = (message: string): boolean =>
  /undefined collection|could not find the table|relation .* does not exist|column .* does not exist|schema cache|pgrst|42p01|42501|failed to fetch|networkerror|not allowed|permission denied|ra\.notification\.(http_error|data_provider_error|not_authorized|offline|bad_item|item_doesnt_exist)/i.test(
    message,
  );
