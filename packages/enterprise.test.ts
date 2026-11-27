import { describe, expect, it } from "vitest";
import {
  applyFieldPermissions,
  evaluateAccess,
  hasAdminConsoleAccess,
  redactSecrets,
  type AuthPrincipal,
} from "./shared-auth/src/index";
import {
  canTransitionUiConfigStatus,
  evaluateFeatureFlag,
  stableRolloutBucket,
  validateUiConfigPayload,
  type FeatureFlagRecord,
} from "./shared-config/src/index";
import {
  compileAllowlistedQuery,
  QueryValidationError,
} from "./shared-api/src/index";
import {
  bangkokLocalToUtcIso,
  formatBangkokDateTime,
} from "./shared-ui/src/index";
import {
  createApiV1Handler,
  SlidingWindowRateLimiter,
  type IdempotencyRecord,
} from "../apps/api/src/index";
import {
  canTransitionJobStatus,
  computeRetryDelaySeconds,
  isLeaseExpired,
  planJobFailureRecovery,
  runWorkerTick,
  type ScheduledJobRecord,
  type WorkerStore,
} from "../apps/worker/src/index";

const makePrincipal = (
  overrides: Partial<AuthPrincipal> = {},
): AuthPrincipal => ({
  userId: "00000000-0000-4000-8000-000000000001",
  salesId: 10,
  email: "rep@ddc.example.test",
  roleKey: "sales_rep",
  administrator: false,
  disabled: false,
  teamIds: [2],
  territoryIds: [5],
  permissions: [
    { resource: "customers", action: "read", scope: "all" },
    { resource: "customers", action: "update", scope: "own" },
  ],
  ...overrides,
});

describe("shared-auth: RBAC, data scopes, field masking & redaction", () => {
  it("enforces deny-by-default and rejects disabled administrators", () => {
    const disabledAdmin = makePrincipal({
      administrator: true,
      roleKey: "super_admin",
      disabled: true,
    });
    expect(
      evaluateAccess(disabledAdmin, { resource: "customers", action: "read" }),
    ).toBe(false);
    expect(hasAdminConsoleAccess(disabledAdmin)).toBe(false);
  });

  it("enforces own, team, and territory scopes properly", () => {
    const rep = makePrincipal({
      permissions: [
        { resource: "customers", action: "update", scope: "own" },
        { resource: "deals", action: "read", scope: "team" },
        { resource: "leads", action: "read", scope: "territory" },
      ],
    });

    expect(
      evaluateAccess(rep, {
        resource: "customers",
        action: "update",
        ownerSalesId: 10,
      }),
    ).toBe(true);
    expect(
      evaluateAccess(rep, {
        resource: "customers",
        action: "update",
        ownerSalesId: 99,
      }),
    ).toBe(false);
    expect(
      evaluateAccess(rep, {
        resource: "deals",
        action: "read",
        ownerSalesId: 99,
        ownerTeamIds: [2],
      }),
    ).toBe(true);
    expect(
      evaluateAccess(rep, {
        resource: "leads",
        action: "read",
        recordTerritoryId: 5,
      }),
    ).toBe(true);
    expect(
      evaluateAccess(rep, {
        resource: "leads",
        action: "read",
        recordTerritoryId: 99,
      }),
    ).toBe(false);
  });

  it("applies field-level hidden and masked rules for non-admins", () => {
    const rep = makePrincipal({
      fieldPermissions: [
        { resource: "customers", fieldName: "revenue", accessLevel: "hidden" },
        {
          resource: "customers",
          fieldName: "tax_identifier",
          accessLevel: "masked",
        },
        { resource: "customers", fieldName: "email", accessLevel: "masked" },
      ],
    });

    const filtered = applyFieldPermissions(
      {
        id: 1,
        name: "Kaset Sugar Mill",
        revenue: "500M",
        tax_identifier: "0105556123456",
        email: "procurement@mill.co.th",
      },
      "customers",
      rep,
    );

    expect("revenue" in filtered).toBe(false);
    expect(filtered.tax_identifier).toBe("*********3456");
    expect(filtered.email).toBe("p***@mill.co.th");
  });

  it("recursively redacts passwords, tokens, and API keys from log objects", () => {
    const clean = redactSecrets({
      authorization: "Bearer eyJhbGciOi...",
      nested: {
        client_secret: "shhh",
        keyHash: "abc",
        api_key: "ddc_live_abc123456789",
        safeField: "ok",
      },
      note: "ddc_live_secretvalue999",
    }) as Record<string, unknown>;

    expect(clean.authorization).toBe("[REDACTED]");
    expect(clean.note).toBe("[REDACTED_KEY]");
    expect((clean.nested as Record<string, unknown>).client_secret).toBe(
      "[REDACTED]",
    );
    expect((clean.nested as Record<string, unknown>).safeField).toBe("ok");
  });
});

