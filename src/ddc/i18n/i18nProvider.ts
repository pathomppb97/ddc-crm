import { mergeTranslations } from "ra-core";
import polyglotI18nProvider from "ra-i18n-polyglot";
import englishMessages from "ra-language-english";
import { raSupabaseEnglishMessages } from "ra-supabase-language-english";
import { englishCrmMessages } from "@/components/atomic-crm/providers/commons/englishCrmMessages";
import { buildResourceMessages } from "../resources/registry";
import { ddcMessages } from "./ddcMessages";
import { thaiAtomicMessages, thaiRaMessages } from "./thaiRaMessages";

/**
 * Thai is the default language, English is available from the language menu.
 * Keys missing in Thai fall back to English (the Thai catalog is merged on top
 * of the English one), so no screen ever shows a raw key.
 */
export const englishCatalog = mergeTranslations(
  englishMessages,
  raSupabaseEnglishMessages,
  englishCrmMessages,
  buildResourceMessages("en"),
  ddcMessages.en,
);

export const thaiCatalog = mergeTranslations(
  englishCatalog,
  thaiRaMessages,
  thaiAtomicMessages,
  buildResourceMessages("th"),
  ddcMessages.th,
);

export const ddcI18nProvider = polyglotI18nProvider(
  (locale) => (locale === "en" ? englishCatalog : thaiCatalog),
  "th",
  [
    { locale: "th", name: "ไทย" },
    { locale: "en", name: "English" },
  ],
  { allowMissing: true },
);
