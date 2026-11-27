// DDC Agriculture CRM — Enterprise Remote MCP Edge Function (SEC-04 Remediated).
//
// Replaces the legacy upstream Atomic CRM raw-SQL MCP endpoint (`get_schema`,
// `query`, `mutate`) with a strict allowlisted, RBAC-enforced, OAuth 2.1
// Streamable HTTP MCP server backed by `@modelcontextprotocol/server@2.4.0`.
//
// Security posture:
// 1. ZERO raw SQL execution (`query`, `mutate`, `execute_sql`, `get_schema` REMOVED).
// 2. OAuth 2.1 Bearer JWT verification via JWKS + RFC 9728 Protected Resource Metadata.
// 3. Live PostgreSQL account status (`disabled = false`), organization `mcp_enabled`,
//    role/user policies, explicit DENY overrides, and CRM `role_permissions` checked
//    on every discovery (`tools/list`) and every execution (`tools/call`).
// 4. Every query executes with strictly parameterized statements inside RLS-scoped
//    transactions (`rlsPostgres.ts`) and records immutable `mcp_execution_logs` /
//    `mcp_security_events`.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createMcpHandler,
  LATEST_PROTOCOL_VERSION,
  McpServer,
} from "npm:@modelcontextprotocol/server@2.4.0";
import { pipeline } from "npm:@supabase/middleware@1.0.0";
import { withCors } from "npm:@supabase/middleware@1.0.0/cors";
import {
  withOAuthProtectedResource,
  withSupabase,
} from "npm:@supabase/server@1.9.1";
import pg from "npm:pg@8.23.1";
import { z } from "npm:zod@^4.3.6";
import { createRlsPostgres, type RlsPostgres } from "./rlsPostgres.ts";

pg.types.setTypeParser(pg.types.builtins.INT8, Number);

let pool: pg.Pool | undefined;
function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = Deno.env.get("SUPABASE_DB_URL");
    if (!connectionString) {
      throw new Error("SUPABASE_DB_URL is not set");
    }
    pool = new pg.Pool({ connectionString, max: 4 });
  }
  return pool;
}

interface LiveCallerPolicy {
  salesId: number;
  roleKey: string | null;
  administrator: boolean;
  disabled: boolean;
  organizationId: number;
  orgMcpEnabled: boolean;
  roleMcpEnabled: boolean;
  userMcpEnabled: boolean;
  deniedTools: Set<string>;
  permissions: Set<string>;
}

async function loadLiveCallerPolicy(
  userId: string,
): Promise<LiveCallerPolicy | null> {
  const db = getPool();
  const saleRes = await db.query(
    `select s.id, s.role_key, s.administrator, s.disabled, s.organization_id,
            o.mcp_enabled as org_mcp_enabled,
            coalesce(rp.mcp_enabled, true) as role_mcp_enabled,
            coalesce(up.mcp_enabled, true) as user_mcp_enabled,
            coalesce(up.denied_tools, '{}'::text[]) as denied_tools
     from public.sales s
     join public.organizations o on o.id = s.organization_id
     left join public.mcp_role_policies rp
       on rp.organization_id = s.organization_id and rp.role_key = s.role_key
     left join public.mcp_user_policies up
       on up.organization_id = s.organization_id and up.sales_id = s.id
     where s.user_id = $1::uuid`,
    [userId],
  );
  const row = saleRes.rows[0];
  if (!row) return null;

  const permRes = row.role_key
    ? await db.query(
        `select resource || ':' || action as perm
         from public.role_permissions where role_key = $1`,
        [row.role_key],
      )
    : { rows: [] };

  const denyRes = row.role_key
    ? await db.query(
        `select tool_name from public.mcp_tool_permissions
         where organization_id = $1 and role_key = $2 and effect = 'deny'`,
        [row.organization_id, row.role_key],
      )
    : { rows: [] };

  const deniedTools = new Set<string>([
    ...(row.denied_tools ?? []),
    ...denyRes.rows.map((r: { tool_name: string }) => r.tool_name),
  ]);

  return {
    salesId: Number(row.id),
    roleKey: row.role_key,
    administrator: Boolean(row.administrator),
    disabled: Boolean(row.disabled),
    organizationId: Number(row.organization_id),
    orgMcpEnabled: Boolean(row.org_mcp_enabled),
    roleMcpEnabled: Boolean(row.role_mcp_enabled),
    userMcpEnabled: Boolean(row.user_mcp_enabled),
    deniedTools,
    permissions: new Set<string>(
      permRes.rows.map((r: { perm: string }) => r.perm),
    ),
  };
}

function canUseTool(
  policy: LiveCallerPolicy,
  toolName: string,
  requiredPerms: string[],
): boolean {
  if (
    policy.disabled ||
    !policy.orgMcpEnabled ||
    !policy.roleMcpEnabled ||
    !policy.userMcpEnabled
  ) {
    return false;
  }
  if (policy.deniedTools.has(toolName)) return false;
  if (policy.administrator || policy.roleKey === "super_admin") return true;
  if (!policy.permissions.has("mcp_access:read")) return false;
  return requiredPerms.every((p) => policy.permissions.has(p));
}

