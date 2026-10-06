import { en } from "./locales/en.js";
import { type MessageKey, type Messages, ru } from "./locales/ru.js";

export type { MessageKey, Messages };

export type Locale = "ru" | "en";

export type TranslationParams = Readonly<Record<string, string | number>>;

export const locales: readonly Locale[] = Object.freeze(["ru", "en"]);
export const defaultLocale: Locale = "ru";
export const localeStorageKey = "solidchange.backoffice.locale";

/** Each language is named in itself so the switch reads the same in every locale. */
export const localeNames: Readonly<Record<Locale, string>> = Object.freeze({
  ru: "Русский",
  en: "English"
});

export const catalogs: Readonly<Record<Locale, Messages>> = Object.freeze({ ru, en });

const intlTags: Readonly<Record<Locale, string>> = Object.freeze({ ru: "ru-RU", en: "en-US" });

export interface LocaleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isLocale(value: unknown): value is Locale {
  return value === "ru" || value === "en";
}

/** True only for own catalog keys, so server-provided codes like "__proto__" or "toString" never resolve. */
export function hasMessage(key: string): key is MessageKey {
  return Object.hasOwn(ru, key);
}

export function readStoredLocale(storage: LocaleStorage | undefined): Locale | undefined {
  try {
    const value = storage?.getItem(localeStorageKey);
    return isLocale(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function storeLocale(storage: LocaleStorage | undefined, locale: Locale): boolean {
  if (!storage) return false;
  try {
    storage.setItem(localeStorageKey, locale);
    return true;
  } catch {
    return false;
  }
}

export function initialLocale(storage: LocaleStorage | undefined): Locale {
  return readStoredLocale(storage) ?? defaultLocale;
}

export function applyDocumentLocale(document: { documentElement: { lang: string }; title: string }, locale: Locale): void {
  document.documentElement.lang = locale;
  document.title = translate(locale, "app.documentTitle");
}

export function intlLocale(locale: Locale): string {
  return isLocale(locale) ? intlTags[locale] : intlTags[defaultLocale];
}

export function placeholdersOf(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? "").sort();
}

function lookup(catalog: Messages, key: string): string | undefined {
  return Object.hasOwn(catalog, key) ? catalog[key as MessageKey] || undefined : undefined;
}

export function translate(locale: Locale, key: MessageKey, params?: TranslationParams): string {
  const catalog = isLocale(locale) ? catalogs[locale] : ru;
  const template = lookup(catalog, key) ?? lookup(ru, key) ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder
  );
}

/** Integer counts only; exact decimal strings (amounts, report values) are rendered as received. */
export function formatCount(locale: Locale, value: number): string {
  return Number.isSafeInteger(value) ? new Intl.NumberFormat(intlLocale(locale)).format(value) : String(value);
}

export function formatLongDate(locale: Locale, date: Date): string {
  const text = new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(date);
  return text.charAt(0).toLocaleUpperCase(intlLocale(locale)) + text.slice(1);
}

const invalidDate = "\u2014";

export function formatTime(locale: Locale, iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? invalidDate : date.toLocaleTimeString(intlLocale(locale));
}

/** Calendar date of an ISO timestamp, in UTC so report periods never shift by a day. */
export function formatDate(locale: Locale, iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return invalidDate;
  return new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}
