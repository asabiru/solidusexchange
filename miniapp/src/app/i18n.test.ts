import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDecimalString, normalizeAmountInput } from "../shared/decimal.js";
import { createFormatter } from "./format.js";
import {
  applyDocumentLocale,
  catalogs,
  defaultLocale,
  initialLocale,
  type LocaleStorage,
  languageCodeFromInitData,
  localeFromLanguageCode,
  localeNames,
  locales,
  localeStorageKey,
  type Messages,
  placeholdersOf,
  readStoredLocale,
  storeLocale,
  translate
} from "./i18n.js";
import { en } from "./locales/en.js";
import { ky } from "./locales/ky.js";
import { ru } from "./locales/ru.js";

function memoryStorage(initial: Record<string, string> = {}): LocaleStorage & { values: Record<string, string> } {
  const values = { ...initial };
  return {
    values,
    getItem: (key) => (Object.hasOwn(values, key) ? values[key] ?? null : null),
    setItem: (key, value) => {
      values[key] = value;
    }
  };
}

const throwingStorage: LocaleStorage = {
  getItem: () => {
    throw new Error("storage disabled");
  },
  setItem: () => {
    throw new Error("storage disabled");
  }
};

function initDataWithLanguage(code: unknown): string {
  return new URLSearchParams({ auth_date: "1", user: JSON.stringify({ id: 1, language_code: code }), hash: "00" }).toString();
}

describe("i18n: catalog parity", () => {
  it("rejects catalogs with missing or extra keys at compile time", () => {
    const { "app.devBadge": dropped, ...rest } = ru;
    // @ts-expect-error a catalog without every Russian key does not compile
    const missing: Messages = rest;
    // @ts-expect-error a catalog with a key Russian does not have does not compile
    const extra: Messages = { ...ru, "extra.key": "x" };
    assert.equal(typeof dropped, "string");
    assert.equal(Object.keys(missing).length, Object.keys(ru).length - 1);
    assert.equal(Object.keys(extra).length, Object.keys(ru).length + 1);
  });

  it("gives ky and en exactly the Russian keys", () => {
    const expected = Object.keys(ru).sort();
    assert.ok(expected.length > 200);
    assert.deepEqual(Object.keys(ky).sort(), expected);
    assert.deepEqual(Object.keys(en).sort(), expected);
    assert.deepEqual([...locales].sort(), Object.keys(catalogs).sort());
  });

  it("has no empty or whitespace-only strings in any locale", () => {
    for (const locale of locales) {
      for (const [key, value] of Object.entries(catalogs[locale])) {
        assert.equal(typeof value, "string", `${locale}:${key}`);
        assert.notEqual(value.trim(), "", `${locale}:${key}`);
        assert.equal(value, value.trim(), `${locale}:${key}`);
      }
    }
  });

  it("keeps the same placeholders in every translation", () => {
    for (const [key, value] of Object.entries(ru)) {
      const expected = placeholdersOf(value);
      assert.deepEqual(placeholdersOf(ky[key as keyof typeof ru]), expected, `ky:${key}`);
      assert.deepEqual(placeholdersOf(en[key as keyof typeof ru]), expected, `en:${key}`);
    }
  });

  it("translates the Kyrgyz and English catalogs instead of copying Russian", () => {
    const cyrillicOnly = /[\u0400-\u04ff]/;
    const sharedLoanwords = [
      "tab.profile",
      "common.fee",
      "common.rate",
      "exchange.spread",
      "exchange.cryptoAsset",
      "profile.capSession",
      "kyc.title",
      "operation.title",
      "operation.channel"
    ];
    const copied = Object.keys(ru).filter((key) => cyrillicOnly.test(ru[key as keyof typeof ru]) && ky[key as keyof typeof ru] === ru[key as keyof typeof ru]);
    assert.deepEqual(copied, sharedLoanwords);
    for (const [key, value] of Object.entries(en)) assert.doesNotMatch(value, cyrillicOnly, `en:${key}`);
    assert.deepEqual(localeNames, { ru: "Русский", ky: "Кыргызча", en: "English" });
  });
});

describe("i18n: locale detection", () => {
  it("maps Telegram language codes to ky, en, or the Russian default", () => {
    assert.equal(defaultLocale, "ru");
    assert.equal(localeFromLanguageCode("ky"), "ky");
    assert.equal(localeFromLanguageCode("ky-KG"), "ky");
    assert.equal(localeFromLanguageCode("KY"), "ky");
    assert.equal(localeFromLanguageCode("en"), "en");
    assert.equal(localeFromLanguageCode("en-US"), "en");
    assert.equal(localeFromLanguageCode("en_GB"), "en");
    for (const other of ["ru", "uk", "kk", "uz", "de", "kyz", "eng", "", " ", undefined]) {
      assert.equal(localeFromLanguageCode(other), "ru", String(other));
    }
  });

  it("reads user.language_code from raw launch data without trusting anything else", () => {
    assert.equal(languageCodeFromInitData(initDataWithLanguage("ky")), "ky");
    assert.equal(languageCodeFromInitData(initDataWithLanguage("en-US")), "en-US");
    assert.equal(languageCodeFromInitData(initDataWithLanguage(7)), undefined);
    assert.equal(languageCodeFromInitData("auth_date=1&user=%7Bbroken&hash=00"), undefined);
    assert.equal(languageCodeFromInitData("auth_date=1&hash=00"), undefined);
    assert.equal(languageCodeFromInitData(undefined), undefined);
    assert.equal(languageCodeFromInitData(""), undefined);
  });

  it("uses the Telegram language when nothing is stored", () => {
    assert.equal(initialLocale({ storage: memoryStorage(), languageCode: "ky" }), "ky");
    assert.equal(initialLocale({ storage: memoryStorage(), languageCode: "en" }), "en");
    assert.equal(initialLocale({ storage: memoryStorage(), languageCode: "tr" }), "ru");
    assert.equal(initialLocale({}), "ru");
  });
});

