import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoRepository } from "./demo.js";

/**
 * Contract-fidelity guard for the degrade oracle: every vocabulary and
 * invariant the fail-closed adapters pin on live data must also hold for the
 * demo universe, or degrade mode renders fiction the live contract would
 * never emit. Statuses mirror the check contract (miniapp shared/checks.ts)
 * and the WithdrawalView enum (packages/api-contracts/openapi.yaml); the TTL
 * bound mirrors custody-policy maximum_intent_ttl_seconds.
 */
const CONTRACT_CHECK_STATUSES = [
  "created",
  "awaiting_recipient_kyc",
  "claimed",
  "cancelled",
  "expired"
];
const CONTRACT_WITHDRAWAL_STATUSES = [
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
];
const MAX_INTENT_TTL_MS = 300_000;
// Execution-terminal states: the intent left the custody TTL domain for good.
// "broadcast" is still in-flight (awaiting rail confirmation) and counts as a
// live queue item, but its signing window is legitimately closed so it is
// exempt from the unexpired-at-universe-now check.
const EXECUTION_TERMINAL_INTENT_STATUSES = ["confirmed", "rejected", "cancelled", "expired"];
const SIGNING_WINDOW_CLOSED_STATUSES = ["broadcast", ...EXECUTION_TERMINAL_INTENT_STATUSES];
const CHECK_FEE_BPS = 30n;
const ASSET_SCALES: Readonly<Record<string, bigint>> = { RUB: 2n, USDT: 6n, TON: 9n };

function ms(value: string): number {
  const parsed = Date.parse(value);
  assert.ok(Number.isFinite(parsed), `not an ISO timestamp: ${value}`);
  return parsed;
}

function toUnits(value: string, scale: bigint): bigint {
  const [whole, fraction = ""] = value.split(".");
  assert.equal(BigInt(fraction.length) <= scale, true, `scale overflow: ${value}`);
  return BigInt(whole) * 10n ** scale + BigInt(fraction.padEnd(Number(scale), "0") || "0");
}

/** The latest recorded instant anywhere in the demo universe. */
function universeNow(): number {
  let latest = 0;
  const see = (value: string | undefined) => {
    if (value !== undefined) latest = Math.max(latest, ms(value));
  };
  for (const customer of demoRepository.customers()) see(customer.lastReviewedAt);
  for (const check of demoRepository.chatChecks()) {
    see(check.createdAt);
    see(check.resolvedAt);
    for (const event of check.timeline) see(event.occurredAt);
  }
  for (const ticket of demoRepository.supportTickets()) {
    see(ticket.createdAt);
    see(ticket.updatedAt);
    see(ticket.resolvedAt);
    for (const message of ticket.messages) see(message.occurredAt);
    for (const note of ticket.internalNotes) see(note.occurredAt);
  }
  for (const intent of demoRepository.withdrawalIntents()) {
    see(intent.createdAt);
    see(intent.updatedAt);
    see(intent.resolvedAt);
    for (const step of intent.approvalSteps) see(step.decidedAt);
    for (const event of intent.timeline) see(event.occurredAt);
  }
  for (const kase of demoRepository.kycCases()) see(kase.openedAt);
  for (const kase of demoRepository.amlCases()) see(kase.openedAt);
  for (const kase of demoRepository.investigationCases()) {
    see(kase.openedAt);
    for (const event of kase.timeline) see(event.occurredAt);
  }
  for (const alert of demoRepository.fraudAlerts()) see(alert.detectedAt);
  for (const event of demoRepository.auditSource()) see(event.occurredAt);
  return latest;
}

