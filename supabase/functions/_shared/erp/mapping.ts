import type { ErpRecord, FieldMapping, FieldTransform } from "./types.ts";

export class MappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MappingError";
  }
}

const isBlank = (value: unknown) =>
  value === null ||
  value === undefined ||
  (typeof value === "string" && value.trim() === "");

const toDateOnly = (value: unknown, field: string): string => {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new MappingError(`Field ${field}: "${String(value)}" is not a date`);
  }
  return date.toISOString().slice(0, 10);
};

export const applyTransform = (
  value: unknown,
  transform: FieldTransform,
  field: string,
): unknown => {
  if (isBlank(value)) return null;
  switch (transform) {
    case "none":
      return value;
    case "trim":
      return String(value).trim();
    case "upper":
      return String(value).trim().toUpperCase();
    case "lower":
      return String(value).trim().toLowerCase();
    case "number": {
      const parsed =
        typeof value === "number"
          ? value
          : Number(String(value).replace(/,/g, ""));
      if (!Number.isFinite(parsed)) {
        throw new MappingError(
          `Field ${field}: "${String(value)}" is not a number`,
        );
      }
      return parsed;
    }
    case "date":
      return toDateOnly(value, field);
    case "boolean": {
      if (typeof value === "boolean") return value;
      const text = String(value).trim().toLowerCase();
      if (["true", "yes", "1"].includes(text)) return true;
      if (["false", "no", "0"].includes(text)) return false;
      throw new MappingError(
        `Field ${field}: "${String(value)}" is not a boolean`,
      );
    }
  }
};

export interface MappedRecord {
  /** ERP key of the record inside its legal entity. */
  erpKey: string;
  /** CRM column values produced by the active field mappings. */
  data: Record<string, unknown>;
}

/** The pseudo CRM field that carries the ERP key. It is never written to a CRM column. */
export const ERP_KEY_FIELD = "erp_key";

/**
 * Translates one ERP record into CRM column values using the configured mappings.
 * Only mapped fields are ever written: unmapped CRM columns are left untouched.
 */
export const mapErpRecord = (
  record: ErpRecord,
  mappings: FieldMapping[],
): MappedRecord => {
  const active = mappings.filter((mapping) => mapping.is_active);
  // Deterministic key order: the main ERP key first, then the other key parts by name
  const keyMappings = active
    .filter((mapping) => mapping.is_key)
    .sort((a, b) =>
      a.crm_field === ERP_KEY_FIELD
        ? -1
        : b.crm_field === ERP_KEY_FIELD
          ? 1
          : a.crm_field.localeCompare(b.crm_field),
    );
  if (keyMappings.length === 0) {
    throw new MappingError("No key mapping is configured for this entity");
  }

  const keyParts = keyMappings.map((mapping) => {
    const value = applyTransform(
      record[mapping.erp_field],
      mapping.transform,
      mapping.erp_field,
    );
    if (isBlank(value) && mapping === keyMappings[0]) {
      throw new MappingError(`Key field ${mapping.erp_field} is empty`);
    }
    return isBlank(value) ? "" : String(value);
  });

  const data: Record<string, unknown> = {};
  for (const mapping of active) {
    if (mapping.crm_field === ERP_KEY_FIELD) continue;
    data[mapping.crm_field] = applyTransform(
      record[mapping.erp_field],
      mapping.transform,
      mapping.erp_field,
    );
  }

  return { erpKey: keyParts.join("|"), data };
};

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([a], [b]) => a.localeCompare(b),
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
};

const fnv1a = (text: string, seed: number): string => {
  let hash = seed;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

/** Order independent fingerprint of the mapped payload, used to skip unchanged records. */
export const hashPayload = (data: Record<string, unknown>): string => {
  const text = stableStringify(data);
  return fnv1a(text, 0x811c9dc5) + fnv1a(text, 0x01234567);
};
