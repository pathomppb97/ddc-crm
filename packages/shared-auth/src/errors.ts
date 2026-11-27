export const PLATFORM_ERROR_CODES = [
  "AUTHENTICATION_REQUIRED",
  "TOKEN_EXPIRED",
  "ACCOUNT_SUSPENDED",
  "MCP_ACCESS_DISABLED",
  "PERMISSION_DENIED",
  "DATA_SCOPE_DENIED",
  "FIELD_ACCESS_DENIED",
  "TOOL_DISABLED",
  "APPROVAL_REQUIRED",
  "CONFIRMATION_REQUIRED",
  "VALIDATION_FAILED",
  "RATE_LIMIT_EXCEEDED",
  "VERSION_CONFLICT",
  "DUPLICATE_REQUEST",
  "RESOURCE_NOT_AVAILABLE",
] as const;

export type PlatformErrorCode = (typeof PLATFORM_ERROR_CODES)[number];

export interface StructuredPlatformError {
  code: PlatformErrorCode;
  message: string;
  retryable: boolean;
  remediation: string;
  requestId: string;
  details?: Record<string, unknown>;
}

const DEFAULT_ERROR_METADATA: Record<
  PlatformErrorCode,
  { httpStatus: number; retryable: boolean; remediation: string }
> = {
  AUTHENTICATION_REQUIRED: {
    httpStatus: 401,
    retryable: false,
    remediation:
      "Sign in with a valid DDC CRM account via OAuth 2.1 before retrying.",
  },
  TOKEN_EXPIRED: {
    httpStatus: 401,
    retryable: true,
    remediation:
      "Refresh your OAuth access token or reconnect your AI client to DDC CRM.",
  },
  ACCOUNT_SUSPENDED: {
    httpStatus: 403,
    retryable: false,
    remediation:
      "Your CRM account is suspended. Contact your DDC System Administrator.",
  },
  MCP_ACCESS_DISABLED: {
    httpStatus: 403,
    retryable: false,
    remediation:
      "AI / MCP access is disabled for your organization, role, or account. Request enablement from an authorized DDC administrator.",
  },
  PERMISSION_DENIED: {
    httpStatus: 403,
    retryable: false,
    remediation:
      "Your current CRM role or OAuth scope does not permit this operation. Contact an authorized DDC administrator to review your permissions.",
  },
  DATA_SCOPE_DENIED: {
    httpStatus: 403,
    retryable: false,
    remediation:
      "This operation falls outside your authorized organization, team, territory, or assigned customer scope.",
  },
  FIELD_ACCESS_DENIED: {
    httpStatus: 403,
    retryable: false,
    remediation:
      "One or more requested or submitted fields are restricted by your role's field-level policy.",
  },
  TOOL_DISABLED: {
    httpStatus: 403,
    retryable: false,
    remediation:
      "This MCP tool is currently disabled by administrator policy. Contact your DDC System Administrator.",
  },
  APPROVAL_REQUIRED: {
    httpStatus: 202,
    retryable: false,
    remediation:
      "This high-risk operation requires explicit human approval in the Admin Approval Center before execution. Do not retry until approved.",
  },
  CONFIRMATION_REQUIRED: {
    httpStatus: 409,
    retryable: true,
    remediation:
      "Review the validation preview with the user and re-submit with the issued confirmation token to execute.",
  },
  VALIDATION_FAILED: {
    httpStatus: 400,
    retryable: true,
    remediation:
      "Correct the invalid or missing input fields indicated in details and try again. Do not invent missing business values.",
  },
  RATE_LIMIT_EXCEEDED: {
    httpStatus: 429,
    retryable: true,
    remediation:
      "Rate limit reached. Wait for the retry window before issuing another request.",
  },
  VERSION_CONFLICT: {
    httpStatus: 409,
    retryable: true,
    remediation:
      "The record was modified by another user. Fetch the latest version and reapply your changes.",
  },
  DUPLICATE_REQUEST: {
    httpStatus: 409,
    retryable: false,
    remediation:
      "A matching record or idempotency key already exists. Inspect the existing resource or supply a fresh Idempotency-Key for a distinct operation.",
  },
  RESOURCE_NOT_AVAILABLE: {
    httpStatus: 404,
    retryable: false,
    remediation:
      "The requested resource is unavailable or cannot be accessed under your current scope.",
  },
};

export class PlatformError extends Error {
  readonly code: PlatformErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly remediation: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: PlatformErrorCode,
    message: string,
    options?: {
      httpStatus?: number;
      retryable?: boolean;
      remediation?: string;
      details?: Record<string, unknown>;
    },
  ) {
    super(message);
    this.name = "PlatformError";
    const defaults = DEFAULT_ERROR_METADATA[code];
    this.code = code;
    this.httpStatus = options?.httpStatus ?? defaults.httpStatus;
    this.retryable = options?.retryable ?? defaults.retryable;
    this.remediation = options?.remediation ?? defaults.remediation;
    this.details = options?.details;
  }

  toSafePayload(requestId: string): StructuredPlatformError {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      remediation: this.remediation,
      requestId,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export function isAuthorizationErrorCode(code: PlatformErrorCode): boolean {
  return (
    code === "AUTHENTICATION_REQUIRED" ||
    code === "TOKEN_EXPIRED" ||
    code === "ACCOUNT_SUSPENDED" ||
    code === "MCP_ACCESS_DISABLED" ||
    code === "PERMISSION_DENIED" ||
    code === "DATA_SCOPE_DENIED" ||
    code === "FIELD_ACCESS_DENIED" ||
    code === "TOOL_DISABLED"
  );
}
