import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { LedgerError, validateChart, validatePostingRules } from "../src/ledger.mjs";
import { SESSION_D_ARTIFACTS, createSessionDLedger } from "../src/session-d.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const chart = SESSION_D_ARTIFACTS.chart;
const postingRules = SESSION_D_ARTIFACTS.postingRules;
const clock = () => "2026-10-15T12:00:00.000Z";

const accounts = [
  {
    account_id: "10000000-0000-4000-8000-000000000001",
    definition_code: "PROVIDER_RECEIVABLE_ASSET",
    legal_entity_id: "solidchange-dev",
    asset_code: "TUSDT",
    owner_reference: "provider-demo",
    created_at: "2026-09-25T10:00:00.000Z"
  },
  {
    account_id: "20000000-0000-4000-8000-000000000002",
    definition_code: "CUSTOMER_SETTLED_LIABILITY",
    legal_entity_id: "solidchange-dev",
    asset_code: "TUSDT",
    owner_reference: "customer-demo",
    created_at: "2026-09-25T10:00:00.000Z"
  },
  {
    account_id: "30000000-0000-4000-8000-000000000003",
    definition_code: "CUSTOMER_HELD_LIABILITY",
    legal_entity_id: "solidchange-dev",
    asset_code: "TUSDT",
    owner_reference: "customer-demo",
    created_at: "2026-09-25T10:00:00.000Z"
  },
  {
    account_id: "40000000-0000-4000-8000-000000000004",
    definition_code: "TREASURY_ASSET",
    legal_entity_id: "solidchange-dev",
    asset_code: "TUSDT",
    owner_reference: "treasury-demo",
    created_at: "2026-09-25T10:00:00.000Z"
  },
  {
    account_id: "50000000-0000-4000-8000-000000000005",
    definition_code: "FEE_REVENUE",
    legal_entity_id: "solidchange-dev",
    asset_code: "TUSDT",
    owner_reference: null,
    created_at: "2026-09-25T10:00:00.000Z"
  },
  {
    account_id: "60000000-0000-4000-8000-000000000006",
    definition_code: "SUSPENSE_ASSET",
    legal_entity_id: "solidchange-dev",
    asset_code: "TUSDT",
    owner_reference: "break-review-demo",
    created_at: "2026-09-25T10:00:00.000Z"
  },
  {
    account_id: "70000000-0000-4000-8000-000000000007",
    definition_code: "SUSPENSE_LIABILITY",
    legal_entity_id: "solidchange-dev",
    asset_code: "TUSDT",
    owner_reference: "break-review-demo",
    created_at: "2026-09-25T10:00:00.000Z"
  },
  {
    account_id: "80000000-0000-4000-8000-000000000008",
    definition_code: "PROVIDER_PAYABLE_LIABILITY",
    legal_entity_id: "solidchange-dev",
    asset_code: "TUSDT",
    owner_reference: "provider-demo",
    created_at: "2026-09-25T10:00:00.000Z"
  },
  {
    account_id: "90000000-0000-4000-8000-000000000009",
    definition_code: "CUSTOMER_SETTLED_LIABILITY",
    legal_entity_id: "other-entity-dev",
    asset_code: "TUSDT",
    owner_reference: "other-customer-demo",
    created_at: "2026-09-25T10:00:00.000Z"
  }
];
const assets = [{ code: "TUSDT", scale: 6 }];

const TREASURY = "40000000-0000-4000-8000-000000000004";
const PROVIDER_PAYABLE = "80000000-0000-4000-8000-000000000008";
const PROVIDER_RECEIVABLE = "10000000-0000-4000-8000-000000000001";
const SETTLED = "20000000-0000-4000-8000-000000000002";
const HELD = "30000000-0000-4000-8000-000000000003";
const FEE = "50000000-0000-4000-8000-000000000005";
const SUSPENSE_ASSET = "60000000-0000-4000-8000-000000000006";
const SUSPENSE_LIABILITY = "70000000-0000-4000-8000-000000000007";
const OTHER_ENTITY_SETTLED = "90000000-0000-4000-8000-000000000009";

