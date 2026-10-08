import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import ts from "typescript";
import { roleProfiles } from "../auth/access.js";
import {
  applyDocumentLocale,
  catalogs,
  defaultLocale,
  formatCount,
  formatDate,
  formatLongDate,
  formatTime,
  hasMessage,
  initialLocale,
  intlLocale,
  intlSupported,
  isLocale,
  type Locale,
  type LocaleStorage,
  localeNames,
  locales,
  localeStorageKey,
  type MessageKey,
  type Messages,
  placeholdersOf,
  readStoredLocale,
  storeLocale,
  translate
} from "./i18n.js";
import { en } from "./locales/en.js";
import { ky } from "./locales/ky.js";
import { ru } from "./locales/ru.js";
import { navigation, navigationGroups } from "./navigation.js";

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

const cyrillic = /[\u0400-\u04ff]/;

describe("i18n: catalog parity", () => {
  it("rejects catalogs with missing or extra keys at compile time", () => {
    const { "app.skipToContent": dropped, ...rest } = ru;
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
    assert.ok(expected.length > 250);
    assert.deepEqual(Object.keys(ky).sort(), expected);
    assert.deepEqual(Object.keys(en).sort(), expected);
    assert.deepEqual([...locales].sort(), Object.keys(catalogs).sort());
    assert.deepEqual([...locales], ["ru", "ky", "en"]);
    assert.equal(catalogs.ky, ky);
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
    let withPlaceholders = 0;
    for (const [key, value] of Object.entries(ru)) {
      const expected = placeholdersOf(value);
      if (expected.length) withPlaceholders += 1;
      assert.deepEqual(placeholdersOf(ky[key as MessageKey]), expected, `ky:${key}`);
      assert.deepEqual(placeholdersOf(en[key as MessageKey]), expected, `en:${key}`);
    }
    assert.ok(withPlaceholders >= 20);
    assert.deepEqual(placeholdersOf("{b} and {a}"), ["a", "b"]);
  });

  it("translates the English catalog instead of copying Russian", () => {
    for (const [key, value] of Object.entries(en)) assert.doesNotMatch(value, cyrillic, `en:${key}`);
    const copied = Object.keys(ru).filter((key) => cyrillic.test(ru[key as MessageKey]) && en[key as MessageKey] === ru[key as MessageKey]);
    assert.deepEqual(copied, []);
    assert.deepEqual(localeNames, { ru: "Русский", ky: "Кыргызча", en: "English" });
    for (const locale of locales) {
      assert.match(catalogs[locale]["app.documentTitle"], /^SOLID\b/, locale);
      for (const value of Object.values(catalogs[locale])) assert.doesNotMatch(value, /SolidChange/, locale);
    }
  });

  it("translates the Kyrgyz catalog in Cyrillic, sharing only loanwords with Russian", () => {
    const sharedLoanwords = [
      "app.documentTitle",
      "group.system",
      "screen.fraud",
      "screen.analytics",
      "common.case",
      "common.subject",
      "common.category",
      "common.scenario",
      "checks.check",
      "checks.amount",
      "checks.status",
      "checks.fee",
      "checks.comment",
      "checks.monitoring",
      "checks.timeline",
      "support.topic",
      "support.status",
      "support.channel",
      "support.author.operator",
      "support.author.system",
      "withdrawals.amount",
      "withdrawals.status",
      "withdrawals.screening",
      "withdrawals.timeline",
      "evidence.projection",
      "aml.screening",
      "investigations.timeline",
      "fraud.alert",
      "fraud.score",
      "audit.resource",
      "audit.hash",
      "reports.digest"
    ];
    const copied = Object.keys(ru).filter((key) => cyrillic.test(ru[key as MessageKey]) && ky[key as MessageKey] === ru[key as MessageKey]);
    assert.deepEqual(copied, sharedLoanwords);
    const cyrillicKeys = Object.keys(ru).filter((key) => cyrillic.test(ru[key as MessageKey]));
    for (const key of cyrillicKeys) assert.match(ky[key as MessageKey], cyrillic, `ky:${key}`);
    for (const [key, value] of Object.entries(ky)) assert.doesNotMatch(value, /[A-Za-z]{3,}[\u0400-\u04ff]|[\u0400-\u04ff][A-Za-z]/, `ky:${key}`);
    assert.match(ky["screen.investigations"], /[өүң]/);
  });

  it("keeps regulated acronyms and contract terms in Latin in Kyrgyz", () => {
    for (const key of ["screen.kyc", "screen.aml", "customers.kyc", "kyc.ubo", "common.sla", "preview.makerChecker", "preview.stepUpMfa", "audit.storagePostgres"] as const) {
      assert.equal(ky[key], ru[key], key);
    }
    for (const [key, term] of [
      ["kyc.tableLabel", "KYC"],
      ["aml.casesTitle", "AML"],
      ["aml.providerEvidence", "KYT"],
      ["evidence.decisionTitle", "maker-checker"],
      ["approvals.pendingDescription", "Maker-checker"],
      ["approvals.noPreviewCapability", "approvals:preview"],
      ["audit.description", "SHA-256"],
      ["blocker.step_up_mfa_required", "Step-up MFA"]
    ] as const) {
      assert.ok(ky[key].includes(term), `${key} keeps ${term}`);
    }
  });

  it("names every screen, navigation group and role", () => {
    for (const item of navigation) assert.ok(hasMessage(`screen.${item.id}`), item.id);
    for (const group of navigationGroups) assert.ok(hasMessage(`group.${group}`), group);
    for (const role of roleProfiles) assert.ok(hasMessage(`role.${role.id}`), role.id);
    const screens = Object.keys(ru).filter((key) => key.startsWith("screen.")).map((key) => key.slice(7));
    assert.deepEqual(screens.sort(), navigation.map((item) => item.id).sort());
  });

  it("labels every policy blocker without renaming the blocker codes", () => {
    const blockers = ["maker_cannot_approve", "evidence_incomplete", "step_up_mfa_required", "approvals_incomplete", "command_client_absent"];
    assert.deepEqual(Object.keys(ru).filter((key) => key.startsWith("blocker.")).map((key) => key.slice(8)).sort(), [...blockers].sort());
  });
});

