import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { formatDecimal, isDecimalString, normalizeAmountInput } from "../shared/decimal.js";
import { createFormatter } from "./format.js";
import {
  applyDocumentLocale,
  catalogs,
  defaultLocale,
  initialLocale,
  decimalSeparators,
  intlLocale,
  type Locale,
  type LocaleStorage,
  languageCodeFromInitData,
  localeFromLanguageCode,
  localeNames,
  locales,
  localeStorageKey,
  type MessageKey,
  type Messages,
  messageKeyFor,
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

  it("falls back to Russian conventions when the runtime has no Kyrgyz Intl data", () => {
    const noKyrgyz = (tag: string) => !tag.startsWith("ky");
    assert.equal(intlLocale("ky", () => true), "ky-KG");
    assert.equal(intlLocale("ky", noKyrgyz), "ru-RU");
    assert.equal(intlLocale("en", noKyrgyz), "en-US");
    const ky = createFormatter("ky", noKyrgyz);
    assert.equal(ky.money("RUB", "84200"), "84\u00a0200,00\u00a0₽");
    const date = ky.dateTime("2026-10-05T06:42:00.000Z");
    assert.match(date, /05\.10/);
    assert.match(date, /12:42/);
    assert.doesNotMatch(date, /[\u0400-\u04ff]/);
  });
});

describe("i18n: untrusted keys, params and dates", () => {
  const prototypeKeys = ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"];

  it("never resolves prototype properties as messages", () => {
    for (const locale of locales) {
      for (const name of prototypeKeys) {
        const text = translate(locale, name as MessageKey);
        assert.equal(typeof text, "string", `${locale}:${name}`);
        assert.equal(text, name, `${locale}:${name}`);
      }
    }
    assert.equal(translate("__proto__" as Locale, "common.unavailable"), ru["common.unavailable"]);
    assert.equal(translate("constructor" as Locale, "common.unavailable"), ru["common.unavailable"]);
  });

  it("maps untrusted server codes to message keys through own properties only", () => {
    const messages: Readonly<Record<string, MessageKey>> = { invalid_amount: "exchange.errorInvalidAmount" };
    assert.equal(messageKeyFor(messages, "invalid_amount"), "exchange.errorInvalidAmount");
    for (const code of [...prototypeKeys, "missing", "", undefined]) {
      assert.equal(messageKeyFor(messages, code), undefined, String(code));
    }
    const withPrototype = Object.create({ inherited: "exchange.errorInvalidAmount" }) as Record<string, MessageKey>;
    assert.equal(messageKeyFor(withPrototype, "inherited"), undefined);
    assert.equal(messageKeyFor({ bogus: "not.a.key" as MessageKey }, "bogus"), undefined);
  });

  it("inserts parameters literally without recursive substitution or replacement patterns", () => {
    for (const value of ["{name}", "$&", "$1$$", "<img src=x onerror=alert(1)>", "\u0000"]) {
      assert.equal(translate("en", "home.greeting", { name: value }), `Good afternoon, ${value}`);
    }
    assert.equal(translate("en", "home.greeting", { name: "{other}", other: "x" }), "Good afternoon, {other}");
    const inherited = Object.create({ name: "inherited" }) as Record<string, string>;
    assert.equal(translate("en", "home.greeting", inherited), "Good afternoon, {name}");
  });

  it("renders a dash instead of throwing for invalid dates", () => {
    for (const locale of locales) {
      const format = createFormatter(locale);
      for (const value of ["", "not-a-date", "2026-13-45T99:99:99Z"]) {
        assert.equal(format.dateTime(value), "\u2014", `${locale}:${value}`);
      }
      assert.notEqual(format.dateTime("2026-10-05T06:42:00.000Z"), "\u2014");
    }
  });
});

