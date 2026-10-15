import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { CardView } from "../shared/api.js";
import { ApiError, api } from "./api.js";
import { cardBrandBadge, cardKindBadge, cardsHistory, cardStatusBadge } from "./cards.js";
import { locales, translate } from "./i18n.js";
import { servedRowsLimit } from "./served-views.js";

const sheetSource = readFileSync(new URL("../../src/app/CardsSheet.tsx", import.meta.url), "utf8");
const homeSource = readFileSync(new URL("../../src/app/screens/HomeScreen.tsx", import.meta.url), "utf8");
const sheetsSource = readFileSync(new URL("../../src/app/sheets.tsx", import.meta.url), "utf8");
const navigationSource = readFileSync(new URL("../../src/app/navigation.ts", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../../src/app/api.ts", import.meta.url), "utf8");

function stubFetch(handler: (path: string) => Response | Promise<Response>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => handler(String(input))) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" }
  });
}

describe("cards sheet", () => {
  it("requests the card list through /bff/cards", async () => {
    let requested = "";
    const restore = stubFetch((path) => {
      requested = path;
      return jsonResponse({ mode: "test", kyc: "verified", cards: [] });
    });
    try {
      const view = await api.cards();
      assert.equal(requested, "/bff/cards");
      assert.equal(view.kyc, "verified");
      assert.equal(view.mode, "test");
    } finally {
      restore();
    }
  });

  it("surfaces the unavailable upstream as an ApiError the sheet maps to the load-failed state", async () => {
    const restore = stubFetch(() => jsonResponse({ error: "cards_unavailable" }, { status: 503 }));
    try {
      await assert.rejects(
        () => api.cards(),
        (error: unknown) => error instanceof ApiError && error.status === 503 && error.code === "cards_unavailable"
      );
    } finally {
      restore();
    }
  });

  it("maps only declared statuses, kinds and brands to badges (fail-closed)", () => {
    assert.deepEqual(cardStatusBadge("active"), { label: "cards.statusActive", tone: "success" });
    assert.deepEqual(cardStatusBadge("blocked"), { label: "cards.statusBlocked", tone: "risk" });
    assert.equal(cardStatusBadge("limbo"), undefined);
    assert.equal(cardStatusBadge(""), undefined);
    assert.equal(cardStatusBadge("__proto__"), undefined);
    assert.deepEqual(cardKindBadge("virtual"), { label: "cards.kindVirtual", tone: "muted" });
    assert.deepEqual(cardKindBadge("physical"), { label: "cards.kindPhysical", tone: "muted" });
    assert.equal(cardKindBadge("holographic"), undefined);
    assert.deepEqual(cardBrandBadge("mir"), { label: "cards.brandMir", tone: "muted" });
    assert.equal(cardBrandBadge("amex"), undefined);
  });

  it("resolves the sheet's strings in every locale", () => {
    const keys = [
      "cards.title",
      "cards.entryDetail",
      "cards.listTitle",
      "cards.listLabel",
      "cards.empty",
      "cards.gated",
      "cards.loadFailed",
      "cards.note",
      "cards.detailTitle",
      "cards.back",
      "cards.masked",
      "cards.brand",
      "cards.kind",
      "cards.status",
      "cards.monthlyLimit",
      "cards.token",
      "cards.createdAt",
      "cards.expiresAt",
      "cards.updatedAt",
      "cards.brandMir",
      "cards.brandVisa",
      "cards.brandMastercard",
      "cards.kindVirtual",
      "cards.kindPhysical",
      "cards.statusPendingActivation",
      "cards.statusActive",
      "cards.statusFrozen",
      "cards.statusBlocked",
      "cards.statusExpired",
      "cards.statusTerminated"
    ] as const;
    for (const locale of locales) {
      for (const key of keys) {
        assert.notEqual(translate(locale, key), key, `${locale}:${key}`);
      }
    }
  });

  it("renders the list rows from the served view without fabricating cards", () => {
    assert.ok(sheetSource.includes("api.cards()"));
    assert.ok(sheetSource.includes("cardsHistory(view)"));
    assert.ok(sheetSource.includes("aria-label={t(\"cards.listLabel\")}"));
    // Status, kind and brand render through the fail-closed badge maps with a raw-text fallback.
    assert.ok(sheetSource.includes("cardStatusBadge(card.status)"));
    assert.ok(sheetSource.includes("cardKindBadge(card.kind)"));
    assert.ok(sheetSource.includes("cardBrandBadge(card.brand)"));
    assert.ok(sheetSource.includes("pill--${statusBadge?.tone"));
  });

  it("opens the card detail from a row like the trades sheet drills into a fill", () => {
    assert.ok(sheetSource.includes('mode.kind === "detail"'));
    assert.ok(sheetSource.includes('onClick={() => show({ kind: "detail", card })}'));
    // The detail reuses the fetched row — there is no member read /bff/cards/{id}.
    assert.ok(sheetSource.includes("<CardDetail card={mode.card}"));
    for (const key of [
      "cards.masked",
      "cards.brand",
      "cards.kind",
      "cards.status",
      "cards.monthlyLimit",
      "cards.token",
      "cards.createdAt",
      "cards.expiresAt",
      "cards.updatedAt",
      "cards.back"
    ]) {
      assert.ok(sheetSource.includes(`t("${key}")`), key);
    }
    assert.ok(sheetSource.includes('className="cta cta--ghost"'));
  });

  it("covers the empty, gated and load-failed states like the sibling sheets", () => {
    assert.ok(sheetSource.includes('history.kyc !== "verified"'));
    assert.ok(sheetSource.includes('t("cards.gated")'));
    assert.ok(sheetSource.includes('t("cards.empty")'));
    assert.ok(sheetSource.includes('t("cards.loadFailed")'));
    assert.ok(sheetSource.includes('t("common.loading")'));
    assert.ok(sheetSource.includes('t("cards.note")'));
    // The list only renders when the subject is not gated — the gated view holds no rows.
    assert.ok(sheetSource.includes("!gated && cards.length > 0"));
  });

  it("wires the sheet into navigation, the sheet host and the home list", () => {
    assert.ok(navigationSource.includes('{ kind: "cards" }'));
    assert.ok(sheetsSource.includes('case "cards":'));
    assert.ok(sheetsSource.includes("CardsSheet"));
    assert.ok(homeSource.includes('{ kind: "cards" }'));
    assert.ok(homeSource.includes('t("cards.title")'));
    assert.ok(homeSource.includes('t("cards.entryDetail")'));
    assert.ok(apiSource.includes('cards: () => call<CardsView>("/bff/cards")'));
  });

  it("surfaces served-list truncation instead of silently dropping rows", () => {
    assert.ok(sheetSource.includes('t("common.truncated"'));
  });
});

