import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { LedgerError, createInMemoryLedger } from "../src/ledger.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ledgerSource = readFileSync(join(root, "src", "ledger.mjs"), "utf8");
const chart = JSON.parse(readFileSync(join(root, "chart-of-accounts.json"), "utf8"));
const postingRules = JSON.parse(readFileSync(join(root, "posting-rules.json"), "utf8"));
const commandDigestVector = JSON.parse(
  readFileSync(join(root, "tests", "command-digest-vector.json"), "utf8")
);

const assetCode = commandDigestVector.asset.code;
const TREASURY_ACCOUNT = {
  account_id: "10000000-0000-4000-8000-000000000001",
  definition_code: "TREASURY_ASSET",
  legal_entity_id: "solidchange-dev",
  asset_code: assetCode,
  owner_reference: "treasury-location-demo",
  created_at: "2026-09-25T10:00:00.000Z"
};
const PAYABLE_ACCOUNT = {
  account_id: "20000000-0000-4000-8000-000000000002",
  definition_code: "PROVIDER_PAYABLE_LIABILITY",
  legal_entity_id: "solidchange-dev",
  asset_code: assetCode,
  owner_reference: "provider-demo",
  created_at: "2026-09-25T10:00:00.000Z"
};
const CUSTOMER_ACCOUNT = {
  account_id: "30000000-0000-4000-8000-000000000003",
  definition_code: "CUSTOMER_SETTLED_LIABILITY",
  legal_entity_id: "solidchange-dev",
  asset_code: assetCode,
  owner_reference: "customer-demo",
  created_at: "2026-09-25T10:00:00.000Z"
};
const OTHER_ENTITY_TREASURY = {
  account_id: "40000000-0000-4000-8000-000000000004",
  definition_code: "TREASURY_ASSET",
  legal_entity_id: "other-entity-dev",
  asset_code: assetCode,
  owner_reference: "other-treasury-demo",
  created_at: "2026-09-25T10:00:00.000Z"
};
const TREASURY_BTC_ACCOUNT = {
  account_id: "50000000-0000-4000-8000-000000000005",
  definition_code: "TREASURY_ASSET",
  legal_entity_id: "solidchange-dev",
  asset_code: "TBTC",
  owner_reference: "btc-treasury-demo",
  created_at: "2026-09-25T10:00:00.000Z"
};
const SUSPENSE_ACCOUNT = {
  account_id: "70000000-0000-4000-8000-000000000007",
  definition_code: "SUSPENSE_LIABILITY",
  legal_entity_id: "solidchange-dev",
  asset_code: assetCode,
  owner_reference: "suspense-demo",
  created_at: "2026-09-25T10:00:00.000Z"
};
const PAYABLE_B_ACCOUNT = {
  account_id: "80000000-0000-4000-8000-000000000008",
  definition_code: "PROVIDER_PAYABLE_LIABILITY",
  legal_entity_id: "solidchange-dev",
  asset_code: assetCode,
  owner_reference: "provider-demo-2",
  created_at: "2026-09-25T10:00:00.000Z"
};

const accounts = [
  TREASURY_ACCOUNT,
  PAYABLE_ACCOUNT,
  CUSTOMER_ACCOUNT,
  OTHER_ENTITY_TREASURY,
  TREASURY_BTC_ACCOUNT,
  SUSPENSE_ACCOUNT,
  PAYABLE_B_ACCOUNT
];
const assets = [
  { code: assetCode, scale: commandDigestVector.asset.scale },
  { code: "TBTC", scale: 8 }
];

function createLedger(overrides = {}) {
  return createInMemoryLedger({
    accounts: overrides.accounts ?? accounts,
    assets: overrides.assets ?? assets,
    chart: overrides.chart ?? chart,
    clock: overrides.clock ?? (() => "2026-09-25T10:15:01.000Z"),
    postingRules: overrides.postingRules ?? postingRules
  });
}

function command(overrides = {}) {
  const base = structuredClone(commandDigestVector.command);
  const merged = { ...base, ...overrides };
  merged.actor = { ...base.actor, ...(overrides.actor ?? {}) };
  merged.source = { ...base.source, ...(overrides.source ?? {}) };
  merged.entries = (overrides.entries ?? base.entries).map((entry) => ({
    ...entry
  }));
  return merged;
}

function expectLedgerError(code, action) {
  assert.throws(
    action,
    (error) => error instanceof LedgerError && error.code === code,
    `Expected LedgerError ${code}`
  );
}

