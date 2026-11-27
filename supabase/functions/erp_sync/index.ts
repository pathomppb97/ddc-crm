import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { AuthMiddleware, UserMiddleware } from "../_shared/authentication.ts";
import { getUserSale } from "../_shared/getUserSale.ts";
import { createMockD365Connector } from "../_shared/erp/mockConnector.ts";
import {
  createD365FOConnector,
  createEntraTokenProvider,
} from "../_shared/erp/d365Connector.ts";
import {
  assertIntegrationAllowed,
  createSyncEngine,
} from "../_shared/erp/syncEngine.ts";
import {
  createTableSyncStore,
  type TableGateway,
} from "../_shared/erp/tableStore.ts";
import {
  ERP_ENTITIES,
  ErpIntegrationDisabledError,
  type ConnectorConfig,
  type CrmRow,
  type ErpConnector,
  type ErpEntityKey,
} from "../_shared/erp/types.ts";

/**
 * ERP synchronization service.
 *
 * Runs with the service role so that it can write ERP bookkeeping tables that
 * users can only read. Every request is authenticated and authorized here.
 * The real Dynamics 365 connector is only built when the configuration is
 * enabled AND approved AND the Entra ID secrets exist in the function
 * environment (supabase secrets set ...). Secrets are never returned or logged.
 */

const gateway: TableGateway = {
  async select(table, filter) {
    let query = supabaseAdmin.from(table).select("*");
    for (const [key, value] of Object.entries(filter))
      query = query.eq(key, value);
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    return (data ?? []) as CrmRow[];
  },
  async insert(table, row) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .insert(row)
      .select("*")
      .single();
    if (error) throw new Error(`${table}: ${error.message}`);
    return data as CrmRow;
  },
  async update(table, idColumn, id, row) {
    const { error } = await supabaseAdmin
      .from(table)
      .update(row)
      .eq(idColumn, id);
    if (error) throw new Error(`${table}: ${error.message}`);
  },
};

const buildConnector = (
  config: ConnectorConfig,
  environmentUrl: string | null,
): ErpConnector => {
  if (config.connector_type === "mock") {
    return createMockD365Connector().connector;
  }
  const tenantId = Deno.env.get("D365_TENANT_ID");
  const clientId = Deno.env.get("D365_CLIENT_ID");
  const clientSecret = Deno.env.get("D365_CLIENT_SECRET");
  if (!environmentUrl || !tenantId || !clientId || !clientSecret) {
    throw new ErpIntegrationDisabledError(
      "Dynamics 365 credentials or environment URL are not configured",
    );
  }
  return createD365FOConnector({
    baseUrl: environmentUrl,
    tokenProvider: createEntraTokenProvider({
      tenantId,
      clientId,
      clientSecret,
      resource: environmentUrl,
    }),
    modifiedField: Deno.env.get("D365_MODIFIED_FIELD") || null,
  });
};

const canRunSync = async (
  salesId: number,
  administrator: boolean,
  roleKey: string | null,
) => {
  if (administrator) return true;
  if (!roleKey) return false;
  const { data } = await supabaseAdmin
    .from("role_permissions")
    .select("id")
    .eq("role_key", roleKey)
    .eq("resource", "erp_integration")
    .eq("action", "update")
    .limit(1);
  return Boolean(data?.length) && salesId > 0;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

Deno.serve(async (req: Request) =>
  OptionsMiddleware(req, async (req) =>
    AuthMiddleware(req, async (req) =>
      UserMiddleware(req, async (req, user) => {
        if (req.method !== "POST")
          return createErrorResponse(405, "Method Not Allowed");
        const sale = user ? await getUserSale(user) : null;
        if (!sale || sale.disabled)
          return createErrorResponse(401, "Unauthorized");
        if (!(await canRunSync(sale.id, sale.administrator, sale.role_key))) {
          return createErrorResponse(
            403,
            "Not allowed to run ERP synchronization",
          );
        }

        let body: {
          action?: string;
          entity?: string;
          dataAreaId?: string;
          mode?: string;
        };
        try {
          body = await req.json();
        } catch {
          return createErrorResponse(400, "Invalid JSON body");
        }
        const action = body.action ?? "sync";
        const entity = body.entity as ErpEntityKey | undefined;
        if (
          ["sync", "reconcile"].includes(action) &&
          (!entity || !ERP_ENTITIES.includes(entity))
        ) {
          return createErrorResponse(400, "Unknown entity");
        }
        if (
          ["sync", "reconcile"].includes(action) &&
          !/^[a-z0-9]{1,4}$/.test(body.dataAreaId ?? "")
        ) {
          return createErrorResponse(400, "Invalid legal entity");
        }
        if (
          body.mode &&
          !["incremental", "full", "retry"].includes(body.mode)
        ) {
          return createErrorResponse(400, "Invalid mode");
        }

        try {
          const store = createTableSyncStore(gateway);
          const config = await store.getConnectorConfig();
          const [{ environment_url }] = (await gateway.select(
            "erp_connector_config",
            { id: 1 },
          )) as Array<{
            environment_url: string | null;
          }>;
          const connector = buildConnector(config, environment_url);
          assertIntegrationAllowed(config, connector);
          const engine = createSyncEngine({ connector, store });

          if (action === "health")
            return json(200, await connector.healthCheck());
          if (action === "register_legal_entities") {
            return json(200, {
              registered: await engine.registerLegalEntities(),
            });
          }
          if (action === "reconcile")
            return json(200, await engine.reconcile(entity!, body.dataAreaId!));
          if (action === "sync") {
            const run = await engine.syncEntity({
              entity: entity!,
              dataAreaId: body.dataAreaId!,
              mode:
                (body.mode as "incremental" | "full" | "retry") ??
                "incremental",
              triggeredBy: sale.id,
            });
            return json(200, run);
          }
          return createErrorResponse(400, "Unknown action");
        } catch (error) {
          if (error instanceof ErpIntegrationDisabledError)
            return createErrorResponse(409, error.message);
          console.error(
            "erp_sync.error",
            error instanceof Error ? error.message : "unknown",
          );
          return createErrorResponse(500, "ERP synchronization failed");
        }
      }),
    ),
  ),
);
