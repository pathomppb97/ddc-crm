import {
  applyFieldPermissions,
  evaluateAccess,
  hasAdminConsoleAccess,
  type AuthPrincipal,
} from "../../../packages/shared-auth/src/index";
import {
  evaluateFeatureFlag,
  validateUiConfigPayload,
  type FeatureFlagRecord,
} from "../../../packages/shared-config/src/index";
import {
  compileAllowlistedQuery,
  createErrorEnvelope,
  createSuccessEnvelope,
  QueryValidationError,
  type ApiErrorCode,
  type CompiledAllowlistedQuery,
} from "../../../packages/shared-api/src/index";
import { BANGKOK_TIMEZONE } from "../../../packages/shared-ui/src/index";
import { SlidingWindowRateLimiter } from "./rateLimiter";

export interface IdempotencyRecord {
  requestHash: string;
  status: number;
  body: unknown;
}

export interface ApiGatewayAdapters {
  resolvePrincipal(req: Request): Promise<AuthPrincipal | null>;
  executeCompiledQuery(
    compiled: CompiledAllowlistedQuery,
    principal: AuthPrincipal,
  ): Promise<{ rows: Record<string, unknown>[]; total: number }>;
  getFeatureFlags(): Promise<FeatureFlagRecord[]>;
  getAdminOverview(principal: AuthPrincipal): Promise<Record<string, unknown>>;
  getIdempotencyRecord?(
    actorUserId: string,
    endpoint: string,
    key: string,
  ): Promise<IdempotencyRecord | null>;
  saveIdempotencyRecord?(
    actorUserId: string,
    endpoint: string,
    key: string,
    record: IdempotencyRecord,
  ): Promise<void>;
  createUiConfigDraft?(
    input: {
      environment: "development" | "staging" | "production";
      changeSummary?: string;
      configPayload: unknown;
    },
    principal: AuthPrincipal,
  ): Promise<Record<string, unknown>>;
  rateLimiter?: SlidingWindowRateLimiter;
  serviceVersion?: string;
}

