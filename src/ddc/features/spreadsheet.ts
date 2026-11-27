import Papa from "papaparse";

/** Reads the first sheet of a CSV or XLSX file into objects keyed by header. */
export const readSpreadsheet = async (
  file: File,
): Promise<Array<Record<string, unknown>>> => {
  if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
    const text = await file.text();
    const result = Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: "greedy",
    });
    if (result.errors.length) throw new Error(result.errors[0].message);
    return result.data;
  }
  if (!/\.xlsx$/i.test(file.name))
    throw new Error("ddc.import.unsupported_file");
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const headers: string[] = [];
  sheet.getRow(1).eachCell((cell, column) => {
    headers[column] = String(cell.text ?? "").trim();
  });
  const rows: Array<Record<string, unknown>> = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: Record<string, unknown> = {};
    headers.forEach((header, column) => {
      if (!header) return;
      const cell = row.getCell(column);
      const value =
        cell.value instanceof Date
          ? cell.value.toISOString().slice(0, 10)
          : cell.text;
      if (value !== "" && value !== undefined) record[header] = value;
    });
    rows.push(record);
  });
  return rows;
};

const download = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const downloadCsv = (
  rows: Array<Record<string, unknown>>,
  fileName: string,
) =>
  // BOM so that Excel opens Thai text as UTF-8
  download(
    new Blob(["﻿", Papa.unparse(rows)], { type: "text/csv;charset=utf-8" }),
    fileName,
  );

export const downloadXlsx = async (
  columns: Array<{ key: string; header: string }>,
  rows: Array<Record<string, unknown>>,
  fileName: string,
  sheetName = "Data",
) => {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "DDC CRM";
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31));
  sheet.columns = columns.map((column) => ({
    ...column,
    width: Math.min(40, Math.max(12, column.header.length + 4)),
  }));
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) {
    sheet.addRow(
      Object.fromEntries(
        columns.map(({ key }) => {
          const value = row[key];
          return [
            key,
            value !== null && typeof value === "object"
              ? JSON.stringify(value)
              : value,
          ];
        }),
      ),
    );
  }
  const buffer = await workbook.xlsx.writeBuffer();
  download(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    fileName,
  );
};