test("synthetic-test-only scope gates a scoped rule before and at posting", () => {
  // Registry admission: a rule outside the synthetic boundary is rejected
  // before it can ever be referenced by a posting.
  expectLedgerError("LEDGER_POSTING_RULES_INVALID", () =>
    createLedger({
      postingRules: {
        ...postingRules,
        rules: [{ ...postingRules.rules[0], scope: "production" }]
      }
    })
  );
  // The command shape cannot smuggle a context or scope override.
  expectLedgerError("LEDGER_VALIDATION_FAILED", () =>
    createLedger().post(command({ scope: "synthetic-test-only" }))
  );
  expectLedgerError("LEDGER_VALIDATION_FAILED", () =>
    createLedger().post(command({ context: "production" }))
  );
  // Defense in depth: the posting path itself re-verifies the resolved
  // rule's scope instead of trusting registry admission alone. Today no
  // non-synthetic rule can reach the registry, so this guard fails closed
  // if admission is ever widened.
  assert.match(
    ledgerSource,
    /postingRule\.scope !== "synthetic-test-only"/
  );
  // Under the registered scope the canonical command is accepted.
  const accepted = createLedger().post(command());
  assert.equal(
    accepted.command_digest,
    commandDigestVector.expected_digest
  );
});

test("allowed_actor_types is enforced at posting time", () => {
  const ledger = createLedger();
  expectLedgerError("LEDGER_POSTING_RULE_VIOLATION", () =>
    ledger.post(command({ actor: { type: "OPERATOR" } }))
  );
  expectLedgerError("LEDGER_POSTING_RULE_VIOLATION", () =>
    ledger.post(command({ actor: { type: "MIGRATION_JOB" } }))
  );
  expectLedgerError("LEDGER_VALIDATION_FAILED", () =>
    ledger.post(command({ actor: { type: "EXTERNAL_SYSTEM" } }))
  );
  const accepted = ledger.post(command());
  assert.equal(accepted.actor.type, "SERVICE");
});

test("entry_pattern pins account definition and side for every posting line", () => {
  const ledger = createLedger();
  const [debit, credit] = commandDigestVector.command.entries;
  // A line on an account outside the declared pattern fails.
  expectLedgerError("LEDGER_POSTING_RULE_VIOLATION", () =>
    ledger.post(
      command({
        entries: [
          { ...debit, account_id: SUSPENSE_ACCOUNT.account_id },
          credit
        ]
      })
    )
  );
  // Same definition twice is not the pattern: both legs cannot hit
  // PROVIDER_PAYABLE_LIABILITY.
  expectLedgerError("LEDGER_POSTING_RULE_VIOLATION", () =>
    ledger.post(
      command({
        entries: [
          { ...debit, account_id: PAYABLE_B_ACCOUNT.account_id },
          credit
        ]
      })
    )
  );
  // Balanced legs beyond the declared pattern are rejected.
  expectLedgerError("LEDGER_POSTING_RULE_VIOLATION", () =>
    ledger.post(
      command({
        entries: [
          debit,
          credit,
          {
            entry_id: "b0000000-0000-4000-8000-00000000000b",
            account_id: CUSTOMER_ACCOUNT.account_id,
            asset_code: assetCode,
            side: "DEBIT",
            amount: "1.000000"
          },
          {
            entry_id: "c0000000-0000-4000-8000-00000000000c",
            account_id: PAYABLE_B_ACCOUNT.account_id,
            asset_code: assetCode,
            side: "CREDIT",
            amount: "1.000000"
          }
        ]
      })
    )
  );
  // Swapping the legs across accounts is a different multiset.
  expectLedgerError("LEDGER_POSTING_RULE_VIOLATION", () =>
    ledger.post(
      command({
        entries: [
          { ...debit, account_id: PAYABLE_ACCOUNT.account_id },
          { ...credit, account_id: TREASURY_ACCOUNT.account_id }
        ]
      })
    )
  );
});