describe("shared-config: typed UI config & feature flags", () => {
  it("accepts a valid typed UI configuration and enforces lifecycle transitions", () => {
    const result = validateUiConfigPayload({
      branding: { title: "DDC Agriculture CRM", supportEmail: "it@ddc.example.test" },
      theme: {
        primary: "#0f4c3a",
        secondary: "#1e293b",
        accent: "#0ea5e9",
        surface: "#f8fafc",
        danger: "#b91c1c",
        warning: "#b45309",
        success: "#15803d",
      },
      typography: { fontFamily: "IBM Plex Sans Thai", density: "default" },
      logos: { lightModeUrl: "/assets/ddc-logo.png" },
    });

    expect(result.valid).toBe(true);
    expect(canTransitionUiConfigStatus("draft", "validated")).toBe(true);
    expect(canTransitionUiConfigStatus("draft", "published")).toBe(false);
    expect(canTransitionUiConfigStatus("approved", "published")).toBe(true);
  });

  it("rejects XSS scripts, javascript URLs, SVG data URIs, and invalid colors", () => {
    const xssTitle = validateUiConfigPayload({
      branding: { title: "<script>alert(1)</script>" },
    });
    const jsLogo = validateUiConfigPayload({
      logos: { lightModeUrl: "javascript:alert(1)" },
    });
    const svgLogo = validateUiConfigPayload({
      logos: {
        lightModeUrl: "data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Lz48L3N2Zz4=",
      },
    });
    const badColor = validateUiConfigPayload({
      theme: { primary: "red; background:url(javascript:alert(1))" },
    });

    expect(xssTitle.valid).toBe(false);
    expect(jsLogo.valid).toBe(false);
    expect(svgLogo.valid).toBe(false);
    expect(badColor.valid).toBe(false);
  });

  it("evaluates feature flags with kill switch, schedule, targeting, and deterministic rollout", () => {
    const baseFlag: FeatureFlagRecord = {
      flagKey: "field.visit_v2",
      isEnabled: true,
      killSwitch: false,
      rolloutPercentage: 25,
      targetUserIds: [42],
      targetRoleKeys: ["sales_manager"],
      targetTeamIds: [7],
      scheduledEnableAt: "2026-11-01T00:00:00Z",
      scheduledDisableAt: "2026-12-31T23:59:59Z",
    };
    const now = new Date("2026-11-27T04:00:00Z");

    expect(
      evaluateFeatureFlag(
        { ...baseFlag, killSwitch: true },
        {
          salesId: 42,
          nowUtc: now,
        },
      ),
    ).toMatchObject({ enabled: false, reason: "kill_switch" });

    expect(
      evaluateFeatureFlag(baseFlag, {
        salesId: 42,
        nowUtc: new Date("2026-10-01T00:00:00Z"),
      }),
    ).toMatchObject({ enabled: false, reason: "outside_schedule" });

    expect(
      evaluateFeatureFlag(baseFlag, { salesId: 42, nowUtc: now }),
    ).toMatchObject({ enabled: true, reason: "user_target" });

    expect(
      evaluateFeatureFlag(baseFlag, {
        salesId: 999,
        roleKey: "sales_manager",
        nowUtc: now,
      }),
    ).toMatchObject({ enabled: true, reason: "role_target" });

    expect(
      evaluateFeatureFlag(baseFlag, {
        salesId: 999,
        teamIds: [7],
        nowUtc: now,
      }),
    ).toMatchObject({ enabled: true, reason: "team_target" });

    // Stable deterministic bucket
    expect(stableRolloutBucket("field.visit_v2", "105")).toBe(
      stableRolloutBucket("field.visit_v2", "105"),
    );
  });
});

