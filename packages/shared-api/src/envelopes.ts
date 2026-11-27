export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "VALIDATION_FAILED"
  | "INVALID_QUERY"
  | "INVALID_FILTER_FIELD"
  | "INVALID_OPERATOR"
  | "UNAUTHENTICATED"
  | "AUTHENTICATION_REQUIRED"
  | "TOKEN_EXPIRED"
  | "ACCOUNT_DISABLED"
  | "ACCOUNT_SUSPENDED"
  | "MCP_ACCESS_DISABLED"
  | "MFA_REQUIRED"
  | "FORBIDDEN"
  | "PERMISSION_DENIED"
  | "SCOPE_DENIED"
  | "DATA_SCOPE_DENIED"
  | "FIELD_ACCESS_DENIED"
  | "TOOL_DISABLED"
  | "APPROVAL_REQUIRED"
  | "CONFIRMATION_REQUIRED"
  | "ADMIN_REQUIRED"
  | "NOT_FOUND"
  | "RESOURCE_NOT_AVAILABLE"
  | "CONFLICT"
  | "VERSION_MISMATCH"
  | "VERSION_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "DUPLICATE_REQUEST"
  | "WORKFLOW_VIOLATION"
  | "RATE_LIMITED"
  | "RATE_LIMIT_EXCEEDED"
  | "INTERNAL_ERROR";

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  timezone: "Asia/Bangkok";
}

export interface ApiSuccessEnvelope<T> {
  data: T;
  meta?: Record<string, unknown>;
  requestId: string;
}

export interface ApiErrorEnvelope {
  error: {
    code: ApiErrorCode;
    message: string;
    retryable?: boolean;
    remediation?: string;
    details?: Record<string, unknown>;
    requestId: string;
  };
}

export function createSuccessEnvelope<T>(
  data: T,
  requestId: string,
  meta?: Record<string, unknown>,
): ApiSuccessEnvelope<T> {
  return meta ? { data, meta, requestId } : { data, requestId };
}

export function createErrorEnvelope(
  code: ApiErrorCode,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
  options?: { retryable?: boolean; remediation?: string },
): ApiErrorEnvelope {
  return {
    error: {
      code,
      message,
      ...(options?.retryable !== undefined
        ? { retryable: options.retryable }
        : {}),
      ...(options?.remediation ? { remediation: options.remediation } : {}),
      ...(details ? { details } : {}),
      requestId,
    },
  };
}