test("posting lines violating declared normal sides fail via the pattern", () => {
  const ledger = createLedger();
  const [debit, credit] = commandDigestVector.command.entries;
  // TREASURY_ASSET has normal_side DEBIT: forcing it to CREDIT leaves the
  // line outside the registered pattern.
  expectLedgerError("LEDGER_POSTING_RULE_VIOLATION", () =>
    ledger.post(
      command({
        entries: [
          { ...debit, side: "CREDIT" },
          { ...credit, side: "DEBIT" }
        ]
      })
    )
  );
  // normal_side itself is a projection convention, not a posting
  // constraint: a rule may legitimately declare contra-normal legs (a
  // liability settles by debiting it), matching the PostgreSQL layer which
  // compares the pattern, not normal_side.
  const contraRules = {
    ...postingRules,
    rules: [
      {
        ...postingRules.rules[0],
        posting_rule_version: "synthetic-contra-v1",
        entry_pattern: [
          { definition_code: "TREASURY_ASSET", side: "CREDIT" },
          { definition_code: "PROVIDER_PAYABLE_LIABILITY", side: "DEBIT" }
        ]
      }
    ]
  };
  const contraLedger = createLedger({ postingRules: contraRules });
  const contraPosting = contraLedger.post(
    command({
      journal_id: "d0000000-0000-4000-8000-00000000000d",
      posting_rule_version: "synthetic-contra-v1",
      idempotency_key: "provider-position-demo-999",
      entries: [
        { ...debit, side: "CREDIT" },
        { ...credit, side: "DEBIT" }
      ]
    })
  );
  assert.equal(contraPosting.entries.length, 2);
});

test("owner_scope-required accounts cannot reach posting without owner_reference", () => {
  const ownerlessPayable = {
    ...PAYABLE_ACCOUNT,
    account_id: "60000000-0000-4000-8000-000000000006",
    owner_reference: null
  };
  expectLedgerError("LEDGER_CONFIGURATION_INVALID", () =>
    createLedger({
      accounts: [
        TREASURY_ACCOUNT,
        ownerlessPayable,
        CUSTOMER_ACCOUNT,
        OTHER_ENTITY_TREASURY,
        TREASURY_BTC_ACCOUNT,
        SUSPENSE_ACCOUNT,
        PAYABLE_B_ACCOUNT
      ]
    })
  );
  // Optional-scope definitions may post from ownerless accounts.
  const ownerlessTreasury = {
    ...TREASURY_ACCOUNT,
    account_id: "90000000-0000-4000-8000-000000000009",
    owner_reference: null
  };
  const ledger = createLedger({
    accounts: [
      ownerlessTreasury,
      PAYABLE_ACCOUNT,
      CUSTOMER_ACCOUNT,
      OTHER_ENTITY_TREASURY,
      TREASURY_BTC_ACCOUNT,
      SUSPENSE_ACCOUNT,
      PAYABLE_B_ACCOUNT
    ]
  });
  const [debit, credit] = commandDigestVector.command.entries;
  const accepted = ledger.post(
    command({
      entries: [{ ...debit, account_id: ownerlessTreasury.account_id }, credit]
    })
  );
  assert.equal(accepted.entries[0].account_id, ownerlessTreasury.account_id);
});

test("unknown or mismatched posting_rule_version fails closed", () => {
  const ledger = createLedger();
  expectLedgerError("LEDGER_POSTING_RULE_NOT_FOUND", () =>
    ledger.post(command({ posting_rule_version: "synthetic-provider-position-v99" }))
  );
  expectLedgerError("LEDGER_POSTING_RULE_NOT_FOUND", () =>
    ledger.post(command({ posting_rule_version: "SYNTHETIC-PROVIDER-POSITION-V1" }))
  );
  // A version registered only under a different journal_type does not leak.
  const twoTypes = {
    ...postingRules,
    rules: [
      postingRules.rules[0],
      {
        ...postingRules.rules[0],
        journal_type: "DEV_CUSTODY_ADJUST",
        posting_rule_version: "synthetic-provider-position-v2"
      }
    ]
  };
  const twoLedger = createLedger({ postingRules: twoTypes });
  expectLedgerError("LEDGER_POSTING_RULE_NOT_FOUND", () =>
    twoLedger.post(
      command({ posting_rule_version: "synthetic-provider-position-v2" })
    )
  );
  // Versions are not split or pattern-matched.
  expectLedgerError("LEDGER_VALIDATION_FAILED", () =>
    ledger.post(
      command({ posting_rule_version: "synthetic-provider-position-v1|v2" })
    )
  );
  // An unregistered journal_type fails closed the same way.
  expectLedgerError("LEDGER_POSTING_RULE_NOT_FOUND", () =>
    ledger.post(command({ journal_type: "DEV_UNKNOWN_TYPE" }))
  );
});

