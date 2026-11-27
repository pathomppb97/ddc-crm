import {
  evaluateAccess,
  hasAdminConsoleAccess,
  PlatformError,
  type AuthPrincipal,
  type ToolPolicySubject,
} from "../../../packages/shared-auth/src/index";
import {
  createErrorEnvelope,
  createSuccessEnvelope,
  QueryValidationError,
  type ApiErrorCode,
} from "../../../packages/shared-api/src/index";
import {
  createServiceContext,
  CrmControlServices,
  CrmDomainServices,
  McpGovernanceService,
  PrincipalResolver,
  type SqlExecutor,
} from "../../../packages/shared-services/src/index";
import { BANGKOK_TIMEZONE } from "../../../packages/shared-ui/src/index";
import { SlidingWindowRateLimiter } from "./rateLimiter";
import { normalizeApiPath } from "./router";

export interface EnterpriseApiOptions {
  db: SqlExecutor;
  resolveBearerPrincipal: (req: Request) => Promise<AuthPrincipal | null>;
  toolSubjects?: readonly ToolPolicySubject[];
  rateLimiter?: SlidingWindowRateLimiter;
  protocolVersion?: string;
  serviceVersion?: string;
}

function getRequestId(req: Request): string {
  const incoming = req.headers.get("x-request-id")?.trim();
  if (incoming && /^[A-Za-z0-9._-]{8,128}$/.test(incoming)) return incoming;
  return `req_${crypto.randomUUID().replace(/-/g, "")}`;
}

function jsonOut(
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

function platformErrorToResponse(
  err: unknown,
  requestId: string,
  extraHeaders: Record<string, string> = {},
): Response {
  if (err instanceof PlatformError) {
    return jsonOut(
      err.httpStatus,
      createErrorEnvelope(
        err.code as ApiErrorCode,
        err.message,
        requestId,
        err.details,
        { retryable: err.retryable, remediation: err.remediation },
      ),
      requestId,
      extraHeaders,
    );
  }
  if (err instanceof QueryValidationError) {
    return jsonOut(
      400,
      createErrorEnvelope(err.code, err.message, requestId, undefined, {
        retryable: true,
      }),
      requestId,
      extraHeaders,
    );
  }
  return jsonOut(
    500,
    createErrorEnvelope(
      "INTERNAL_ERROR",
      "An internal error occurred while processing the request",
      requestId,
      undefined,
      { retryable: false },
    ),
    requestId,
    extraHeaders,
  );
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = (await req.json()) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new PlatformError(
        "VALIDATION_FAILED",
        "Request body must be a JSON object",
      );
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof PlatformError) throw err;
    throw new PlatformError("VALIDATION_FAILED", "Invalid JSON request body");
  }
}

function parsePositiveInt(raw: string | null | undefined): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new PlatformError("VALIDATION_FAILED", "Invalid positive integer ID");
  }
  return n;
}