let sequence = 0;
function ids() {
  sequence += 1;
  const tag = String(sequence).padStart(12, "0");
  return {
    journal_id: `a0000000-0000-4000-8000-${tag}`,
    entry_one: `b0000000-0000-4000-8000-${tag}`,
    entry_two: `c0000000-0000-4000-8000-${tag}`,
    correlation_id: `d0000000-0000-4000-8000-${tag}`
  };
}

function command(overrides = {}) {
  const generated = ids();
  return {
    journal_id: generated.journal_id,
    journal_type: "SYNTHETIC_HOLD_CREATE",
    legal_entity_id: "solidchange-dev",
    idempotency_key: `session-d-demo-${String(sequence).padStart(6, "0")}`,
    correlation_id: generated.correlation_id,
    causation_id: null,
    effective_at: "2026-10-15T11:59:59.000Z",
    actor: { type: "SERVICE", id: "financial-core-test" },
    authorization_reference: "policy-decision-session-d-001",
    policy_version: "ledger-dev-policy-v1",
    posting_rule_version: "synthetic-hold-create-v1",
    source: {
      type: "synthetic-test",
      reference: `session-d-source-${String(sequence).padStart(6, "0")}`,
      evidence_digest: "b".repeat(64)
    },
    entries: [],
    ...overrides
  };
}

function createLedger() {
  sequence = 0;
  return createSessionDLedger({ accounts, assets, clock });
}

function fundCustomer(ledger, amount = "25.500000") {
  return ledger.post(
    command({
      journal_type: "SYNTHETIC_CUSTOMER_CREDIT",
      posting_rule_version: "synthetic-customer-credit-v1",
      entries: [
        {
          entry_id: `e1000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
          account_id: PROVIDER_RECEIVABLE,
          asset_code: "TUSDT",
          side: "DEBIT",
          amount
        },
        {
          entry_id: `e2000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
          account_id: SETTLED,
          asset_code: "TUSDT",
          side: "CREDIT",
          amount
        }
      ]
    })
  );
}

function holdCommand(reservation, amount = "10.000000") {
  const generated = ids();
  return command({
    journal_type: "SYNTHETIC_HOLD_CREATE",
    posting_rule_version: "synthetic-hold-create-v1",
    journal_id: generated.journal_id,
    correlation_id: generated.correlation_id,
    source: {
      type: "synthetic-test",
      reference: reservation,
      evidence_digest: "c".repeat(64)
    },
    entries: [
      {
        entry_id: generated.entry_one,
        account_id: SETTLED,
        asset_code: "TUSDT",
        side: "DEBIT",
        amount
      },
      {
        entry_id: generated.entry_two,
        account_id: HELD,
        asset_code: "TUSDT",
        side: "CREDIT",
        amount
      }
    ]
  });
}

function expectLedgerError(action, code) {
  assert.throws(action, (error) => error instanceof LedgerError && error.code === code);
}

test("session-d draft artifacts remain dev-only drafts over the foundation shape", () => {
  assert.equal(validateChart(chart), true);
  assert.equal(validatePostingRules(postingRules, chart), true);
  assert.equal(chart.chart_version, 1);
  assert.equal(chart.status, "draft");
  assert.equal(chart.holds_in_scope, false);
  assert.equal(chart.reversals_in_scope, false);
  assert.equal(chart.reconciliation_in_scope, false);
  assert.equal(chart.account_definitions.length, 9);
  assert.equal(postingRules.rules.length, 12);
  for (const rule of postingRules.rules) {
    assert.equal(rule.scope, "synthetic-test-only");
    assert.equal(postingRules.runtime_boundary, "dev-dry-run");
    assert.equal(postingRules.production_execution_enabled, false);
  }
});

test("hold creation reserves the settled liability under a named reference", () => {
  const ledger = createLedger();
  fundCustomer(ledger);
  const journal = ledger.createHold(holdCommand("hold-demo-001"));
  assert.equal(journal.journal_type, "SYNTHETIC_HOLD_CREATE");
  assert.equal(
    ledger.ledger.getProjection(SETTLED).normal_balance,
    "15.500000"
  );
  assert.equal(
    ledger.ledger.getProjection(HELD).normal_balance,
    "10.000000"
  );
  const [hold] = ledger.holds();
  assert.deepEqual(hold, {
    reservation_id: "hold-demo-001",
    create_journal_id: journal.journal_id,
    held_account_id: HELD,
    settled_account_id: SETTLED,
    asset_code: "TUSDT",
    amount: "10.000000",
    state: "open"
  });
});