describe("demo oracle contract fidelity", () => {
  it("emits only contract check statuses", () => {
    for (const check of demoRepository.chatChecks()) {
      assert.ok(
        (CONTRACT_CHECK_STATUSES as readonly string[]).includes(check.status),
        `${check.id} status ${check.status} is not a contract check status`
      );
    }
  });

  it("emits only contract withdrawal statuses", () => {
    for (const intent of demoRepository.withdrawalIntents()) {
      assert.ok(
        (CONTRACT_WITHDRAWAL_STATUSES as readonly string[]).includes(intent.status),
        `${intent.id} status ${intent.status} is not a contract withdrawal status`
      );
    }
  });

  it("keeps every intent lifecycle inside the custody TTL window", () => {
    for (const intent of demoRepository.withdrawalIntents()) {
      const created = ms(intent.createdAt);
      const expires = ms(intent.expiresAt);
      assert.ok(expires > created, `${intent.id} expires before it is created`);
      assert.ok(
        expires - created <= MAX_INTENT_TTL_MS,
        `${intent.id} TTL ${expires - created}ms exceeds maximum_intent_ttl_seconds`
      );
      for (const event of intent.timeline) {
        // A rail-side confirmation may land after the signing window closes,
        // and an expiry record lands exactly at expiresAt; every other
        // lifecycle transition must precede the expiry the custody core
        // asserts fail-closed.
        if (event.action === "withdrawal.confirmed") continue;
        const boundary = event.action === "withdrawal.expired" ? 1 : 0;
        assert.ok(
          ms(event.occurredAt) < expires + boundary,
          `${intent.id} records ${event.action} at ${event.occurredAt} after expiresAt ${intent.expiresAt}`
        );
      }
      for (const step of intent.approvalSteps) {
        if (step.decidedAt === undefined) continue;
        assert.ok(
          ms(step.decidedAt) < expires,
          `${intent.id} records a ${step.role} decision at ${step.decidedAt} after expiresAt ${intent.expiresAt}`
        );
      }
    }
  });

  it("keeps non-terminal intents unexpired at the universe's latest instant", () => {
    const now = universeNow();
    for (const intent of demoRepository.withdrawalIntents()) {
      if ((SIGNING_WINDOW_CLOSED_STATUSES as readonly string[]).includes(intent.status)) continue;
      assert.ok(
        ms(intent.expiresAt) > now,
        `${intent.id} reads ${intent.status} but expired at ${intent.expiresAt} before the demo's latest instant`
      );
    }
  });

  it("resolves every cross-link to a fixture row", () => {
    const customers = new Map(demoRepository.customers().map((row) => [row.id, row]));
    const checks = new Map(demoRepository.chatChecks().map((row) => [row.id, row]));
    const intents = new Map(demoRepository.withdrawalIntents().map((row) => [row.id, row]));
    const kyc = new Map(demoRepository.kycCases().map((row) => [row.id, row]));
    const aml = new Map(demoRepository.amlCases().map((row) => [row.id, row]));
    const inv = new Map(demoRepository.investigationCases().map((row) => [row.id, row]));
    const fraud = new Map(demoRepository.fraudAlerts().map((row) => [row.id, row]));
    const approvals = new Map(demoRepository.approvals().map((row) => [row.id, row]));

    for (const [id, customer] of customers) {
      if (customer.kycCaseId !== undefined) {
        assert.ok(kyc.has(customer.kycCaseId), `${id} kycCaseId ${customer.kycCaseId} has no case row`);
      }
      assert.equal(
        customer.openAmlCases,
        [...aml.values()].filter((row) => row.customerId === id).length,
        `${id} openAmlCases does not match the aml case rows`
      );
    }
    for (const ticket of demoRepository.supportTickets()) {
      if (ticket.linkedCheckId !== undefined) {
        const check = checks.get(ticket.linkedCheckId);
        assert.ok(check, `${ticket.id} linkedCheckId ${ticket.linkedCheckId} has no check row`);
        assert.equal(
          check.senderCustomerId,
          ticket.customerId,
          `${ticket.id} is filed by ${ticket.customerId} but ${check.id} was sent by ${check.senderCustomerId}`
        );
      }
      if (ticket.linkedKycCaseId !== undefined) {
        assert.ok(kyc.has(ticket.linkedKycCaseId), `${ticket.id} linkedKycCaseId ${ticket.linkedKycCaseId} has no case row`);
      }
      if (ticket.linkedScreeningId !== undefined) {
        assert.ok(aml.has(ticket.linkedScreeningId), `${ticket.id} linkedScreeningId ${ticket.linkedScreeningId} has no case row`);
      }
    }
    for (const approval of demoRepository.approvals()) {
      const [kind, ref] = approval.resource.split(":");
      const table: Readonly<Record<string, ReadonlyMap<string, unknown>>> = {
        withdrawal: intents,
        "kyc-case": kyc,
        "kyb-case": kyc,
        "aml-case": aml,
        customer: customers
      };
      const collection = table[kind];
      if (collection === undefined) continue; // resources with no fixture collection are covered in the audit observations
      assert.ok(collection.has(ref), `${approval.id} resource ${approval.resource} has no row`);
    }
    for (const collection of [
      [...demoRepository.kycCases()],
      [...demoRepository.amlCases()],
      [...demoRepository.investigationCases()],
      [...demoRepository.fraudAlerts()]
    ]) {
      for (const row of collection) {
        if (row.linkedApprovalId !== undefined) {
          assert.ok(approvals.has(row.linkedApprovalId), `${row.id} linkedApprovalId ${row.linkedApprovalId} has no approval row`);
        }
      }
    }
    for (const kase of demoRepository.investigationCases()) {
      for (const ref of kase.relatedAlertIds) {
        assert.ok(fraud.has(ref), `${kase.id} relatedAlertId ${ref} has no alert row`);
      }
      for (const ref of kase.relatedCaseIds) {
        assert.ok(kyc.has(ref) || aml.has(ref) || inv.has(ref), `${kase.id} relatedCaseId ${ref} has no case row`);
      }
    }
    for (const alert of demoRepository.fraudAlerts()) {
      if (alert.linkedInvestigationId !== undefined) {
        assert.ok(inv.has(alert.linkedInvestigationId), `${alert.id} linkedInvestigationId ${alert.linkedInvestigationId} has no case row`);
      }
    }
  });

  it("pins awaiting_recipient_kyc checks to a genuinely gated recipient", () => {
    const customers = new Map(demoRepository.customers().map((row) => [row.id, row]));
    for (const check of demoRepository.chatChecks()) {
      if (check.status !== "awaiting_recipient_kyc") continue;
      const recipient = customers.get(check.recipientCustomerId ?? "");
      assert.ok(recipient, `${check.id} recipient ${check.recipientCustomerId} is not a customer`);
      assert.notEqual(
        recipient.kyc,
        "Verified",
        `${check.id} holds the claim for recipient KYC but ${recipient.id} is already Verified`
      );
    }
  });

  it("computes check fees on the canonical 30bps rail", () => {
    for (const check of demoRepository.chatChecks()) {
      const scale = ASSET_SCALES[check.asset];
      assert.ok(scale !== undefined, `${check.id} asset ${check.asset} has no contract scale`);
      const expected = (toUnits(check.amount, scale) * CHECK_FEE_BPS + 9_999n) / 10_000n;
      assert.equal(toUnits(check.fee, scale), expected, `${check.id} fee ${check.fee} is not 30bps of ${check.amount}`);
    }
  });

  it("reconciles queue totals with the enumerable fixture rows", () => {
    const kycCount = demoRepository.kycCases().length;
    const amlCount = demoRepository.amlCases().length;
    const openIntents = demoRepository
      .withdrawalIntents()
      .filter((intent) => !(EXECUTION_TERMINAL_INTENT_STATUSES as readonly string[]).includes(intent.status)).length;
    const totals = new Map(demoRepository.queues().map((row) => [row.queue, row.total]));
    assert.equal(totals.get("KYC review"), kycCount);
    assert.equal(totals.get("AML alerts"), amlCount);
    assert.equal(totals.get("High-risk withdrawals"), openIntents);
  });

  it("reconciles the open-cases metric with the case collections", () => {
    const metric = demoRepository.metrics().find((row) => row.label === "Открытые кейсы");
    assert.ok(metric, "open-cases metric missing");
    const cases =
      demoRepository.kycCases().length +
      demoRepository.amlCases().length +
      demoRepository.investigationCases().length +
      demoRepository.fraudAlerts().length;
    assert.equal(metric.value, String(cases));
  });
});
