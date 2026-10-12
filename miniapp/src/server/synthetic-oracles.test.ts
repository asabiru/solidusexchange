import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withdrawalsView, withdrawalIdPattern, withdrawalLegIdPattern, destinationReferencePattern } from "./withdrawals.js";
import { paymentsView } from "./payments.js";
import { cardsView } from "./cards.js";
import { depositsView } from "./deposits.js";
import { syntheticData } from "./synthetic.js";

/**
 * Contract-fidelity guard for the miniapp's local synthetic oracle: the same
 * fail-closed pins the upstream adapters assert must hold for the gated
 * fixtures, or a degraded session renders a universe the contract would
 * never emit.
 */
const TERMINAL_WITHDRAWAL_STATUSES = ["broadcast", "confirmed", "rejected", "cancelled", "expired"];
const MAX_INTENT_TTL_MS = 300_000;

function ms(value: string | number): number {
  const parsed = typeof value === "number" ? value : Date.parse(value);
  assert.ok(Number.isFinite(parsed), `not a timestamp: ${value}`);
  return parsed;
}

/** The latest recorded instant the verified synthetic universe serves. */
function universeNow(): number {
  let latest = 0;
  const see = (value: string | number | undefined | null) => {
    if (value !== undefined && value !== null) latest = Math.max(latest, ms(value));
  };
  for (const payment of paymentsView("verified").payments) {
    see(payment.createdAt);
    see(payment.updatedAt);
  }
  for (const card of cardsView("verified").cards) {
    see(card.createdAt);
    see(card.updatedAt);
  }
  for (const deposit of depositsView("verified").deposits) {
    see(deposit.createdAt);
    see(deposit.updatedAt);
  }
  for (const withdrawal of withdrawalsView("verified").withdrawals) {
    see(withdrawal.createdAt);
    see(withdrawal.updatedAt);
  }
  for (const operation of syntheticData.operations("verified")) {
    see(operation.createdAt);
  }
  return latest;
}

describe("synthetic oracle contract fidelity", () => {
  it("emits contract-shaped withdrawal identities", () => {
    for (const withdrawal of withdrawalsView("verified").withdrawals) {
      assert.match(withdrawal.id, withdrawalIdPattern);
      assert.match(withdrawal.destinationReference, destinationReferencePattern);
      for (const leg of withdrawal.legs) assert.match(leg.id, withdrawalLegIdPattern);
    }
  });

  it("keeps every withdrawal inside the custody TTL window", () => {
    for (const withdrawal of withdrawalsView("verified").withdrawals) {
      const created = ms(withdrawal.createdAt);
      const expires = ms(withdrawal.expiresAt);
      assert.ok(expires > created, `${withdrawal.id} expires before it is created`);
      assert.ok(
        expires - created <= MAX_INTENT_TTL_MS,
        `${withdrawal.id} TTL exceeds maximum_intent_ttl_seconds`
      );
      if (!(TERMINAL_WITHDRAWAL_STATUSES as readonly string[]).includes(withdrawal.status)) {
        assert.ok(
          ms(withdrawal.updatedAt) < expires,
          `${withdrawal.id} updated after its expiry`
        );
      }
    }
  });

  it("keeps non-terminal withdrawals unexpired at the universe's latest instant", () => {
    const now = universeNow();
    for (const withdrawal of withdrawalsView("verified").withdrawals) {
      if ((TERMINAL_WITHDRAWAL_STATUSES as readonly string[]).includes(withdrawal.status)) continue;
      assert.ok(
        ms(withdrawal.expiresAt) > now,
        `${withdrawal.id} reads ${withdrawal.status} but expired before the synthetic universe's latest instant`
      );
    }
  });
});