test("hold lifecycle fails closed on duplicate, wrong shape and wrong actor", () => {
  const ledger = createLedger();
  fundCustomer(ledger);
  ledger.createHold(holdCommand("hold-demo-002"));
  expectLedgerError(
    () => ledger.createHold(holdCommand("hold-demo-002")),
    "SESSION_D_HOLD_STATE"
  );
  const threeLegs = holdCommand("hold-demo-003");
  threeLegs.entries.push({
    entry_id: "f0000000-0000-4000-8000-000000000099",
    account_id: TREASURY,
    asset_code: "TUSDT",
    side: "DEBIT",
    amount: "1.000000"
  });
  expectLedgerError(() => ledger.createHold(threeLegs), "SESSION_D_JOURNAL_SHAPE");
  const reversed = holdCommand("hold-demo-004");
  reversed.entries = [
    { ...reversed.entries[1], side: "DEBIT" },
    { ...reversed.entries[0], side: "CREDIT" }
  ];
  expectLedgerError(() => ledger.createHold(reversed), "SESSION_D_JOURNAL_SHAPE");
  const wrongActor = holdCommand("hold-demo-005");
  wrongActor.actor = { type: "MIGRATION_JOB", id: "migration-demo" };
  expectLedgerError(() => ledger.createHold(wrongActor), "LEDGER_POSTING_RULE_VIOLATION");
});

test("hold release mirrors the open hold exactly", () => {
  const ledger = createLedger();
  fundCustomer(ledger);
  const holdJournal = ledger.createHold(holdCommand("hold-demo-010", "10.000000"));
  const release = command({
    journal_type: "SYNTHETIC_HOLD_RELEASE",
    posting_rule_version: "synthetic-hold-release-v1",
    causation_id: holdJournal.journal_id,
    source: {
      type: "synthetic-test",
      reference: "hold-demo-010",
      evidence_digest: "d".repeat(64)
    },
    entries: [
      {
        entry_id: `e3000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
        account_id: HELD,
        asset_code: "TUSDT",
        side: "DEBIT",
        amount: "10.000000"
      },
      {
        entry_id: `e4000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
        account_id: SETTLED,
        asset_code: "TUSDT",
        side: "CREDIT",
        amount: "10.000000"
      }
    ]
  });
  ledger.releaseHold(release);
  assert.equal(ledger.ledger.getProjection(HELD).normal_balance, "0.000000");
  assert.equal(ledger.ledger.getProjection(SETTLED).normal_balance, "25.500000");
  assert.equal(ledger.holds()[0].state, "released");
  expectLedgerError(() => ledger.releaseHold({ ...release, journal_id: "a0000000-0000-4000-8000-999999999999", idempotency_key: "session-d-replay-release", entries: release.entries.map((e) => ({ ...e, entry_id: `f1000000-0000-4000-8000-${e.entry_id.slice(-12)}` })) }), "SESSION_D_HOLD_STATE");
});

test("hold release fails closed without the hold binding", () => {
  const ledger = createLedger();
  fundCustomer(ledger);
  const release = command({
    journal_type: "SYNTHETIC_HOLD_RELEASE",
    posting_rule_version: "synthetic-hold-release-v1",
    source: { type: "synthetic-test", reference: "hold-missing", evidence_digest: "d".repeat(64) },
    entries: [
      { entry_id: "e3000000-0000-4000-8000-000000000091", account_id: HELD, asset_code: "TUSDT", side: "DEBIT", amount: "10.000000" },
      { entry_id: "e4000000-0000-4000-8000-000000000092", account_id: SETTLED, asset_code: "TUSDT", side: "CREDIT", amount: "10.000000" }
    ]
  });
  expectLedgerError(() => ledger.releaseHold(release), "SESSION_D_HOLD_STATE");
});

