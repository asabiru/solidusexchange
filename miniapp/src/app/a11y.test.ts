import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import ts from "typescript";
import { catalogs, locales, translate } from "./i18n.js";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(`src/${path}`, root), "utf8");
const app = read("app/App.tsx");
const ui = read("app/ui.tsx");
const sheets = read("app/sheets.tsx");
const exchange = read("app/screens/ExchangeScreen.tsx");
const activity = read("app/screens/OperationsScreen.tsx");
const screenNames = ["Home", "Exchange", "Qr", "Operations", "Profile"];
const sources = [app, ui, sheets, ...screenNames.map((name) => read(`app/screens/${name}Screen.tsx`))];
const css = read("styles.css");

interface CssRule {
  selectors: string[];
  declarations: Map<string, string>;
  context: string;
}

function parseCss(source: string): CssRule[] {
  const rules: CssRule[] = [];
  const stack: string[] = [];
  let buffer = "";
  for (const char of source.replace(/\/\*[\s\S]*?\*\//g, "")) {
    if (char === "{") {
      stack.push(buffer.trim());
      buffer = "";
    } else if (char === "}") {
      const selector = stack.pop() ?? "";
      if (!selector.startsWith("@")) {
        const declarations = new Map<string, string>();
        for (const part of buffer.split(";")) {
          const colon = part.indexOf(":");
          if (colon > 0) declarations.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
        }
        rules.push({ selectors: selector.split(",").map((value) => value.trim()), declarations, context: stack.join(" ") });
      }
      buffer = "";
    } else buffer += char;
  }
  return rules;
}

const rules = parseCss(css);
function declaration(selector: string, name: string, context = ""): string {
  const matching = rules.filter((rule) => rule.context === context && rule.selectors.includes(selector) && rule.declarations.has(name));
  const value = matching.at(-1)?.declarations.get(name);
  assert.ok(value, `missing ${selector}: ${name} (${context})`);
  return value;
}

type Rgb = readonly [number, number, number];
interface Color { rgb: Rgb; alpha: number }

function color(value: string): Color {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) return { rgb: [0, 2, 4].map((index) => Number.parseInt(hex[1].slice(index, index + 2), 16)) as unknown as Rgb, alpha: 1 };
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value);
  assert.ok(rgba, `unsupported color ${value}`);
  return { rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], alpha: Number(rgba[4]) };
}

function over(foreground: Color, background: Rgb): Rgb {
  return foreground.rgb.map((channel, index) => channel * foreground.alpha + background[index] * (1 - foreground.alpha)) as unknown as Rgb;
}

