import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import ts from "typescript";

type Rgb = readonly [number, number, number];

interface CssRule {
  selectors: string[];
  declarations: Map<string, string>;
  atRule: string;
}

const root = new URL("../../", import.meta.url);
const css = readFileSync(new URL("src/styles.css", root), "utf8");
const appSource = readFileSync(new URL("src/app/App.tsx", root), "utf8");
const iconsSource = readFileSync(new URL("src/app/icons.tsx", root), "utf8");

function parseCss(source: string): CssRule[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: CssRule[] = [];
  const stack: string[] = [];
  let buffer = "";
  for (const char of text) {
    if (char === "{") {
      const prelude = buffer.trim();
      buffer = "";
      stack.push(prelude);
      continue;
    }
    if (char === "}") {
      const prelude = stack.pop() ?? "";
      if (!prelude.startsWith("@")) {
        const declarations = new Map<string, string>();
        for (const part of buffer.split(";")) {
          const colon = part.indexOf(":");
          if (colon > 0) declarations.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
        }
        rules.push({
          selectors: prelude.split(",").map((selector) => selector.trim()),
          declarations,
          atRule: stack.filter((entry) => entry.startsWith("@")).join(" ")
        });
      }
      buffer = "";
      continue;
    }
    buffer += char;
  }
  return rules;
}

const rules = parseCss(css);

function findRule(selector: string, atRule = ""): CssRule {
  const rule = rules.find((item) => item.atRule === atRule && item.selectors.includes(selector));
  assert.ok(rule, `missing CSS rule ${selector} ${atRule}`);
  return rule;
}

function rulesIn(atRulePrefix: string): CssRule[] {
  return rules.filter((rule) => rule.atRule.startsWith(atRulePrefix));
}

function tokens(rule: CssRule): Map<string, string> {
  const result = new Map<string, string>();
  for (const [name, value] of rule.declarations) if (name.startsWith("--")) result.set(name, value);
  return result;
}

function rgbFromChannels(value: string): Rgb {
  const parts = value.split(",").map((part) => Number(part.trim()));
  assert.equal(parts.length, 3, `expected r, g, b channels in "${value}"`);
  assert.ok(parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255));
  return [parts[0], parts[1], parts[2]];
}

function rgbFromHex(value: string): Rgb {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  assert.ok(match, `expected 6-digit hex colour, got ${value}`);
  return [Number.parseInt(match[1], 16), Number.parseInt(match[2], 16), Number.parseInt(match[3], 16)];
}

function rgbaToken(value: string): { color: Rgb; alpha: number } {
  const match = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value);
  assert.ok(match, `expected rgba() token, got ${value}`);
  return { color: [Number(match[1]), Number(match[2]), Number(match[3])], alpha: Number(match[4]) };
}

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(foreground: Rgb, background: Rgb): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

function over(foreground: Rgb, alpha: number, background: Rgb): Rgb {
  return [0, 1, 2].map((index) => foreground[index] * alpha + background[index] * (1 - alpha)) as unknown as Rgb;
}

function minContrast(foreground: Rgb, backgrounds: readonly Rgb[]): number {
  return Math.min(...backgrounds.map((background) => contrast(foreground, background)));
}

const lightTokens = tokens(findRule(".app"));
const darkTokens = new Map([...lightTokens, ...tokens(findRule('.app[data-theme="dark"]'))]);
const opaqueLight = tokens(findRule(".app", "@media (prefers-reduced-transparency: reduce)"));
const opaqueDark = tokens(findRule('.app[data-theme="dark"]', "@media (prefers-reduced-transparency: reduce)"));
const unsupportedBlur = "@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))";

interface ThemeCase {
  name: string;
  values: Map<string, string>;
}

