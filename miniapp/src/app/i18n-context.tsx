import { createContext, type ReactNode, useContext, useMemo } from "react";
import { createFormatter, type Formatter } from "./format";
import { type Locale, type MessageKey, type TranslationParams, translate } from "./i18n";

export interface I18n {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, params?: TranslationParams) => string;
  format: Formatter;
}

const I18nContext = createContext<I18n | undefined>(undefined);

export function I18nProvider({ locale, setLocale, children }: { locale: Locale; setLocale: (locale: Locale) => void; children: ReactNode }) {
  const value = useMemo<I18n>(() => ({
    locale,
    setLocale,
    t: (key, params) => translate(locale, key, params),
    format: createFormatter(locale)
  }), [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