test("reversal mirrors the accepted journal and net-proves it once", () => {
  const ledger = createLedger();
  const position = ledger.post(
    command({
      journal_type: "SYNTHETIC_PROVIDER_POSITION",
      posting_rule_version: "synthetic-provider-position-v1",
      entries: [
        { entry_id: "e1000000-0000-4000-8000-000000000081", account_id: TREASURY, asset_code: "TUSDT", side: "DEBIT", amount: "4.250000" },
        { entry_id: "e2000000-0000-4000-8000-000000000082", account_id: PROVIDER_PAYABLE, asset_code: "TUSDT", side: "CREDIT", amount: "4.250000" }
      ]
    })
  );
  const reversal = command({
    journal_type: "SYNTHETIC_PROVIDER_POSITION_REVERSAL",
    posting_rule_version: "synthetic-provider-position-reversal-v1",
    causation_id: position.journal_id,
    actor: { type: "OPERATOR", id: "operator-demo" },
    source: { type: "journal_reversal", reference: position.journal_id, evidence_digest: "e".repeat(64) },
    entries: [
      { entry_id: "e3000000-0000-4000-8000-000000000083", account_id: TREASURY, asset_code: "TUSDT", side: "CREDIT", amount: "4.250000" },
      { entry_id: "e4000000-0000-4000-8000-000000000084", account_id: PROVIDER_PAYABLE, asset_code: "TUSDT", side: "DEBIT", amount: "4.250000" }
    ]
  });
  ledger.reverseJournal(reversal);
  assert.equal(ledger.ledger.getProjection(TREASURY).normal_balance, "0.000000");
  assert.equal(ledger.ledger.getProjection(PROVIDER_PAYABLE).normal_balance, "0.000000");
  expectLedgerError(
    () => ledger.reverseJournal({ ...reversal, journal_id: "a0000000-0000-4000-8000-000000000095", idempotency_key: "session-d-second-reversal", entries: reversal.entries.map((e, i) => ({ ...e, entry_id: `f5000000-0000-4000-8000-00000000009${i}` })) }),
    "SESSION_D_REVERSAL_STATE"
  );
});

test("reversal fails closed on missing, mismatched or self-reversing links", () => {
  const ledger = createLedger();
  const base = command({
    journal_type: "SYNTHETIC_PROVIDER_POSITION_REVERSAL",
    posting_rule_version: "synthetic-provider-position-reversal-v1",
    actor: { type: "OPERATOR", id: "operator-demo" },
    source: { type: "journal_reversal", reference: "a0000000-0000-4000-8000-000000000099", evidence_digest: "e".repeat(64) },
    entries: [
      { entry_id: "e3000000-0000-4000-8000-000000000085", account_id: TREASURY, asset_code: "TUSDT", side: "CREDIT", amount: "4.250000" },
      { entry_id: "e4000000-0000-4000-8000-000000000086", account_id: PROVIDER_PAYABLE, asset_code: "TUSDT", side: "DEBIT", amount: "4.250000" }
    ]
  });
  expectLedgerError(() => ledger.reverseJournal(base), "SESSION_D_BINDING");
  const position = ledger.post(
    command({
      journal_type: "SYNTHETIC_PROVIDER_POSITION",
      posting_rule_version: "synthetic-provider-position-v1",
      entries: [
        { entry_id: "e1000000-0000-4000-8000-000000000087", account_id: TREASURY, asset_code: "TUSDT", side: "DEBIT", amount: "4.250000" },
        { entry_id: "e2000000-0000-4000-8000-000000000088", account_id: PROVIDER_PAYABLE, asset_code: "TUSDT", side: "CREDIT", amount: "4.250000" }
      ]
    })
  );
  const wrongSource = { ...base, causation_id: position.journal_id, source: { type: "synthetic-test", reference: position.journal_id, evidence_digest: "e".repeat(64) } };
  expectLedgerError(() => ledger.reverseJournal(wrongSource), "SESSION_D_BINDING");
  const wrongAmount = {
    ...base,
    causation_id: position.journal_id,
    source: { type: "journal_reversal", reference: position.journal_id, evidence_digest: "e".repeat(64) },
    entries: base.entries.map((e, i) => ({ ...e, entry_id: `f6000000-0000-4000-8000-00000000009${i}`, amount: "9.000000" }))
  };
  expectLedgerError(() => ledger.reverseJournal(wrongAmount), "SESSION_D_JOURNAL_SHAPE");
});