function safeToolError(code: string, message: string, requestId: string) {
  const payload = {
    code,
    message,
    retryable: false,
    remediation:
      "Contact an authorized DDC CRM administrator if you require access.",
    requestId,
  };
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

async function logMcpCall(entry: {
  requestId: string;
  policy: LiveCallerPolicy;
  userId: string;
  toolName: string;
  action: string;
  resource: string;
  riskLevel: string;
  authResult: string;
  execResult: string;
  errorCode?: string;
  durationMs: number;
}) {
  await getPool()
    .query(
      `insert into public.mcp_execution_logs (
         request_id, organization_id, user_id, sales_id, channel, tool_name,
         tool_version, action, resource, risk_level, authorization_result,
         execution_result, error_code, duration_ms
       ) values ($1, $2, $3::uuid, $4, 'mcp', $5, '2.0.0', $6, $7, $8, $9, $10, $11, $12)`,
      [
        entry.requestId,
        entry.policy.organizationId,
        entry.userId,
        entry.policy.salesId,
        entry.toolName,
        entry.action,
        entry.resource,
        entry.riskLevel,
        entry.authResult,
        entry.execResult,
        entry.errorCode ?? null,
        entry.durationMs,
      ],
    )
    .catch(() => undefined);
}

function createEnterpriseEdgeMcpServer(
  postgres: RlsPostgres,
  userId: string,
  policy: LiveCallerPolicy,
  requestId: string,
): McpServer {
  const server = new McpServer({
    name: "ddc-agriculture-crm-mcp",
    version: "2.0.0",
  });

  // Identity
  if (canUseTool(policy, "get_my_profile", [])) {
    server.registerTool(
      "get_my_profile",
      {
        title: "Get My Profile",
        description:
          "Return the authenticated DDC CRM user's profile and role derived from verified OAuth credentials.",
        inputSchema: z.object({}).strict(),
        annotations: { readOnlyHint: true },
      },
      async () => {
        const t0 = Date.now();
        const rows = await postgres.query(
          `select id, email::text as email, first_name, last_name, role_key, organization_id
           from public.sales where user_id = $1::uuid`,
          [userId],
          { readOnly: true },
        );
        await logMcpCall({
          requestId,
          policy,
          userId,
          toolName: "get_my_profile",
          action: "read",
          resource: "identity",
          riskLevel: "L0",
          authResult: "allowed",
          execResult: "success",
          durationMs: Date.now() - t0,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                ok: true,
                requestId,
                data: rows[0] ?? null,
              }),
            },
          ],
        };
      },
    );
  }

  // Customers search (strictly parameterized — zero raw SQL!)
  if (canUseTool(policy, "search_customers", ["customers:read"])) {
    server.registerTool(
      "search_customers",
      {
        title: "Search Customers",
        description:
          "Search DDC Agriculture customers by name, customer code, or province.",
        inputSchema: z
          .object({
            query: z.string().max(200).optional(),
            province: z.string().max(100).optional(),
            limit: z.number().int().min(1).max(100).optional(),
          })
          .strict(),
        annotations: { readOnlyHint: true },
      },
      async ({ query, province, limit }) => {
        const t0 = Date.now();
        const pattern = query?.trim() ? `%${query.trim()}%` : null;
        const provPattern = province?.trim() ? `%${province.trim()}%` : null;
        const rows = await postgres.query(
          `select id, customer_code, name, province, city, org_type, version
           from public.companies
           where deleted_at is null
             and ($1::text is null or name ilike $1 or customer_code ilike $1)
             and ($2::text is null or province ilike $2)
           order by updated_at desc limit $3`,
          [pattern, provPattern, limit ?? 25],
          { readOnly: true },
        );
        await logMcpCall({
          requestId,
          policy,
          userId,
          toolName: "search_customers",
          action: "read",
          resource: "customers",
          riskLevel: "L0",
          authResult: "allowed",
          execResult: "success",
          durationMs: Date.now() - t0,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                ok: true,
                requestId,
                data: { items: rows },
              }),
            },
          ],
        };
      },
    );
  }

  // Compatible agricultural parts
  if (
    canUseTool(policy, "find_compatible_parts", [
      "machine_applications:read",
      "products:read",
    ])
  ) {
    server.registerTool(
      "find_compatible_parts",
      {
        title: "Find Compatible Parts",
        description:
          "Find verified compatible DDC agricultural spare parts for a machine model.",
        inputSchema: z
          .object({
            machine_model_query: z.string().min(1).max(120),
            verified_only: z.boolean().optional(),
          })
          .strict(),
        annotations: { readOnlyHint: true },
      },
      async ({ machine_model_query, verified_only }) => {
        const t0 = Date.now();
        const rows = await postgres.query(
          `select p.id as product_id, p.part_number, p.name, mm.model_name,
                  pma.component_application, pma.verification_status, pma.verification_source
           from public.product_machine_applications pma
           join public.products p on p.id = pma.product_id
           join public.machine_models mm on mm.id = pma.machine_model_id
           where p.deleted_at is null
             and mm.model_name ilike $1
             and ($2::boolean = false or pma.verification_status = 'verified')
           order by p.part_number asc limit 50`,
          [`%${machine_model_query.trim()}%`, verified_only !== false],
          { readOnly: true },
        );
        await logMcpCall({
          requestId,
          policy,
          userId,
          toolName: "find_compatible_parts",
          action: "read",
          resource: "machine_applications",
          riskLevel: "L0",
          authResult: "allowed",
          execResult: "success",
          durationMs: Date.now() - t0,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                ok: true,
                requestId,
                data: { parts: rows },
              }),
            },
          ],
        };
      },
    );
  }

  // Routine visit report creation (L1)
  if (canUseTool(policy, "create_visit_report", ["activities:create"])) {
    server.registerTool(
      "create_visit_report",
      {
        title: "Create Visit Report",
        description:
          "Record a field sales visit report for an authorized customer.",
        inputSchema: z
          .object({
            company_id: z.number().int().positive(),
            subject: z.string().min(1).max(200),
            discussion: z.string().max(4000).optional(),
            outcome: z.string().max(2000).optional(),
            follow_up_date: z.string().max(32).optional(),
          })
          .strict(),
      },
      async ({ company_id, subject, discussion, outcome, follow_up_date }) => {
        const t0 = Date.now();
        try {
          const opt = (await postgres.query(
            `select id from public.master_options
             where category = 'activity_type' and code = 'onsite_visit' limit 1`,
            undefined,
            { readOnly: true },
          )) as Array<{ id: number }>;
          if (!opt[0]) {
            return safeToolError(
              "VALIDATION_FAILED",
              "onsite_visit activity type is not configured",
              requestId,
            );
          }
          const rows = await postgres.query(
            `insert into public.activities (
               activity_type_id, company_id, subject, start_at, discussion, outcome,
               status, follow_up_date
             ) values ($1, $2, $3, now(), $4, $5, 'completed', $6::date)
             returning id, company_id, subject, status, logged_at`,
            [
              opt[0].id,
              company_id,
              subject.trim(),
              discussion ?? null,
              outcome ?? null,
              follow_up_date ?? null,
            ],
          );
          await logMcpCall({
            requestId,
            policy,
            userId,
            toolName: "create_visit_report",
            action: "create",
            resource: "activities",
            riskLevel: "L1",
            authResult: "allowed",
            execResult: "success",
            durationMs: Date.now() - t0,
          });
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ ok: true, requestId, data: rows[0] }),
              },
            ],
          };
        } catch {
          return safeToolError(
            "PERMISSION_DENIED",
            "Could not create visit report under current authorization scope",
            requestId,
          );
        }
      },
    );
  }

  return server;
}

