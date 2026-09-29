import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { formatAmount, parseAmount } from "../src/amount.mjs";
import {
  LedgerError,
  createInMemoryLedger,
  validateChart,
  validatePostingRules
} from "../src/ledger.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const chart = JSON.parse(readFileSync(join(root, "chart-of-accounts.json"), "utf8"));
const postingRules = JSON.parse(readFileSync(join(root, "posting-rules.json"), "utf8"));
const commandDigestVector = JSON.parse(
  readFileSync(join(root, "tests", "command-digest-vector.json"), "utf8")
);
const vectorAssetCode = commandDigestVector.asset.code;
const accounts = [
  {
    account_id: "10000000-0000-4000-8000-000000000001",
    definition_code: "TREASURY_ASSET",
    legal_entity_id: "solidchange-dev",
    asset_code: vectorAssetCode,
    owner_reference: "treasury-location-demo",
    created_at: "2026-09-25T10:00:00.000Z"
  },
  {
    account_id: "20000000-0000-4000-8000-000000000002",
    definition_code: "PROVIDER_PAYABLE_LIABILITY",
    legal_entity_id: "solidchange-dev",
    asset_code: vectorAssetCode,
    owner_reference: "provider-demo",
    created_at: "2026-09-25T10:00:00.000Z"
  },
  {
    account_id: "30000000-0000-4000-8000-000000000003",
    definition_code: "CUSTOMER_SETTLED_LIABILITY",
    legal_entity_id: "solidchange-dev",
    asset_code: vectorAssetCode,
    owner_reference: "customer-demo",
    created_at: "2026-09-25T10:00:00.000Z"
  },
  {
    account_id: "40000000-0000-4000-8000-000000000004",
    definition_code: "TREASURY_ASSET",
    legal_entity_id: "other-entity-dev",
    asset_code: vectorAssetCode,
    owner_reference: "other-treasury-demo",
    created_at: "2026-09-25T10:00:00.000Z"
  },
  {
    account_id: "50000000-0000-4000-8000-000000000005",
    definition_code: "TREASURY_ASSET",
    legal_entity_id: "solidchange-dev",
    asset_code: "TBTC",
    owner_reference: "btc-treasury-demo",
    created_at: "2026-09-25T10:00:00.000Z"
  },
  {
    account_id: "60000000-0000-4000-8000-000000000006",
    definition_code: "PROVIDER_PAYABLE_LIABILITY",
    legal_entity_id: "solidchange-dev",
    asset_code: "TBTC",
    owner_reference: "btc-provider-demo",
    created_at: "2026-09-25T10:00:00.000Z"
  }
];
const assets = [
  { code: vectorAssetCode, scale: commandDigestVector.asset.scale },
  { code: "TBTC", scale: 8 }
];

function createLedger() {
  return createInMemoryLedger({
    accounts,
    assets,
    chart,
    postingRules,
    clock: () => "2026-09-25T10:15:01.000Z"
  });
}

function command(overrides = {}) {
  return {
    ...structuredClone(commandDigestVector.command),
    ...overrides
  };
}

function expectLedgerError(action, code) {
  assert.throws(action, (error) => error instanceof LedgerError && error.code === code);
}

test("chart remains draft, dev-only and complete", () => {
  assert.equal(validateChart(chart), true);
  assert.equal(validatePostingRules(postingRules, chart), true);
  assert.equal(chart.account_definitions.length, 8);
  expectLedgerError(
    () => validateChart({ ...chart, production_override: true }),
    "LEDGER_VALIDATION_FAILED"
  );
});

test("decimal conversion is exact and scale-aware", () => {
  assert.equal(parseAmount("25.500000", 6), 25_500_000n);
  assert.equal(formatAmount(25_500_000n, 6), "25.500000");
  assert.equal(formatAmount(-125n, 2), "-1.25");
  assert.equal(parseAmount(`${"9".repeat(76)}.00`, 2), BigInt(`${"9".repeat(76)}00`));
  assert.throws(() => parseAmount(`${"9".repeat(77)}.00`, 2), RangeError);
  assert.throws(() => parseAmount(`${"9".repeat(78)}.00`, 2), RangeError);
  assert.throws(() => parseAmount("0.000001", 5), RangeError);
  assert.throws(() => parseAmount("0", 6), RangeError);
  assert.throws(() => parseAmount("1e6", 6), TypeError);
});

