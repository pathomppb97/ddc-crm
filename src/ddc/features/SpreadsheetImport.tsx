import { useState } from "react";
import {
  CanAccess,
  useDataProvider,
  useGetList,
  useListContext,
  useNotify,
  useRefresh,
  useTranslate,
} from "ra-core";
import { FileDown, FileSpreadsheet, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { findDuplicateCandidates } from "../domain/duplicates";
import {
  IMPORT_SCHEMAS,
  validateImportRows,
  type ImportIssue,
  type ImportResource,
} from "../domain/importValidation";
import { getResourceDef } from "../resources/registry";
import { useLabel } from "../ui/labels";
import { downloadCsv, downloadXlsx, readSpreadsheet } from "./spreadsheet";
import { errorMessage } from "./useDdcDataProvider";

const UNIQUE_COLUMN: Partial<Record<ImportResource, string>> = {
  products: "part_number",
  companies: "customer_code",
};

interface Preview {
  fileName: string;
  valid: Array<{ row: number; data: Record<string, unknown> }>;
  issues: ImportIssue[];
  warnings: Array<{ row: number; message: string }>;
  unknownColumns: string[];
}

const ImportDialog = ({
  resource,
  onClose,
}: {
  resource: ImportResource;
  onClose: () => void;
}) => {
  const translate = useTranslate();
  const dataProvider = useDataProvider();
  const notify = useNotify();
  const refresh = useRefresh();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [progress, setProgress] = useState<{
    done: number;
    failed: ImportIssue[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: existing = [] } = useGetList(resource, {
    pagination: { page: 1, perPage: 5000 },
    sort: { field: "id", order: "ASC" },
  });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const rows = await readSpreadsheet(file);
      const uniqueColumn = UNIQUE_COLUMN[resource];
      const result = validateImportRows(resource, rows, {
        uniqueColumn,
        existingValues: uniqueColumn
          ? existing.map((r) => String(r[uniqueColumn] ?? "")).filter(Boolean)
          : [],
      });
      const warnings =
        resource === "companies"
          ? result.valid.flatMap(({ row, data }) =>
              findDuplicateCandidates(data, existing)
                .slice(0, 1)
                .map((match) => ({
                  row,
                  message: `${translate("ddc.duplicates.title")}: ${match.record.name}`,
                })),
            )
          : [];
      setPreview({
        fileName: file.name,
        ...result,
        valid: result.valid as Preview["valid"],
        warnings,
      });
      setProgress(null);
    } catch (error) {
      notify(errorMessage(error), { type: "error" });
    }
  };

  const runImport = async () => {
    if (!preview) return;
    setBusy(true);
    const failed: ImportIssue[] = [];
    let done = 0;
    for (const { row, data } of preview.valid) {
      try {
        await dataProvider.create(resource, { data });
        done += 1;
      } catch (error) {
        failed.push({ row, column: "", message: errorMessage(error) });
      }
      setProgress({ done, failed: [...failed] });
    }
    setBusy(false);
    refresh();
    notify("ddc.import.finished", {
      type: failed.length ? "warning" : "success",
      messageArgs: { done, failed: failed.length },
    });
  };

  const allIssues = [...(preview?.issues ?? []), ...(progress?.failed ?? [])];
  const template = Object.fromEntries(
    Object.keys(IMPORT_SCHEMAS[resource].shape).map((column) => [column, ""]),
  );

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{translate("ddc.import.title")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">
            {translate("ddc.import.instructions")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadCsv([template], `${resource}-template.csv`)
              }
            >
              <FileDown className="size-4" />
              {translate("ddc.import.template")}
            </Button>
            <input
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              aria-label={translate("ddc.import.choose_file")}
              onChange={(event) => onFile(event.target.files?.[0])}
            />
          </div>
          {preview ? (
            <div className="flex flex-col gap-2">
              <p>
                {translate("ddc.import.summary", {
                  valid: preview.valid.length,
                  invalid: new Set(preview.issues.map((i) => i.row)).size,
                })}
              </p>
              {preview.unknownColumns.length ? (
                <p className="text-amber-700 dark:text-amber-300">
                  {translate("ddc.import.unknown_columns")}:{" "}
                  {preview.unknownColumns.join(", ")}
                </p>
              ) : null}
              {preview.warnings.length ? (
                <ul className="max-h-32 overflow-auto text-amber-700 dark:text-amber-300">
                  {preview.warnings.map((w) => (
                    <li key={w.row}>
                      {translate("ddc.import.row")} {w.row}: {w.message}
                    </li>
                  ))}
                </ul>
              ) : null}
              {allIssues.length ? (
                <>
                  <ul className="max-h-48 overflow-auto rounded border p-2 text-red-700 dark:text-red-300">
                    {allIssues.map((issue, index) => (
                      <li key={index}>
                        {translate("ddc.import.row")} {issue.row}
                        {issue.column ? ` · ${issue.column}` : ""}:{" "}
                        {translate(`ddc.import.error.${issue.message}`, {
                          _: issue.message,
                        })}
                      </li>
                    ))}
                  </ul>
                  <div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        downloadCsv(
                          allIssues as never,
                          `${resource}-import-errors.csv`,
                        )
                      }
                    >
                      <FileDown className="size-4" />
                      {translate("ddc.import.error_report")}
                    </Button>
                  </div>
                </>
              ) : null}
              {progress ? (
                <p>
                  {translate("ddc.import.progress", {
                    done: progress.done,
                    total: preview.valid.length,
                  })}
                </p>
              ) : (
                <div>
                  <Button
                    disabled={busy || preview.valid.length === 0}
                    onClick={runImport}
                  >
                    <Upload className="size-4" />
                    {translate("ddc.import.run", {
                      count: preview.valid.length,
                    })}
                  </Button>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export const makeImportExportActions = (resource: ImportResource) => {
  const ImportExportActions = () => {
    const translate = useTranslate();
    const [open, setOpen] = useState(false);
    return (
      <>
        <CanAccess resource={resource} action="import">
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Upload className="size-4" />
            {translate("ddc.import.button")}
          </Button>
        </CanAccess>
        <CanAccess resource={resource} action="export">
          <ExcelExportButton />
        </CanAccess>
        {open ? (
          <ImportDialog resource={resource} onClose={() => setOpen(false)} />
        ) : null}
      </>
    );
  };
  return ImportExportActions;
};

/** Exports the rows matching the current list filters to an Excel workbook. */
export const ExcelExportButton = () => {
  const { resource, filterValues, sort, total } = useListContext();
  const dataProvider = useDataProvider();
  const translate = useTranslate();
  const notify = useNotify();
  const label = useLabel();
  const [busy, setBusy] = useState(false);
  const def = getResourceDef(resource);
  if (!def) return null;

  const exportRows = async () => {
    setBusy(true);
    try {
      const { data } = await dataProvider.getList(resource, {
        filter: filterValues,
        sort,
        pagination: { page: 1, perPage: Math.max(total ?? 0, 1) },
      });
      await downloadXlsx(
        def.fields.map((f) => ({ key: f.source, header: label(f.label) })),
        data,
        `${resource}-${new Date().toISOString().slice(0, 10)}.xlsx`,
        label(def.label.many),
      );
    } catch (error) {
      notify(errorMessage(error), { type: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outline" size="sm" disabled={busy} onClick={exportRows}>
      <FileSpreadsheet className="size-4" />
      {translate("ddc.import.export_excel")}
    </Button>
  );
};