function resolveRequestId(req: Request): string {
  const incoming = req.headers.get("x-request-id")?.trim();
  if (incoming && /^[A-Za-z0-9._-]{8,128}$/.test(incoming)) return incoming;
  return `req_${crypto.randomUUID().replace(/-/g, "")}`;
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function jsonResponse(
  status: number,
  body: unknown,
  requestId: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Request-Id": requestId,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function errorJson(
  status: number,
  code: ApiErrorCode,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Response {
  return jsonResponse(
    status,
    createErrorEnvelope(code, message, requestId, details),
    requestId,
    extraHeaders,
  );
}

/**
 * Normalizes paths whether invoked directly (/api/v1/...) or behind Supabase Edge
 * Function prefix (/functions/v1/api_v1/api/v1/... or /api_v1/api/v1/...).
 */
export function normalizeApiPath(rawPathname: string): string {
  const stripped = rawPathname
    .replace(/^\/functions\/v1\/api_v1/, "")
    .replace(/^\/api_v1/, "");
  return stripped || "/";
}

export function createApiV1Handler(adapters: ApiGatewayAdapters) {
  const limiter = adapters.rateLimiter ?? new SlidingWindowRateLimiter();
  const version = adapters.serviceVersion ?? "1.0.0-phase1";

  return async function handleRequest(req: Request): Promise<Response> {
    const requestId = resolveRequestId(req);
    const url = new URL(req.url);
    const pathname = normalizeApiPath(url.pathname);

    // 1. Public liveness endpoint (zero secrets exposed)
    if (req.method === "GET" && pathname === "/api/v1/health") {
      return jsonResponse(
        200,
        createSuccessEnvelope(
          {
            status: "ok",
            service: "ddc-crm-api-v1",
            version,
            utcTime: new Date().toISOString(),
            displayTimezone: BANGKOK_TIMEZONE,
          },
          requestId,
        ),
        requestId,
      );
    }

    // 2. Authentication & active-account enforcement for all business & admin routes
    const principal = await adapters.resolvePrincipal(req);
    if (!principal) {
      return errorJson(
        401,
        "UNAUTHENTICATED",
        "Authentication required",
        requestId,
      );
    }
    if (principal.disabled) {
      return errorJson(
        401,
        "ACCOUNT_DISABLED",
        "User account is suspended or disabled",
        requestId,
      );
    }

    // 3. Sliding-window rate limiting per namespace
    const isAdminRoute = pathname.startsWith("/admin/v1/");
    const limit = isAdminRoute ? 30 : pathname === "/api/v1/query" ? 60 : 120;
    const rate = limiter.check(
      `${principal.userId}:${isAdminRoute ? "admin" : "api"}`,
      limit,
    );
    const rateHeaders = {
      "X-RateLimit-Limit": String(rate.limit),
      "X-RateLimit-Remaining": String(rate.remaining),
    };
    if (!rate.allowed) {
      return errorJson(
        429,
        "RATE_LIMITED",
        "Rate limit exceeded. Retry later.",
        requestId,
        { retryAfterSeconds: rate.retryAfterSeconds },
        { ...rateHeaders, "Retry-After": String(rate.retryAfterSeconds) },
      );
    }

    // 4. Separate Admin Control Plane gate (/admin/v1/*)
    if (isAdminRoute && !hasAdminConsoleAccess(principal)) {
      return errorJson(
        403,
        "ADMIN_REQUIRED",
        "Administrative Control Center permission required",
        requestId,
        undefined,
        rateHeaders,
      );
    }

    // 5. Business API routes (/api/v1/*)
    if (req.method === "GET" && pathname === "/api/v1/me") {
      const flags = await adapters.getFeatureFlags();
      const evaluatedFlags = Object.fromEntries(
        flags.map((flag) => {
          const result = evaluateFeatureFlag(flag, {
            salesId: principal.salesId,
            roleKey: principal.roleKey,
            teamIds: principal.teamIds,
          });
          return [flag.flagKey, result.enabled];
        }),
      );
      return jsonResponse(
        200,
        createSuccessEnvelope(
          {
            userId: principal.userId,
            salesId: principal.salesId,
            email: principal.email,
            roleKey: principal.roleKey,
            administrator: principal.administrator,
            adminConsoleAccess: hasAdminConsoleAccess(principal),
            permissions: principal.permissions,
            featureFlags: evaluatedFlags,
          },
          requestId,
          { timezone: BANGKOK_TIMEZONE },
        ),
        requestId,
        rateHeaders,
      );
    }

    if (
      req.method === "POST" &&
      (pathname === "/api/v1/query" || pathname === "/admin/v1/query/execute")
    ) {
      if (
        pathname === "/admin/v1/query/execute" &&
        !evaluateAccess(principal, {
          resource: "data_management",
          action: "read",
        })
      ) {
        return errorJson(
          403,
          "FORBIDDEN",
          "Permission data_management:read required",
          requestId,
          undefined,
          rateHeaders,
        );
      }

      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return errorJson(
          400,
          "VALIDATION_ERROR",
          "Invalid JSON request body",
          requestId,
          undefined,
          rateHeaders,
        );
      }

      let compiled: CompiledAllowlistedQuery;
      try {
        compiled = compileAllowlistedQuery(body);
      } catch (err) {
        if (err instanceof QueryValidationError) {
          return errorJson(
            400,
            err.code,
            err.message,
            requestId,
            undefined,
            rateHeaders,
          );
        }
        throw err;
      }

      if (
        !evaluateAccess(principal, {
          resource: compiled.permissionResource,
          action: "read",
        })
      ) {
        return errorJson(
          403,
          "FORBIDDEN",
          `Permission denied for ${compiled.permissionResource}:read`,
          requestId,
          undefined,
          rateHeaders,
        );
      }

      const { rows, total } = await adapters.executeCompiledQuery(
        compiled,
        principal,
      );
      const maskedRows = rows.map((row) =>
        applyFieldPermissions(row, compiled.permissionResource, principal),
      );

      return jsonResponse(
        200,
        createSuccessEnvelope(maskedRows, requestId, {
          resource: compiled.resource,
          page: Math.floor(compiled.offset / compiled.limit) + 1,
          pageSize: compiled.limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / compiled.limit)),
          timezone: BANGKOK_TIMEZONE,
        }),
        requestId,
        rateHeaders,
      );
    }

    // 6. Admin Control Plane routes (/admin/v1/*)
    if (req.method === "GET" && pathname === "/admin/v1/overview") {
      if (
        !evaluateAccess(principal, {
          resource: "admin_console",
          action: "read",
        })
      ) {
        return errorJson(
          403,
          "FORBIDDEN",
          "Permission admin_console:read required",
          requestId,
          undefined,
          rateHeaders,
        );
      }
      const overview = await adapters.getAdminOverview(principal);
      return jsonResponse(
        200,
        createSuccessEnvelope(overview, requestId, {
          timezone: BANGKOK_TIMEZONE,
        }),
        requestId,
        rateHeaders,
      );
    }

    if (req.method === "POST" && pathname === "/admin/v1/ui-configs") {
      if (
        !evaluateAccess(principal, { resource: "ui_config", action: "create" })
      ) {
        return errorJson(
          403,
          "FORBIDDEN",
          "Permission ui_config:create required",
          requestId,
          undefined,
          rateHeaders,
        );
      }

      const rawText = await req.text();
      let parsedBody: {
        environment?: "development" | "staging" | "production";
        changeSummary?: string;
        configPayload?: unknown;
      };
      try {
        parsedBody = JSON.parse(rawText);
      } catch {
        return errorJson(
          400,
          "VALIDATION_ERROR",
          "Invalid JSON request body",
          requestId,
          undefined,
          rateHeaders,
        );
      }

      const idempotencyKey = req.headers.get("idempotency-key")?.trim();
      const requestHash = await sha256Hex(rawText);

      if (idempotencyKey && adapters.getIdempotencyRecord) {
        const existing = await adapters.getIdempotencyRecord(
          principal.userId,
          pathname,
          idempotencyKey,
        );
        if (existing) {
          if (existing.requestHash !== requestHash) {
            return errorJson(
              409,
              "IDEMPOTENCY_CONFLICT",
              "Idempotency-Key was reused with a different request payload",
              requestId,
              undefined,
              rateHeaders,
            );
          }
          return jsonResponse(existing.status, existing.body, requestId, {
            ...rateHeaders,
            "X-Idempotent-Replayed": "true",
          });
        }
      }

      const env = parsedBody.environment ?? "staging";
      if (!["development", "staging", "production"].includes(env)) {
        return errorJson(
          400,
          "VALIDATION_ERROR",
          "Invalid environment",
          requestId,
          undefined,
          rateHeaders,
        );
      }

      const validation = validateUiConfigPayload(parsedBody.configPayload);
      if (!validation.valid) {
        return errorJson(
          400,
          "VALIDATION_ERROR",
          "UI configuration failed schema or security validation",
          requestId,
          { errors: validation.errors },
          rateHeaders,
        );
      }

      const created = adapters.createUiConfigDraft
        ? await adapters.createUiConfigDraft(
            {
              environment: env,
              changeSummary: parsedBody.changeSummary,
              configPayload: validation.data,
            },
            principal,
          )
        : {
            environment: env,
            status: "validated",
            configPayload: validation.data,
          };

      const envelope = createSuccessEnvelope(created, requestId);
      if (idempotencyKey && adapters.saveIdempotencyRecord) {
        await adapters.saveIdempotencyRecord(
          principal.userId,
          pathname,
          idempotencyKey,
          { requestHash, status: 201, body: envelope },
        );
      }

      return jsonResponse(201, envelope, requestId, rateHeaders);
    }

    return errorJson(
      404,
      "NOT_FOUND",
      `Route not found: ${req.method} ${pathname}`,
      requestId,
      undefined,
      rateHeaders,
    );
  };
}
