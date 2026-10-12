import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { DepositView, WithdrawalView } from "../shared/api.js";
import { ApiError, api } from "./api.js";
import { locales, translate } from "./i18n.js";
import {
  depositHistory,
  depositMethodKey,
  depositStatusBadge,
  moneyHistoryLimit,
  withdrawalHistory,
  withdrawalStatusBadge
} from "./money-flow.js";

const sheetSource = readFileSync(new URL("../../src/app/MoneyFlowSheet.tsx", import.meta.url), "utf8");
const sheetsSource = readFileSync(new URL("../../src/app/sheets.tsx", import.meta.url), "utf8");
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

const depositRow: DepositView = {
  id: "dep_a1b2c3d4e5f6a7b8c9d0e1f2",
  asset: "RUB",
  method: "sbp",
  status: "payment_received",
  expected: "25000.00",
  received: "25000.00",
  reversed: "0.00",
  paymentReference: "SIMSBPA1B2C3D4E5F6",
  createdAt: Date.parse("2026-10-04T12:10:00.000Z"),
  updatedAt: Date.parse("2026-10-04T12:14:00.000Z"),
  posting: "none"
};

const withdrawalRow: WithdrawalView = {
  id: "wdr_a1b2c3d4e5f6a7b8c9d0e1f2",
  asset: "USDT",
  network: "TON_TESTNET",
  status: "confirmed",
  amount: "120.500000",
  fee: "0.500000",
  destinationReference: "destination_ref_ton_1",
  legs: [
    { id: "wdl_a1b2c3d4e5f6a7b8c9d0e1f2", asset: "USDT", amount: "120.500000", direction: "out" },
    { id: "wdl_f1e2d3c4b5a6f7e8d9c0b1a2", asset: "USDT", amount: "0.500000", direction: "out" }
  ],
  createdAt: Date.parse("2026-10-05T10:00:00.000Z"),
  updatedAt: Date.parse("2026-10-05T10:05:00.000Z"),
  expiresAt: Date.parse("2026-10-05T10:10:00.000Z"),
  posting: "none"
};

const depositsView = { mode: "test", kyc: "verified", deposits: [depositRow] } as const;
const withdrawalsView = { mode: "test", kyc: "verified", withdrawals: [withdrawalRow] } as const;