describe("i18n: persistence and fallback", () => {
  it("uses a backoffice-specific storage key and Russian by default", () => {
    assert.equal(localeStorageKey, "solidchange.backoffice.locale");
    assert.notEqual(localeStorageKey, "solidchange.miniapp.locale");
    assert.equal(defaultLocale, "ru");
    assert.equal(initialLocale(memoryStorage()), "ru");
    assert.equal(initialLocale(undefined), "ru");
  });

  it("persists the chosen locale and restores it", () => {
    const storage = memoryStorage();
    assert.equal(storeLocale(storage, "en"), true);
    assert.deepEqual(storage.values, { [localeStorageKey]: "en" });
    assert.equal(readStoredLocale(storage), "en");
    assert.equal(initialLocale(storage), "en");
    assert.equal(storeLocale(storage, "ky"), true);
    assert.deepEqual(storage.values, { [localeStorageKey]: "ky" });
    assert.equal(initialLocale(storage), "ky");
    storeLocale(storage, "ru");
    assert.equal(initialLocale(storage), "ru");
  });

  it("ignores unknown stored values", () => {
    for (const stored of ["de", "", "EN", "en-US", "KY", "ky-KG", "kg", "kk", "null", "__proto__"]) {
      const storage = memoryStorage({ [localeStorageKey]: stored });
      assert.equal(readStoredLocale(storage), undefined, stored);
      assert.equal(initialLocale(storage), "ru", stored);
    }
    assert.equal(isLocale("toString"), false);
  });

  it("survives unavailable or throwing storage", () => {
    assert.equal(readStoredLocale(undefined), undefined);
    assert.equal(readStoredLocale(throwingStorage), undefined);
    assert.equal(storeLocale(undefined, "en"), false);
    assert.equal(storeLocale(throwingStorage, "en"), false);
    assert.equal(initialLocale(throwingStorage), "ru");
  });

  it("sets the document language and title to the selected locale", () => {
    const document = { documentElement: { lang: "ru" }, title: "" };
    applyDocumentLocale(document, "en");
    assert.equal(document.documentElement.lang, "en");
    assert.equal(document.title, en["app.documentTitle"]);
    applyDocumentLocale(document, "ky");
    assert.equal(document.documentElement.lang, "ky");
    assert.equal(document.title, ky["app.documentTitle"]);
    applyDocumentLocale(document, "ru");
    assert.equal(document.documentElement.lang, "ru");
    assert.equal(document.title, ru["app.documentTitle"]);
  });

  it("interpolates parameters and leaves unknown placeholders visible", () => {
    assert.equal(translate("ru", "app.greeting", { name: "Аудитор" }), "Добрый день, Аудитор");
    assert.equal(translate("en", "app.greeting", { name: "Auditor" }), "Good afternoon, Auditor");
    assert.equal(translate("ky", "app.greeting", { name: "Аудитор" }), "Саламатсызбы, Аудитор");
    assert.equal(translate("ky", "app.greeting"), "Саламатсызбы, {name}");
    assert.equal(translate("ky", "kyc.stageOwner", { stage: "A", owner: "B" }), "A · жооптуу: B");
    assert.equal(translate("en", "app.greeting"), "Good afternoon, {name}");
    assert.equal(translate("en", "app.greeting", { other: "x" }), "Good afternoon, {name}");
    assert.equal(translate("en", "customers.count", { count: 3 }), en["customers.count"].replace("{count}", "3"));
  });

  it("falls back to Russian for unknown locales and to the key for unknown keys", () => {
    assert.equal(translate("de" as Locale, "app.skipToContent"), ru["app.skipToContent"]);
    assert.equal(translate("en", "missing.key" as MessageKey), "missing.key");
    assert.equal(intlLocale("de" as Locale), "ru-RU");
    assert.equal(intlLocale("en"), "en-US");
  });

  it("falls back to Russian for keys missing or empty in the Kyrgyz catalog", () => {
    const mutable = ky as Record<MessageKey, string>;
    const original = mutable["app.skipToContent"];
    try {
      mutable["app.skipToContent"] = "";
      assert.equal(translate("ky", "app.skipToContent"), ru["app.skipToContent"]);
      delete (mutable as Partial<Record<MessageKey, string>>)["app.skipToContent"];
      assert.equal(translate("ky", "app.skipToContent"), ru["app.skipToContent"]);
    } finally {
      mutable["app.skipToContent"] = original;
    }
    assert.equal(translate("ky", "app.skipToContent"), "Мазмунга өтүү");
    assert.equal(translate("ky", "missing.key" as MessageKey), "missing.key");
  });
});