test("fee and spread rules post through the draft registry", () => {
  const ledger = createLedger();
  fundCustomer(ledger, "25.500000");
  ledger.post(
    command({
      journal_type: "SYNTHETIC_FEE_CHARGE",
      posting_rule_version: "synthetic-fee-charge-v1",
      entries: [
        { entry_id: "e1000000-0000-4000-8000-000000000071", account_id: SETTLED, asset_code: "TUSDT", side: "DEBIT", amount: "1.500000" },
        { entry_id: "e2000000-0000-4000-8000-000000000072", account_id: FEE, asset_code: "TUSDT", side: "CREDIT", amount: "1.500000" }
      ]
    })
  );
  ledger.post(
    command({
      journal_type: "SYNTHETIC_SPREAD_RECOGNITION",
      posting_rule_version: "synthetic-spread-recognition-v1",
      entries: [
        { entry_id: "e3000000-0000-4000-8000-000000000073", account_id: TREASURY, asset_code: "TUSDT", side: "DEBIT", amount: "0.750000" },
        { entry_id: "e4000000-0000-4000-8000-000000000074", account_id: FEE, asset_code: "TUSDT", side: "CREDIT", amount: "0.750000" }
      ]
    })
  );
  assert.equal(ledger.ledger.getProjection(FEE).normal_balance, "2.250000");
  assert.equal(ledger.ledger.getProjection(SETTLED).normal_balance, "24.000000");
});

test("suspense parks a break once and clears into resolution", () => {
  const ledger = createLedger();
  fundCustomer(ledger);
  const park = command({
    journal_type: "SYNTHETIC_SUSPENSE_PARK_IN",
    posting_rule_version: "synthetic-suspense-park-in-v1",
    source: { type: "reconciliation_break", reference: "break-demo-001", evidence_digest: "f".repeat(64) },
    entries: [
      { entry_id: "e1000000-0000-4000-8000-000000000061", account_id: SUSPENSE_ASSET, asset_code: "TUSDT", side: "DEBIT", amount: "3.000000" },
      { entry_id: "e2000000-0000-4000-8000-000000000062", account_id: SETTLED, asset_code: "TUSDT", side: "CREDIT", amount: "3.000000" }
    ]
  });
  const parkJournal = ledger.parkSuspense(park);
  assert.equal(ledger.breaks()[0].state, "open");
  assert.equal(ledger.breaks()[0].direction, "IN");
  const clear = command({
    journal_type: "SYNTHETIC_SUSPENSE_CLEAR_IN",
    posting_rule_version: "synthetic-suspense-clear-in-v1",
    causation_id: parkJournal.journal_id,
    entries: [
      { entry_id: "e3000000-0000-4000-8000-000000000063", account_id: TREASURY, asset_code: "TUSDT", side: "DEBIT", amount: "3.000000" },
      { entry_id: "e4000000-0000-4000-8000-000000000064", account_id: SUSPENSE_ASSET, asset_code: "TUSDT", side: "CREDIT", amount: "3.000000" }
    ]
  });
  ledger.clearSuspense(clear);
  assert.equal(ledger.breaks()[0].state, "resolved");
  assert.equal(ledger.ledger.getProjection(SUSPENSE_ASSET).normal_balance, "0.000000");
  assert.equal(ledger.ledger.getProjection(TREASURY).normal_balance, "3.000000");
});

