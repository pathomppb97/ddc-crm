import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  getRequestId,
  OptionsMiddleware,
  resolveCorsHeaders,
} from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { createErrorResponse } from "../_shared/utils.ts";

/**
 * Versioned API-First Gateway Edge Function (/api/v1/* and /admin/v1/*).
 *
 * Phase 1 exposes authenticated health, caller context (/api/v1/me), and
 * administrative system overview (/admin/v1/overview) backed by live
 * PostgreSQL RLS and server-side RBAC. Phase 2 wires full business resource
 * CRUD and allowlisted Dynamic Query Builder endpoints onto this gateway.
 */

const BANGKOK_TZ = "Asia/Bangkok";

const json = (req: Request, status: number, body: unknown) => {
  const requestId = getRequestId(req);
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Request-Id": requestId,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      ...resolveCorsHeaders(req),
    },
  });
};

async function resolveCaller(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SB_PUBLISHABLE_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return null;

  const { data: sale } = await supabaseAdmin
    .from("sales")
    .select(
      "id, email, first_name, last_name, administrator, disabled, role_key",
    )
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (!sale) return null;

  const { data: permissions } = sale.role_key
    ? await supabaseAdmin
        .from("role_permissions")
        .select("resource, action, scope")
        .eq("role_key", sale.role_key)
    : { data: [] };

  return {
    user: userData.user,
    sale,
    permissions: permissions ?? [],
    userClient,
  };
}

function normalizePath(pathname: string): string {
  return (
    pathname.replace(/^\/functions\/v1\/api_v1/, "").replace(/^\/api_v1/, "") ||
    "/"
  );
}

Deno.serve(async (req: Request) =>
  OptionsMiddleware(req, async (req) => {
    const requestId = getRequestId(req);
    const pathname = normalizePath(new URL(req.url).pathname);

    if (
      req.method === "GET" &&
      (pathname === "/api/v1/health" || pathname === "/integrations/v1/health")
    ) {
      return json(req, 200, {
        data: {
          status: "ok",
          service: "ddc-crm-api-v1",
          version: "2.0.0",
          namespaces: ["/api/v1/", "/admin/v1/", "/integrations/v1/", "/mcp"],
          utcTime: new Date().toISOString(),
          displayTimezone: BANGKOK_TZ,
        },
        requestId,
      });
    }

    const caller = await resolveCaller(req);
    if (!caller) {
      return createErrorResponse(
        401,
        "Authentication required",
        { code: "UNAUTHENTICATED" },
        req,
      );
    }
    if (caller.sale.disabled) {
      return createErrorResponse(
        401,
        "Account is disabled",
        { code: "ACCOUNT_DISABLED" },
        req,
      );
    }

    const isSuperOrAdmin =
      Boolean(caller.sale.administrator) ||
      caller.sale.role_key === "super_admin";

    if (req.method === "GET" && pathname === "/api/v1/me") {
      return json(req, 200, {
        data: {
          userId: caller.user.id,
          salesId: caller.sale.id,
          email: caller.sale.email,
          roleKey: caller.sale.role_key,
          administrator: Boolean(caller.sale.administrator),
          permissions: caller.permissions,
        },
        meta: { timezone: BANGKOK_TZ },
        requestId,
      });
    }

    if (pathname.startsWith("/admin/v1/")) {
      const canAccessAdmin =
        isSuperOrAdmin ||
        caller.permissions.some(
          (p: { resource: string; action: string }) =>
            p.resource === "admin_console" && p.action === "read",
        );

      if (!canAccessAdmin) {
        return createErrorResponse(
          403,
          "Admin Control Center permission required",
          { code: "ADMIN_REQUIRED" },
          req,
        );
      }

      if (req.method === "GET" && pathname === "/admin/v1/overview") {
        const [usersRes, flagsRes, jobsRes, configRes] = await Promise.all([
          supabaseAdmin
            .from("sales")
            .select("id, disabled", { count: "exact" }),
          supabaseAdmin
            .from("feature_flags")
            .select("id, is_enabled, kill_switch"),
          supabaseAdmin.from("scheduled_jobs").select("id, status"),
          supabaseAdmin
            .from("ui_config_versions")
            .select("id, environment, version_number, status, published_at")
            .eq("status", "published"),
        ]);

        const users = usersRes.data ?? [];
        const flags = flagsRes.data ?? [];
        const jobs = jobsRes.data ?? [];

        return json(req, 200, {
          data: {
            users: {
              total: users.length,
              active: users.filter((u: { disabled: boolean }) => !u.disabled)
                .length,
              disabled: users.filter((u: { disabled: boolean }) => u.disabled)
                .length,
            },
            featureFlags: {
              total: flags.length,
              enabled: flags.filter(
                (f: { is_enabled: boolean; kill_switch: boolean }) =>
                  f.is_enabled && !f.kill_switch,
              ).length,
              killSwitched: flags.filter(
                (f: { kill_switch: boolean }) => f.kill_switch,
              ).length,
            },
            jobs: {
              total: jobs.length,
              running: jobs.filter(
                (j: { status: string }) => j.status === "running",
              ).length,
              failed: jobs.filter(
                (j: { status: string }) => j.status === "failed",
              ).length,
              scheduled: jobs.filter(
                (j: { status: string }) =>
                  j.status === "scheduled" || j.status === "pending",
              ).length,
            },
            activeUiConfigs: configRes.data ?? [],
          },
          meta: { timezone: BANGKOK_TZ },
          requestId,
        });
      }
    }

    return createErrorResponse(
      404,
      `Route not found: ${req.method} ${pathname}`,
      { code: "NOT_FOUND" },
      req,
    );
  }),
);
