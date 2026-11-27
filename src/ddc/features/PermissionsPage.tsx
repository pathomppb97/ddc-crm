import { useMemo, useState } from "react";
import { isResourceEnabled } from "../featureFlags";
import {
  useCreate,
  useDelete,
  useGetList,
  useNotify,
  useRefresh,
  useTranslate,
  useUpdate,
} from "ra-core";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocalizedName } from "../ui/labels";
import {
  usePageDesign,
  designRows,
  canvasTarget,
  columnSize,
} from "../pages/pageDesign";

const ACTIONS = [
  "read",
  "create",
  "update",
  "delete",
  "approve",
  "export",
  "import",
] as const;
type Cell = "none" | "all" | "own";

/**
 * Permission matrix editor (administrators only). Changes are written to
 * role_permissions and apply immediately, in the database policies as well.
 */
export const PermissionsPage = () => {
  const translate = useTranslate();
  const design = usePageDesign("permissions");
  const columns = designRows(
    ACTIONS.map((id) => ({ id, label: id, visible: true })),
    design.table,
  )
    .filter((row) => row.visible)
    .map((row) => row.id as (typeof ACTIONS)[number]);
  const notify = useNotify();
  const refresh = useRefresh();
  const localizedName = useLocalizedName();
  const [create] = useCreate();
  const [update] = useUpdate();
  const [remove] = useDelete();
  const { data: roles = [] } = useGetList("ddc_roles", {
    pagination: { page: 1, perPage: 100 },
    sort: { field: "sort_order", order: "ASC" },
  });
  const { data: resources = [] } = useGetList("permission_resources", {
    pagination: { page: 1, perPage: 100 },
    sort: { field: "sort_order", order: "ASC" },
  });
  const [roleKey, setRoleKey] = useState<string>("");
  const selectedRole = roleKey || (roles[0]?.key as string) || "";
  const { data: permissions = [] } = useGetList(
    "role_permissions",
    {
      filter: { role_key: selectedRole },
      pagination: { page: 1, perPage: 1000 },
      sort: { field: "id", order: "ASC" },
    },
    { enabled: Boolean(selectedRole) },
  );
  const { data: users = [] } = useGetList("sales", {
    pagination: { page: 1, perPage: 500 },
    sort: { field: "first_name", order: "ASC" },
  });

  const cellOf = useMemo(() => {
    const map = new Map(
      permissions.map((p) => [`${p.resource}:${p.action}`, p]),
    );
    return (resource: string, action: string) =>
      map.get(`${resource}:${action}`);
  }, [permissions]);

  const change = (resource: string, action: string, next: Cell) => {
    const current = cellOf(resource, action);
    const options = {
      onSuccess: () => refresh(),
      onError: (error: unknown) => notify(String(error), { type: "error" }),
    };
    if (next === "none") {
      if (current)
        remove(
          "role_permissions",
          { id: current.id, previousData: current },
          options,
        );
    } else if (current) {
      update(
        "role_permissions",
        { id: current.id, data: { scope: next }, previousData: current },
        options,
      );
    } else {
      create(
        "role_permissions",
        { data: { role_key: selectedRole, resource, action, scope: next } },
        options,
      );
    }
  };

  return (
    <div className="flex flex-col gap-4 py-4">
      <h1 className="text-2xl font-semibold">
        {translate("ddc.permissions.title")}
      </h1>
      <p className="text-sm text-muted-foreground">
        {translate("ddc.permissions.hint")}
      </p>
      <Card>
        <CardHeader className="flex flex-row items-center gap-3 space-y-0">
          <CardTitle className="text-base">
            {translate("ddc.permissions.role")}
          </CardTitle>
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={selectedRole}
            onChange={(e) => setRoleKey(e.target.value)}
            aria-label={translate("ddc.permissions.role")}
          >
            {roles.map((role) => (
              <option key={role.key} value={role.key}>
                {localizedName(role)}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">
            {translate("ddc.permissions.users_with_role", {
              count: users.filter((u) => u.role_key === selectedRole).length,
            })}
          </span>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr style={{ height: design.headerHeight }}>
                <th className="p-2 text-left">
                  {translate("ddc.permissions.resource")}
                </th>
                {columns.map((action) => (
                  <th
                    key={action}
                    className="p-2"
                    {...canvasTarget("permissions", "table", action)}
                    style={columnSize(
                      design.table?.find((row) => row.id === action)?.width,
                    )}
                  >
                    {design.table?.find(
                      (row) => row.id === action && row.label !== action,
                    )?.label || translate(`ddc.permissions.action.${action}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resources
                .filter((resource) => isResourceEnabled(String(resource.key)))
                .map((resource) => (
                  <tr key={resource.key} className="border-t">
                    <td className="p-2">{localizedName(resource)}</td>
                    {columns.map((action) => {
                      const current = cellOf(resource.key, action);
                      const value: Cell = current
                        ? (current.scope as Cell)
                        : "none";
                      return (
                        <td key={action} className="p-1 text-center">
                          <select
                            className={`h-8 rounded border bg-background px-1 text-xs ${value === "all" ? "font-semibold" : value === "own" ? "text-sky-700 dark:text-sky-300" : "text-muted-foreground"}`}
                            value={value}
                            onChange={(e) =>
                              change(
                                resource.key,
                                action,
                                e.target.value as Cell,
                              )
                            }
                            aria-label={`${localizedName(resource)} ${translate(`ddc.permissions.action.${action}`)}`}
                          >
                            <option value="none">—</option>
                            <option value="all">
                              {translate("ddc.permissions.scope.all")}
                            </option>
                            <option value="own">
                              {translate("ddc.permissions.scope.own")}
                            </option>
                          </select>
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
};

PermissionsPage.path = "/permissions";