function luminance(rgb: Rgb): number {
  const channels = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function ratio(foreground: Color, background: Rgb): number {
  const [light, dark] = [luminance(over(foreground, background)), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

const light = new Map(rules.find((rule) => rule.selectors.includes(":root"))?.declarations);
const dark = new Map([...light, ...new Map(rules.find((rule) => rule.selectors.includes(':root[data-theme="dark"]'))?.declarations)]);
const themes = [{ name: "light", values: light }, { name: "dark", values: dark }];

function resolve(value: string, tokens: Map<string, string>): Color {
  const token = /^var\((--[\w-]+)\)$/.exec(value);
  if (!token) return color(value);
  const resolved = tokens.get(token[1]);
  assert.ok(resolved, `missing ${token[1]}`);
  return resolve(resolved, tokens);
}

function checkContrast(foreground: Color, backgrounds: Rgb[], minimum: number, context: string) {
  for (const background of backgrounds) {
    const actual = ratio(foreground, background);
    assert.ok(actual >= minimum, `${context}: ${actual.toFixed(3)} < ${minimum}`);
  }
}

interface Element {
  tag: string;
  attributes: Map<string, string>;
  node: ts.JsxElement | ts.JsxSelfClosingElement;
  source: ts.SourceFile;
}

function elements(text: string): Element[] {
  const source = ts.createSourceFile("component.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const result: Element[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const attributes = new Map<string, string>();
      for (const attribute of opening.attributes.properties) {
        if (ts.isJsxAttribute(attribute)) attributes.set(attribute.name.getText(source), attribute.initializer?.getText(source) ?? "true");
      }
      result.push({ tag: opening.tagName.getText(source), attributes, node, source });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}

function visibleText(node: ts.Node, source: ts.SourceFile): boolean {
  if (ts.isJsxText(node)) return node.text.trim() !== "";
  if (ts.isJsxExpression(node)) return node.expression ? visibleText(node.expression, source) : false;
  if (ts.isParenthesizedExpression(node)) return visibleText(node.expression, source);
  if (ts.isConditionalExpression(node)) return visibleText(node.whenTrue, source) || visibleText(node.whenFalse, source);
  if (ts.isJsxElement(node)) {
    const tag = node.openingElement.tagName.getText(source);
    if (["Icon", "Coin", "svg"].includes(tag)) return false;
    if (node.openingElement.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "aria-hidden")) return false;
    return node.children.some((child) => visibleText(child, source));
  }
  return ts.isIdentifier(node) || ts.isCallExpression(node) || ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isStringLiteral(node) || ts.isBinaryExpression(node);
}

const jsx = sources.flatMap(elements);

describe("Mini App accessibility semantics", () => {
  it("names all native buttons, including icon-only controls", () => {
    const buttons = jsx.filter((element) => element.tag === "button");
    assert.ok(buttons.length >= 35);
    let iconOnly = 0;
    for (const button of buttons) {
      const text = ts.isJsxElement(button.node) && button.node.children.some((child) => visibleText(child, button.source));
      if (!text) {
        iconOnly++;
        assert.ok(button.attributes.has("aria-label"), button.node.getText(button.source));
      }
    }
    assert.ok(iconOnly >= 5);
  });

  it("uses native keyboard controls instead of clickable generic elements", () => {
    for (const element of jsx.filter((entry) => entry.attributes.has("onClick") && /^[a-z]/.test(entry.tag))) {
      assert.equal(element.tag, "button");
    }
    assert.ok(!sources.join("\n").includes('role="tablist"'));
    assert.ok(!sources.join("\n").includes('role="tab"'));
  });

  it("keeps segmented controls and language choices labelled and pressed", () => {
    const groups = jsx.filter((entry) => entry.tag === "fieldset");
    assert.ok(groups.length >= 6);
    for (const group of groups) assert.ok(group.attributes.has("aria-label"));
    for (const source of [exchange, sheets, read("app/screens/ProfileScreen.tsx")]) assert.match(source, /aria-pressed=/);
    assert.match(read("app/screens/ProfileScreen.tsx"), /lang=\{value\}/);
  });

  it("exposes main and named navigation landmarks with the current page", () => {
    assert.ok(elements(app).filter((entry) => entry.tag === "main").length >= 3);
    const nav = elements(app).find((entry) => entry.tag === "nav");
    assert.equal(nav?.attributes.get("aria-label"), '{t("app.navLabel")}');
    assert.match(app, /aria-current=\{tab === item.id \? "page" : undefined\}/);
  });

  it("starts each screen at h1 with correctly ordered subsection headings", () => {
    assert.match(ui, /<h1 ref=\{heading\} tabIndex=\{-1\}>/);
    for (const name of screenNames) {
      const source = read(`app/screens/${name}Screen.tsx`);
      assert.equal(elements(source).filter((entry) => entry.tag === "ScreenTitle").length, 1);
      assert.ok(!source.includes("<h3"));
    }
    assert.match(ui, /heading.current\?\.focus\(\{ preventScroll: true \}\)/);
  });

  it("uses a native modal dialog with a labelled, focusable title", () => {
    const dialog = elements(ui).find((entry) => entry.tag === "dialog");
    assert.equal(dialog?.attributes.get("aria-modal"), '"true"');
    assert.equal(dialog?.attributes.get("aria-labelledby"), "{titleId}");
    assert.match(ui, /dialog.showModal\(\)/);
    assert.match(ui, /<h2 id=\{titleId\} ref=\{heading\} tabIndex=\{-1\}>/);
  });

  it("closes sheets on native Escape cancellation without submitting anything", () => {
    assert.match(ui, /onCancel=\{\(event\) => \{\s*event.preventDefault\(\);\s*onClose\(\);/);
  });

  it("traps Tab and Shift+Tab in visible enabled sheet controls", () => {
    assert.match(ui, /event.key !== "Tab"/);
    assert.match(ui, /button:not\(:disabled\), input:not\(:disabled\), select:not\(:disabled\)/);
    assert.match(ui, /getClientRects\(\).length > 0/);
    assert.match(ui, /event.shiftKey/);
    assert.match(ui, /last.focus\(\)/);
    assert.match(ui, /first.focus\(\)/);
  });

  it("restores the opener after close, including chained sheets", () => {
    assert.match(ui, /opener instanceof HTMLElement && opener.isConnected/);
    assert.match(ui, /opener.focus\(\)/);
    assert.match(app, /!active.closest\("dialog"\)/);
    assert.match(app, /sheetOpener.current.isConnected/);
    assert.match(app, /sheetOpener.current.focus\(\{ preventScroll: true \}\)/);
  });

  it("labels every input and select and associates validation errors", () => {
    for (const source of sources) {
      const entries = elements(source);
      for (const input of entries.filter((entry) => ["input", "select"].includes(entry.tag))) {
        assert.ok(input.attributes.has("aria-label") || entries.some((entry) => entry.tag === "label" && entry.attributes.get("htmlFor") === input.attributes.get("id")), input.node.getText(input.source));
      }
    }
    for (const source of [exchange, sheets]) {
      assert.match(source, /aria-describedby=\{errorId\}/);
      assert.match(source, /aria-invalid=/);
      assert.match(source, /id=\{errorId\}/);
    }
  });

  it("announces asynchronous outcomes politely without reading every countdown tick", () => {
    for (const source of [exchange, activity, sheets]) assert.match(source, /aria-live="polite"/);
    assert.match(exchange, /loading \? t\("exchange.requesting"\)/);
    assert.match(exchange, /"a11y.quoteReady"/);
    assert.match(exchange, /role="timer"\s*aria-live="off"/);
    assert.match(sheets, /className="sheet__summary" aria-live="polite" aria-atomic="true"/);
    assert.match(sheets, /<div aria-live="polite" aria-atomic="true">\s*\{busy/);
    assert.match(activity, /failed \? t\("activity.loadFailed"\) : items === undefined/);
  });

  it("keeps money-moving actions disabled and describes test-version unavailability", () => {
    const cta = elements(ui).find((entry) => entry.tag === "button" && entry.attributes.get("className") === '"cta"');
    assert.equal(cta?.attributes.get("disabled"), "true");
    assert.equal(cta?.attributes.get("aria-describedby"), "{hintId}");
    assert.match(ui, /hint \?\? t\("common.unavailable"\)/);
    assert.match(exchange, /<DisabledCta\s*label=\{t\("exchange.confirm"\)\}/);
    for (const locale of locales) {
      assert.ok(translate(locale, "common.unavailable"));
      assert.ok(translate(locale, "exchange.confirmHint"));
    }
  });

  it("keeps accessibility messages in all three translation catalogs", () => {
    for (const locale of locales) {
      assert.deepEqual(Object.keys(catalogs[locale]).sort(), Object.keys(catalogs.ru).sort());
      for (const key of ["a11y.quoteReady", "common.close", "exchange.errorInvalidAmount", "screening.errorInvalidAddress"] as const) {
        assert.ok(translate(locale, key).trim());
      }
    }
  });

  it("hides decorative SVGs from assistive technology", () => {
    const icon = read("app/Icon.tsx");
    assert.match(icon, /aria-hidden="true"/);
    assert.match(icon, /focusable="false"/);
  });
});

describe("Mini App WCAG 2.2 AA CSS", () => {
  it("computes known contrast vectors with correct alpha compositing", () => {
    assert.equal(ratio(color("#000000"), color("#ffffff").rgb), 21);
    assert.equal(ratio(color("#ffffff"), color("#ffffff").rgb), 1);
    assert.deepEqual(over(color("rgba(0, 0, 0, 0.5)"), [255, 255, 255]), [127.5, 127.5, 127.5]);
  });

  it("meets 4.5:1 for primary, secondary and inactive-tab text on both themes", () => {
    for (const theme of themes) {
      const backgrounds = ["bg", "surface", "surface-elevated", "fill", "fill-strong", "bar"].map((name) => resolve(`var(--${name})`, theme.values).rgb);
      for (const name of ["ink", "muted", "faint"]) checkContrast(resolve(`var(--${name})`, theme.values), backgrounds, 4.5, `${theme.name} ${name}`);
    }
  });

  it("meets 4.5:1 for accent and status text including alpha-tinted surfaces", () => {
    for (const theme of themes) {
      for (const [foreground, soft] of [["tint-text", "tint-soft"], ["green", "green-soft"], ["orange", "orange-soft"], ["red", "red-soft"]]) {
        const base = ["bg", "surface", "surface-elevated"].map((name) => resolve(`var(--${name})`, theme.values).rgb);
        const backgrounds = [...base, ...base.map((rgb) => over(resolve(`var(--${soft})`, theme.values), rgb))];
        checkContrast(resolve(`var(--${foreground})`, theme.values), backgrounds, 4.5, `${theme.name} ${foreground}`);
      }
    }
  });

  it("meets 4.5:1 for active controls and 3:1 for their indicators", () => {
    for (const theme of themes) {
      const values = theme.values;
      checkContrast(resolve(declaration(".cta", "color"), values), [resolve(declaration(".cta", "background"), values).rgb], 4.5, `${theme.name} cta`);
      checkContrast(resolve(declaration(".filter[aria-pressed=\"true\"]", "color"), values), [resolve("var(--tint)", values).rgb], 4.5, `${theme.name} filter`);
      checkContrast(resolve(declaration(".coin--menu", "color"), values), [resolve("var(--tint)", values).rgb], 3, `${theme.name} menu icon`);
      checkContrast(resolve("var(--tint)", values), [resolve("var(--fill)", values).rgb, resolve("var(--surface-elevated)", values).rgb, resolve("var(--fill-strong)", values).rgb], 3, `${theme.name} selection`);
    }
  });

  it("meets 4.5:1 on gradient hero cards including maximum glow and overlays", () => {
    for (const theme of themes) {
      const values = theme.values;
      const bases = [resolve("var(--hero-from)", values).rgb, resolve("var(--hero-to)", values).rgb, color("#172a49").rgb];
      const glowing = [...bases, ...bases.map((rgb) => over(resolve("var(--hero-glow)", values), rgb))];
      const backgrounds = [...glowing, ...glowing.map((rgb) => over(color("rgba(241, 238, 231, 0.16)"), rgb))];
      checkContrast(resolve("var(--hero-ink)", values), backgrounds, 4.5, `${theme.name} hero`);
      for (const selector of [".balance__label", ".balance__meta", ".qr-panel p", ".sheet__eyebrow", ".sheet__summary-meta"]) {
        checkContrast(resolve(declaration(selector, "color"), values), glowing, 4.5, `${theme.name} ${selector}`);
      }
    }
  });

  it("meets 3:1 for focus rings and form control boundaries", () => {
    assert.equal(declaration(":focus-visible", "outline"), "3px solid var(--focus)");
    for (const theme of themes) {
      const backgrounds = ["bg", "surface", "surface-elevated", "fill", "fill-strong", "bar"].map((name) => resolve(`var(--${name})`, theme.values).rgb);
      checkContrast(resolve("var(--focus)", theme.values), backgrounds, 3, `${theme.name} focus`);
      checkContrast(resolve("var(--control-border)", theme.values), backgrounds, 3, `${theme.name} boundary`);
    }
    for (const selector of [".exchange-field", ".asset-select", ".form-control input", ".switch"]) assert.equal(declaration(selector, "border"), "1px solid var(--control-border)");
    assert.equal(declaration(".exchange-field__value:focus-visible", "outline-offset"), "-3px");
    assert.equal(declaration(".sheet :focus-visible", "outline-offset"), "-3px");
  });

  it("gives native controls at least 24 by 24 CSS pixels", () => {
    for (const selector of ["button", "input", "select"]) {
      assert.equal(declaration(selector, "min-width"), "24px");
      assert.equal(declaration(selector, "min-height"), "24px");
    }
    for (const rule of rules) {
      const value = rule.declarations.get("min-height");
      if (value?.endsWith("px")) assert.ok(Number.parseFloat(value) >= 24, rule.selectors.join(","));
    }
  });

  it("keeps keyboard focus clear of fixed navigation and clipped groups", () => {
    assert.equal(declaration("button", "scroll-margin-block"), "80px 110px");
    assert.equal(declaration(".segment :focus-visible", "outline-offset"), "-3px");
    assert.equal(declaration(".list :focus-visible", "outline-offset"), "-3px");
    assert.equal(declaration(".balance", "--focus"), "var(--hero-ink)");
    assert.equal(declaration(".qr-panel", "--focus"), "var(--hero-ink)");
  });

  it("disables animations, springs and smooth scrolling for reduced motion", () => {
    const reduce = "@media (prefers-reduced-motion: reduce)";
    assert.equal(declaration("*", "animation", reduce), "none");
    assert.equal(declaration("*", "transition", reduce), "none");
    assert.equal(declaration("*", "scroll-behavior", reduce), "auto");
    for (const rule of rules) {
      for (const name of ["animation", "transition", "transition-duration"]) {
        if (rule.declarations.has(name)) assert.match(rule.context, /prefers-reduced-motion: (?:no-preference|reduce)/);
      }
    }
  });
});