describe("i18n: untrusted keys and params", () => {
  const prototypeKeys = ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"];

  it("never resolves prototype properties as messages", () => {
    for (const locale of locales) {
      for (const name of prototypeKeys) {
        assert.equal(translate(locale, name as MessageKey), name, `${locale}:${name}`);
        assert.equal(hasMessage(name), false, name);
        assert.equal(hasMessage(`blocker.${name}`), false, name);
      }
    }
    assert.equal(translate("__proto__" as Locale, "app.skipToContent"), ru["app.skipToContent"]);
    assert.equal(translate("constructor" as Locale, "app.skipToContent"), ru["app.skipToContent"]);
  });

  it("inserts parameters literally without recursive substitution or replacement patterns", () => {
    for (const value of ["{name}", "$&", "$1$$", "<img src=x onerror=alert(1)>", "\u0000"]) {
      assert.equal(translate("en", "app.greeting", { name: value }), `Good afternoon, ${value}`);
    }
    assert.equal(translate("en", "app.greeting", { name: "{other}", other: "x" }), "Good afternoon, {other}");
    const inherited = Object.create({ name: "inherited" }) as Record<string, string>;
    assert.equal(translate("en", "app.greeting", inherited), "Good afternoon, {name}");
  });
});

describe("i18n: locale formatting", () => {
  it("formats integer counts with Intl and never rounds other values", () => {
    assert.equal(formatCount("en", 12345), "12,345");
    assert.equal(formatCount("ru", 12345), new Intl.NumberFormat("ru-RU").format(12345));
    assert.notEqual(formatCount("ru", 12345), "12,345");
    assert.equal(formatCount("en", 0.1 + 0.2), String(0.1 + 0.2));
    assert.equal(formatCount("en", Number.MAX_SAFE_INTEGER + 2), String(Number.MAX_SAFE_INTEGER + 2));
  });

  it("formats dates in the selected locale and UTC calendar day", () => {
    assert.equal(formatDate("en", "2026-10-05T23:30:00.000Z"), "October 5, 2026");
    assert.match(formatDate("ru", "2026-10-05T23:30:00.000Z"), /^5 октября 2026/);
    assert.match(formatLongDate("ru", new Date(Date.UTC(2026, 9, 5, 12))), /^[А-Я]/);
    assert.match(formatLongDate("en", new Date(Date.UTC(2026, 9, 5, 12))), /October/);
    assert.match(formatTime("en", "2026-10-05T12:00:00.000Z"), /\d/);
  });

  it("formats Kyrgyz with ky-KG and falls back to Russian numbers and numeric dates without Kyrgyz Intl data", () => {
    const noKyrgyz = (tag: string) => !tag.startsWith("ky");
    const always = () => true;
    assert.equal(intlLocale("ky", always), "ky-KG");
    assert.equal(intlLocale("ky", noKyrgyz), "ru-RU");
    assert.equal(intlLocale("en", noKyrgyz), "en-US");
    assert.equal(intlSupported("en-US"), true);
    assert.equal(formatCount("ky", 12345, noKyrgyz), formatCount("ru", 12345));
    assert.equal(formatDate("ky", "2026-10-05T23:30:00.000Z", noKyrgyz), "05.10.2026");
    assert.equal(formatLongDate("ky", new Date(Date.UTC(2026, 9, 5, 12)), noKyrgyz), "05.10.2026");
    assert.match(formatTime("ky", "2026-10-05T12:00:00.000Z", noKyrgyz), /\d/);
    assert.match(formatDate("ky", "2026-10-05T23:30:00.000Z", always), /2026/);
    assert.match(formatDate("ky", "2026-10-05T23:30:00.000Z", always), /5/);
    assert.doesNotMatch(formatDate("ky", "2026-10-05T23:30:00.000Z", always), /октября/);
    assert.doesNotMatch(formatLongDate("ky", new Date(Date.UTC(2026, 9, 5, 12)), always), /понедельник/i);
  });

  it("renders a dash instead of throwing for invalid dates", () => {
    for (const locale of locales) {
      for (const value of ["", "not-a-date", "2026-13-45T99:99:99Z"]) {
        assert.equal(formatDate(locale, value), "\u2014", `${locale}:${value}`);
        assert.equal(formatTime(locale, value), "\u2014", `${locale}:${value}`);
      }
    }
  });

  it("keeps exact decimal strings out of number parsing in the browser app", () => {
    const sources = ["App.tsx", "i18n.ts", "i18n-context.tsx"].map((name) => readFileSync(new URL(`../../src/app/${name}`, import.meta.url), "utf8"));
    for (const source of sources) {
      assert.doesNotMatch(source, /parseFloat|Number\(\s*(?:row|item|selected|approval|metric|preview|customer)\./);
    }
    assert.match(sources[0] ?? "", /\{row\.value\}/);
  });
});

const appDirectory = new URL("../../src/app/", import.meta.url);
const uiAttributes = new Set(["aria-label", "aria-description", "aria-valuetext", "title", "placeholder", "alt", "label", "description", "message"]);
const brandText = new Set(["S", "SOLID"]);
const contractLiterals = new Set(["not_for_submission"]);
const letter = /\p{L}/u;
const sentence = /^[A-Z][a-z]+(?:[ -][A-Za-z]+)+[.!?…]?$/;

function textParts(node: ts.Node): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
  return [];
}

