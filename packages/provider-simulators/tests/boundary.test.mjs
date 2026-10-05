import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  ADAPTER_OPERATIONS,
  assertProviderAdapter,
  createBankSimulator,
  createCallbackInbox,
  createKycSimulator,
  createKytSimulator,
  createQuoteSimulator,
  FORBIDDEN_OPERATION,
} from "../src/index.mjs";
import * as api from "../src/index.mjs";
import { freshKey } from "./helpers.mjs";

const sourceDirectory = new URL("../src/", import.meta.url);

describe("provider-neutral adapter boundary", () => {
  test("every simulator satisfies its provider-neutral contract", () => {
    const key = freshKey();
    assert.equal(assertProviderAdapter("kyc", createKycSimulator({ seed: "b", key })), true);
    assert.equal(assertProviderAdapter("kyt", createKytSimulator({ seed: "b", key })), true);
    assert.equal(assertProviderAdapter("bank", createBankSimulator({ seed: "b", key })), true);
    assert.equal(assertProviderAdapter("quote", createQuoteSimulator({ seed: "b", key })), true);
  });

  test("adapters exposing execution or money-moving operations are refused", () => {
    const quote = { providerId: "future-lp", requestQuote: async () => ({}), getQuote: async () => ({}) };
    for (const operation of ["placeOrder", "executeQuote", "acceptQuote", "hedge", "settle", "orderMarket", "fillQuote", "trade"]) {
      assert.throws(() => assertProviderAdapter("quote", { ...quote, [operation]: async () => ({}) }), /must not expose/, operation);
    }
    const bank = { providerId: "future-bank", createPaymentIntent: async () => ({}), getPaymentStatus: async () => ({}) };
    for (const operation of ["payout", "refund", "settlePayment", "postToLedger", "capture", "transferFunds", "withdraw"]) {
      assert.throws(() => assertProviderAdapter("bank", { ...bank, [operation]: async () => ({}) }), /must not expose/, operation);
    }
    class Inherited {
      settle() {}
    }
    const inherited = Object.assign(new Inherited(), bank);
    assert.throws(() => assertProviderAdapter("bank", inherited), /must not expose settle/);
    assert.throws(() => assertProviderAdapter("bank", { ...bank, getPaymentStatus: "no" }), /must implement/);
    assert.throws(() => assertProviderAdapter("bank", { ...bank, providerId: "Real Bank" }), /providerId/);
    assert.throws(() => assertProviderAdapter("custody", bank), /unknown adapter kind/);
    assert.throws(() => assertProviderAdapter("bank", null), /object/);
    assert.equal(assertProviderAdapter("bank", bank), true);
  });

  test("the public API has no execution, settlement or ledger entry points", () => {
    for (const name of Object.keys(api)) {
      assert.equal(FORBIDDEN_OPERATION.test(name), false, name);
      assert.doesNotMatch(name, /order|hedge|settle|ledger|payout|broadcast|custody/i, name);
    }
    for (const [kind, operations] of Object.entries(ADAPTER_OPERATIONS)) {
      for (const operation of operations) {
        assert.equal(FORBIDDEN_OPERATION.test(operation), false, `${kind}.${operation}`);
      }
    }
  });

  test("sources import only node:crypto and sibling modules", () => {
    const files = readdirSync(sourceDirectory).filter((name) => name.endsWith(".mjs"));
    assert.ok(files.length >= 10);
    for (const file of files) {
      const text = readFileSync(new URL(file, sourceDirectory), "utf8");
      for (const match of text.matchAll(/\bfrom\s+"([^"]+)"/g)) {
        assert.ok(match[1] === "node:crypto" || match[1].startsWith("./"), `${file}: ${match[1]}`);
      }
      assert.doesNotMatch(text, /\bfetch\s*\(|node:https?|node:net|node:dns|node:tls|Math\.random|Date\.now\s*\(|parseFloat/, file);
    }
  });
});

describe("callback inbox", () => {
  const transitions = { open: ["middle", "done"], middle: ["done"], done: [] };
  const event = (sequence, status, extra = {}) => ({ subject: "sim-s", event_id: `evt_${sequence}${extra.suffix ?? ""}`, sequence, status, ...extra.fields });

  test("applies, buffers, deduplicates and flags conflicts, stale and invalid events", () => {
    const inbox = createCallbackInbox({ subjectField: "subject", initialStatus: "open", transitions });
    inbox.openSubject("sim-s", { deadline: 100 });
    assert.throws(() => inbox.openSubject("sim-s", { deadline: 100 }), /already open/);
    assert.equal(inbox.accept({ ...event(1, "middle"), subject: "sim-other" }, { receivedAt: 1 }).action, "unknown_subject");
    assert.deepEqual(inbox.accept(event(2, "done"), { receivedAt: 1 }), { action: "buffered", status: "open", appliedStatuses: [] });
    assert.equal(inbox.get("sim-s").buffered, 1);
    assert.deepEqual(inbox.accept(event(1, "middle"), { receivedAt: 2 }), { action: "applied", status: "done", appliedStatuses: ["middle", "done"] });
    assert.equal(inbox.accept(event(1, "middle"), { receivedAt: 3 }).action, "duplicate");
    assert.equal(inbox.accept({ ...event(1, "done") }, { receivedAt: 3 }).action, "conflict");
    assert.equal(inbox.accept(event(1, "middle", { suffix: "b" }), { receivedAt: 3 }).action, "stale");
    assert.equal(inbox.accept(event(3, "middle"), { receivedAt: 3 }).action, "invalid_transition");
    const state = inbox.get("sim-s");
    assert.deepEqual([state.status, state.sequence, state.reviewEvents, state.buffered], ["done", 2, 2, 0]);
    assert.deepEqual(inbox.expire(1000), []);
    assert.equal(inbox.get("sim-missing"), undefined);
  });

  test("invalid buffered successors are held for review, not applied", () => {
    const inbox = createCallbackInbox({ subjectField: "subject", initialStatus: "open", transitions });
    inbox.openSubject("sim-s", { deadline: 100 });
    assert.equal(inbox.accept(event(2, "open"), { receivedAt: 1 }).action, "buffered");
    assert.equal(inbox.accept(event(2, "middle", { suffix: "b" }), { receivedAt: 1 }).action, "stale");
    assert.deepEqual(inbox.accept(event(1, "middle"), { receivedAt: 1 }).appliedStatuses, ["middle"]);
    assert.equal(inbox.get("sim-s").reviewEvents, 1);
    assert.deepEqual(inbox.expire(101), ["sim-s"]);
    assert.equal(inbox.accept(event(3, "done"), { receivedAt: 50 }).action, "late");
    assert.throws(() => inbox.openSubject("sim-t", { deadline: 1.5 }), TypeError);
  });
});