test("suspense out-bound clears through the mirrored resolution journal", () => {
  const ledger = createLedger();
  fundCustomer(ledger);
  const park = command({
    journal_type: "SYNTHETIC_SUSPENSE_PARK_OUT",
    posting_rule_version: "synthetic-suspense-park-out-v1",
    source: { type: "reconciliation_break", reference: "break-demo-002", evidence_digest: "f".repeat(64) },
    entries: [
      { entry_id: "e1000000-0000-4000-8000-000000000051", account_id: SETTLED, asset_code: "TUSDT", side: "DEBIT", amount: "2.000000" },
      { entry_id: "e2000000-0000-4000-8000-000000000052", account_id: SUSPENSE_LIABILITY, asset_code: "TUSDT", side: "CREDIT", amount: "2.000000" }
    ]
  });
  const parkJournal = ledger.parkSuspense(park);
  const clear = command({
    journal_type: "SYNTHETIC_SUSPENSE_CLEAR_OUT",
    posting_rule_version: "synthetic-suspense-clear-out-v1",
    causation_id: parkJournal.journal_id,
    entries: [
      { entry_id: "e3000000-0000-4000-8000-000000000053", account_id: SUSPENSE_LIABILITY, asset_code: "TUSDT", side: "DEBIT", amount: "2.000000" },
      { entry_id: "e4000000-0000-4000-8000-000000000054", account_id: TREASURY, asset_code: "TUSDT", side: "CREDIT", amount: "2.000000" }
    ]
  });
  ledger.clearSuspense(clear);
  assert.equal(ledger.ledger.getProjection(SUSPENSE_LIABILITY).normal_balance, "0.000000");
  assert.equal(ledger.ledger.getProjection(TREASURY).normal_balance, "-2.000000");
  const wrongType = { ...clear, journal_type: "SYNTHETIC_SUSPENSE_CLEAR_IN", posting_rule_version: "synthetic-suspense-clear-in-v1", causation_id: null };
  expectLedgerError(() => ledger.clearSuspense(wrongType), "SESSION_D_BINDING");
});

test("reconcile reports matched balances and signed break deltas", () => {
  const ledger = createLedger();
  fundCustomer(ledger, "25.500000");
  const matched = ledger.reconcileAccount({
    account_id: SETTLED,
    expected_normal_balance: "25.500000"
  });
  assert.deepEqual(matched, {
    account_id: SETTLED,
    asset_code: "TUSDT",
    matched: true,
    actual_normal_balance: "25.500000",
    expected_normal_balance: "25.500000",
    difference: "0.000000"
  });
  const broke = ledger.reconcileAccount({
    account_id: SETTLED,
    expected_normal_balance: "30.000000"
  });
  assert.equal(broke.matched, false);
  assert.equal(broke.difference, "-4.500000");
});

test("foundation boundary stays enforced under the draft arms", () => {
  const ledger = createLedger();
  fundCustomer(ledger);
  const cross = holdCommand("hold-cross");
  cross.entries[0].account_id = OTHER_ENTITY_SETTLED;
  expectLedgerError(() => ledger.createHold(cross), "LEDGER_BOUNDARY_VIOLATION");
  const unbalanced = command({
    journal_type: "SYNTHETIC_FEE_CHARGE",
    posting_rule_version: "synthetic-fee-charge-v1",
    entries: [
      { entry_id: "e1000000-0000-4000-8000-000000000041", account_id: SETTLED, asset_code: "TUSDT", side: "DEBIT", amount: "1.500000" },
      { entry_id: "e2000000-0000-4000-8000-000000000042", account_id: FEE, asset_code: "TUSDT", side: "CREDIT", amount: "9.000000" }
    ]
  });
  expectLedgerError(() => ledger.post(unbalanced), "LEDGER_UNBALANCED_JOURNAL");
  const badPattern = command({
    journal_type: "SYNTHETIC_FEE_CHARGE",
    posting_rule_version: "synthetic-fee-charge-v1",
    entries: [
      { entry_id: "e3000000-0000-4000-8000-000000000043", account_id: SETTLED, asset_code: "TUSDT", side: "DEBIT", amount: "1.500000" },
      { entry_id: "e4000000-0000-4000-8000-000000000044", account_id: TREASURY, asset_code: "TUSDT", side: "CREDIT", amount: "1.500000" }
    ]
  });
  expectLedgerError(() => ledger.post(badPattern), "LEDGER_POSTING_RULE_VIOLATION");
});
