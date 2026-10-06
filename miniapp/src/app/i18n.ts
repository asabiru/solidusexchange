import type { DecimalSeparators } from "../shared/decimal.js";
import { en } from "./locales/en.js";
import { ky } from "./locales/ky.js";
import { type MessageKey, type Messages, ru } from "./locales/ru.js";

export type { MessageKey, Messages };

export type Locale = "ru" | "ky" | "en";

export type TranslationParams = Readonly<Record<string, string | number>>;

export const locales: readonly Locale[] = Object.freeze(["ru", "ky", "en"]);
export const defaultLocale: Locale = "ru";
export const localeStorageKey = "solidchange.miniapp.locale";

/** Each language is named in itself so the picker reads the same in every locale. */
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

/** Maps a Telegram `language_code` (IETF tag) to a supported locale; anything else falls back to Russian. */
export function localeFromLanguageCode(code: string | undefined): Locale {
  const primary = (code ?? "").trim().toLowerCase().split(/[-_]/)[0];
  if (primary === "ky") return "ky";
  if (primary === "en") return "en";
  return defaultLocale;
}

/** Reads `user.language_code` from raw launch data. Used for UI language only, never for authorization. */
export function languageCodeFromInitData(initData: string | undefined): string | undefined {
  if (!initData) return undefined;
  try {
    const user: unknown = JSON.parse(new URLSearchParams(initData).get("user") ?? "null");
    const code = user && typeof user === "object" ? (user as { language_code?: unknown }).language_code : undefined;
    return typeof code === "string" ? code : undefined;
  } catch {
    return undefined;
  }
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

/** A saved choice wins; otherwise the Telegram user language decides. */
export function initialLocale(options: { storage?: LocaleStorage; languageCode?: string }): Locale {
  return readStoredLocale(options.storage) ?? localeFromLanguageCode(options.languageCode);
}

export function applyDocumentLocale(document: { documentElement: { lang: string } }, locale: Locale): void {
  document.documentElement.lang = locale;
}

export type IntlSupport = (tag: string) => boolean;

export const intlSupported: IntlSupport = (tag) =>
  Intl.NumberFormat.supportedLocalesOf(tag).length > 0 && Intl.DateTimeFormat.supportedLocalesOf(tag).length > 0;

/** Browsers without Kyrgyz ICU data (e.g. Chrome) fall back to ru-RU, which shares Kyrgyz number conventions. */
export function intlLocale(locale: Locale, supported: IntlSupport = intlSupported): string {
  const tag = intlTags[locale] ?? intlTags[defaultLocale];
  return supported(tag) ? tag : intlTags[defaultLocale];
}

export function placeholdersOf(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? "").sort();
}

export function translate(locale: Locale, key: MessageKey, params?: TranslationParams): string {
  const template = (catalogs[locale] ?? ru)[key] || ru[key] || key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder
  );
}

/** Group/decimal symbols from Intl so exact decimal strings can be formatted without floats. */
export function decimalSeparators(locale: Locale, supported: IntlSupport = intlSupported): DecimalSeparators {
  const parts = new Intl.NumberFormat(intlLocale(locale, supported)).formatToParts(1234567.5);
  return {
    group: parts.find((part) => part.type === "group")?.value ?? "\u00a0",
    decimal: parts.find((part) => part.type === "decimal")?.value ?? ","
  };
}