const themes: ThemeCase[] = [
  { name: "light glass", values: lightTokens },
  { name: "dark glass", values: darkTokens },
  { name: "light opaque", values: new Map([...lightTokens, ...opaqueLight]) },
  { name: "dark opaque", values: new Map([...darkTokens, ...opaqueLight, ...opaqueDark]) },
  {
    name: "light without backdrop-filter",
    values: new Map([...lightTokens, ...tokens(findRule(".app", unsupportedBlur))])
  },
  {
    name: "dark without backdrop-filter",
    values: new Map([
      ...darkTokens,
      ...tokens(findRule(".app", unsupportedBlur)),
      ...tokens(findRule('.app[data-theme="dark"]', unsupportedBlur))
    ])
  }
];

function themeColor(theme: ThemeCase, name: string): Rgb {
  const value = theme.values.get(`--${name}`);
  assert.ok(value, `${theme.name}: missing --${name}`);
  return rgbFromChannels(value);
}

function themeNumber(theme: ThemeCase, name: string): number {
  const value = Number(theme.values.get(`--${name}`));
  assert.ok(value > 0 && value <= 1, `${theme.name}: --${name} must be an alpha value`);
  return value;
}

function surfaces(theme: ThemeCase) {
  const pageColor = themeColor(theme, "page");
  const pageDeep = themeColor(theme, "page-deep");
  const blobA = rgbaToken(theme.values.get("--blob-a") ?? "");
  const blobB = rgbaToken(theme.values.get("--blob-b") ?? "");
  const page = [pageColor, pageDeep, over(blobA.color, blobA.alpha, pageColor)];
  const behindCards = [...page, over(blobA.color, blobA.alpha, pageDeep), over(blobB.color, blobB.alpha, pageDeep)];
  const cards = behindCards.map((background) =>
    over(themeColor(theme, "glass"), themeNumber(theme, "glass-a"), background)
  );
  const subs = cards.map((card) => over(themeColor(theme, "sub"), themeNumber(theme, "sub-a"), card));
  return { page, cards, subs, panels: [...cards, ...subs] };
}

function tokenReference(value: string | undefined, pattern: RegExp): { token: string; alpha?: number } {
  const match = value ? pattern.exec(value) : null;
  assert.ok(match, `unexpected colour declaration ${value}`);
  return { token: match[1], alpha: match[2] ? Number(match[2]) : undefined };
}

const statusRules = [".status", ...["info", "success", "warning", "danger"].map((tone) => `.status[data-tone="${tone}"]`)].map(
  (selector) => {
    const rule = findRule(selector);
    const color = tokenReference(rule.declarations.get("color"), /^rgb\(var\(--([a-z-]+)\)\)$/);
    const background = tokenReference(rule.declarations.get("background"), /^rgba\(var\(--([a-z-]+)\), ([\d.]+)\)$/);
    return { selector, color: color.token, background: background.token, alpha: background.alpha ?? 1 };
  }
);

describe("contrast arithmetic", () => {
  it("matches published WCAG reference ratios so token checks are not vacuous", () => {
    assert.equal(contrast([0, 0, 0], [255, 255, 255]).toFixed(2), "21.00");
    assert.equal(contrast([255, 255, 255], [255, 255, 255]), 1);
    assert.equal(contrast([118, 118, 118], [255, 255, 255]).toFixed(2), "4.54");
    assert.ok(contrast([119, 119, 119], [255, 255, 255]) < 4.5);
    assert.equal(contrast([0, 0, 255], [255, 255, 255]).toFixed(2), "8.59");
    assert.deepEqual(over([255, 255, 255], 0.5, [0, 0, 0]), [127.5, 127.5, 127.5]);
    assert.ok(minContrast([118, 118, 118], [[255, 255, 255], [119, 119, 119]]) < 1.02);
  });
});

const textTokens = ["text", "muted", "accent-text", "info", "success", "warning", "danger"];
const textThreshold = 4.5;
const uiThreshold = 3;