describe("i18n: locale-aware amount input", () => {
  it("treats a comma as a thousands separator in English instead of a decimal point", () => {
    const en = createFormatter("en");
    assert.equal(en.parseAmountInput("1,000"), "1000");
    assert.equal(en.parseAmountInput("25,000.50"), "25000.50");
    assert.equal(en.parseAmountInput("1,234,567.000001"), "1234567.000001");
    assert.equal(en.parseAmountInput(" 1\u202f000.5 "), "1000.5");
    assert.equal(en.parseAmountInput("12.5"), "12.5");
    for (const ambiguous of ["1,5", "1,00", "12,34,567", "1,000,5", "1,000.5.5", "0,001", ",500", "1,000,"]) {
      assert.equal(isDecimalString(en.parseAmountInput(ambiguous), 6), false, ambiguous);
    }
  });

  it("keeps the comma as the decimal separator in Russian and Kyrgyz", () => {
    for (const locale of ["ru", "ky"] as const) {
      for (const supported of [() => true, (tag: string) => !tag.startsWith("ky")]) {
        const format = createFormatter(locale, supported);
        assert.equal(format.parseAmountInput("1,5"), "1.5", locale);
        assert.equal(format.parseAmountInput("25\u00a0000,50"), "25000.50", locale);
        assert.equal(format.parseAmountInput("25\u202f000,50"), "25000.50", locale);
        assert.equal(format.parseAmountInput("12.5"), "12.5", locale);
        assert.equal(isDecimalString(format.parseAmountInput("1,000,5"), 6), false, locale);
      }
    }
  });

  it("round-trips formatted inputs exactly in every locale", () => {
    const values = ["0.000001", "1000", "12345.678901", "987654321098765432109876543210.5"];
    for (const locale of locales) {
      const format = createFormatter(locale);
      for (const value of values) {
        assert.equal(format.parseAmountInput(format.amountInput("USDT", value)), value, `${locale}:${value}`);
      }
      const separators = decimalSeparators(locale);
      assert.notEqual(separators.group, separators.decimal, locale);
      assert.match(separators.decimal, /^[.,]$/, locale);
    }
  });

  it("rounds and signs identically in every locale, only separators differ", () => {
    const cases = ["-0.004", "-0.005", "0.005", "-0", "-1234567.995", "999999999999999999999999999999.999"];
    const digitsOnly = (text: string) => text.replace(/[^0-9+\u2212]/g, "");
    for (const value of cases) {
      const reference = formatDecimal(value, { fractionDigits: 2, signDisplay: "always" });
      for (const locale of locales) {
        const formatted = createFormatter(locale).decimal(value, { fractionDigits: 2, signDisplay: "always" });
        assert.equal(digitsOnly(formatted), digitsOnly(reference), `${locale}:${value}`);
      }
    }
    assert.equal(createFormatter("en").decimal("-0.004", { fractionDigits: 2 }), "0.00");
    assert.equal(createFormatter("en").decimal("-0.005", { fractionDigits: 2 }), "\u22120.01");
    assert.equal(createFormatter("ru").decimal("-1234567.995", { fractionDigits: 2 }), "\u22121\u00a0234\u00a0568,00");
  });
});

describe("i18n: browser boundary", () => {
  const sourceRoot = new URL("../../src/", import.meta.url);
  const browserFiles = ["main.tsx", ...["app", "shared"].flatMap((directory) =>
    (readdirSync(new URL(directory, sourceRoot), { recursive: true }) as string[])
      .filter((name) => /\.tsx?$/.test(name) && !name.endsWith(".test.ts"))
      .map((name) => `${directory}/${name}`)
  )];
  const sources = new Map(browserFiles.map((name) => [name, readFileSync(new URL(name, sourceRoot), "utf8")]));

  it("browser sources import no Node built-ins, provider simulators or server code", () => {
    assert.ok(sources.size >= 20);
    let imports = 0;
    for (const [name, source] of sources) {
      for (const match of source.matchAll(/^(?:import|export)\b[^"]*?\bfrom\s+"([^"]+)"|^import\s+"([^"]+)"|\bimport\(\s*"([^"]+)"/gm)) {
        imports += 1;
        const specifier = match[1] ?? match[2] ?? match[3] ?? "";
        assert.doesNotMatch(specifier, /^node:|provider-simulators|customer-api|\/server\//, `${name} imports ${specifier}`);
        assert.ok(specifier.startsWith(".") || /^react(?:-dom)?(?:\/|$)/.test(specifier), `${name} imports ${specifier}`);
      }
    }
    assert.ok(imports >= 80);
  });

  it("never renders raw HTML", () => {
    for (const [name, source] of sources) {
      assert.doesNotMatch(source, /dangerouslySetInnerHTML|\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write/, name);
    }
  });

  it("uses the Telegram language and stored locale only to pick the UI language", () => {
    const usesOf = (pattern: RegExp) => [...sources].filter(([, source]) => pattern.test(source)).map(([name]) => name).sort();
    assert.deepEqual(usesOf(/telegramLanguageCode\(/), ["app/App.tsx", "app/telegram.ts"]);
    assert.match(sources.get("app/App.tsx") ?? "", /initialLocale\(\{ storage: localeStorage\(\), languageCode: telegramLanguageCode\(\) \}\)/);
    assert.equal((sources.get("app/App.tsx") ?? "").match(/telegramLanguageCode\(\)/g)?.length, 1);
    assert.deepEqual(usesOf(/localeStorageKey|localStorage/), ["app/App.tsx", "app/i18n.ts"]);
    assert.deepEqual(usesOf(/initDataUnsafe/), ["app/telegram.ts"]);
    assert.doesNotMatch(sources.get("app/api.ts") ?? "", /locale|language|Accept-Language|initDataUnsafe/i);
  });
});
