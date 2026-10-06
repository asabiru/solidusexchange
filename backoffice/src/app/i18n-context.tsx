import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  applyDocumentLocale,
  formatCount,
  formatDate,
  formatLongDate,
  formatTime,
  initialLocale,
  intlLocale,
  type Locale,
  type LocaleStorage,
  type MessageKey,
  storeLocale,
  type TranslationParams,
  translate
} from "./i18n";

export interface I18n {
  locale: Locale;
  intlTag: string;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, params?: TranslationParams) => string;
  count: (value: number) => string;
  date: (iso: string) => string;
  longDate: (date: Date) => string;
  time: (iso: string) => string;
}

const I18nContext = createContext<I18n | undefined>(undefined);

function browserStorage(): LocaleStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale(browserStorage()));

  useEffect(() => {
    applyDocumentLocale(document, locale);
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    storeLocale(browserStorage(), next);
  }, []);

  const value = useMemo<I18n>(() => ({
    locale,
    intlTag: intlLocale(locale),
    setLocale,
    t: (key, params) => translate(locale, key, params),
    count: (count) => formatCount(locale, count),
    date: (iso) => formatDate(locale, iso),
    longDate: (date) => formatLongDate(locale, date),
    time: (iso) => formatTime(locale, iso)
  }), [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