test("posting accepts a balanced journal and derives projections", () => {
  const ledger = createLedger();
  const accepted = ledger.post(command());

  assert.equal(
    accepted.command_digest,
    commandDigestVector.expected_digest
  );
  assert.equal(accepted.accepted_at, "2026-09-25T10:15:01.000Z");
  assert.deepEqual(ledger.getProjection(accounts[0].account_id), {
    account_id: accounts[0].account_id,
    asset_code: vectorAssetCode,
    as_of_journal_count: 1,
    debit_total: "25.500000",
    credit_total: "0.000000",
    normal_balance: "25.500000"
  });
  assert.deepEqual(ledger.getProjection(accounts[1].account_id), {
    account_id: accounts[1].account_id,
    asset_code: vectorAssetCode,
    as_of_journal_count: 1,
    debit_total: "0.000000",
    credit_total: "25.500000",
    normal_balance: "25.500000"
  });
});

test("trial balance and projection rebuilds are deterministic", () => {
  const ledger = createLedger();
  ledger.post(
    command({
      entries: [
        ...command().entries,
        {
          entry_id: "b0000000-0000-4000-8000-00000000000b",
          account_id: "50000000-0000-4000-8000-000000000005",
          asset_code: "TBTC",
          side: "DEBIT",
          amount: "0.01000000"
        },
        {
          entry_id: "c0000000-0000-4000-8000-00000000000c",
          account_id: "60000000-0000-4000-8000-000000000006",
          asset_code: "TBTC",
          side: "CREDIT",
          amount: "0.01000000"
        }
      ]
    })
  );

  assert.deepEqual(ledger.getTrialBalance(), [
    {
      legal_entity_id: "solidchange-dev",
      asset_code: "TBTC",
      journal_count: 1,
      entry_count: 2,
      debit_total: "0.01000000",
      credit_total: "0.01000000",
      difference: "0.00000000",
      balanced: true
    },
    {
      legal_entity_id: "solidchange-dev",
      asset_code: "TUSDT",
      journal_count: 1,
      entry_count: 2,
      debit_total: "25.500000",
      credit_total: "25.500000",
      difference: "0.000000",
      balanced: true
    }
  ]);

  const first = ledger.rebuildProjectionSnapshot();
  const second = ledger.rebuildProjectionSnapshot();
  assert.deepEqual(second, first);
  assert.match(first.snapshot_digest, /^[0-9a-f]{64}$/);
  assert.equal(first.as_of_journal_count, 1);
  assert.deepEqual(
    first.projections.map((projection) => projection.account_id),
    accounts.map((account) => account.account_id).sort()
  );
});

test("returned journals cannot mutate accepted ledger state", () => {
  const ledger = createLedger();
  const accepted = ledger.post(command());
  accepted.entries[0].amount = "999.000000";

  assert.equal(ledger.listJournals()[0].entries[0].amount, "25.500000");
  assert.equal(ledger.getProjection(accounts[0].account_id).normal_balance, "25.500000");
});

test("exact idempotent replay returns the original accepted journal", () => {
  const ledger = createLedger();
  const first = ledger.post(command());
  const replay = ledger.post(command());

  assert.deepEqual(replay, first);
  assert.equal(ledger.listJournals().length, 1);
});

test("idempotency key reuse with changed content fails closed", () => {
  const ledger = createLedger();
  ledger.post(command());
  const changed = command({
    source: {
      type: "synthetic-test",
      reference: "provider-position-source-002",
      evidence_digest: "b".repeat(64)
    }
  });

  expectLedgerError(() => ledger.post(changed), "LEDGER_IDEMPOTENCY_CONFLICT");
});

test("duplicate journal ID under another idempotency key is rejected", () => {
  const ledger = createLedger();
  ledger.post(command());
  const duplicate = command({ idempotency_key: "provider-position-demo-002" });

  expectLedgerError(() => ledger.post(duplicate), "LEDGER_DUPLICATE_JOURNAL");
});

