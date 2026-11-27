/**
 * Customer duplicate detection. Candidates are scored on normalized identifiers;
 * the result is a suggestion for a person to review, never an automatic merge.
 */

export interface CustomerIdentity {
  id?: number | string;
  name?: string | null;
  tax_identifier?: string | null;
  email?: string | null;
  phone_number?: string | null;
  website?: string | null;
}

export interface DuplicateMatch<T extends CustomerIdentity> {
  record: T;
  score: number;
  reasons: string[];
}

// Legal form words carry no identity ("Co., Ltd.", "บริษัท ... จำกัด")
const LEGAL_FORMS = [
  "company limited",
  "co ltd",
  "co",
  "ltd",
  "limited",
  "inc",
  "corp",
  "corporation",
  "plc",
  "public company",
  "part ltd",
  "llc",
  "gmbh",
  "pte",
  "บริษัท",
  "จำกัด",
  "มหาชน",
  "ห้างหุ้นส่วนจำกัด",
  "หจก",
  "บจก",
].map((form) => form.normalize("NFKC"));

export const normalizeCompanyName = (
  name: string | null | undefined,
): string => {
  if (!name) return "";
  let text = name
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[(),.\-_/&]+/g, " ");
  for (const form of LEGAL_FORMS) {
    text = text.replace(new RegExp(`(^|\\s)${form}(?=\\s|$)`, "g"), " ");
  }
  return text.replace(/\s+/g, " ").trim();
};

export const normalizeDigits = (value: string | null | undefined) =>
  (value ?? "").replace(/\D/g, "");

/** Last 8 digits: ignores country code / trunk prefix differences (+66 2... vs 02...). */
const phoneKey = (value: string | null | undefined) =>
  normalizeDigits(value).slice(-8);

export const normalizeDomain = (value: string | null | undefined): string => {
  if (!value) return "";
  const text = value.trim().toLowerCase();
  const host = text.includes("@")
    ? text.split("@").pop()!
    : text.replace(/^https?:\/\//, "").split("/")[0];
  return host.replace(/^www\./, "");
};

const FREE_MAIL = new Set([
  "gmail.com",
  "hotmail.com",
  "outlook.com",
  "yahoo.com",
  "live.com",
  "icloud.com",
]);

const bigrams = (text: string) => {
  const compact = text.replace(/\s/g, "");
  const grams = new Set<string>();
  for (let index = 0; index < compact.length - 1; index += 1)
    grams.add(compact.slice(index, index + 2));
  return grams;
};

/** Dice coefficient on character bigrams, 0..1. */
export const nameSimilarity = (a: string, b: string): number => {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const left = bigrams(a);
  const right = bigrams(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return (2 * shared) / (left.size + right.size);
};

export const DUPLICATE_THRESHOLD = 0.6;

export const findDuplicateCandidates = <T extends CustomerIdentity>(
  candidate: CustomerIdentity,
  existing: T[],
  threshold = DUPLICATE_THRESHOLD,
): DuplicateMatch<T>[] => {
  const name = normalizeCompanyName(candidate.name);
  const tax = normalizeDigits(candidate.tax_identifier);
  const phone = phoneKey(candidate.phone_number);
  const domains = [
    normalizeDomain(candidate.website),
    normalizeDomain(candidate.email),
  ].filter((domain) => domain && !FREE_MAIL.has(domain));

  return existing
    .filter(
      (record) =>
        candidate.id === undefined ||
        String(record.id) !== String(candidate.id),
    )
    .map((record) => {
      const reasons: string[] = [];
      let score = 0;
      if (tax.length >= 10 && tax === normalizeDigits(record.tax_identifier)) {
        score = 1;
        reasons.push("tax_identifier");
      }
      const similarity = nameSimilarity(
        name,
        normalizeCompanyName(record.name),
      );
      if (similarity >= 0.8) {
        score = Math.max(score, similarity * 0.9);
        reasons.push("name");
      }
      const recordDomains = [
        normalizeDomain(record.website),
        normalizeDomain(record.email),
      ];
      if (domains.some((domain) => recordDomains.includes(domain))) {
        score = Math.max(score, 0.7) + 0.1;
        reasons.push("domain");
      }
      if (phone.length === 8 && phone === phoneKey(record.phone_number)) {
        score = Math.max(score, 0.6) + 0.1;
        reasons.push("phone");
      }
      return {
        record,
        score: Math.min(1, Math.round(score * 100) / 100),
        reasons,
      };
    })
    .filter((match) => match.score >= threshold)
    .sort((a, b) => b.score - a.score);
};
