import { z } from "zod";

/**
 * Validation of spreadsheet imports (CSV / XLSX). Each row is validated on its
 * own; valid rows can be imported while invalid rows are reported with their
 * spreadsheet row number, column and message.
 */

const optionalText = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .optional();

const requiredText = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .pipe(z.string().min(1, "required"));

const optionalEmail = optionalText.pipe(
  z.string().email("invalid_email").nullable().optional(),
);

const optionalNumber = z
  .union([z.string(), z.number()])
  .transform((value) =>
    typeof value === "number" ? value : String(value).replace(/,/g, "").trim(),
  )
  .transform((value) => (value === "" ? null : Number(value)))
  .pipe(
    z
      .number({ message: "invalid_number" })
      .nonnegative("negative_number")
      .nullable(),
  )
  .optional();

const optionalDate = optionalText.pipe(
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "invalid_date")
    .refine(
      (value) => !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()),
      "invalid_date",
    )
    .nullable()
    .optional(),
);

export const IMPORT_SCHEMAS = {
  companies: z.object({
    customer_code: optionalText,
    name: requiredText,
    legal_name: optionalText,
    tax_identifier: optionalText,
    phone_number: optionalText,
    email: optionalEmail,
    website: optionalText,
    address: optionalText,
    city: optionalText,
    province: optionalText,
    zipcode: optionalText,
    country: optionalText,
    description: optionalText,
  }),
  leads: z.object({
    company_name: requiredText,
    contact_name: optionalText,
    contact_title: optionalText,
    email: optionalEmail,
    phone: optionalText,
    website: optionalText,
    country: optionalText,
    province: optionalText,
    product_interest: optionalText,
    estimated_value: optionalNumber,
    currency: optionalText.pipe(
      z
        .string()
        .regex(/^[A-Za-z]{3}$/, "invalid_currency")
        .nullable()
        .optional(),
    ),
    follow_up_date: optionalDate,
    qualification_notes: optionalText,
  }),
  products: z.object({
    part_number: requiredText,
    name: requiredText,
    name_en: optionalText,
    material: optionalText,
    uom: optionalText,
    current_revision: optionalText,
    description: optionalText,
  }),
} as const;

export type ImportResource = keyof typeof IMPORT_SCHEMAS;

export interface ImportIssue {
  /** Spreadsheet row number (header is row 1). */
  row: number;
  column: string;
  message: string;
}

export interface ImportValidationResult<T> {
  valid: Array<{ row: number; data: T }>;
  issues: ImportIssue[];
  /** Header names that do not match any importable column. */
  unknownColumns: string[];
}

const normalizeHeader = (header: string) =>
  header
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

export const validateImportRows = <R extends ImportResource>(
  resource: R,
  rows: Array<Record<string, unknown>>,
  options: { uniqueColumn?: string; existingValues?: Iterable<string> } = {},
): ImportValidationResult<z.infer<(typeof IMPORT_SCHEMAS)[R]>> => {
  const schema = IMPORT_SCHEMAS[resource];
  const known = new Set(Object.keys(schema.shape));
  const headers = new Set(rows.flatMap((row) => Object.keys(row)));
  const unknownColumns = [...headers].filter(
    (header) => !known.has(normalizeHeader(header)),
  );
  const seen = new Set(
    [...(options.existingValues ?? [])].map((value) =>
      value.trim().toLowerCase(),
    ),
  );

  const valid: ImportValidationResult<
    z.infer<(typeof IMPORT_SCHEMAS)[R]>
  >["valid"] = [];
  const issues: ImportIssue[] = [];

  rows.forEach((raw, index) => {
    const rowNumber = index + 2;
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      const column = normalizeHeader(key);
      if (known.has(column) && value !== null && value !== undefined)
        normalized[column] = value;
    }
    const parsed = schema.safeParse(normalized);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push({
          row: rowNumber,
          column: String(issue.path[0] ?? ""),
          message:
            issue.code === "invalid_type" && issue.input === undefined
              ? "required"
              : issue.message,
        });
      }
      return;
    }
    if (options.uniqueColumn) {
      const value = String(
        (parsed.data as Record<string, unknown>)[options.uniqueColumn] ?? "",
      )
        .trim()
        .toLowerCase();
      if (value && seen.has(value)) {
        issues.push({
          row: rowNumber,
          column: options.uniqueColumn,
          message: "duplicate_value",
        });
        return;
      }
      if (value) seen.add(value);
    }
    valid.push({
      row: rowNumber,
      data: parsed.data as z.infer<(typeof IMPORT_SCHEMAS)[R]>,
    });
  });

  return { valid, issues, unknownColumns };
};