describe("theme token contrast", () => {
  for (const theme of themes) {
    const surface = surfaces(theme);

    it(`${theme.name}: text tokens reach 4.5:1 on glass cards and sub-surfaces`, () => {
      for (const token of textTokens) {
        const ratio = minContrast(themeColor(theme, token), surface.panels);
        assert.ok(ratio >= textThreshold, `${theme.name} --${token} ${ratio.toFixed(2)}:1`);
      }
    });

    it(`${theme.name}: status chips reach 4.5:1 on cards and on the page`, () => {
      for (const status of statusRules) {
        const foreground = themeColor(theme, status.color);
        const tint = themeColor(theme, status.background);
        const backgrounds = [...surface.panels, ...surface.page].map((background) =>
          over(tint, status.alpha, background)
        );
        const ratio = minContrast(foreground, backgrounds);
        assert.ok(ratio >= textThreshold, `${theme.name} ${status.selector} ${ratio.toFixed(2)}:1`);
      }
    });

    it(`${theme.name}: page-level headings and descriptions reach 4.5:1 on the page background`, () => {
      for (const token of ["text", "muted"]) {
        const ratio = minContrast(themeColor(theme, token), surface.page);
        assert.ok(ratio >= textThreshold, `${theme.name} --${token} on page ${ratio.toFixed(2)}:1`);
      }
    });

    it(`${theme.name}: selected table rows keep text and the selection indicator readable`, () => {
      const rule = findRule('tbody tr[data-selected="true"]');
      const background = tokenReference(rule.declarations.get("background"), /^rgba\(var\(--([a-z-]+)\), ([\d.]+)\)$/);
      const indicator = tokenReference(rule.declarations.get("box-shadow"), /rgb\(var\(--([a-z-]+)\)\)$/);
      const rows = surface.subs.map((sub) => over(themeColor(theme, background.token), background.alpha ?? 1, sub));
      for (const token of ["text", "muted", "accent-text"]) {
        const ratio = minContrast(themeColor(theme, token), rows);
        assert.ok(ratio >= textThreshold, `${theme.name} --${token} on selected row ${ratio.toFixed(2)}:1`);
      }
      const ratio = minContrast(themeColor(theme, indicator.token), surface.subs);
      assert.ok(ratio >= uiThreshold, `${theme.name} selection indicator ${ratio.toFixed(2)}:1`);
    });

    it(`${theme.name}: focus ring reaches 3:1 against every surface`, () => {
      const rule = findRule("button:focus-visible");
      const outline = tokenReference(rule.declarations.get("outline"), /rgb\(var\(--([a-z-]+)\)\)$/);
      const ratio = minContrast(themeColor(theme, outline.token), [...surface.page, ...surface.panels]);
      assert.ok(ratio >= uiThreshold, `${theme.name} focus ring ${ratio.toFixed(2)}:1`);
    });

    it(`${theme.name}: active navigation and skip link colours reach the thresholds`, () => {
      const active = themeColor(theme, "rail-active");
      const ink = themeColor(theme, "rail-active-ink");
      assert.ok(contrast(ink, active) >= textThreshold, `${theme.name} rail-active ink ${contrast(ink, active).toFixed(2)}:1`);
      const ratio = minContrast(active, surface.cards);
      assert.ok(ratio >= uiThreshold, `${theme.name} rail-active indicator ${ratio.toFixed(2)}:1`);
      const icon = minContrast(themeColor(theme, "muted"), surface.cards);
      assert.ok(icon >= uiThreshold, `${theme.name} navigation icons ${icon.toFixed(2)}:1`);
    });
  }

  it("light text on cognac and navy gradients reaches 4.5:1 at every gradient stop", () => {
    let checked = 0;
    for (const rule of rules) {
      const color = rule.declarations.get("color");
      const background = rule.declarations.get("background");
      if (!color?.startsWith("#") || !background?.startsWith("linear-gradient")) continue;
      if (rule.selectors.some((selector) => selector.startsWith(".brand"))) continue;
      const foreground = rgbFromHex(color);
      for (const stop of background.match(/#[0-9a-f]{6}/gi) ?? []) {
        const ratio = contrast(foreground, rgbFromHex(stop));
        assert.ok(ratio >= textThreshold, `${rule.selectors.join(", ")} ${color} on ${stop} ${ratio.toFixed(2)}:1`);
        checked += 1;
      }
    }
    assert.ok(checked >= 6, `expected gradient stops to be checked, got ${checked}`);
  });
});

interface JsxNode {
  tag: string;
  attributes: Map<string, ts.JsxAttribute>;
  node: ts.JsxElement | ts.JsxSelfClosingElement;
  ancestors: JsxNode[];
  functionName: string;
}

function parseTsx(fileName: string, source: string): ts.SourceFile {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function openingOf(node: ts.JsxElement | ts.JsxSelfClosingElement): ts.JsxOpeningElement | ts.JsxSelfClosingElement {
  return ts.isJsxElement(node) ? node.openingElement : node;
}

function collectJsx(sourceFile: ts.SourceFile): JsxNode[] {
  const result: JsxNode[] = [];
  function visit(node: ts.Node, ancestors: JsxNode[], functionName: string) {
    let nextFunction = functionName;
    if (ts.isFunctionDeclaration(node) && node.name) nextFunction = node.name.text;
    let nextAncestors = ancestors;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = openingOf(node);
      const attributes = new Map<string, ts.JsxAttribute>();
      for (const property of opening.attributes.properties) {
        if (ts.isJsxAttribute(property)) attributes.set(property.name.getText(sourceFile), property);
      }
      const entry = { tag: opening.tagName.getText(sourceFile), attributes, node, ancestors, functionName };
      result.push(entry);
      nextAncestors = [...ancestors, entry];
    }
    ts.forEachChild(node, (child) => visit(child, nextAncestors, nextFunction));
  }
  visit(sourceFile, [], "");
  return result;
}

const appFile = parseTsx("App.tsx", appSource);
const appJsx = collectJsx(appFile);
const iconsJsx = collectJsx(parseTsx("icons.tsx", iconsSource));
const decorativeComponents = new Set(["UiIcon", "ScreenIcon", "svg", "Backdrop"]);

function attributeText(entry: JsxNode, name: string): string | undefined {
  const attribute = entry.attributes.get(name);
  if (!attribute) return undefined;
  if (!attribute.initializer) return "true";
  return attribute.initializer.getText(appFile);
}

function staticAttribute(entry: JsxNode, name: string): string | undefined {
  const initializer = entry.attributes.get(name)?.initializer;
  return initializer && ts.isStringLiteral(initializer) ? initializer.text : undefined;
}

function hasVisibleText(node: ts.Node): boolean {
  if (ts.isJsxText(node)) return node.text.trim().length > 0;
  if (ts.isJsxExpression(node)) return Boolean(node.expression);
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
    const opening = openingOf(node);
    const tag = opening.tagName.getText(appFile);
    if (decorativeComponents.has(tag)) return false;
    const hidden = opening.attributes.properties.some(
      (property) =>
        ts.isJsxAttribute(property) &&
        property.name.getText(appFile) === "aria-hidden" &&
        property.initializer?.getText(appFile) === '"true"'
    );
    if (hidden || ts.isJsxSelfClosingElement(node)) return false;
    return node.children.some(hasVisibleText);
  }
  if (ts.isJsxFragment(node)) return node.children.some(hasVisibleText);
  return false;
}

