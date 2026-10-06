import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import type { AddressScreeningStatus, AddressScreeningView, QuotePreview } from "../shared/api.js";
import { activityIdPattern, createActivityLog, maxActivityPerSubject, maxActivitySubjects } from "./activity.js";

const tonTestnet = "kQBrcnmAh46VnKOqsbi_xs3U2-Lp8Pf-BQwTGiEoLzY9RCIT";

function quote(overrides: Partial<QuotePreview> = {}): QuotePreview {
  return {
    id: "quote_0123456789abcdef0123456789abcdef",
    from: "RUB",
    to: "USDT",
    amountIn: "25000.00",
    fee: "125.10",
    feeAsset: "RUB",
    feeBps: 50,
    spreadBps: 30,
    netIn: "24874.90",
    amountOut: "301.234567",
    total: "25000.00",
    rate: { base: "USDT", quote: "RUB", value: "82.570000" },
    issuedAt: 1_000,
    expiresAt: 31_000,
    ttlSeconds: 30,
    serverTime: 1_000,
    insufficientBalance: false,
    kycRequired: false,
    executable: false,
    executionUnavailableReason: "dev_test_version",
    ...overrides
  };
}

function screening(status: AddressScreeningStatus = "pending"): AddressScreeningView {
  return {
    id: "scr_0123456789abcdef0123456789abcdef",
    mode: "test",
    asset: "TON",
    network: "TON_TESTNET",
    status,
    advisory: true,
    executable: false,
    submittedAt: 1_000,
    deadline: 61_000
  };
}