function isTranslationArgument(node: ts.Node): boolean {
  const parent = node.parent;
  return ts.isCallExpression(parent) && parent.arguments[0] === node && ["t", "hasMessage"].includes(parent.expression.getText());
}

function isComparisonOperand(node: ts.Node): boolean {
  const parent = node.parent;
  return ts.isBinaryExpression(parent) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(parent.operatorToken.kind);
}

function isErrorArgument(node: ts.Node): boolean {
  const parent = node.parent;
  return ts.isNewExpression(parent) && parent.expression.getText() === "Error";
}

function jsxContext(node: ts.Node): "child" | "attribute" | undefined {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isJsxAttribute(current)) return "attribute";
    if (ts.isJsxExpression(current) && (ts.isJsxElement(current.parent) || ts.isJsxFragment(current.parent))) return "child";
  }
  return undefined;
}

/** Literal UI text left in a component instead of the catalog. */
function uiStringViolations(fileName: string, source: string): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const report = (node: ts.Node, text: string) => {
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
    found.push(`${fileName}:${line} ${JSON.stringify(text.trim())}`);
  };
  function visit(node: ts.Node) {
    if (ts.isJsxText(node) && letter.test(node.text) && !brandText.has(node.text.trim())) report(node, node.text);
    if (ts.isJsxAttribute(node) && uiAttributes.has(node.name.getText(file)) && node.initializer && ts.isStringLiteral(node.initializer) && letter.test(node.initializer.text)) {
      report(node, node.initializer.text);
    }
    const parts = textParts(node);
    if (parts.length && !ts.isImportDeclaration(node.parent) && !ts.isExportDeclaration(node.parent) && !isTranslationArgument(node)) {
      const text = parts.join("");
      const exempt = contractLiterals.has(text) || isComparisonOperand(node);
      if (cyrillic.test(text)) report(node, text);
      else if (!exempt && jsxContext(node) === "child" && letter.test(text)) report(node, text);
      else if (!exempt && !isErrorArgument(node) && parts.some((part) => sentence.test(part.trim()))) report(node, text);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return found;
}

describe("i18n: no hard-coded UI strings in components", () => {
  const componentFiles = (readdirSync(appDirectory, { recursive: true }) as string[])
    .map((name) => name.replaceAll("\\", "/"))
    .filter((name) => /\.tsx?$/.test(name) && !name.endsWith(".test.ts") && !name.startsWith("locales/") && name !== "i18n.ts")
    .sort();

  it("finds Cyrillic, English text, labels and sentences that bypass the catalog", () => {
    const sample = [
      'const note = "Готово";',
      'const error = "Preview rejected by the BFF";',
      'export function View({ ok }: { ok: boolean }) {',
      '  return <section aria-label="Results"><p>Loading</p>{ok ? "verified" : t("app.skipToContent")}<b>{`seq`}</b></section>;',
      "}"
    ].join("\n");
    const found = uiStringViolations("sample.tsx", sample);
    assert.equal(found.length, 6, found.join("\n"));
    assert.deepEqual(uiStringViolations("ok.tsx", 'const a = <p className="x" data-tone="warning">{t("app.skipToContent")}{state === "verified" ? "—" : ""}SOLID</p>;'), []);
    assert.deepEqual(uiStringViolations("error.ts", 'throw new Error("Backoffice root element is missing");'), []);
  });

  it("keeps every user-visible and ARIA string of the app in the catalogs", () => {
    assert.ok(componentFiles.includes("App.tsx"));
    assert.ok(componentFiles.includes("navigation.ts"));
    assert.ok(componentFiles.length >= 5);
    const found = componentFiles.flatMap((name) => uiStringViolations(name, readFileSync(new URL(name, appDirectory), "utf8")));
    assert.deepEqual(found, []);
  });

  it("keeps contract markers and identifiers out of translation", () => {
    const app = readFileSync(new URL("App.tsx", appDirectory), "utf8");
    assert.equal(app.match(/"not_for_submission"/g)?.length, 1);
    assert.match(app, /status: data\.status,/);
    assert.match(app, /environment: data\.environment,/);
    assert.match(app, /<th scope="col" key=\{column\}>\{column\}<\/th>/);
    assert.match(app, /<dt>\{row\.key\}<\/dt>/);
    for (const value of Object.values(ru)) assert.doesNotMatch(value, /not_for_submission/);
    assert.deepEqual(navigation.map((item) => item.capability).filter(Boolean).length, navigation.filter((item) => item.capability).length);
  });

  it("reads and writes the locale only through the i18n module", () => {
    const sources = new Map(
      [...componentFiles, "i18n.ts"].map((name) => [name, readFileSync(new URL(name, appDirectory), "utf8")])
    );
    const usesOf = (pattern: RegExp) => [...sources].filter(([, source]) => pattern.test(source)).map(([name]) => name).sort();
    assert.deepEqual(usesOf(/localStorage/), ["i18n-context.tsx"]);
    assert.deepEqual(usesOf(/localeStorageKey/), ["i18n.ts"]);
    assert.deepEqual(usesOf(/documentElement\.lang/), ["i18n.ts"]);
    for (const [name, source] of sources) {
      for (const match of source.matchAll(/\bfrom\s+"([^"]+)"/g)) {
        assert.doesNotMatch(match[1] ?? "", /^node:|provider-simulators|\/server\//, `${name} imports ${match[1]}`);
      }
      assert.doesNotMatch(source, /dangerouslySetInnerHTML|\.innerHTML\b/, name);
    }
  });
});
