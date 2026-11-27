import { useState } from "react";
import {
  useCanAccess,
  useGetList,
  useNotify,
  useRefresh,
  useTranslate,
  useUpdate,
  type RaRecord,
} from "ra-core";
import { Link } from "react-router";
import { AlertTriangle, PlugZap, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DesignSlots } from "../pages/pageDesign";
import { useDdcLocale } from "../ui/labels";
import { errorMessage, useDdcDataProvider } from "./useDdcDataProvider";

const formatDate = (value: string | null | undefined, locale: string) =>
  value
    ? new Date(value).toLocaleString(locale === "th" ? "th-TH" : "en-GB")
    : "—";

/**
 * ERP integration administration: connector status and approval, legal
 * entities, integration contracts with their pending decisions, runs and errors.
 * Real ERP connectivity cannot be switched on from here: it requires a recorded
 * approval in the database and server side credentials.
 */
export const ErpAdminPage = () => {
  const translate = useTranslate();
  const locale = useDdcLocale();
  const notify = useNotify();
  const refresh = useRefresh();
  const dataProvider = useDdcDataProvider();
  const [busy, setBusy] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<Record<string, unknown> | null>(
    null,
  );
  const [update] = useUpdate();
  const { canAccess: isAdmin } = useCanAccess({
    resource: "erp_integration",
    action: "edit",
  });

  const { data: config = [] } = useGetList("erp_connector_config", {
    pagination: { page: 1, perPage: 1 },
    sort: { field: "id", order: "ASC" },
  });
  const { data: legalEntities = [] } = useGetList("erp_legal_entities", {
    pagination: { page: 1, perPage: 100 },
    sort: { field: "data_area_id", order: "ASC" },
  });
  const { data: entities = [] } = useGetList("erp_entity_configs", {
    pagination: { page: 1, perPage: 100 },
    sort: { field: "sort_order", order: "ASC" },
  });
  const { data: mappings = [] } = useGetList("erp_field_mappings", {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: "id", order: "ASC" },
  });
  const { data: runs = [] } = useGetList("erp_sync_runs", {
    pagination: { page: 1, perPage: 15 },
    sort: { field: "started_at", order: "DESC" },
  });
  const { data: openErrors = [], total: openErrorCount } = useGetList(
    "erp_sync_errors",
    {
      filter: { is_resolved: false },
      pagination: { page: 1, perPage: 10 },
      sort: { field: "created_at", order: "DESC" },
    },
  );
  const connector = config[0];

  const run = async (
    key: string,
    request: Parameters<typeof dataProvider.runErpAction>[0],
  ) => {
    setBusy(key);
    try {
      const result = await dataProvider.runErpAction(request);
      setLastResult(result);
      notify("ddc.erp.action_done", { type: "success" });
      refresh();
    } catch (error) {
      notify(errorMessage(error), { type: "error" });
    } finally {
      setBusy(null);
    }
  };

  const toggleEntity = (entity: RaRecord) =>
    update(
      "erp_entity_configs",
      {
        id: entity.id,
        data: { is_enabled: !entity.is_enabled },
        previousData: entity,
      },
      { onSuccess: refresh },
    );

  const lastRunOf = (entity: string) => runs.find((r) => r.entity === entity);
  const defaultLegalEntity =
    legalEntities.find((l) => l.is_default) ?? legalEntities[0];

  return (
    <div className="flex flex-col gap-4 py-4">
      <h1 className="text-2xl font-semibold">{translate("ddc.erp.title")}</h1>

      <div
        role="note"
        className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950"
      >
        <AlertTriangle className="size-4 shrink-0" />
        <p>{translate("ddc.erp.safety_notice")}</p>
      </div>

      <DesignSlots page="erp-integration">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">
              {translate("ddc.erp.connector")}
            </CardTitle>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null || !connector?.is_enabled}
                onClick={() => run("health", { action: "health" })}
              >
                <PlugZap className="size-4" />
                {translate("ddc.erp.health")}
              </Button>
              {isAdmin ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null || !connector?.is_enabled}
                  onClick={() =>
                    run("legal", { action: "register_legal_entities" })
                  }
                >
                  {translate("ddc.erp.register_legal_entities")}
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            {connector ? (
              <dl className="grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground">
                    {translate("ddc.erp.connector_type")}
                  </dt>
                  <dd>
                    {connector.connector_type === "mock"
                      ? translate("ddc.erp.mock")
                      : "Dynamics 365 F&O (OData)"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {translate("ddc.erp.environment")}
                  </dt>
                  <dd>{connector.environment_type}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {translate("ddc.erp.enabled")}
                  </dt>
                  <dd className="flex items-center gap-2">
                    <Badge
                      variant={connector.is_enabled ? "default" : "outline"}
                    >
                      {connector.is_enabled
                        ? translate("ra.boolean.true")
                        : translate("ra.boolean.false")}
                    </Badge>
                    {isAdmin && connector.connector_type === "mock" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          update(
                            "erp_connector_config",
                            {
                              id: connector.id,
                              data: { is_enabled: !connector.is_enabled },
                              previousData: connector,
                            },
                            { onSuccess: refresh },
                          )
                        }
                      >
                        {connector.is_enabled
                          ? translate("ddc.erp.disable_mock")
                          : translate("ddc.erp.enable_mock")}
                      </Button>
                    ) : null}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {translate("ddc.erp.approval")}
                  </dt>
                  <dd>
                    {translate(
                      `ddc.erp.approval_status.${connector.approval_status}`,
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {translate("ddc.erp.environment_url")}
                  </dt>
                  <dd>{connector.environment_url ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {translate("ddc.erp.open_errors")}
                  </dt>
                  <dd>
                    <Link to="/erp_sync_errors" className="underline">
                      {openErrorCount ?? 0}
                    </Link>
                  </dd>
                </div>
                {connector.notes ? (
                  <p className="text-muted-foreground sm:col-span-3">
                    {connector.notes}
                  </p>
                ) : null}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">
                {translate("ra.page.loading")}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {translate("ddc.erp.legal_entities")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {legalEntities.length === 0 ? (
              <p className="text-muted-foreground">
                {translate("ddc.erp.no_legal_entities")}
              </p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {legalEntities.map((le) => (
                  <li key={le.id}>
                    <Badge variant="outline">
                      {le.data_area_id} · {le.name}{" "}
                      {le.is_verified
                        ? "✓"
                        : `(${translate("ddc.erp.unverified")})`}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {translate("ddc.erp.contracts")}
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="p-2">{translate("ddc.erp.entity")}</th>
                  <th className="p-2">{translate("ddc.erp.erp_entity")}</th>
                  <th className="p-2">{translate("ddc.erp.direction")}</th>
                  <th className="p-2">
                    {translate("ddc.erp.system_of_record")}
                  </th>
                  <th className="p-2">{translate("ddc.erp.decision")}</th>
                  <th className="p-2">{translate("ddc.erp.mappings")}</th>
                  <th className="p-2">{translate("ddc.erp.last_sync")}</th>
                  <th className="p-2">{translate("ddc.erp.enabled")}</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {entities.map((entity) => {
                  const last = lastRunOf(entity.entity);
                  const entityMappings = mappings.filter(
                    (m) => m.entity === entity.entity,
                  );
                  const verified = entityMappings.filter(
                    (m) => m.is_verified,
                  ).length;
                  return (
                    <tr key={entity.id} className="border-t align-top">
                      <td className="p-2 font-medium">
                        <Link
                          to={`/erp_entity_configs/${encodeURIComponent(String(entity.id))}/show`}
                          className="underline"
                        >
                          {entity.label}
                        </Link>
                      </td>
                      <td className="p-2 font-mono text-xs">
                        {entity.erp_entity_name}
                      </td>
                      <td className="p-2">{entity.direction}</td>
                      <td className="p-2">{entity.system_of_record}</td>
                      <td className="p-2">
                        <Badge
                          variant="outline"
                          className={
                            entity.decision_status === "confirmed"
                              ? ""
                              : "border-amber-400"
                          }
                        >
                          {translate(
                            `ddc.erp.decision_status.${entity.decision_status}`,
                          )}
                        </Badge>
                        {entity.decision_note ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {entity.decision_note}
                          </p>
                        ) : null}
                      </td>
                      <td className="p-2">
                        {entityMappings.length} ({verified}{" "}
                        {translate("ddc.erp.verified")})
                      </td>
                      <td className="p-2 text-xs">
                        {formatDate(entity.last_synced_at, locale)}
                        {last ? (
                          <div>
                            {last.status} · {last.records_read}/
                            {last.records_failed}
                          </div>
                        ) : null}
                      </td>
                      <td className="p-2">
                        {isAdmin ? (
                          <input
                            type="checkbox"
                            checked={Boolean(entity.is_enabled)}
                            onChange={() => toggleEntity(entity)}
                            aria-label={`${translate("ddc.erp.enabled")} ${entity.label}`}
                          />
                        ) : entity.is_enabled ? (
                          translate("ra.boolean.true")
                        ) : (
                          translate("ra.boolean.false")
                        )}
                      </td>
                      <td className="p-2">
                        {defaultLegalEntity &&
                        connector?.is_enabled &&
                        entity.is_enabled ? (
                          <div className="flex flex-col gap-1">
                            {(["incremental", "full", "retry"] as const).map(
                              (mode) => (
                                <Button
                                  key={mode}
                                  size="sm"
                                  variant="outline"
                                  disabled={busy !== null}
                                  onClick={() =>
                                    run(`${entity.entity}-${mode}`, {
                                      action: "sync",
                                      entity: entity.entity,
                                      dataAreaId:
                                        defaultLegalEntity.data_area_id,
                                      mode,
                                    })
                                  }
                                >
                                  <RefreshCw className="size-3" />
                                  {translate(`ddc.erp.mode.${mode}`)}
                                </Button>
                              ),
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy !== null}
                              onClick={() =>
                                run(`${entity.entity}-reconcile`, {
                                  action: "reconcile",
                                  entity: entity.entity,
                                  dataAreaId: defaultLegalEntity.data_area_id,
                                })
                              }
                            >
                              {translate("ddc.erp.reconcile")}
                            </Button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {legalEntities.length > 1 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {translate("ddc.erp.default_legal_entity", {
                  id: defaultLegalEntity?.data_area_id,
                })}
              </p>
            ) : null}
          </CardContent>
        </Card>

        {lastResult ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {translate("ddc.erp.last_result")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="max-h-72 overflow-auto rounded bg-muted p-2 text-xs">
                {JSON.stringify(lastResult, null, 2)}
              </pre>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">
              {translate("ddc.erp.recent_errors")}
            </CardTitle>
            <Link to="/erp_sync_runs" className="text-sm underline">
              {translate("ddc.erp.all_runs")}
            </Link>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {openErrors.map((e) => (
                <li key={e.id}>
                  <Link
                    to={`/erp_sync_errors/${e.id}/show`}
                    className="underline"
                  >
                    {e.entity} · {e.data_area_id} · {e.erp_key ?? "—"}
                  </Link>{" "}
                  <span className="text-muted-foreground">
                    {e.error_message}
                  </span>
                </li>
              ))}
              {openErrors.length === 0 ? (
                <li className="text-muted-foreground">
                  {translate("ddc.common.no_records")}
                </li>
              ) : null}
            </ul>
          </CardContent>
        </Card>
      </DesignSlots>
    </div>
  );
};

ErpAdminPage.path = "/erp-integration";