describe("activity log: server events only, display-safe fields", () => {
  it("records login, trusted KYC, quote and screening events newest-first with the server clock", () => {
    let clock = 1_000;
    const log = createActivityLog({ clock: () => clock });
    log.recordLogin("tg-a", "telegram");
    clock += 1;
    log.recordKyc("tg-a", "submitted");
    clock += 1;
    log.recordQuote("tg-a", quote());
    clock += 1;
    log.recordScreening("tg-a", screening("low"));
    const items = log.list("tg-a");
    assert.deepEqual(items.map((item) => item.kind), ["address_screened", "quote_previewed", "kyc_submitted", "session_login"]);
    assert.deepEqual(items.map((item) => item.at), [1_003, 1_002, 1_001, 1_000]);
    for (const item of items) assert.match(item.id, activityIdPattern);
    assert.equal(new Set(items.map((item) => item.id)).size, items.length);
    assert.deepEqual(items[3], { id: items[3]?.id, at: 1_000, kind: "session_login", source: "telegram" });
    assert.deepEqual(items[0], {
      id: items[0]?.id,
      at: 1_003,
      kind: "address_screened",
      asset: "TON",
      network: "TON_TESTNET",
      status: "low",
      advisory: true,
      executable: false
    });
    assert.ok(Object.isFrozen(items[0]));
  });

  it("maps every KYC state to a kyc_<state> entry and ignores not_started", () => {
    const log = createActivityLog({ clock: () => 0 });
    for (const state of ["not_started", "submitted", "in_review", "approved", "rejected", "needs_more_data", "timed_out", "unavailable"] as const) {
      log.recordKyc("tg-a", state);
    }
    assert.deepEqual(log.list("tg-a").map((item) => item.kind).reverse(), [
      "kyc_submitted",
      "kyc_in_review",
      "kyc_approved",
      "kyc_rejected",
      "kyc_needs_more_data",
      "kyc_timed_out",
      "kyc_unavailable"
    ]);
  });

  it("keeps quote amounts as the exact decimal strings returned to the client and never executable", () => {
    const log = createActivityLog({ clock: () => 0 });
    const preview = quote({ amountIn: "1234567890.120000", amountOut: "0.000001", fee: "0.10", rate: { base: "USDT", quote: "RUB", value: "82.000000" } });
    log.recordQuote("tg-a", preview);
    const [item] = log.list("tg-a");
    assert.ok(item?.kind === "quote_previewed");
    assert.deepEqual(item, {
      id: item.id,
      at: 0,
      kind: "quote_previewed",
      pair: "USDT/RUB",
      side: "buy",
      from: "RUB",
      to: "USDT",
      amountIn: "1234567890.120000",
      amountOut: "0.000001",
      fee: "0.10",
      feeAsset: "RUB",
      rate: { base: "USDT", quote: "RUB", value: "82.000000" },
      executable: false
    });
    const text = JSON.stringify(item);
    assert.match(text, /"amountIn":"1234567890\.120000"/);
    assert.match(text, /"amountOut":"0\.000001"/);
    assert.match(text, /"value":"82\.000000"/);
    assert.equal(text.includes(preview.id), false);
    assert.doesNotMatch(text, /feeBps|spreadBps|netIn|insufficientBalance|expiresAt/);
  });

  it("derives pair and side from the quote rate", () => {
    const log = createActivityLog({ clock: () => 0 });
    log.recordQuote("tg-a", quote({ from: "USDT", to: "RUB", feeAsset: "RUB", rate: { base: "USDT", quote: "RUB", value: "81.10" } }));
    log.recordQuote("tg-a", quote({ from: "TON", to: "USDT", feeAsset: "USDT", rate: { base: "TON", quote: "USDT", value: "3.250000" } }));
    const [ton, usdt] = log.list("tg-a");
    assert.ok(ton?.kind === "quote_previewed" && usdt?.kind === "quote_previewed");
    assert.equal(usdt.pair, "USDT/RUB");
    assert.equal(usdt.side, "sell");
    assert.equal(ton.pair, "TON/USDT");
    assert.equal(ton.side, "sell");
  });

  it("never stores the screened address or the BFF screening id", () => {
    const log = createActivityLog({ clock: () => 0 });
    const view = screening("pending");
    log.recordScreening("tg-a", { ...view, address: tonTestnet } as AddressScreeningView);
    const text = JSON.stringify(log.list("tg-a"));
    assert.equal(text.includes(tonTestnet), false);
    assert.equal(text.includes(view.id), false);
    assert.equal(text.includes("tg-a"), false);
    assert.doesNotMatch(text, /address"|deadline|submittedAt|sim-/);
  });

  it("follows a pending screening to its public result and stops once settled", () => {
    const log = createActivityLog({ clock: () => 0 });
    let current: AddressScreeningStatus | undefined = "pending";
    let lookups = 0;
    log.recordScreening("tg-a", screening("pending"), () => {
      lookups += 1;
      return current;
    });
    const statusOf = () => {
      const [item] = log.list("tg-a");
      assert.ok(item?.kind === "address_screened");
      return item.status;
    };
    assert.equal(statusOf(), "pending");
    current = "medium";
    assert.equal(statusOf(), "medium");
    current = "low";
    assert.equal(statusOf(), "medium");
    assert.equal(lookups, 2);
  });

  it("keeps the last known status when the screening is no longer tracked", () => {
    const log = createActivityLog({ clock: () => 0 });
    log.recordScreening("tg-a", screening("pending"), () => undefined);
    const [item] = log.list("tg-a");
    assert.ok(item?.kind === "address_screened");
    assert.equal(item.status, "pending");
  });

  it("does not follow screenings that were already settled when recorded", () => {
    const log = createActivityLog({ clock: () => 0 });
    log.recordScreening("tg-a", screening("unavailable"), () => assert.fail("must not look up a settled screening"));
    const [item] = log.list("tg-a");
    assert.ok(item?.kind === "address_screened");
    assert.equal(item.status, "unavailable");
  });
});

describe("activity log: bounded and isolated", () => {
  it("caps each subject at 50 entries and evicts the oldest first", () => {
    let clock = 0;
    const log = createActivityLog({ clock: () => clock });
    assert.equal(maxActivityPerSubject, 50);
    for (let index = 0; index < 75; index += 1) {
      clock = index;
      log.recordKyc("tg-a", "in_review");
    }
    assert.equal(log.size("tg-a"), 50);
    const items = log.list("tg-a");
    assert.equal(items.length, 50);
    assert.equal(items[0]?.at, 74);
    assert.equal(items.at(-1)?.at, 25);
  });

  it("honours a list limit and never returns more than the cap", () => {
    let clock = 0;
    const log = createActivityLog({ clock: () => clock, maxPerSubject: 5 });
    for (let index = 0; index < 8; index += 1) {
      clock = index;
      log.recordLogin("tg-a", "telegram");
    }
    assert.deepEqual(log.list("tg-a", 2).map((item) => item.at), [7, 6]);
    assert.equal(log.list("tg-a", 500).length, 5);
    assert.deepEqual(log.list("tg-a", 0), []);
    assert.deepEqual(log.list("tg-a", -3), []);
    assert.deepEqual(log.list("tg-a", Number.NaN), []);
  });

  it("caps tracked subjects at 1,000 and evicts the least recently active", () => {
    const log = createActivityLog({ clock: () => 0 });
    assert.equal(maxActivitySubjects, 1_000);
    for (let index = 0; index < maxActivitySubjects; index += 1) log.recordLogin(`tg-${index}`, "telegram");
    log.recordLogin("tg-0", "telegram");
    log.recordLogin("tg-new", "telegram");
    assert.equal(log.subjects(), maxActivitySubjects);
    assert.equal(log.size("tg-0"), 2);
    assert.equal(log.size("tg-1"), 0);
    assert.equal(log.size("tg-new"), 1);
  });

  it("isolates subjects: one subject never sees or evicts another's history", () => {
    const log = createActivityLog({ clock: () => 0, maxPerSubject: 3 });
    log.recordLogin("tg-victim", "telegram");
    log.recordKyc("tg-victim", "approved");
    for (let index = 0; index < 100; index += 1) log.recordQuote("tg-attacker", quote());
    assert.deepEqual(log.list("tg-victim").map((item) => item.kind), ["kyc_approved", "session_login"]);
    assert.equal(log.list("tg-attacker").length, 3);
    assert.ok(log.list("tg-attacker").every((item) => item.kind === "quote_previewed"));
    assert.deepEqual(log.list("tg-unknown"), []);
  });

  it("rejects non-positive or fractional bounds", () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      assert.throws(() => createActivityLog({ clock: () => 0, maxPerSubject: bad }), RangeError);
      assert.throws(() => createActivityLog({ clock: () => 0, maxSubjects: bad }), RangeError);
    }
  });

  it("uses unpredictable ids that differ between log instances", () => {
    const first = createActivityLog({ clock: () => 0 });
    const second = createActivityLog({ clock: () => 0 });
    first.recordLogin("tg-a", "telegram");
    second.recordLogin("tg-a", "telegram");
    assert.notEqual(first.list("tg-a")[0]?.id, second.list("tg-a")[0]?.id);
  });

  it("has no network access, client entrypoint or money-moving method", async () => {
    const source = await readFile(new URL("../../src/server/activity.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /fetch\(|node:(http|https|net|dns|tls|dgram)|provider-simulators/);
    const log = createActivityLog({ clock: () => 0 });
    assert.deepEqual(Object.keys(log).sort(), ["list", "recordKyc", "recordLogin", "recordQuote", "recordScreening", "size", "subjects"]);
    assert.ok(Object.isFrozen(log));
  });
});