function parseExpectedVersion(
  req: Request,
  body: Record<string, unknown>,
): number | undefined {
  const ifMatch = req.headers
    .get("if-match")
    ?.replace(/^W\//, "")
    .replace(/"/g, "");
  const raw = body.expected_version ?? body.version ?? ifMatch;
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new PlatformError(
      "VALIDATION_FAILED",
      "expected_version / If-Match must be a positive integer",
    );
  }
  return n;
}

/**
 * Full Enterprise REST API Handler serving:
 * - /api/v1/*          (Business CRM API)
 * - /admin/v1/*        (Admin Control Plane & MCP Governance API)
 * - /integrations/v1/* (External Application & Service Account API)
 *
 * Every channel routes through the exact same Shared Business Services and
 * Centralized Authorization Policy Engine.
 */
export function createEnterpriseApiHandler(options: EnterpriseApiOptions) {
  const limiter = options.rateLimiter ?? new SlidingWindowRateLimiter();
  const resolver = new PrincipalResolver(options.db);
  const domain = new CrmDomainServices(options.db);
  const control = new CrmControlServices(options.db);
  const governance = new McpGovernanceService(options.db, resolver);
  const version = options.serviceVersion ?? "2.0.0";
  const protocolVersion = options.protocolVersion ?? "2025-11-25";

  return async function handleEnterpriseApi(req: Request): Promise<Response> {
    const requestId = getRequestId(req);
    const url = new URL(req.url);
    const pathname = normalizeApiPath(url.pathname);
    const method = req.method.toUpperCase();

    // 1. Public liveness endpoints
    if (
      method === "GET" &&
      (pathname === "/api/v1/health" || pathname === "/integrations/v1/health")
    ) {
      return jsonOut(
        200,
        createSuccessEnvelope(
          {
            status: "ok",
            service: "ddc-crm-enterprise-api",
            version,
            mcpProtocolVersion: protocolVersion,
            namespaces: ["/api/v1/", "/admin/v1/", "/integrations/v1/", "/mcp"],
            utcTime: new Date().toISOString(),
            displayTimezone: BANGKOK_TIMEZONE,
          },
          requestId,
        ),
        requestId,
      );
    }

    const isAdminRoute = pathname.startsWith("/admin/v1/");
    const isIntegrationRoute = pathname.startsWith("/integrations/v1/");

    // 2. Authentication (Bearer JWT for /api/v1 & /admin/v1; X-Api-Key or Bearer for /integrations/v1)
    let principal: AuthPrincipal | null = null;
    try {
      const apiKeyHeader =
        req.headers.get("x-api-key")?.trim() ??
        (req.headers.get("authorization")?.startsWith("ApiKey ")
          ? req.headers.get("authorization")!.slice(7).trim()
          : undefined);

      if (isIntegrationRoute && apiKeyHeader) {
        principal = await resolver.resolveByApiKey(apiKeyHeader);
      } else {
        principal = await options.resolveBearerPrincipal(req);
      }
    } catch (err) {
      return platformErrorToResponse(err, requestId);
    }

    if (!principal) {
      return platformErrorToResponse(
        new PlatformError(
          "AUTHENTICATION_REQUIRED",
          "Valid authentication credentials are required",
        ),
        requestId,
      );
    }
    if (principal.disabled) {
      return platformErrorToResponse(
        new PlatformError(
          "ACCOUNT_SUSPENDED",
          "User account is suspended or disabled",
        ),
        requestId,
      );
    }

    // 3. Per-namespace sliding-window rate limiting
    const bucket = isAdminRoute
      ? "admin"
      : isIntegrationRoute
        ? "integration"
        : pathname === "/api/v1/query"
          ? "query"
          : "api";
    const limit = bucket === "admin" ? 60 : bucket === "query" ? 60 : 180;
    const rate = limiter.check(`${principal.userId}:${bucket}`, limit);
    const rateHeaders = {
      "X-RateLimit-Limit": String(rate.limit),
      "X-RateLimit-Remaining": String(rate.remaining),
    };
    if (!rate.allowed) {
      return platformErrorToResponse(
        new PlatformError(
          "RATE_LIMIT_EXCEEDED",
          "Rate limit exceeded; retry later",
          { details: { retryAfterSeconds: rate.retryAfterSeconds } },
        ),
        requestId,
        { ...rateHeaders, "Retry-After": String(rate.retryAfterSeconds) },
      );
    }

    // 4. Separate Admin Control Plane boundary
    if (isAdminRoute && !hasAdminConsoleAccess(principal)) {
      return platformErrorToResponse(
        new PlatformError(
          "PERMISSION_DENIED",
          "Administrative Control Center permission required",
        ),
        requestId,
        rateHeaders,
      );
    }

    const ctx = createServiceContext({
      requestId,
      channel: isIntegrationRoute ? "integration_api" : "rest_api",
      idempotencyKey: req.headers.get("idempotency-key")?.trim() || undefined,
      auditReason: req.headers.get("x-audit-reason")?.trim() || undefined,
    });

    try {
      // ======================================================================
      // A. BUSINESS API (/api/v1/*)
      // ======================================================================

      if (method === "GET" && pathname === "/api/v1/me") {
        const profile = await domain.getMyProfile(principal, ctx);
        return jsonOut(
          200,
          createSuccessEnvelope(
            {
              ...profile,
              adminConsoleAccess: hasAdminConsoleAccess(principal),
              permissions: principal.permissions,
            },
            requestId,
            { timezone: BANGKOK_TIMEZONE },
          ),
          requestId,
          rateHeaders,
        );
      }

      if (method === "GET" && pathname === "/api/v1/data-scope") {
        return jsonOut(
          200,
          createSuccessEnvelope(domain.getMyDataScope(principal), requestId),
          requestId,
          rateHeaders,
        );
      }

      if (
        method === "POST" &&
        (pathname === "/api/v1/query" || pathname === "/admin/v1/query/execute")
      ) {
        if (
          pathname === "/admin/v1/query/execute" &&
          !evaluateAccess(principal, {
            resource: "data_management",
            action: "read",
          })
        ) {
          throw new PlatformError(
            "PERMISSION_DENIED",
            "Permission data_management:read required",
          );
        }
        const body = await readJsonBody(req);
        const { rows, total, compiled } = await domain.executeDynamicQuery(
          principal,
          ctx,
          body,
        );
        return jsonOut(
          200,
          createSuccessEnvelope(rows, requestId, {
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

      // Saved queries (/api/v1/saved-queries)
      if (method === "GET" && pathname === "/api/v1/saved-queries") {
        const { rows } = await options.db.query<Record<string, unknown>>(
          `select id, resource, name, description, view_type, query_definition, is_shared, owner_sales_id, updated_at
           from public.saved_views
           where is_shared = true or owner_sales_id = $1
           order by updated_at desc limit 100`,
          [principal.salesId ?? -1],
        );
        return jsonOut(
          200,
          createSuccessEnvelope(rows, requestId),
          requestId,
          rateHeaders,
        );
      }

      if (method === "POST" && pathname === "/api/v1/saved-queries") {
        if (!principal.salesId) {
          throw new PlatformError("PERMISSION_DENIED", "Active user required");
        }
        const body = await readJsonBody(req);
        const { rows } = await options.db.query<Record<string, unknown>>(
          `insert into public.saved_views (
             resource, name, description, view_type, query_definition, is_shared, owner_sales_id
           ) values ($1, $2, $3, 'query', $4::jsonb, $5, $6)
           returning *`,
          [
            String(body.resource ?? "companies"),
            String(body.name ?? "Untitled query"),
            body.description ? String(body.description) : null,
            JSON.stringify(body.query_definition ?? {}),
            Boolean(body.is_shared),
            principal.salesId,
          ],
        );
        return jsonOut(
          201,
          createSuccessEnvelope(rows[0], requestId),
          requestId,
          rateHeaders,
        );
      }

      // Customers
      if (
        method === "GET" &&
        (pathname === "/api/v1/customers" ||
          pathname === "/integrations/v1/customers")
      ) {
        const fieldsParam = url.searchParams.get("fields");
        const data = await domain.searchCustomers(principal, ctx, {
          query: url.searchParams.get("q") ?? undefined,
          province: url.searchParams.get("province") ?? undefined,
          customerGroupCode:
            url.searchParams.get("customer_group") ?? undefined,
          page: url.searchParams.get("page")
            ? Number(url.searchParams.get("page"))
            : undefined,
          pageSize: url.searchParams.get("pageSize")
            ? Number(url.searchParams.get("pageSize"))
            : undefined,
          fields: fieldsParam
            ? fieldsParam
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
        });
        return jsonOut(
          200,
          createSuccessEnvelope(data.items, requestId, {
            page: data.page,
            pageSize: data.pageSize,
            total: data.total,
            totalPages: Math.max(1, Math.ceil(data.total / data.pageSize)),
            timezone: BANGKOK_TIMEZONE,
          }),
          requestId,
          rateHeaders,
        );
      }

      if (
        method === "POST" &&
        (pathname === "/api/v1/customers" ||
          pathname === "/integrations/v1/customers")
      ) {
        const body = await readJsonBody(req);
        const created = await domain.createCustomer(principal, ctx, body);
        return jsonOut(
          201,
          createSuccessEnvelope(created, requestId),
          requestId,
          rateHeaders,
        );
      }

      const custMatch = pathname.match(/^\/api\/v1\/customers\/(\d+)$/);
      if (custMatch && method === "GET") {
        const data = await domain.getCustomer(
          principal,
          ctx,
          parsePositiveInt(custMatch[1]),
        );
        return jsonOut(
          200,
          createSuccessEnvelope(data, requestId),
          requestId,
          rateHeaders,
        );
      }
      if (custMatch && method === "PATCH") {
        const body = await readJsonBody(req);
        const expectedVersion = parseExpectedVersion(req, body);
        const patch = { ...body };
        delete patch.expected_version;
        delete patch.version;
        const updated = await domain.updateCustomer(
          principal,
          ctx,
          parsePositiveInt(custMatch[1]),
          patch,
          expectedVersion,
        );
        return jsonOut(
          200,
          createSuccessEnvelope(updated, requestId),
          requestId,
          rateHeaders,
        );
      }

      const custSub = pathname.match(
        /^\/api\/v1\/customers\/(\d+)\/(contacts|history|machines)$/,
      );
      if (custSub) {
        const cid = parsePositiveInt(custSub[1]);
        if (custSub[2] === "contacts" && method === "POST") {
          const body = await readJsonBody(req);
          const created = await domain.createCustomerContact(principal, ctx, {
            ...(body as Parameters<
              CrmDomainServices["createCustomerContact"]
            >[2]),
            company_id: cid,
          });
          return jsonOut(
            201,
            createSuccessEnvelope(created, requestId),
            requestId,
            rateHeaders,
          );
        }
        if (custSub[2] === "history" && method === "GET") {
          const data = await domain.getCustomerHistory(principal, ctx, cid);
          return jsonOut(
            200,
            createSuccessEnvelope(data, requestId),
            requestId,
            rateHeaders,
          );
        }
        if (custSub[2] === "machines" && method === "GET") {
          const data = await domain.getCustomerMachines(principal, ctx, cid);
          return jsonOut(
            200,
            createSuccessEnvelope(data, requestId),
            requestId,
            rateHeaders,
          );
        }
      }

      // Machines
      if (method === "GET" && pathname === "/api/v1/machines/summary") {
        const data = await domain.getMachineSummary(principal, ctx);
        return jsonOut(
          200,
          createSuccessEnvelope(data, requestId),
          requestId,
          rateHeaders,
        );
      }
      if (method === "GET" && pathname === "/api/v1/machines") {
        const data = await domain.searchMachines(principal, ctx, {
          query: url.searchParams.get("q") ?? undefined,
          manufacturerName: url.searchParams.get("manufacturer") ?? undefined,
          companyId: url.searchParams.get("company_id")
            ? Number(url.searchParams.get("company_id"))
            : undefined,
        });
        return jsonOut(
          200,
          createSuccessEnvelope(data, requestId),
          requestId,
          rateHeaders,
        );
      }
      if (method === "POST" && pathname === "/api/v1/machines") {
        const body = await readJsonBody(req);
        const created = await domain.registerMachine(
          principal,
          ctx,
          body as Parameters<CrmDomainServices["registerMachine"]>[2],
        );
        return jsonOut(
          201,
          createSuccessEnvelope(created, requestId),
          requestId,
          rateHeaders,
        );
      }
      const machineMatch = pathname.match(/^\/api\/v1\/machines\/(\d+)$/);
      if (machineMatch && method === "GET") {
        const data = await domain.getMachine(
          principal,
          ctx,
          parsePositiveInt(machineMatch[1]),
        );
        return jsonOut(
          200,
          createSuccessEnvelope(data, requestId),
          requestId,
          rateHeaders,
        );
      }
      if (machineMatch && method === "PATCH") {
        const body = await readJsonBody(req);
        const expectedVersion = parseExpectedVersion(req, body);
        const patch = { ...body };
        delete patch.expected_version;
        delete patch.version;
        const updated = await domain.updateMachine(
          principal,
          ctx,
          parsePositiveInt(machineMatch[1]),
          patch,
          expectedVersion,
        );
        return jsonOut(
          200,
          createSuccessEnvelope(updated, requestId),
          requestId,
          rateHeaders,
        );
      }
      const machineHist = pathname.match(
        /^\/api\/v1\/machines\/(\d+)\/service-history$/,
      );
      if (machineHist && method === "GET") {
        const data = await domain.getMachineServiceHistory(
          principal,
          ctx,
          parsePositiveInt(machineHist[1]),
        );
        return jsonOut(
          200,
          createSuccessEnvelope(data, requestId),
          requestId,
          rateHeaders,
        );
      }

      // Products
      if (
        method === "GET" &&
        (pathname === "/api/v1/products" ||
          pathname === "/integrations/v1/products")
      ) {
        const data = await domain.searchProducts(principal, ctx, {
          query: url.searchParams.get("q") ?? undefined,
          material: url.searchParams.get("material") ?? undefined,
        });
        return jsonOut(
          200,
          createSuccessEnvelope(data, requestId),
          requestId,
          rateHeaders,
        );
      }
      if (
        method === "GET" &&
        pathname === "/api/v1/products/compatible-parts"
      ) {
        const data = await domain.findCompatibleParts(principal, ctx, {
          machineModelId: url.searchParams.get("machine_model_id")
            ? Number(url.searchParams.get("machine_model_id"))
            : undefined,
          machineModelQuery: url.searchParams.get("machine_model") ?? undefined,
          verifiedOnly: url.searchParams.get("verified_only") !== "false",
        });
        return jsonOut(
          200,
          createSuccessEnvelope(data, requestId),
          requestId,
          rateHeaders,
        );
      }
      const prodMatch = pathname.match(/^\/api\/v1\/products\/(\d+)$/);
      if (prodMatch && method === "GET") {
        const data = await domain.getProduct(
          principal,
          ctx,
          parsePositiveInt(prodMatch[1]),
        );
        return jsonOut(
          200,
          createSuccessEnvelope(data, requestId),
          requestId,
          rateHeaders,
        );
      }
      const prodPrice = pathname.match(/^\/api\/v1\/products\/(\d+)\/price$/);
      if (prodPrice && method === "GET") {
        const data = await domain.getProductPrice(principal, ctx, {
          productId: parsePositiveInt(prodPrice[1]),
          quantity: url.searchParams.get("quantity")
            ? Number(url.searchParams.get("quantity"))
            : 1,
          currency: url.searchParams.get("currency") ?? undefined,
        });
        return jsonOut(
          200,
          createSuccessEnvelope(data, requestId),
          requestId,
          rateHeaders,
        );
      }
      const prodInv = pathname.match(
        /^\/(?:api|integrations)\/v1\/products\/(\d+)\/inventory$/,
      );
      if (prodInv && method === "GET") {
        const data = await domain.getInventoryAvailability(
          principal,
          ctx,
          parsePositiveInt(prodInv[1]),
        );
        return jsonOut(
          200,
          createSuccessEnvelope(data, requestId),
          requestId,
          rateHeaders,
        );
      }

      // Sales & Opportunities
      if (method === "GET" && pathname === "/api/v1/opportunities") {
        const data = await domain.searchOpportunities(principal, ctx, {
          query: url.searchParams.get("q") ?? undefined,
          stage: url.searchParams.get("stage") ?? undefined,
          companyId: url.searchParams.get("company_id")
            ? Number(url.searchParams.get("company_id"))
            : undefined,
        });
        return jsonOut(
          200,
          createSuccessEnvelope(data, requestId),
          requestId,
          rateHeaders,
        );
      }
      if (method === "POST" && pathname === "/api/v1/opportunities") {
        const body = await readJsonBody(req);
        const created = await domain.createOpportunity(
          principal,
          ctx,
          body as Parameters<CrmDomainServices["createOpportunity"]>[2],
        );
        return jsonOut(
          201,
          createSuccessEnvelope(created, requestId),
          requestId,
          rateHeaders,
        );
      }
      const oppMatch = pathname.match(/^\/api\/v1\/opportunities\/(\d+)$/);
      if (oppMatch && method === "PATCH") {
        const body = await readJsonBody(req);
        const expectedVersion = parseExpectedVersion(req, body);
        const patch = { ...body };
        delete patch.expected_version;
        delete patch.version;
        const updated = await domain.updateOpportunity(
          principal,
          ctx,
          parsePositiveInt(oppMatch[1]),
          patch,
          expectedVersion,
        );
        return jsonOut(
          200,
          createSuccessEnvelope(updated, requestId),
          requestId,
          rateHeaders,
        );
      }
      if (method === "GET" && pathname === "/api/v1/sales/pipeline") {
        return jsonOut(
          200,
          createSuccessEnvelope(
            await domain.getSalesPipeline(principal, ctx),
            requestId,
          ),
          requestId,
          rateHeaders,
        );
      }
      if (method === "GET" && pathname === "/api/v1/sales/targets") {
        return jsonOut(
          200,
          createSuccessEnvelope(
            await domain.getSalesTarget(principal, ctx),
            requestId,
          ),
          requestId,
          rateHeaders,
        );
      }
      if (method === "GET" && pathname === "/api/v1/sales/forecasts") {
        return jsonOut(
          200,
          createSuccessEnvelope(
            await domain.getSalesForecast(principal, ctx),
            requestId,
          ),
          requestId,
          rateHeaders,
        );
      }

      // Visits & Follow-ups
      if (method === "GET" && pathname === "/api/v1/visits") {
        const data = await domain.getVisitHistory(principal, ctx, {
          companyId: url.searchParams.get("company_id")
            ? Number(url.searchParams.get("company_id"))
            : undefined,
        });
        return jsonOut(
          200,
          createSuccessEnvelope(data, requestId),
          requestId,
          rateHeaders,
        );
      }
      if (method === "POST" && pathname === "/api/v1/visits") {
        const body = await readJsonBody(req);
        const created = await domain.createVisitReport(
          principal,
          ctx,
          body as Parameters<CrmDomainServices["createVisitReport"]>[2],
        );
        return jsonOut(
          201,
          createSuccessEnvelope(created, requestId),
          requestId,
          rateHeaders,
        );
      }
      if (method === "POST" && pathname === "/api/v1/follow-ups") {
        const body = await readJsonBody(req);
        const created = await domain.createFollowUp(
          principal,
          ctx,
          body as Parameters<CrmDomainServices["createFollowUp"]>[2],
        );
        return jsonOut(
          201,
          createSuccessEnvelope(created, requestId),
          requestId,
          rateHeaders,
        );
      }
      const fuComplete = pathname.match(
        /^\/api\/v1\/follow-ups\/(\d+)\/complete$/,
      );
      if (fuComplete && method === "POST") {
        const res = await domain.completeFollowUp(
          principal,
          ctx,
          parsePositiveInt(fuComplete[1]),
        );
        return jsonOut(
          200,
          createSuccessEnvelope(res, requestId),
          requestId,
          rateHeaders,
        );
      }

      // Quotations
      if (method === "POST" && pathname === "/api/v1/quotations") {
        const body = await readJsonBody(req);
        const created = await domain.createQuotation(
          principal,
          ctx,
          body as Parameters<CrmDomainServices["createQuotation"]>[2],
        );
        return jsonOut(
          201,
          createSuccessEnvelope(created, requestId),
          requestId,
          rateHeaders,
        );
      }
      const qtMatch = pathname.match(/^\/api\/v1\/quotations\/(\d+)$/);
      if (qtMatch && method === "GET") {
        const data = await domain.getQuotation(
          principal,
          ctx,
          parsePositiveInt(qtMatch[1]),
        );
        return jsonOut(
          200,
          createSuccessEnvelope(data, requestId),
          requestId,
          rateHeaders,
        );
      }
      if (qtMatch && method === "PATCH") {
        const body = await readJsonBody(req);
        const expectedVersion = parseExpectedVersion(req, body);
        const patch = { ...body };
        delete patch.expected_version;
        delete patch.version;
        const updated = await domain.updateQuotationDraft(
          principal,
          ctx,
          parsePositiveInt(qtMatch[1]),
          patch,
          expectedVersion,
        );
        return jsonOut(
          200,
          createSuccessEnvelope(updated, requestId),
          requestId,
          rateHeaders,
        );
      }
      const qtSubmit = pathname.match(/^\/api\/v1\/quotations\/(\d+)\/submit$/);
      if (qtSubmit && method === "POST") {
        const res = await domain.submitQuotationForApproval(
          principal,
          ctx,
          parsePositiveInt(qtSubmit[1]),
        );
        return jsonOut(
          200,
          createSuccessEnvelope(res, requestId),
          requestId,
          rateHeaders,
        );
      }

      // Analytics, Reports, Data Management & Jobs
      if (method === "GET" && pathname === "/api/v1/analytics/customers") {
        return jsonOut(
          200,
          createSuccessEnvelope(
            await control.queryCustomerSummary(principal, ctx),
            requestId,
          ),
          requestId,
          rateHeaders,
        );
      }
      if (method === "GET" && pathname === "/api/v1/analytics/machines") {
        return jsonOut(
          200,
          createSuccessEnvelope(
            await control.queryMachineSummary(principal, ctx),
            requestId,
          ),
          requestId,
          rateHeaders,
        );
      }
      if (method === "GET" && pathname === "/api/v1/analytics/sales") {
        return jsonOut(
          200,
          createSuccessEnvelope(
            await control.querySalesSummary(principal, ctx),
            requestId,
          ),
          requestId,
          rateHeaders,
        );
      }
      if (
        method === "GET" &&
        pathname === "/api/v1/analytics/replacement-demand"
      ) {
        return jsonOut(
          200,
          createSuccessEnvelope(
            await control.queryReplacementDemand(principal, ctx),
            requestId,
          ),
          requestId,
          rateHeaders,
        );
      }
      if (method === "POST" && pathname === "/api/v1/reports") {
        const body = await readJsonBody(req);
        const created = await control.generateReport(
          principal,
          ctx,
          body as Parameters<CrmControlServices["generateReport"]>[2],
        );
        return jsonOut(
          201,
          createSuccessEnvelope(created, requestId),
          requestId,
          rateHeaders,
        );
      }
      const repMatch = pathname.match(/^\/api\/v1\/reports\/(\d+)$/);
      if (repMatch && method === "GET") {
        const data = await control.getSavedReport(
          principal,
          ctx,
          parsePositiveInt(repMatch[1]),
        );
        return jsonOut(
          200,
          createSuccessEnvelope(data, requestId),
          requestId,
          rateHeaders,
        );
      }

      if (method === "POST" && pathname === "/api/v1/data/imports/validate") {
        const body = await readJsonBody(req);
        return jsonOut(
          200,
          createSuccessEnvelope(
            await control.validateImport(
              principal,
              ctx,
              body as Parameters<CrmControlServices["validateImport"]>[2],
            ),
            requestId,
          ),
          requestId,
          rateHeaders,
        );
      }
      if (
        method === "POST" &&
        pathname === "/api/v1/data/bulk-updates/preview"
      ) {
        const body = await readJsonBody(req);
        return jsonOut(
          200,
          createSuccessEnvelope(
            await control.previewBulkUpdate(
              principal,
              ctx,
              body as Parameters<CrmControlServices["previewBulkUpdate"]>[2],
            ),
            requestId,
          ),
          requestId,
          rateHeaders,
        );
      }
      if (method === "POST" && pathname === "/api/v1/data/exports") {
        const body = await readJsonBody(req);
        return jsonOut(
          202,
          createSuccessEnvelope(
            await control.generateExport(
              principal,
              ctx,
              body as Parameters<CrmControlServices["generateExport"]>[2],
            ),
            requestId,
          ),
          requestId,
          rateHeaders,
        );
      }

      if (method === "GET" && pathname === "/api/v1/jobs") {
        return jsonOut(
          200,
          createSuccessEnvelope(
            await control.getAutomationJobs(principal, ctx),
            requestId,
          ),
          requestId,
          rateHeaders,
        );
      }
      if (method === "POST" && pathname === "/api/v1/jobs") {
        const body = await readJsonBody(req);
        return jsonOut(
          201,
          createSuccessEnvelope(
            await control.createAutomationJob(
              principal,
              ctx,
              body as Parameters<CrmControlServices["createAutomationJob"]>[2],
            ),
            requestId,
          ),
          requestId,
          rateHeaders,
        );
      }
      const jobMatch = pathname.match(
        /^\/(?:api|integrations)\/v1\/jobs\/(\d+)$/,
      );
      if (jobMatch && method === "GET") {
        return jsonOut(
          200,
          createSuccessEnvelope(
            await control.getJobStatus(
              principal,
              ctx,
              parsePositiveInt(jobMatch[1]),
            ),
            requestId,
          ),
          requestId,
          rateHeaders,
        );
      }
      const jobCancel = pathname.match(/^\/api\/v1\/jobs\/(\d+)\/cancel$/);
      if (jobCancel && method === "POST") {
        return jsonOut(
          200,
          createSuccessEnvelope(
            await control.cancelAuthorizedJob(
              principal,
              ctx,
              parsePositiveInt(jobCancel[1]),
            ),
            requestId,
          ),
          requestId,
          rateHeaders,
        );
      }

      // ======================================================================
      // B. ADMIN CONTROL PLANE & MCP GOVERNANCE API (/admin/v1/*)
      // ======================================================================

      if (method === "GET" && pathname === "/admin/v1/overview") {
        if (
          !evaluateAccess(principal, {
            resource: "admin_console",
            action: "read",
          })
        ) {
          throw new PlatformError(
            "PERMISSION_DENIED",
            "Permission admin_console:read required",
          );
        }
        const mcpOverview = evaluateAccess(principal, {
          resource: "mcp_admin",
          action: "read",
        })
          ? await governance.getMcpOverview(principal, protocolVersion)
          : null;
        return jsonOut(
          200,
          createSuccessEnvelope({ mcp: mcpOverview }, requestId, {
            timezone: BANGKOK_TIMEZONE,
          }),
          requestId,
          rateHeaders,
        );
      }

      if (method === "GET" && pathname === "/admin/v1/users") {
        return jsonOut(
          200,
          createSuccessEnvelope(
            await control.getUsers(principal, ctx),
            requestId,
          ),
          requestId,
          rateHeaders,
        );
      }
      if (method === "GET" && pathname === "/admin/v1/roles") {
        return jsonOut(
          200,
          createSuccessEnvelope(
            await control.getRoles(principal, ctx),
            requestId,
          ),
          requestId,
          rateHeaders,
        );
      }
      if (method === "GET" && pathname === "/admin/v1/permissions") {
        return jsonOut(
          200,
          createSuccessEnvelope(
            await control.getPermissions(
              principal,
              ctx,
              url.searchParams.get("role_key") ?? undefined,
            ),
            requestId,
          ),
          requestId,
          rateHeaders,
        );
      }
      if (method === "GET" && pathname === "/admin/v1/audit-logs") {
        return jsonOut(
          200,
          createSuccessEnvelope(
            await control.getAuditHistory(principal, ctx, {
              tableName: url.searchParams.get("table") ?? undefined,
              channel: url.searchParams.get("channel") ?? undefined,
            }),
            requestId,
          ),
          requestId,
          rateHeaders,
        );
      }

      // Admin MCP Governance
      if (method === "GET" && pathname === "/admin/v1/mcp/overview") {
        return jsonOut(
          200,
          createSuccessEnvelope(
            await governance.getMcpOverview(principal, protocolVersion),
            requestId,
            { timezone: BANGKOK_TIMEZONE },
          ),
          requestId,
          rateHeaders,
        );
      }

      if (
        method === "PUT" &&
        pathname === "/admin/v1/mcp/organization-policy"
      ) {
        const body = await readJsonBody(req);
        return jsonOut(
          200,
          createSuccessEnvelope(
            await governance.updateOrganizationMcpPolicy(principal, {
              mcpEnabled: Boolean(body.mcpEnabled),
            }),
            requestId,
          ),
          requestId,
          rateHeaders,
        );
      }

      if (method === "GET" && pathname === "/admin/v1/mcp/tools") {
        return jsonOut(
          200,
          createSuccessEnvelope(
            await governance.listTools(principal),
            requestId,
          ),
          requestId,
          rateHeaders,
        );
      }

      const toolPatchMatch = pathname.match(
        /^\/admin\/v1\/mcp\/tools\/([a-z][a-z0-9_]*)$/,
      );
      if (toolPatchMatch && method === "PATCH") {
        const body = await readJsonBody(req);
        return jsonOut(
          200,
          createSuccessEnvelope(
            await governance.updateToolConfig(
              principal,
              toolPatchMatch[1],
              body as Parameters<McpGovernanceService["updateToolConfig"]>[2],
            ),
            requestId,
          ),
          requestId,
          rateHeaders,
        );
      }

      const rolePolicyMatch = pathname.match(
        /^\/admin\/v1\/mcp\/roles\/([a-z][a-z0-9_]*)\/policy$/,
      );
      if (rolePolicyMatch && method === "PUT") {
        const body = await readJsonBody(req);
        return jsonOut(
          200,
          createSuccessEnvelope(
            await governance.upsertRolePolicy(
              principal,
              rolePolicyMatch[1],
              body as Parameters<McpGovernanceService["upsertRolePolicy"]>[2],
            ),
            requestId,
          ),
          requestId,
          rateHeaders,
        );
      }

      const roleToolMatch = pathname.match(
        /^\/admin\/v1\/mcp\/roles\/([a-z][a-z0-9_]*)\/tools\/([a-z][a-z0-9_]*)$/,
      );
      if (roleToolMatch && method === "PUT") {
        const body = await readJsonBody(req);
        return jsonOut(
          200,
          createSuccessEnvelope(
            await governance.upsertRoleToolPermission(
              principal,
              roleToolMatch[1],
              roleToolMatch[2],
              body as Parameters<
                McpGovernanceService["upsertRoleToolPermission"]
              >[3],
            ),
            requestId,
          ),
          requestId,
          rateHeaders,
        );
      }

      const rolePreviewMatch = pathname.match(
        /^\/admin\/v1\/mcp\/roles\/([a-z][a-z0-9_]*)\/preview$/,
      );
      if (rolePreviewMatch && method === "GET") {
        return jsonOut(
          200,
          createSuccessEnvelope(
            await governance.getRoleEffectivePreview(
              principal,
              rolePreviewMatch[1],
              options.toolSubjects ?? [],
            ),
            requestId,
          ),
          requestId,
          rateHeaders,
        );
      }

      if (method === "GET" && pathname === "/admin/v1/mcp/users") {
        return jsonOut(
          200,
          createSuccessEnvelope(
            await governance.listUserMcpAccess(principal),
            requestId,
          ),
          requestId,
          rateHeaders,
        );
      }

      const userPolicyMatch = pathname.match(
        /^\/admin\/v1\/mcp\/users\/(\d+)\/policy$/,
      );
      if (userPolicyMatch && method === "PUT") {
        const body = await readJsonBody(req);
        return jsonOut(
          200,
          createSuccessEnvelope(
            await governance.upsertUserMcpPolicy(
              principal,
              parsePositiveInt(userPolicyMatch[1]),
              body as Parameters<
                McpGovernanceService["upsertUserMcpPolicy"]
              >[2],
            ),
            requestId,
          ),
          requestId,
          rateHeaders,
        );
      }

      const userRevokeMatch = pathname.match(
        /^\/admin\/v1\/mcp\/users\/(\d+)\/revoke$/,
      );
      if (userRevokeMatch && method === "POST") {
        const body = await readJsonBody(req);
        return jsonOut(
          200,
          createSuccessEnvelope(
            await governance.revokeUserMcpAccess(
              principal,
              parsePositiveInt(userRevokeMatch[1]),
              String(body.reason ?? "Admin revocation"),
            ),
            requestId,
          ),
          requestId,
          rateHeaders,
        );
      }

      if (method === "GET" && pathname === "/admin/v1/mcp/clients") {
        return jsonOut(
          200,
          createSuccessEnvelope(
            await governance.listClients(principal),
            requestId,
          ),
          requestId,
          rateHeaders,
        );
      }
      if (method === "POST" && pathname === "/admin/v1/mcp/clients") {
        const body = await readJsonBody(req);
        return jsonOut(
          201,
          createSuccessEnvelope(
            await governance.registerClient(
              principal,
              body as Parameters<McpGovernanceService["registerClient"]>[1],
            ),
            requestId,
          ),
          requestId,
          rateHeaders,
        );
      }
      const clientRevoke = pathname.match(
        /^\/admin\/v1\/mcp\/clients\/([A-Za-z0-9._:-]+)\/revoke$/,
      );
      if (clientRevoke && method === "POST") {
        const body = await readJsonBody(req);
        return jsonOut(
          200,
          createSuccessEnvelope(
            await governance.revokeClient(
              principal,
              clientRevoke[1],
              String(body.reason ?? "Admin revocation"),
            ),
            requestId,
          ),
          requestId,
          rateHeaders,
        );
      }

      if (method === "GET" && pathname === "/admin/v1/mcp/connections") {
        return jsonOut(
          200,
          createSuccessEnvelope(
            await governance.listConnections(principal),
            requestId,
          ),
          requestId,
          rateHeaders,
        );
      }
      const connRevoke = pathname.match(
        /^\/admin\/v1\/mcp\/connections\/([0-9a-fA-F-]+)\/revoke$/,
      );
      if (connRevoke && method === "POST") {
        const body = await readJsonBody(req);
        return jsonOut(
          200,
          createSuccessEnvelope(
            await governance.revokeConnection(
              principal,
              connRevoke[1],
              String(body.reason ?? "Revoked"),
            ),
            requestId,
          ),
          requestId,
          rateHeaders,
        );
      }

      if (method === "GET" && pathname === "/admin/v1/mcp/approvals") {
        return jsonOut(
          200,
          createSuccessEnvelope(
            {
              approvals: await control.approvals.listApprovalRequests(
                principal,
                { status: url.searchParams.get("status") ?? undefined },
              ),
            },
            requestId,
          ),
          requestId,
          rateHeaders,
        );
      }

      const apprDecision = pathname.match(
        /^\/admin\/v1\/mcp\/approvals\/(\d+)\/(approve|reject)$/,
      );
      if (apprDecision && method === "POST") {
        const body = await readJsonBody(req);
        const decision =
          apprDecision[2] === "approve" ? "approved" : "rejected";
        const updated = await control.approvals.decideApproval(
          principal,
          parsePositiveInt(apprDecision[1]),
          decision,
          body.comment ? String(body.comment) : undefined,
        );
        return jsonOut(
          200,
          createSuccessEnvelope(updated, requestId),
          requestId,
          rateHeaders,
        );
      }

      if (method === "GET" && pathname === "/admin/v1/mcp/logs") {
        return jsonOut(
          200,
          createSuccessEnvelope(
            await governance.listExecutionLogs(principal, {
              toolName: url.searchParams.get("tool") ?? undefined,
              result: url.searchParams.get("result") ?? undefined,
            }),
            requestId,
          ),
          requestId,
          rateHeaders,
        );
      }

      if (method === "GET" && pathname === "/admin/v1/mcp/security-events") {
        return jsonOut(
          200,
          createSuccessEnvelope(
            await governance.listSecurityEvents(principal, {
              severity: url.searchParams.get("severity") ?? undefined,
              eventType: url.searchParams.get("type") ?? undefined,
            }),
            requestId,
          ),
          requestId,
          rateHeaders,
        );
      }

      return jsonOut(
        404,
        createErrorEnvelope(
          "RESOURCE_NOT_AVAILABLE",
          `Route not found: ${method} ${pathname}`,
          requestId,
        ),
        requestId,
        rateHeaders,
      );
    } catch (err) {
      return platformErrorToResponse(err, requestId, rateHeaders);
    }
  };
}