function hasAccessibleName(entry: JsxNode): boolean {
  if (entry.attributes.has("aria-label") || entry.attributes.has("aria-labelledby")) return true;
  return ts.isJsxElement(entry.node) && entry.node.children.some(hasVisibleText);
}

function isDescendant(entry: JsxNode, parent: JsxNode): boolean {
  return entry.ancestors.includes(parent);
}

describe("backoffice markup semantics", () => {
  it("every button has an accessible name and icon-only buttons use aria-label", () => {
    const buttons = appJsx.filter((entry) => entry.tag === "button");
    assert.ok(buttons.length >= 20);
    const iconOnly = buttons.filter((entry) => !(ts.isJsxElement(entry.node) && entry.node.children.some(hasVisibleText)));
    assert.ok(iconOnly.length >= 4, `expected icon-only controls, found ${iconOnly.length}`);
    for (const entry of buttons) {
      const line = appFile.getLineAndCharacterOfPosition(entry.node.getStart(appFile)).line + 1;
      assert.ok(hasAccessibleName(entry), `App.tsx:${line} button has no accessible name`);
    }
    for (const entry of iconOnly) {
      const line = appFile.getLineAndCharacterOfPosition(entry.node.getStart(appFile)).line + 1;
      assert.ok(entry.attributes.has("aria-label"), `App.tsx:${line} icon-only button needs aria-label`);
    }
  });

  it("every form control has a label", () => {
    const controls = appJsx.filter((entry) => ["input", "select", "textarea"].includes(entry.tag));
    assert.ok(controls.length >= 4);
    for (const entry of controls) {
      const label = entry.ancestors.find((ancestor) => ancestor.tag === "label");
      const labelled =
        entry.attributes.has("aria-label") ||
        entry.attributes.has("aria-labelledby") ||
        Boolean(label && ts.isJsxElement(label.node) && label.node.children.some(hasVisibleText));
      const line = appFile.getLineAndCharacterOfPosition(entry.node.getStart(appFile)).line + 1;
      assert.ok(labelled, `App.tsx:${line} ${entry.tag} has no label`);
    }
  });

  it("aria-describedby and aria-controls only reference ids rendered in the same component", () => {
    const references = appJsx.flatMap((entry) =>
      ["aria-describedby", "aria-controls"].flatMap((name) => {
        const text = attributeText(entry, name);
        return text ? [{ entry, name, ids: text.match(/[A-Za-z]+Id\b/g) ?? [] }] : [];
      })
    );
    assert.ok(references.length >= 3);
    for (const reference of references) {
      assert.ok(reference.ids.length > 0, `${reference.name} must reference a generated id`);
      for (const id of reference.ids) {
        const target = appJsx.find(
          (entry) => entry.functionName === reference.entry.functionName && attributeText(entry, "id") === `{${id}}`
        );
        assert.ok(target, `${reference.name} references ${id} without a matching element`);
        assert.match(appSource, new RegExp(`const ${id} = useId\\(\\);`));
      }
    }
  });

  it("the step-up code input exposes its error through aria-describedby and aria-invalid", () => {
    const input = appJsx.find((entry) => staticAttribute(entry, "autoComplete") === "one-time-code");
    assert.ok(input);
    assert.match(attributeText(input, "aria-describedby") ?? "", /stepUpErrorId/);
    assert.match(attributeText(input, "aria-invalid") ?? "", /retry/);
  });

  it("every table header declares its scope", () => {
    const headers = appJsx.filter((entry) => entry.tag === "th");
    assert.ok(headers.length >= 40);
    for (const entry of headers) assert.match(staticAttribute(entry, "scope") ?? "", /^(col|row)$/);
    for (const entry of appJsx.filter((item) => item.tag === "table")) {
      assert.ok(
        entry.ancestors.some((ancestor) => ancestor.tag === "TableShell"),
        "tables must be wrapped in a labelled, keyboard-scrollable TableShell"
      );
    }
    const shell = appJsx.find((entry) => entry.functionName === "TableShell" && entry.tag === "section");
    assert.ok(shell);
    assert.ok(shell.attributes.has("aria-label"));
    assert.equal(attributeText(shell, "tabIndex"), "{0}");
  });

  it("the workspace exposes header, labelled nav and focusable main landmarks with a skip link", () => {
    const appRoot = appJsx.find((entry) => entry.functionName === "App" && staticAttribute(entry, "className") === "app");
    assert.ok(appRoot && ts.isJsxElement(appRoot.node));
    const workspace: JsxNode = appRoot;
    const firstChild = appRoot.node.children.find((child) => ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child));
    assert.ok(firstChild && (ts.isJsxElement(firstChild) || ts.isJsxSelfClosingElement(firstChild)));
    const skip = appJsx.find((entry) => entry.node === firstChild);
    assert.ok(skip);
    assert.equal(staticAttribute(skip, "className"), "skip-link");
    assert.match(attributeText(skip, "onClick") ?? "", /mainRef\.current\?\.focus\(\)/);
    const main = appJsx.find((entry) => entry.functionName === "App" && entry.tag === "main");
    assert.ok(main);
    assert.equal(attributeText(main, "ref"), "{mainRef}");
    assert.equal(attributeText(main, "tabIndex"), "{-1}");
    assert.ok(appJsx.some((entry) => entry.functionName === "App" && entry.tag === "header" && isDescendant(entry, workspace)));
    const navs = appJsx.filter((entry) => entry.tag === "nav");
    assert.ok(navs.length >= 2);
    for (const nav of navs) assert.ok(nav.attributes.has("aria-label"), "every nav landmark needs a distinct label");
    assert.equal(new Set(navs.map((nav) => staticAttribute(nav, "aria-label"))).size, navs.length);
    assert.ok(appJsx.some((entry) => entry.functionName === "AccessGate" && entry.tag === "main"));
  });

  it("active navigation and selected rows expose aria-current", () => {
    const navButtons = appJsx.filter(
      (entry) => entry.tag === "button" && entry.ancestors.some((ancestor) => ancestor.tag === "nav")
    );
    assert.ok(navButtons.length >= 2);
    for (const entry of navButtons) assert.ok(entry.attributes.has("aria-current"));
    const selectableRows = appJsx.filter((entry) => entry.tag === "tr" && entry.attributes.has("data-selected"));
    assert.ok(selectableRows.length >= 7);
    for (const row of selectableRows) {
      const button = appJsx.find((entry) => entry.tag === "button" && isDescendant(entry, row));
      assert.ok(button?.attributes.has("aria-current"), "selected row trigger must expose aria-current");
    }
  });

  it("async failures are alerts and progress is announced through polite live regions", () => {
    const failures = appJsx.filter(
      (entry) =>
        staticAttribute(entry, "className") === "preview-error" || staticAttribute(entry, "data-state") === "failed"
    );
    assert.ok(failures.length >= 6);
    for (const entry of failures) assert.equal(staticAttribute(entry, "role"), "alert");
    const live = appJsx.find((entry) => entry.functionName === "LiveStatus" && entry.tag === "output");
    assert.ok(live);
    assert.equal(staticAttribute(live, "aria-live"), "polite");
    assert.equal(staticAttribute(live, "aria-atomic"), "true");
    const uses = new Set(appJsx.filter((entry) => entry.tag === "LiveStatus").map((entry) => entry.functionName));
    for (const view of ["App", "ApprovalsView", "AuditView", "ReportsView"]) assert.ok(uses.has(view), `${view} needs LiveStatus`);
  });

  it("headings start at h1 in page headers and never skip a level", () => {
    const byFunction = new Map<string, Set<number>>();
    for (const entry of appJsx) {
      const match = /^h([1-6])$/.exec(entry.tag);
      if (!match) continue;
      const levels = byFunction.get(entry.functionName) ?? new Set<number>();
      levels.add(Number(match[1]));
      byFunction.set(entry.functionName, levels);
    }
    for (const [name, levels] of byFunction) {
      if (levels.has(1)) assert.ok(["PageHeading", "AccessGate"].includes(name), `${name} must not render h1`);
      for (const level of levels) {
        if (level > 2) assert.ok(levels.has(level - 1), `${name} renders h${level} without h${level - 1}`);
      }
    }
    const pageViews = new Set(appJsx.filter((entry) => entry.tag === "PageHeading").map((entry) => entry.functionName));
    assert.ok(pageViews.size >= 8);
  });

  it("decorative icons are hidden from assistive technology and charts are labelled", () => {
    const svgs = [...iconsJsx, ...appJsx].filter((entry) => entry.tag === "svg");
    assert.ok(svgs.length >= 2);
    for (const svg of svgs) {
      const role = svg.attributes.get("role")?.initializer;
      if (role && ts.isStringLiteral(role) && role.text === "img") {
        assert.ok(svg.attributes.has("aria-label"));
        continue;
      }
      const hidden = svg.attributes.get("aria-hidden")?.initializer;
      assert.ok(hidden && ts.isStringLiteral(hidden) && hidden.text === "true");
    }
  });

  it("Escape dismisses the rail tooltip", () => {
    assert.match(appSource, /if \(event\.key === "Escape"\) setTooltip\(undefined\);/);
    assert.match(appSource, /document\.addEventListener\("keydown", onKeyDown\);/);
    assert.match(appSource, /return \(\) => document\.removeEventListener\("keydown", onKeyDown\);/);
  });
});