const cardRow: CardView = {
  id: "crd_a1b2c3d4e5f6a7b8c9d0e1f2",
  brand: "mir",
  kind: "physical",
  status: "active",
  last4: "4832",
  tokenReference: "tok_a1b2c3d4e5f6a7b8c9d0e1f2",
  asset: "RUB",
  monthlyLimit: "250000.00",
  createdAt: Date.parse("2026-09-12T10:00:00.000Z"),
  expiresAt: Date.parse("2029-09-12T00:00:00.000Z"),
  updatedAt: Date.parse("2026-09-12T10:05:00.000Z"),
  posting: "none"
};

const cardsView = { mode: "test", kyc: "verified", cards: [cardRow] } as const;

describe("cardsHistory served-view adapter", () => {
  it("adapts a valid cards view, keeping the kyc flag, rows and pre-truncation total", () => {
    const history = cardsHistory(cardsView);
    assert.equal(history?.kyc, "verified");
    assert.equal(history?.rows.length, 1);
    assert.equal(history?.total, 1);
    assert.equal(history?.rows[0]?.tokenReference, cardRow.tokenReference);
    const gated = cardsHistory({ mode: "test", kyc: "kyc-gated", cards: [] });
    assert.equal(gated?.kyc, "kyc-gated");
    assert.equal(gated?.rows.length, 0);
  });

  it("fails closed on malformed cards views and rows (exact keys)", () => {
    for (const corrupt of [
      { ...cardsView, extra: true },
      { mode: "test", kyc: "verified" },
      { ...cardsView, mode: "live" },
      { ...cardsView, kyc: "unknown" },
      { ...cardsView, cards: "nope" },
      { ...cardsView, cards: [null] },
      { ...cardsView, cards: [{ ...cardRow, extra: 1 }] },
      { ...cardsView, cards: [{ ...cardRow, id: "crd_UPPERCASEAAAAAAAAAAAAAAAAAAAA" }] },
      { ...cardsView, cards: [{ ...cardRow, id: "trd_a1b2c3d4e5f6a7b8c9d0e1f2" }] },
      { ...cardsView, cards: [{ ...cardRow, brand: "amex" }] },
      { ...cardsView, cards: [{ ...cardRow, kind: "holographic" }] },
      { ...cardsView, cards: [{ ...cardRow, status: "limbo" }] },
      { ...cardsView, cards: [{ ...cardRow, last4: "483" }] },
      { ...cardsView, cards: [{ ...cardRow, tokenReference: "crd_a1b2c3d4e5f6a7b8c9d0e1f2" }] },
      { ...cardsView, cards: [{ ...cardRow, asset: "USDT" }] },
      { ...cardsView, cards: [{ ...cardRow, monthlyLimit: "250000.001" }] },
      { ...cardsView, cards: [{ ...cardRow, monthlyLimit: "abc" }] },
      { ...cardsView, cards: [{ ...cardRow, createdAt: "2026-09-12" }] },
      { ...cardsView, cards: [{ ...cardRow, posting: "signed" }] }
    ]) {
      assert.equal(cardsHistory(corrupt), undefined, JSON.stringify(corrupt).slice(0, 120));
    }
  });

  it("bounds the rendered list and reports the pre-truncation total", () => {
    const many = Array.from({ length: servedRowsLimit + 10 }, (_, index) => ({
      ...cardRow,
      id: `crd_${String(index).padStart(24, "0")}`
    }));
    const history = cardsHistory({ mode: "test", kyc: "verified", cards: many });
    assert.equal(history?.rows.length, servedRowsLimit);
    assert.equal(history?.total, servedRowsLimit + 10);
  });
});
