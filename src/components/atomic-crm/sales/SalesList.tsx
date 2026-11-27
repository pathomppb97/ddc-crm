import { useRecordContext, useTranslate } from "ra-core";
import { CreateButton } from "@/components/admin/create-button";
import { DataTable } from "@/components/admin/data-table";
import { ExportButton } from "@/components/admin/export-button";
import { List } from "@/components/admin/list";
import { SearchInput } from "@/components/admin/search-input";
import { Badge } from "@/components/ui/badge";

import { TopToolbar } from "../layout/TopToolbar";
import {
  usePageDesign,
  designRows,
  groupsFor,
  columnSize,
  canvasTarget,
} from "@/ddc/pages/pageDesign";

const SalesListActions = () => (
  <TopToolbar>
    <ExportButton />
    <CreateButton label="resources.sales.action.new" />
  </TopToolbar>
);

const filters = [<SearchInput source="q" alwaysOn />];

const OptionsField = (_props: { label?: string | boolean }) => {
  const record = useRecordContext();
  const translate = useTranslate();
  if (!record) return null;
  return (
    <div className="flex flex-row gap-1">
      {record.administrator && (
        <Badge
          variant="outline"
          className="border-blue-300 dark:border-blue-700"
        >
          {translate("resources.sales.fields.administrator")}
        </Badge>
      )}
      {record.disabled && (
        <Badge
          variant="outline"
          className="border-orange-300 dark:border-orange-700"
        >
          {translate("resources.sales.fields.disabled")}
        </Badge>
      )}
    </div>
  );
};

export function SalesList() {
  const design = usePageDesign("sales");
  const rows = designRows(
    groupsFor("sales").find((group) => group.key === "table")!.rows,
    design.table,
  );
  return (
    <List
      filters={filters}
      actions={<SalesListActions />}
      sort={{ field: "first_name", order: "ASC" }}
    >
      <DataTable bulkActionButtons={false}>
        {rows
          .filter((row) => row.visible)
          .map((row) =>
            row.id === "Account flags" ? (
              <DataTable.Col
                key={row.id}
                designTarget={canvasTarget("sales", "table", row.id)}
                columnStyle={columnSize(row.width)}
                label={row.label === row.id ? false : row.label}
                headerHeight={design.headerHeight}
              >
                <OptionsField />
              </DataTable.Col>
            ) : (
              <DataTable.Col
                key={row.id}
                source={row.id}
                headerHeight={design.headerHeight}
                designTarget={canvasTarget("sales", "table", row.id)}
                columnStyle={columnSize(row.width)}
                label={
                  row.label === row.id.replaceAll("_", " ")
                    ? undefined
                    : row.label
                }
              />
            ),
          )}
      </DataTable>
    </List>
  );
}