test("unbalanced postings are rejected per asset", () => {
  const ledger = createLedger();
  const unbalanced = command({
    entries: [
      command().entries[0],
      { ...command().entries[1], amount: "25.499999" }
    ]
  });

  expectLedgerError(() => ledger.post(unbalanced), "LEDGER_UNBALANCED_JOURNAL");
});

test("a journal may contain multiple assets only when each asset balances", () => {
  const ledger = createLedger();
  const multiAsset = command({
    entries: [
      ...command().entries,
      {
        entry_id: "b0000000-0000-4000-8000-00000000000b",
        account_id: "50000000-0000-4000-8000-000000000005",
        asset_code: "TBTC",
        side: "DEBIT",
        amount: "0.01000000"
      },
      {
        entry_id: "c0000000-0000-4000-8000-00000000000c",
        account_id: "60000000-0000-4000-8000-000000000006",
        asset_code: "TBTC",
        side: "CREDIT",
        amount: "0.01000000"
      }
    ]
  });

  assert.equal(ledger.post(multiAsset).entries.length, 4);
});

test("cross-entity entries are rejected", () => {
  const ledger = createLedger();
  const crossEntity = command({
    entries: [
      command().entries[0],
      {
        ...command().entries[1],
        account_id: "40000000-0000-4000-8000-000000000004"
      }
    ]
  });

  expectLedgerError(() => ledger.post(crossEntity), "LEDGER_BOUNDARY_VIOLATION");
});

test("account asset and amount scale mismatches are rejected", () => {
  const ledger = createLedger();
  const wrongAsset = command({
    entries: [
      command().entries[0],
      { ...command().entries[1], asset_code: "TBTC" }
    ]
  });
  expectLedgerError(() => ledger.post(wrongAsset), "LEDGER_BOUNDARY_VIOLATION");

  const excessiveScale = command({
    entries: command().entries.map((entry) => ({ ...entry, amount: "1.0000001" }))
  });
  expectLedgerError(() => ledger.post(excessiveScale), "LEDGER_AMOUNT_INVALID");
});

test("unsupported actors and hidden command fields are rejected", () => {
  const ledger = createLedger();
  expectLedgerError(() => ledger.post(null), "LEDGER_VALIDATION_FAILED");
  expectLedgerError(
    () => ledger.post(command({ actor: { type: "AI_AGENT", id: "autonomous-agent" } })),
    "LEDGER_VALIDATION_FAILED"
  );
  expectLedgerError(
    () => ledger.post({ ...command(), direct_balance: "25.500000" }),
    "LEDGER_VALIDATION_FAILED"
  );
  expectLedgerError(
    () => ledger.post({ ...command(), accepted_at: "2026-09-25T10:15:01.000Z" }),
    "LEDGER_VALIDATION_FAILED"
  );
  expectLedgerError(
    () => ledger.post(command({ idempotency_key: "invalid\nkey-value" })),
    "LEDGER_VALIDATION_FAILED"
  );
  expectLedgerError(
    () => ledger.post(command({ effective_at: "0" })),
    "LEDGER_VALIDATION_FAILED"
  );
  expectLedgerError(
    () => ledger.post(command({ effective_at: "2026-02-31T10:00:00Z" })),
    "LEDGER_VALIDATION_FAILED"
  );
  expectLedgerError(
    () => ledger.post(command({ effective_at: "2026-09-25T10:00:00+14:01" })),
    "LEDGER_VALIDATION_FAILED"
  );
  expectLedgerError(
    () => ledger.post(command({ posting_rule_version: "unregistered-rule-v1" })),
    "LEDGER_POSTING_RULE_NOT_FOUND"
  );
  expectLedgerError(
    () =>
      ledger.post(
        command({
          actor: {
            type: "OPERATOR",
            id: "operator-finance-reviewer"
          }
        })
      ),
    "LEDGER_POSTING_RULE_VIOLATION"
  );
  expectLedgerError(
    () =>
      ledger.post(
        command({
          entries: [
            command().entries[0],
            {
              ...command().entries[1],
              account_id: "30000000-0000-4000-8000-000000000003"
            }
          ]
        })
      ),
    "LEDGER_POSTING_RULE_VIOLATION"
  );
  expectLedgerError(
    () => ledger.post(command({ entries: Array(1001).fill(command().entries[0]) })),
    "LEDGER_VALIDATION_FAILED"
  );
});