describe("money flow sheet", () => {
  it("surfaces served-history truncation instead of silently dropping rows", () => {
    assert.ok(sheetSource.includes('t("common.truncated"'));
  });

  it("requests the collections through the served BFF endpoints", async () => {
    const requested: string[] = [];
    const restore = stubFetch((path) => {
      requested.push(path);
      return jsonResponse(path === "/bff/deposits" ? depositsView : withdrawalsView);
    });
    try {
      const deposits = await api.deposits();
      const withdrawals = await api.withdrawals();
      assert.deepEqual(requested, ["/bff/deposits", "/bff/withdrawals"]);
      assert.equal(deposits.kyc, "verified");
      assert.equal(withdrawals.mode, "test");
    } finally {
      restore();
    }
  });

  it("surfaces upstream unavailability as ApiError codes the sheet maps to load-failed", async () => {
    const restore = stubFetch((path) =>
      jsonResponse(
        { error: path === "/bff/deposits" ? "deposits_unavailable" : "withdrawals_unavailable" },
        { status: 503 }
      )
    );
    try {
      await assert.rejects(
        () => api.deposits(),
        (error: unknown) => error instanceof ApiError && error.status === 503 && error.code === "deposits_unavailable"
      );
      await assert.rejects(
        () => api.withdrawals(),
        (error: unknown) => error instanceof ApiError && error.status === 503 && error.code === "withdrawals_unavailable"
      );
    } finally {
      restore();
    }
  });

  it("adapts a valid deposits view, keeping the kyc flag and contract rows", () => {
    const history = depositHistory(depositsView);
    assert.equal(history?.kyc, "verified");
    assert.equal(history?.total, 1);
    assert.equal(history?.rows.length, 1);
    assert.equal(history?.rows[0]?.id, depositRow.id);
    assert.equal(history?.rows[0]?.paymentReference, depositRow.paymentReference);
    const gated = depositHistory({ mode: "test", kyc: "kyc-gated", deposits: [] });
    assert.equal(gated?.kyc, "kyc-gated");
    assert.equal(gated?.rows.length, 0);
  });

  it("adapts a valid withdrawals view including the two out-legs", () => {
    const history = withdrawalHistory(withdrawalsView);
    assert.equal(history?.kyc, "verified");
    assert.equal(history?.rows.length, 1);
    assert.equal(history?.rows[0]?.id, withdrawalRow.id);
    assert.equal(history?.rows[0]?.legs.length, 2);
    assert.equal(history?.rows[0]?.destinationReference, withdrawalRow.destinationReference);
  });

  it("fails closed on malformed deposit views and rows (exact keys)", () => {
    for (const corrupt of [
      { ...depositsView, extra: true },
      { mode: "test", kyc: "verified" },
      { ...depositsView, mode: "live" },
      { ...depositsView, kyc: "unknown" },
      { ...depositsView, deposits: "nope" },
      { ...depositsView, deposits: [null] },
      { ...depositsView, deposits: [{ ...depositRow, extra: 1 }] },
      { ...depositsView, deposits: [{ ...depositRow, posting: undefined }] },
      { ...depositsView, deposits: [{ ...depositRow, id: "dep_uppercaseAAAAAAAAAAAAAAAAAAAAAA" }] },
      { ...depositsView, deposits: [{ ...depositRow, method: "card" }] },
      { ...depositsView, deposits: [{ ...depositRow, status: "settled" }] },
      { ...depositsView, deposits: [{ ...depositRow, asset: "BTC" }] },
      { ...depositsView, deposits: [{ ...depositRow, expected: "25000.001" }] },
      { ...depositsView, deposits: [{ ...depositRow, received: "abc" }] },
      { ...depositsView, deposits: [{ ...depositRow, paymentReference: "SIMSBPlowercase" }] },
      { ...depositsView, deposits: [{ ...depositRow, createdAt: "2026-10-04" }] },
      { ...depositsView, deposits: [{ ...depositRow, posting: "pending" }] }
    ]) {
      assert.equal(depositHistory(corrupt), undefined, JSON.stringify(corrupt).slice(0, 120));
    }
  });

  it("fails closed on malformed withdrawal views, rows and legs (exact keys)", () => {
    for (const corrupt of [
      { ...withdrawalsView, extra: true },
      { mode: "test", kyc: "verified" },
      { ...withdrawalsView, kyc: null },
      { ...withdrawalsView, withdrawals: {} },
      { ...withdrawalsView, withdrawals: [42] },
      { ...withdrawalsView, withdrawals: [{ ...withdrawalRow, extra: 1 }] },
      { ...withdrawalsView, withdrawals: [{ ...withdrawalRow, id: "wdr_!" }] },
      { ...withdrawalsView, withdrawals: [{ ...withdrawalRow, network: "BTC_MAINNET" }] },
      { ...withdrawalsView, withdrawals: [{ ...withdrawalRow, asset: "TON", network: "TRON_TESTNET" }] },
      { ...withdrawalsView, withdrawals: [{ ...withdrawalRow, status: "signed" }] },
      { ...withdrawalsView, withdrawals: [{ ...withdrawalRow, amount: "120.5000001" }] },
      { ...withdrawalsView, withdrawals: [{ ...withdrawalRow, fee: "-0.5" }] },
      { ...withdrawalsView, withdrawals: [{ ...withdrawalRow, destinationReference: "0xabcdef" }] },
      { ...withdrawalsView, withdrawals: [{ ...withdrawalRow, legs: withdrawalRow.legs.slice(0, 1) }] },
      { ...withdrawalsView, withdrawals: [{ ...withdrawalRow, legs: [...withdrawalRow.legs, withdrawalRow.legs[0]!] }] },
      { ...withdrawalsView, withdrawals: [{ ...withdrawalRow, legs: [{ ...withdrawalRow.legs[0]!, amount: "1.000000" }, withdrawalRow.legs[1]!] }] },
      { ...withdrawalsView, withdrawals: [{ ...withdrawalRow, legs: [{ ...withdrawalRow.legs[0]!, direction: "in" }, withdrawalRow.legs[1]!] }] },
      { ...withdrawalsView, withdrawals: [{ ...withdrawalRow, legs: [{ ...withdrawalRow.legs[0]!, id: "dep_a1b2c3d4e5f6a7b8c9d0e1f2" }, withdrawalRow.legs[1]!] }] },
      { ...withdrawalsView, withdrawals: [{ ...withdrawalRow, legs: [{ ...withdrawalRow.legs[0]!, asset: "TON" }, withdrawalRow.legs[1]!] }] },
      { ...withdrawalsView, withdrawals: [{ ...withdrawalRow, expiresAt: Number.NaN }] },
      { ...withdrawalsView, withdrawals: [{ ...withdrawalRow, posting: "signed" }] }
    ]) {
      assert.equal(withdrawalHistory(corrupt), undefined, JSON.stringify(corrupt).slice(0, 120));
    }
  });

  it("bounds the rendered history to the declared limit", () => {
    const many = Array.from({ length: moneyHistoryLimit + 10 }, (_, index) => ({
      ...depositRow,
      id: `dep_${String(index).padStart(24, "0").replaceAll(/\d/g, (d) => "abcdef0123456789"[Number(d) % 16] ?? "a")}`
    }));
    const history = depositHistory({ mode: "test", kyc: "verified", deposits: many });
    assert.equal(history?.rows.length, moneyHistoryLimit);
    assert.equal(history?.total, moneyHistoryLimit + 10);
    assert.equal(many.length, moneyHistoryLimit + 10);
  });

  it("maps only declared deposit and withdrawal statuses to badges (fail-closed)", () => {
    for (const status of [
      "awaiting_payment",
      "payment_received",
      "partial_payment",
      "duplicate_payment",
      "payment_reversed",
      "expired_no_payment"
    ] as const) {
      const badge = depositStatusBadge(status);
      assert.ok(badge !== undefined, status);
      assert.ok(badge.label.startsWith("deposit.status"), status);
      assert.ok(["muted", "warning", "success", "risk"].includes(badge.tone), status);
    }
    assert.equal(depositStatusBadge("settled"), undefined);
    assert.equal(depositStatusBadge(""), undefined);
    assert.equal(depositStatusBadge("__proto__"), undefined);
    for (const status of [
      "draft",
      "screened",
      "pending_maker_approval",
      "pending_checker_approval",
      "unsigned_intent_ready",
      "broadcast",
      "confirmed",
      "rejected",
      "cancelled",
      "expired"
    ] as const) {
      const badge = withdrawalStatusBadge(status);
      assert.ok(badge !== undefined, status);
      assert.ok(badge.label.startsWith("withdraw.status"), status);
      assert.ok(["muted", "warning", "success", "risk"].includes(badge.tone), status);
    }
    assert.equal(withdrawalStatusBadge("signed"), undefined);
    assert.equal(withdrawalStatusBadge(""), undefined);
    assert.equal(withdrawalStatusBadge("constructor"), undefined);
    assert.equal(depositMethodKey("sbp"), "deposit.methodSbp");
    assert.equal(depositMethodKey("card"), undefined);
    assert.equal(depositMethodKey(""), undefined);
  });

  it("resolves the sheet's strings in every locale", () => {
    const keys = [
      "deposit.historyTitle",
      "deposit.historyNote",
      "deposit.listLabel",
      "deposit.empty",
      "deposit.gated",
      "deposit.loadFailed",
      "deposit.method",
      "deposit.methodSbp",
      "deposit.detailTitle",
      "deposit.back",
      "deposit.status",
      "deposit.expected",
      "deposit.received",
      "deposit.reversed",
      "deposit.reference",
      "deposit.createdAt",
      "deposit.updatedAt",
      "deposit.depositId",
      "deposit.statusAwaitingPayment",
      "deposit.statusPaymentReceived",
      "deposit.statusPartialPayment",
      "deposit.statusDuplicatePayment",
      "deposit.statusPaymentReversed",
      "deposit.statusExpiredNoPayment",
      "withdraw.historyTitle",
      "withdraw.historyNote",
      "withdraw.listLabel",
      "withdraw.empty",
      "withdraw.gated",
      "withdraw.loadFailed",
      "withdraw.detailTitle",
      "withdraw.back",
      "withdraw.status",
      "withdraw.asset",
      "withdraw.amount",
      "withdraw.destination",
      "withdraw.legs",
      "withdraw.legsLabel",
      "withdraw.legOut",
      "withdraw.createdAt",
      "withdraw.updatedAt",
      "withdraw.expiresAt",
      "withdraw.withdrawalId",
      "withdraw.statusDraft",
      "withdraw.statusScreened",
      "withdraw.statusPendingMaker",
      "withdraw.statusPendingChecker",
      "withdraw.statusIntentReady",
      "withdraw.statusBroadcast",
      "withdraw.statusConfirmed",
      "withdraw.statusRejected",
      "withdraw.statusCancelled",
      "withdraw.statusExpired"
    ] as const;
    for (const locale of locales) {
      for (const key of keys) {
        assert.notEqual(translate(locale, key), key, `${locale}:${key}`);
      }
    }
  });

  it("renders the history inside the existing sheets through the fail-closed adapter", () => {
    assert.ok(sheetSource.includes("api.deposits()"));
    assert.ok(sheetSource.includes("api.withdrawals()"));
    assert.ok(sheetSource.includes("depositHistory(view)"));
    assert.ok(sheetSource.includes("withdrawalHistory(view)"));
    assert.ok(sheetSource.includes('history.kyc !== "verified"'));
    assert.ok(sheetSource.includes('t(flow.loadFailed)'));
    assert.ok(sheetSource.includes('t(flow.gated)'));
    assert.ok(sheetSource.includes('t(flow.empty)'));
    assert.ok(sheetSource.includes('t("common.loading")'));
    assert.ok(sheetSource.includes('aria-label={t(flow.listLabel)}'));
    // Exact-decimal rendering at the asset's own scale.
    assert.ok(sheetSource.includes("money(deposit.asset, deposit.expected, true)"));
    assert.ok(sheetSource.includes("money(withdrawal.asset, withdrawal.amount, true)"));
    assert.ok(sheetSource.includes("money(withdrawal.asset, withdrawal.fee, true)"));
    // Statuses and method resolve through fail-closed member maps with raw-text fallback.
    assert.ok(sheetSource.includes("depositStatusBadge(deposit.status)"));
    assert.ok(sheetSource.includes("withdrawalStatusBadge(withdrawal.status)"));
    assert.ok(sheetSource.includes("depositMethodKey(deposit.method)"));
    assert.ok(sheetSource.includes("screeningNetworkKeyOf(withdrawal.network)"));
    // The detail reuses the fetched row — the BFF exposes no member read /bff/deposits/{id}.
    assert.ok(sheetSource.includes("onClick={() => onOpen(deposit)}"));
    assert.ok(sheetSource.includes("onClick={() => onOpen(withdrawal)}"));
    assert.ok(sheetSource.includes("<DepositDetail deposit={detail.deposit}"));
    assert.ok(sheetSource.includes("<WithdrawalDetail withdrawal={detail.withdrawal}"));
    assert.ok(sheetSource.includes("deposit.paymentReference"));
    assert.ok(sheetSource.includes("withdrawal.destinationReference"));
    assert.ok(sheetSource.includes("withdrawal.legs.map"));
    assert.ok(sheetSource.includes("format.epochMs(deposit.updatedAt)"));
    assert.ok(sheetSource.includes("format.epochMs(withdrawal.expiresAt)"));
  });

  it("keeps the sibling a11y idiom: aria-live announcement and focus on view switch", () => {
    assert.ok(sheetSource.includes('className="visually-hidden" aria-live="polite" aria-atomic="true">{announcement}'));
    assert.ok(sheetSource.includes("heading.current?.focus()"));
    assert.ok(sheetSource.includes('className="section-label" ref={heading} tabIndex={-1}'));
    assert.ok(sheetSource.includes('className="sheet__summary" aria-live="polite" aria-atomic="true"'));
    assert.ok(sheetSource.includes('className="form-error" role="alert"'));
    assert.ok(sheetSource.includes('className="cta cta--ghost"'));
  });

  it("stays on the existing deposit/withdraw navigation — no new sheet kinds", () => {
    assert.ok(sheetsSource.includes('case "deposit":'));
    assert.ok(sheetsSource.includes('case "withdraw":'));
    assert.ok(sheetsSource.includes('from "./MoneyFlowSheet"'));
    assert.ok(sheetsSource.includes('<MoneyFlowSheet mode="deposit"'));
    assert.ok(sheetsSource.includes('<MoneyFlowSheet mode="withdraw"'));
    assert.ok(apiSource.includes('deposits: () => call<DepositsView>("/bff/deposits")'));
    assert.ok(apiSource.includes('withdrawals: () => call<WithdrawalsView>("/bff/withdrawals")'));
    // The sheet never fabricates member reads.
    assert.doesNotMatch(sheetSource, /\/bff\/deposits\/|\/bff\/withdrawals\//);
  });
});