describe("shared-api: allowlisted Dynamic Query Builder (no raw SQL)", () => {
  it("compiles a valid structured query into strictly parameterized bindings", () => {
    const compiled = compileAllowlistedQuery({
      resource: "companies",
      select: ["id", "name", "province"],
      filters: [
        { field: "province", op: "contains", value: "Khon_Kaen%100" },
        { field: "territory_id", op: "in", value: [1, 2] },
      ],
      sort: [{ field: "name", direction: "asc" }],
      page: 2,
      pageSize: 20,
    });

    expect(compiled.table).toBe("companies");
    expect(compiled.permissionResource).toBe("customers");
    expect(compiled.whereSql).toBe(
      `"deleted_at" IS NULL AND "province" ILIKE $1 ESCAPE '\\' AND "territory_id" = ANY($2)`,
    );
    expect(compiled.params).toEqual(["%Khon\\_Kaen\\%100%", [1, 2]]);
    expect(compiled.orderBySql).toBe(`"name" ASC`);
    expect(compiled.limit).toBe(20);
    expect(compiled.offset).toBe(20);
  });

  it("rejects non-allowlisted tables, sensitive columns, invalid operators, and SQL injection", () => {
    expect(() => compileAllowlistedQuery({ resource: "api_keys" })).toThrow(
      QueryValidationError,
    );

    expect(() =>
      compileAllowlistedQuery({
        resource: "companies",
        select: ["id; DROP TABLE companies;--"],
      }),
    ).toThrow(QueryValidationError);

    expect(() =>
      compileAllowlistedQuery({
        resource: "companies",
        filters: [{ field: "sales_id", op: "contains", value: "1" }],
      }),
    ).toThrow(QueryValidationError);

    expect(() =>
      compileAllowlistedQuery({
        resource: "companies",
        pageSize: 500,
      }),
    ).toThrow(QueryValidationError);
  });
});

describe("shared-ui: UTC to Asia/Bangkok timezone formatting", () => {
  it("converts Bangkok local wall-clock schedule to UTC and formats UTC back in ICT", () => {
    const utcIso = bangkokLocalToUtcIso("2026-11-27T14:30");
    expect(utcIso).toBe("2026-11-27T07:30:00.000Z");

    const formatted = formatBangkokDateTime(utcIso, "en");
    expect(formatted).toContain("14:30:00");
    expect(formatted).toContain("ICT");
  });
});

describe("apps/api: API v1 gateway auth, RBAC, rate limiting & idempotency", () => {
  const buildGateway = (principal: AuthPrincipal | null) => {
    const idemStore = new Map<string, IdempotencyRecord>();
    const handler = createApiV1Handler({
      resolvePrincipal: async () => principal,
      executeCompiledQuery: async () => ({
        rows: [{ id: 1, name: "Mill A", tax_identifier: "0105556123456" }],
        total: 1,
      }),
      getFeatureFlags: async () => [
        {
          flagKey: "crm.new_catalog",
          isEnabled: true,
          killSwitch: false,
          rolloutPercentage: 100,
          targetUserIds: [],
          targetRoleKeys: [],
          targetTeamIds: [],
        },
      ],
      getAdminOverview: async () => ({ healthy: true }),
      getIdempotencyRecord: async (u, e, k) =>
        idemStore.get(`${u}:${e}:${k}`) ?? null,
      saveIdempotencyRecord: async (u, e, k, rec) => {
        idemStore.set(`${u}:${e}:${k}`, rec);
      },
      rateLimiter: new SlidingWindowRateLimiter(),
    });
    return handler;
  };

  it("allows unauthenticated /api/v1/health and rejects unauthenticated business/admin calls", async () => {
    const handler = buildGateway(null);

    const health = await handler(new Request("https://api.test/api/v1/health"));
    expect(health.status).toBe(200);
    expect(health.headers.get("x-request-id")).toMatch(/^req_/);

    const me = await handler(new Request("https://api.test/api/v1/me"));
    expect(me.status).toBe(401);

    const admin = await handler(
      new Request("https://api.test/admin/v1/overview"),
    );
    expect(admin.status).toBe(401);
  });

  it("rejects sales_rep on /admin/v1/* with 403 and masks fields on /api/v1/query", async () => {
    const rep = makePrincipal({
      fieldPermissions: [
        {
          resource: "customers",
          fieldName: "tax_identifier",
          accessLevel: "masked",
        },
      ],
    });
    const handler = buildGateway(rep);

    const adminDenied = await handler(
      new Request("https://api.test/admin/v1/overview"),
    );
    expect(adminDenied.status).toBe(403);

    const queryOk = await handler(
      new Request("https://api.test/api/v1/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resource: "companies",
          select: ["id", "name"],
        }),
      }),
    );
    expect(queryOk.status).toBe(200);
    const payload = (await queryOk.json()) as {
      data: Array<Record<string, unknown>>;
    };
    expect(payload.data[0].tax_identifier).toBe("*********3456");
  });

  it("enforces Idempotency-Key replay and conflict detection on /admin/v1/ui-configs", async () => {
    const admin = makePrincipal({
      administrator: true,
      roleKey: "super_admin",
    });
    const handler = buildGateway(admin);

    const req1 = new Request("https://api.test/admin/v1/ui-configs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "cfg-draft-001",
      },
      body: JSON.stringify({
        environment: "staging",
        configPayload: { branding: { title: "DDC Staging" } },
      }),
    });
    const res1 = await handler(req1);
    expect(res1.status).toBe(201);

    // Same key + same body -> replayed
    const req2 = new Request("https://api.test/admin/v1/ui-configs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "cfg-draft-001",
      },
      body: JSON.stringify({
        environment: "staging",
        configPayload: { branding: { title: "DDC Staging" } },
      }),
    });
    const res2 = await handler(req2);
    expect(res2.status).toBe(201);
    expect(res2.headers.get("x-idempotent-replayed")).toBe("true");

    // Same key + different body -> 409 conflict
    const req3 = new Request("https://api.test/admin/v1/ui-configs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "cfg-draft-001",
      },
      body: JSON.stringify({
        environment: "production",
        configPayload: { branding: { title: "Tampered" } },
      }),
    });
    const res3 = await handler(req3);
    expect(res3.status).toBe(409);
  });
});