describe("i18n: persistence and fallback", () => {
  it("persists the chosen locale and prefers it over the Telegram language", () => {
    const storage = memoryStorage();
    assert.equal(storeLocale(storage, "ky"), true);
    assert.deepEqual(storage.values, { [localeStorageKey]: "ky" });
    assert.equal(readStoredLocale(storage), "ky");
    assert.equal(initialLocale({ storage, languageCode: "en" }), "ky");
    storeLocale(storage, "ru");
    assert.equal(initialLocale({ storage, languageCode: "en" }), "ru");
  });

  it("ignores unknown stored values and falls back to detection", () => {
    for (const stored of ["de", "", "KY", "en-US", "null"]) {
      const storage = memoryStorage({ [localeStorageKey]: stored });
      assert.equal(readStoredLocale(storage), undefined, stored);
      assert.equal(initialLocale({ storage, languageCode: "en" }), "en", stored);
      assert.equal(initialLocale({ storage }), "ru", stored);
    }
  });

  it("survives unavailable or throwing storage", () => {
    assert.equal(readStoredLocale(undefined), undefined);
    assert.equal(readStoredLocale(throwingStorage), undefined);
    assert.equal(storeLocale(undefined, "en"), false);
    assert.equal(storeLocale(throwingStorage, "en"), false);
    assert.equal(initialLocale({ storage: throwingStorage, languageCode: "ky" }), "ky");
  });

  it("sets the document language to the selected locale", () => {
    const document = { documentElement: { lang: "ru" } };
    applyDocumentLocale(document, "ky");
    assert.equal(document.documentElement.lang, "ky");
    applyDocumentLocale(document, "en");
    assert.equal(document.documentElement.lang, "en");
  });

  it("interpolates parameters and leaves unknown placeholders visible", () => {
    assert.equal(translate("ru", "home.greeting", { name: "Тимур" }), "Добрый день, Тимур");
    assert.equal(translate("ky", "home.greeting", { name: "Тимур" }), "Саламатсызбы, Тимур");
    assert.equal(translate("en", "activity.found", { count: 3 }), "Found: 3");
    assert.equal(translate("en", "home.greeting"), "Good afternoon, {name}");
    assert.equal(translate("en", "home.greeting", { other: "x" }), "Good afternoon, {name}");
    assert.equal(translate("ru", "common.unavailable"), "Недоступно в тестовой версии");
    assert.equal(translate("ky", "common.unavailable"), "Сыноо версиясында жеткиликсиз");
    assert.equal(translate("en", "common.unavailable"), "Not available in the test version");
  });
});

describe("i18n: locale formatting", () => {
  it("formats exact decimal strings with locale separators and no float rounding", () => {
    assert.equal(createFormatter("ru").money("RUB", "1234567.89"), "1\u00a0234\u00a0567,89\u00a0₽");
    assert.equal(createFormatter("ky").money("RUB", "1234567.89"), "1\u00a0234\u00a0567,89\u00a0₽");
    assert.equal(createFormatter("en").money("RUB", "1234567.89"), "1,234,567.89\u00a0₽");
    const huge = "98765432109876543.123456";
    assert.equal(createFormatter("en").amount("USDT", huge, true), "98,765,432,109,876,543.123456");
    assert.equal(createFormatter("ru").amount("USDT", huge, true), "98\u00a0765\u00a0432\u00a0109\u00a0876\u00a0543,123456");
    assert.notEqual(String(Number(huge)), "98765432109876543.123456");
  });

  it("formats signed legs and rates per locale", () => {
    const en = createFormatter("en");
    assert.equal(en.signedLeg({ asset: "RUB", amount: "25000", direction: "out" }), "\u221225,000.00\u00a0₽");
    assert.equal(en.signedLeg({ asset: "USDT", amount: "250.5", direction: "in" }), "+250.50\u00a0USDT");
    assert.equal(createFormatter("ru").rate({ base: "USDT", quote: "RUB", value: "91.5" }), "1 USDT = 91,50\u00a0₽");
    assert.equal(en.rate({ base: "USDT", quote: "RUB", value: "91.5" }), "1 USDT = 91.50\u00a0₽");
    assert.equal(en.decimal("12.5", { fractionDigits: 2 }), "12.50");
  });

  it("produces amount inputs that round-trip through the input parser", () => {
    for (const locale of locales) {
      const text = createFormatter(locale).amountInput("USDT", "12345.678901");
      assert.equal(normalizeAmountInput(text), "12345.678901", locale);
      assert.ok(isDecimalString(normalizeAmountInput(text), 6), locale);
    }
    assert.equal(createFormatter("en").amountInput("RUB", "1000.5"), "1000.5");
    assert.equal(createFormatter("ru").amountInput("RUB", "1000.5"), "1000,5");
  });

  it("formats dates with Intl in the selected locale", () => {
    const iso = "2026-10-05T06:42:00.000Z";
    const ruDate = createFormatter("ru").dateTime(iso);
    const kyDate = createFormatter("ky").dateTime(iso);
    const enDate = createFormatter("en").dateTime(iso);
    assert.match(ruDate, /октября/);
    assert.match(ruDate, /12:42/);
    assert.match(kyDate, /октябр/);
    assert.notEqual(kyDate, ruDate);
    assert.match(enDate, /October/);
    assert.match(enDate, /12:42/);
  });
});
