import { z } from "zod";

const DANGEROUS_CONTENT_PATTERN =
  /(<\s*script|<\s*iframe|<\s*object|<\s*embed|<\s*svg|javascript:|vbscript:|data\s*:\s*text\/html|on[a-z]+\s*=|expression\s*\()/i;

const SAFE_HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const SAFE_ASSET_URL_PATTERN =
  /^(https:\/\/[^\s"'<>]+|\/[a-zA-Z0-9/._-]+|data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]{1,65536})$/;

const safeText = (max = 200) =>
  z
    .string()
    .max(max)
    .refine(
      (val) => !DANGEROUS_CONTENT_PATTERN.test(val),
      "Disallowed executable content or script pattern detected",
    );

const safeAssetUrl = z
  .string()
  .max(70000)
  .refine(
    (val) =>
      SAFE_ASSET_URL_PATTERN.test(val) && !DANGEROUS_CONTENT_PATTERN.test(val),
    "Asset URL must be HTTPS, a relative path, or a safe raster image data URI",
  );

export const ALLOWED_FONT_FAMILIES = [
  "IBM Plex Sans Thai",
  "Inter",
  "Sarabun",
  "Prompt",
  "Noto Sans Thai",
] as const;

export const ALLOWED_NAV_KEYS = [
  "dashboard",
  "field-visit",
  "timeline",
  "companies",
  "contacts",
  "catalog",
  "calendar",
  "leads",
  "deals",
  "rfqs",
  "quotations",
  "sales_orders",
  "products",
  "machine_models",
  "product_machine_applications",
  "dev_projects",
  "dealer_networks",
  "service_cases",
] as const;

export const UiConfigSchema = z.object({
  branding: z
    .object({
      title: safeText(80).default("DDC Agriculture CRM"),
      subtitle: safeText(160).optional(),
      footerText: safeText(200).optional(),
      supportEmail: z.string().email().optional(),
    })
    .default({ title: "DDC Agriculture CRM" }),
  logos: z
    .object({
      lightModeUrl: safeAssetUrl.optional(),
      darkModeUrl: safeAssetUrl.optional(),
      faviconUrl: safeAssetUrl.optional(),
    })
    .default({}),
  theme: z
    .object({
      primary: z.string().regex(SAFE_HEX_COLOR).default("#0f4c3a"),
      secondary: z.string().regex(SAFE_HEX_COLOR).default("#1e293b"),
      accent: z.string().regex(SAFE_HEX_COLOR).default("#0ea5e9"),
      surface: z.string().regex(SAFE_HEX_COLOR).default("#f8fafc"),
      danger: z.string().regex(SAFE_HEX_COLOR).default("#b91c1c"),
      warning: z.string().regex(SAFE_HEX_COLOR).default("#b45309"),
      success: z.string().regex(SAFE_HEX_COLOR).default("#15803d"),
    })
    .default({
      primary: "#0f4c3a",
      secondary: "#1e293b",
      accent: "#0ea5e9",
      surface: "#f8fafc",
      danger: "#b91c1c",
      warning: "#b45309",
      success: "#15803d",
    }),
  typography: z
    .object({
      fontFamily: z.enum(ALLOWED_FONT_FAMILIES).default("IBM Plex Sans Thai"),
      density: z.enum(["compact", "default", "comfortable"]).default("default"),
    })
    .default({ fontFamily: "IBM Plex Sans Thai", density: "default" }),
  login: z
    .object({
      backgroundUrl: safeAssetUrl.optional(),
      headline: safeText(120).optional(),
      tagline: safeText(240).optional(),
    })
    .default({}),
  navigation: z
    .array(
      z.object({
        key: z.enum(ALLOWED_NAV_KEYS),
        visible: z.boolean().default(true),
        sortOrder: z.number().int().min(0).max(1000).default(0),
        labelTh: safeText(80).optional(),
        labelEn: safeText(80).optional(),
      }),
    )
    .max(50)
    .default([]),
  dashboardWidgets: z
    .array(
      z.object({
        widgetId: z
          .string()
          .regex(/^[a-z][a-z0-9_-]{1,60}$/)
          .max(64),
        visible: z.boolean().default(true),
        colSpan: z.number().int().min(1).max(4).default(1),
        sortOrder: z.number().int().min(0).max(200).default(0),
      }),
    )
    .max(40)
    .default([]),
  tableColumns: z
    .record(
      z.string().regex(/^[a-z][a-z0-9_]*$/),
      z
        .array(
          z.object({
            field: z.string().regex(/^[a-z][a-z0-9_]*$/),
            visible: z.boolean(),
            width: z.number().int().min(48).max(1600).optional(),
            label: safeText(80).optional(),
          }),
        )
        .max(100),
    )
    .default({}),
  dynamicFormFields: z
    .array(
      z.object({
        entity: z.enum(["companies", "contacts", "leads", "deals", "products"]),
        fieldKey: z.string().regex(/^[a-z][a-z0-9_]*$/),
        labelTh: safeText(80),
        labelEn: safeText(80),
        dataType: z.enum(["text", "number", "date", "boolean", "select"]),
        required: z.boolean().default(false),
        options: z.array(safeText(80)).max(50).default([]),
      }),
    )
    .max(200)
    .default([]),
  notificationTemplates: z
    .array(
      z.object({
        eventKey: z.string().regex(/^[a-z][a-z0-9_.-]*$/),
        subjectTh: safeText(160),
        subjectEn: safeText(160),
        bodyTh: safeText(2000),
        bodyEn: safeText(2000),
      }),
    )
    .max(100)
    .default([]),
});

export type UiConfigPayload = z.infer<typeof UiConfigSchema>;

export type UiConfigStatus =
  | "draft"
  | "validated"
  | "approved"
  | "scheduled"
  | "published"
  | "superseded"
  | "rolled_back";

const ALLOWED_TRANSITIONS: Record<UiConfigStatus, readonly UiConfigStatus[]> = {
  draft: ["validated"],
  validated: ["draft", "approved"],
  approved: ["scheduled", "published", "draft"],
  scheduled: ["published", "approved"],
  published: ["superseded", "rolled_back"],
  superseded: [],
  rolled_back: [],
};

export function canTransitionUiConfigStatus(
  from: UiConfigStatus,
  to: UiConfigStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export interface UiConfigValidationResult {
  valid: boolean;
  data?: UiConfigPayload;
  errors: Array<{ path: string; message: string }>;
}

/** Validates untrusted configuration payloads and rejects executable code injection. */
export function validateUiConfigPayload(
  payload: unknown,
): UiConfigValidationResult {
  const parsed = UiConfigSchema.safeParse(payload);
  if (parsed.success) {
    return { valid: true, data: parsed.data, errors: [] };
  }
  return {
    valid: false,
    errors: parsed.error.issues.map((issue) => ({
      path: issue.path.join(".") || "$",
      message: issue.message,
    })),
  };
}