describe("apps/worker: durable job state machine, retries & lease recovery", () => {
  it("computes bounded exponential retry backoff and transitions cleanly", () => {
    expect(canTransitionJobStatus("scheduled", "running")).toBe(true);
    expect(canTransitionJobStatus("completed", "running")).toBe(false);
    expect(computeRetryDelaySeconds(1, 30, 3600)).toBe(30);
    expect(computeRetryDelaySeconds(3, 30, 3600)).toBe(120);
    expect(computeRetryDelaySeconds(20, 30, 3600)).toBe(3600);

    const now = new Date("2026-11-27T05:00:00.000Z");
    expect(
      planJobFailureRecovery({ attemptCount: 1, maxAttempts: 3 }, now),
    ).toEqual({
      nextStatus: "retrying",
      nextRetryAtUtc: "2026-11-27T05:00:30.000Z",
    });
    expect(
      planJobFailureRecovery({ attemptCount: 3, maxAttempts: 3 }, now),
    ).toEqual({
      nextStatus: "failed",
      nextRetryAtUtc: null,
    });

    expect(
      isLeaseExpired(
        { status: "running", lockedUntilUtc: "2026-11-27T04:59:00.000Z" },
        now,
      ),
    ).toBe(true);
  });

  it("executes a claimed job and retries on transient handler failure", async () => {
    const job: ScheduledJobRecord = {
      id: 77,
      jobType: "data_export",
      queueName: "exports",
      status: "running",
      payload: { resource: "companies" },
      scheduledAtUtc: "2026-11-27T05:00:00.000Z",
      attemptCount: 1,
      maxAttempts: 3,
    };

    const recorded: {
      failureStatus?: string;
      logs: string[];
    } = { logs: [] };

    const store: WorkerStore = {
      claimNext: async () => job,
      markCompleted: async () => undefined,
      markFailure: async (_id, nextStatus) => {
        recorded.failureStatus = nextStatus;
      },
      appendLog: async (_id, _attempt, _level, message) => {
        recorded.logs.push(message);
      },
    };

    const tick = await runWorkerTick({
      workerId: "worker-test-1",
      queueName: "exports",
      store,
      handlers: {
        data_export: async () => {
          throw new Error("Transient storage timeout");
        },
      },
      nowUtc: new Date("2026-11-27T05:00:00.000Z"),
    });

    expect(tick).toEqual({
      processed: true,
      jobId: 77,
      finalStatus: "retrying",
    });
    expect(recorded.failureStatus).toBe("retrying");
    expect(recorded.logs.length).toBeGreaterThanOrEqual(2);
  });
});