test("amount invariants reject non-canonical, zero, negative and off-scale values", () => {
  const ledger = createLedger();
  const badAmounts = [
    "0",
    "0.000000",
    "-1",
    "+1",
    "1e6",
    "25.5000000",
    "25.",
    " 25",
    "25 ",
    "025",
    "1_000",
    "NaN",
    "Infinity",
    "",
    null,
    25.5,
    "1".repeat(79)
  ];
  for (const amount of badAmounts) {
    expectLedgerError("LEDGER_AMOUNT_INVALID", () =>
      ledger.post(
        command({
          entries: commandDigestVector.command.entries.map((entry) => ({
            ...entry,
            amount
          }))
        })
      )
    );
  }
  // One minor unit of imbalance rejects the journal — exact decimal math.
  const [debit, credit] = commandDigestVector.command.entries;
  expectLedgerError("LEDGER_UNBALANCED_JOURNAL", () =>
    ledger.post(
      command({
        entries: [debit, { ...credit, amount: "25.499999" }]
      })
    )
  );
  // Canonically equal spellings post exactly once.
  const exact = createLedger().post(
    command({
      entries: [debit, { ...credit, amount: "25.5" }]
    })
  );
  assert.equal(exact.entries.length, 2);
});

test("entry asset must match its account asset", () => {
  const ledger = createLedger();
  const [debit, credit] = commandDigestVector.command.entries;
  // A TUSDT line on the TBTC treasury account is a boundary violation.
  expectLedgerError("LEDGER_BOUNDARY_VIOLATION", () =>
    ledger.post(
      command({
        entries: [{ ...debit, account_id: TREASURY_BTC_ACCOUNT.account_id }, credit]
      })
    )
  );
  // A TBTC line on the TUSDT account is equally rejected.
  expectLedgerError("LEDGER_BOUNDARY_VIOLATION", () =>
    ledger.post(
      command({
        entries: [
          { ...debit, asset_code: "TBTC" },
          { ...credit, asset_code: "TBTC", amount: "0.00000500" }
        ]
      })
    )
  );
  // Accounts cannot reference an unregistered asset at all.
  expectLedgerError("LEDGER_CONFIGURATION_INVALID", () =>
    createLedger({
      accounts: [
        { ...TREASURY_ACCOUNT, asset_code: "TXRP" },
        PAYABLE_ACCOUNT,
        CUSTOMER_ACCOUNT,
        OTHER_ENTITY_TREASURY,
        TREASURY_BTC_ACCOUNT,
        SUSPENSE_ACCOUNT,
        PAYABLE_B_ACCOUNT
      ]
    })
  );
});

test("idempotent replay never double-applies a journal", () => {
  const ledger = createLedger();
  const first = ledger.post(command());
  const projectionBefore = ledger.getProjection(PAYABLE_ACCOUNT.account_id);
  const replay = ledger.post(command());
  assert.equal(ledger.listJournals().length, 1);
  assert.deepEqual(replay, first);
  assert.deepEqual(
    ledger.getProjection(PAYABLE_ACCOUNT.account_id),
    projectionBefore
  );
});

test("idempotency key reuse fails closed and failed posts consume nothing", () => {
  const ledger = createLedger();
  ledger.post(command());
  const [debit, credit] = commandDigestVector.command.entries;
  // Same key, different content: conflict.
  expectLedgerError("LEDGER_IDEMPOTENCY_CONFLICT", () =>
    ledger.post(
      command({
        journal_id: "e0000000-0000-4000-8000-00000000000e",
        entries: [
          { ...debit, amount: "30.000000" },
          { ...credit, amount: "30.000000" }
        ]
      })
    )
  );
  // Same key, reordered entries: canonical digests differ, still conflict.
  expectLedgerError("LEDGER_IDEMPOTENCY_CONFLICT", () =>
    ledger.post(
      command({
        journal_id: "f0000000-0000-4000-8000-00000000000f",
        entries: [credit, debit]
      })
    )
  );
  // Different key, same journal_id: duplicate journal.
  expectLedgerError("LEDGER_DUPLICATE_JOURNAL", () =>
    ledger.post(command({ idempotency_key: "provider-position-demo-002" }))
  );
  // A rejected posting does not reserve its idempotency key.
  const fresh = createLedger();
  expectLedgerError("LEDGER_POSTING_RULE_VIOLATION", () =>
    fresh.post(command({ actor: { type: "OPERATOR" } }))
  );
  const retried = fresh.post(command());
  assert.equal(retried.journal_id, commandDigestVector.command.journal_id);
});
