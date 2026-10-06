import { en } from "./locales/en.js";
import { ky } from "./locales/ky.js";
import { type MessageKey, type Messages, ru } from "./locales/ru.js";

export type { MessageKey, Messages };

export type Locale = "ru" | "ky" | "en";

export type TranslationParams = Readonly<Record<string, string | number>>;

export const locales: readonly Locale[] = Object.freeze(["ru", "ky", "en"]);
export const defaultLocale: Locale = "ru";
export const localeStorageKey = "solidchange.backoffice.locale";

/** Each language is named in itself so the switch reads the same in every locale. */
export const localeNames: Readonly<Record<Locale, string>> = Object.freeze({
  ru: "Русский",
  ky: "Кыргызча",
  en: "English"
});

export const catalogs: Readonly<Record<Locale, Messages>> = Object.freeze({ ru, ky, en });

const intlTags: Readonly<Record<Locale, string>> = Object.freeze({ ru: "ru-RU", ky: "ky-KG", en: "en-US" });

export interface LocaleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isLocale(value: unknown): value is Locale {
  return value === "ru" || value === "ky" || value === "en";
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

export type IntlSupport = (tag: string) => boolean;

export const intlSupported: IntlSupport = (tag) =>
  Intl.NumberFormat.supportedLocalesOf(tag).length > 0 && Intl.DateTimeFormat.supportedLocalesOf(tag).length > 0;

/** Browsers without Kyrgyz ICU data fall back to ru-RU, which shares Kyrgyz number conventions. */
export function intlLocale(locale: Locale, supported: IntlSupport = intlSupported): string {
  const tag = isLocale(locale) ? intlTags[locale] : intlTags[defaultLocale];
  return supported(tag) ? tag : intlTags[defaultLocale];
}

/** Without native Kyrgyz data dates stay numeric so no Russian month or weekday names leak into the Kyrgyz UI. */
function numericDates(locale: Locale, tag: string): boolean {
  return locale === "ky" && tag !== intlTags.ky;
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
export function formatCount(locale: Locale, value: number, supported: IntlSupport = intlSupported): string {
  return Number.isSafeInteger(value) ? new Intl.NumberFormat(intlLocale(locale, supported)).format(value) : String(value);
}

export function formatLongDate(locale: Locale, date: Date, supported: IntlSupport = intlSupported): string {
  const tag = intlLocale(locale, supported);
  const options: Intl.DateTimeFormatOptions = numericDates(locale, tag)
    ? { day: "2-digit", month: "2-digit", year: "numeric" }
    : { weekday: "long", day: "numeric", month: "long", year: "numeric" };
  const text = new Intl.DateTimeFormat(tag, options).format(date);
  return text.charAt(0).toLocaleUpperCase(tag) + text.slice(1);
}

const invalidDate = "\u2014";

export function formatTime(locale: Locale, iso: string, supported: IntlSupport = intlSupported): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? invalidDate : date.toLocaleTimeString(intlLocale(locale, supported));
}

/** Calendar date of an ISO timestamp, in UTC so report periods never shift by a day. */
export function formatDate(locale: Locale, iso: string, supported: IntlSupport = intlSupported): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return invalidDate;
  const tag = intlLocale(locale, supported);
  const numeric = numericDates(locale, tag);
  return new Intl.DateTimeFormat(tag, { day: numeric ? "2-digit" : "numeric", month: numeric ? "2-digit" : "long", year: "numeric", timeZone: "UTC" }).format(date);
}