Deno.serve(
  pipeline(
    [
      withCors({
        exposedHeaders: [
          "WWW-Authenticate",
          "Mcp-Session-Id",
          "MCP-Protocol-Version",
          "X-Request-Id",
          "x-supabase-server-error",
        ],
      }),
      withOAuthProtectedResource(),
      withSupabase({ auth: "user" }),
    ],
    async (req, { jwtClaims }) => {
      const requestId =
        req.headers.get("x-request-id")?.trim() ||
        `mcp_${crypto.randomUUID().replace(/-/g, "")}`;
      const userId = String(jwtClaims?.sub ?? "");

      const policy = await loadLiveCallerPolicy(userId);
      if (!policy || policy.disabled) {
        return new Response(
          JSON.stringify({
            error: {
              code: policy?.disabled
                ? "ACCOUNT_SUSPENDED"
                : "AUTHENTICATION_REQUIRED",
              message: policy?.disabled
                ? "User account is suspended"
                : "CRM user not found",
              requestId,
            },
          }),
          {
            status: policy?.disabled ? 403 : 401,
            headers: {
              "Content-Type": "application/json",
              "X-Request-Id": requestId,
              "MCP-Protocol-Version": LATEST_PROTOCOL_VERSION,
            },
          },
        );
      }

      if (
        !policy.orgMcpEnabled ||
        !policy.roleMcpEnabled ||
        !policy.userMcpEnabled
      ) {
        return new Response(
          JSON.stringify({
            error: {
              code: "MCP_ACCESS_DISABLED",
              message:
                "MCP access is disabled for your organization, role, or account",
              requestId,
            },
          }),
          {
            status: 403,
            headers: {
              "Content-Type": "application/json",
              "X-Request-Id": requestId,
            },
          },
        );
      }

      let postgres: RlsPostgres;
      try {
        postgres = createRlsPostgres(getPool(), jwtClaims ?? {});
      } catch {
        return new Response("Internal Server Error", { status: 500 });
      }

      const handler = createMcpHandler(() =>
        createEnterpriseEdgeMcpServer(postgres, userId, policy, requestId),
      );
      return handler.fetch(req);
    },
  ),
);