describe("focus and motion styles", () => {
  it("focus-visible outlines cover every focusable element type", () => {
    const rule = findRule("button:focus-visible");
    for (const selector of ["a:focus-visible", "input:focus-visible", "select:focus-visible", "[tabindex]:focus-visible"]) {
      assert.ok(rule.selectors.includes(selector), `focus ring missing for ${selector}`);
    }
    assert.match(rule.declarations.get("outline") ?? "", /^2px solid /);
  });

  it("the skip link is hidden until focused", () => {
    assert.match(findRule(".skip-link").declarations.get("transform") ?? "", /translateY\(-/);
    assert.equal(findRule(".skip-link:focus").declarations.get("transform"), "none");
  });

  it("reduced motion disables transitions, animations and hover transforms", () => {
    const reduced = rulesIn("@media (prefers-reduced-motion: reduce)");
    const universal = reduced.find((rule) => rule.selectors.includes("*"));
    assert.ok(universal);
    assert.match(universal.declarations.get("transition") ?? "", /^none !important$/);
    assert.match(universal.declarations.get("animation") ?? "", /^none !important$/);
    assert.match(universal.declarations.get("scroll-behavior") ?? "", /^auto !important$/);
    const neutralized = new Set(
      reduced.filter((rule) => rule.declarations.get("transform") === "none").flatMap((rule) => rule.selectors)
    );
    const moving = rules.filter(
      (rule) => rule.atRule === "" && rule.declarations.has("transform") && rule.selectors.some((selector) => selector.includes(":hover"))
    );
    assert.ok(moving.length >= 3);
    for (const rule of moving) {
      for (const selector of rule.selectors) assert.ok(neutralized.has(selector), `${selector} moves under reduced motion`);
    }
  });
});

describe("accessibility changes keep security behaviour", () => {
  const sensitiveName = /^(?:verificationCode|challenge|grant|token|secret|password|code|address|reference|subject|customer|email|phone)$/i;

  function identifiersIn(node: ts.Node): string[] {
    const names: string[] = [];
    function visit(child: ts.Node) {
      if (ts.isIdentifier(child)) names.push(child.text);
      ts.forEachChild(child, visit);
    }
    visit(node);
    return names;
  }

  it("live regions only announce fixed status text and the active section label", () => {
    const uses = appJsx.filter((entry) => entry.tag === "LiveStatus");
    assert.ok(uses.length >= 4);
    const allowed = new Set(["previewState", "stepUpState", "preview", "exportState", "detailState", "activeItem", "label"]);
    for (const entry of uses) {
      const initializer = entry.attributes.get("message")?.initializer;
      assert.ok(initializer, `${entry.functionName} LiveStatus needs a message`);
      for (const name of identifiersIn(initializer)) {
        assert.ok(allowed.has(name), `${entry.functionName} LiveStatus announces ${name}`);
      }
    }
    const live = appJsx.filter((entry) => entry.attributes.has("aria-live"));
    assert.deepEqual(live.map((entry) => entry.functionName), ["LiveStatus"]);
  });

  it("alerts never announce step-up codes, challenges or customer data", () => {
    const alerts = appJsx.filter((entry) => staticAttribute(entry, "role") === "alert");
    assert.ok(alerts.length >= 7);
    for (const entry of alerts) {
      for (const name of identifiersIn(entry.node)) {
        assert.doesNotMatch(name, sensitiveName, `${entry.functionName} alert reads ${name}`);
      }
    }
  });

  it("Escape only dismisses the tooltip and is the single keyboard shortcut", () => {
    assert.equal(appSource.match(/"Escape"/g)?.length, 1);
    assert.equal(appSource.match(/addEventListener\("keydown"/g)?.length, 1);
    assert.doesNotMatch(appSource, /onKeyDown=|onKeyUp=|onKeyPress=/);
    const handler = /function onKeyDown\(event: KeyboardEvent\) \{([^}]*)\}/.exec(appSource);
    assert.ok(handler);
    assert.deepEqual(identifiersIn(parseTsx("handler.ts", handler[1] ?? "")), ["event", "key", "setTooltip", "undefined"]);
  });

  it("capability-gated controls stay disabled without the capability", () => {
    assert.match(appSource, /const mayPreview = capabilities\.includes\("approvals:preview"\);/);
    assert.match(appSource, /const mayStepUp = capabilities\.includes\("approvals:step-up"\);/);
    const gated = new Map([
      ["loadPreview", /^\{!mayPreview \|\| /],
      ["startStepUp", /^\{!mayStepUp \|\| /],
      ["verifyStepUp", /verificationCode\.length !== 6\}$/]
    ]);
    for (const [action, pattern] of gated) {
      const button = appJsx.find((entry) => entry.tag === "button" && (attributeText(entry, "onClick") ?? "").includes(`${action}()`));
      assert.ok(button, action);
      assert.match(attributeText(button, "disabled") ?? "", pattern, action);
    }
    const auditExport = appJsx.filter(
      (entry) => entry.functionName === "AuditView" && entry.tag === "button" && entry.attributes.has("disabled")
    );
    assert.ok(auditExport.some((entry) => /^\{!mayExport \|\| /.test(attributeText(entry, "disabled") ?? "")));
    const ariaDisabled = appJsx.filter((item) => item.attributes.has("aria-disabled"));
    assert.ok(ariaDisabled.length >= 1);
    for (const entry of ariaDisabled) {
      assert.equal(entry.tag, "button");
      assert.equal(attributeText(entry, "onClick"), "{() => selectScreen(item)}", "aria-disabled controls must still guard the click");
    }
    assert.match(
      appSource,
      /function selectScreen\(item: NavigationItem\) \{\n {4}if \(item\.capability && !hasCapability\(session, item\.capability\)\) return;/
    );
  });

  it("the skip link only moves focus and the main landmark is its only target", () => {
    assert.equal(appSource.match(/ref=\{mainRef\}/g)?.length, 1);
    assert.equal(appSource.match(/mainRef\.current/g)?.length, 1);
    const skip = appJsx.find((entry) => staticAttribute(entry, "className") === "skip-link");
    assert.ok(skip);
    assert.equal(attributeText(skip, "onClick"), "{() => mainRef.current?.focus()}");
    assert.equal(skip.tag, "button");
    assert.equal(staticAttribute(skip, "type"), "button");
  });
});
