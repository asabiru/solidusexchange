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
const assetCode = commandDigestVector.asset.code;
const accounts = [
  {
    account_id: "10000000-0000-4000-8000-000000000001",
    definition_code: "TREASURY_ASSET",
    legal_entity_id: "solidchange-dev",
    asset_code: assetCode,
    owner_reference: "treasury-location-demo",
    created_at: "2026-09-25T10:00:00.000Z"
  },
  {
    account_id: "20000000-0000-4000-8000-000000000002",
    definition_code: "PROVIDER_PAYABLE_LIABILITY",
    legal_entity_id: "solidchange-dev",
    asset_code: assetCode,
    owner_reference: "provider-demo",
    created_at: "2026-09-25T10:00:00.000Z"
  },
  {
    account_id: "30000000-0000-4000-8000-000000000003",
    definition_code: "CUSTOMER_SETTLED_LIABILITY",
    legal_entity_id: "solidchange-dev",
    asset_code: assetCode,
    owner_reference: "customer-demo",
    created_at: "2026-09-25T10:00:00.000Z"
  },
  {
    account_id: "40000000-0000-4000-8000-000000000004",
    definition_code: "TREASURY_ASSET",
    legal_entity_id: "other-entity-dev",
    asset_code: assetCode,
    owner_reference: "other-treasury-demo",
    created_at: "2026-09-25T10:00:00.000Z"
  }
];
const assets = [
  { code: assetCode, scale: commandDigestVector.asset.scale },
  { code: "TBTC", scale: 8 }
];

function createLedger(overrides = {}) {
  return createInMemoryLedger({
    accounts: structuredClone(accounts),
    assets: structuredClone(assets),
    chart: structuredClone(chart),
    postingRules: structuredClone(postingRules),
    clock: () => "2026-09-25T10:15:01.000Z",
    ...overrides
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

test("parseAmount rejects non-canonical and non-string amounts", () => {
  for (const value of [
    "-1",
    "+1",
    "01",
    "1.",
    ".5",
    " 1",
    "1 ",
    "1_000",
    "0x10",
    "NaN",
    "Infinity",
    "1e6",
    "",
    25.5,
    1n,
    null,
    undefined
  ]) {
    assert.throws(() => parseAmount(value, 6), TypeError, `value=${String(value)}`);
  }
  for (const scale of [-1, 19, 1.5, "6", null]) {
    assert.throws(() => parseAmount("1", scale), TypeError, `scale=${String(scale)}`);
  }
  assert.throws(() => parseAmount("0", 6), RangeError);
  assert.throws(() => parseAmount("0.0", 6), RangeError);
  assert.throws(() => parseAmount("0.000000", 6), RangeError);
  assert.throws(() => parseAmount(`${"9".repeat(79)}`, 6), RangeError);
  assert.throws(() => parseAmount("0.5", 0), RangeError);
  assert.equal(parseAmount("5", 6), 5_000_000n);
  assert.equal(parseAmount("5", 0), 5n);
});

test("formatAmount rejects non-bigint minors and bad scales", () => {
  for (const minorUnits of [1, "1", 1.5, null]) {
    assert.throws(() => formatAmount(minorUnits, 6), TypeError);
  }
  for (const scale of [-1, 19, 1.5]) {
    assert.throws(() => formatAmount(1n, scale), TypeError);
  }
  assert.equal(formatAmount(0n, 0), "0");
  assert.equal(formatAmount(5n, 0), "5");
});

test("posting rejects zero, bare-number and over-precision entry amounts", () => {
  const ledger = createLedger();
  for (const amount of ["0", "0.0", "0.000000", `${"9".repeat(79)}`, 25.5, "-1", "1e6"]) {
    const badAmount = command({
      entries: command().entries.map((entry) => ({ ...entry, amount }))
    });
    expectLedgerError(() => ledger.post(badAmount), "LEDGER_AMOUNT_INVALID");
  }
  expectLedgerError(
    () => ledger.post(command({ entries: [command().entries[0]] })),
    "LEDGER_VALIDATION_FAILED"
  );
  expectLedgerError(
    () => ledger.post(command({ entries: [] })),
    "LEDGER_VALIDATION_FAILED"
  );
});

test("posting rejects duplicate entry IDs and invalid entry fields", () => {
  const ledger = createLedger();
  const duplicated = command({
    entries: [
      command().entries[0],
      { ...command().entries[1], entry_id: command().entries[0].entry_id }
    ]
  });
  expectLedgerError(() => ledger.post(duplicated), "LEDGER_VALIDATION_FAILED");

  const badSide = command({
    entries: [
      command().entries[0],
      { ...command().entries[1], side: "debit" }
    ]
  });
  expectLedgerError(() => ledger.post(badSide), "LEDGER_VALIDATION_FAILED");

  const unknownAccount = command({
    entries: [
      command().entries[0],
      { ...command().entries[1], account_id: "90000000-0000-4000-8000-0000000000ff" }
    ]
  });
  expectLedgerError(() => ledger.post(unknownAccount), "LEDGER_ACCOUNT_NOT_FOUND");
  assert.equal(ledger.listJournals().length, 0);
});

test("a balanced extra leg pair still violates the registered entry pattern", () => {
  const ledger = createLedger();
  const extraPair = command({
    entries: [
      ...command().entries,
      {
        entry_id: "b0000000-0000-4000-8000-00000000000b",
        account_id: accounts[0].account_id,
        asset_code: assetCode,
        side: "DEBIT",
        amount: "0.000001"
      },
      {
        entry_id: "c0000000-0000-4000-8000-00000000000c",
        account_id: accounts[1].account_id,
        asset_code: assetCode,
        side: "CREDIT",
        amount: "0.000001"
      }
    ]
  });
  expectLedgerError(() => ledger.post(extraPair), "LEDGER_POSTING_RULE_VIOLATION");
  assert.equal(ledger.listJournals().length, 0);
});

test("posting rejects malformed actor, source and identity fields", () => {
  const ledger = createLedger();
  expectLedgerError(
    () => ledger.post(command({ actor: { type: "SERVICE", id: "bad actor" } })),
    "LEDGER_VALIDATION_FAILED"
  );
  expectLedgerError(
    () => ledger.post(command({ actor: { type: "OPERATOR" } })),
    "LEDGER_VALIDATION_FAILED"
  );
  expectLedgerError(
    () => ledger.post(command({ causation_id: "not-a-uuid" })),
    "LEDGER_VALIDATION_FAILED"
  );
  expectLedgerError(
    () => ledger.post(command({ correlation_id: "80000000-0000-4000-8000-00000000000g" })),
    "LEDGER_VALIDATION_FAILED"
  );
  expectLedgerError(
    () =>
      ledger.post(
        command({ source: { type: "synthetic-test", reference: "ref-1", evidence_digest: "zz" } })
      ),
    "LEDGER_VALIDATION_FAILED"
  );
  expectLedgerError(
    () => ledger.post(command({ journal_type: "synthetic_provider_position" })),
    "LEDGER_VALIDATION_FAILED"
  );
  expectLedgerError(
    () => ledger.post(command({ journal_type: "UNREGISTERED_TYPE" })),
    "LEDGER_POSTING_RULE_NOT_FOUND"
  );
});

test("getProjection rejects unknown accounts", () => {
  const ledger = createLedger();
  expectLedgerError(
    () => ledger.getProjection("90000000-0000-4000-8000-0000000000ff"),
    "LEDGER_ACCOUNT_NOT_FOUND"
  );
});

test("a broken ledger clock fails closed", () => {
  expectLedgerError(
    () =>
      createLedger({ clock: () => "not-a-timestamp" }).post(command()),
    "LEDGER_VALIDATION_FAILED"
  );
});

test("chart validation rejects structural violations", () => {
  const duplicateCode = structuredClone(chart);
  duplicateCode.account_definitions.push({
    ...duplicateCode.account_definitions[0]
  });
  expectLedgerError(() => validateChart(duplicateCode), "LEDGER_CHART_INVALID");

  const missingCategory = structuredClone(chart);
  missingCategory.account_definitions = missingCategory.account_definitions.filter(
    (definition) => definition.category !== "suspense"
  );
  expectLedgerError(() => validateChart(missingCategory), "LEDGER_CHART_INVALID");

  const badSide = structuredClone(chart);
  badSide.account_definitions[0].normal_side = "BOTH";
  expectLedgerError(() => validateChart(badSide), "LEDGER_CHART_INVALID");

  const badScope = structuredClone(chart);
  badScope.account_definitions[0].owner_scope = "sometimes";
  expectLedgerError(() => validateChart(badScope), "LEDGER_CHART_INVALID");

  const shortPurpose = structuredClone(chart);
  shortPurpose.account_definitions[0].purpose = "short";
  expectLedgerError(() => validateChart(shortPurpose), "LEDGER_CHART_INVALID");

  const unknownCategory = structuredClone(chart);
  unknownCategory.account_definitions[0].category = "offshore";
  expectLedgerError(() => validateChart(unknownCategory), "LEDGER_CHART_INVALID");
});

test("posting-rule registry rejects structural violations", () => {
  const duplicateRule = structuredClone(postingRules);
  duplicateRule.rules.push({ ...structuredClone(postingRules.rules[0]) });
  expectLedgerError(
    () => validatePostingRules(duplicateRule, chart),
    "LEDGER_POSTING_RULES_INVALID"
  );

  const productionScope = structuredClone(postingRules);
  productionScope.rules[0].scope = "production";
  expectLedgerError(
    () => validatePostingRules(productionScope, chart),
    "LEDGER_POSTING_RULES_INVALID"
  );

  const singleLeg = structuredClone(postingRules);
  singleLeg.rules[0].entry_pattern = [singleLeg.rules[0].entry_pattern[0]];
  expectLedgerError(
    () => validatePostingRules(singleLeg, chart),
    "LEDGER_POSTING_RULES_INVALID"
  );

  const duplicateLeg = structuredClone(postingRules);
  duplicateLeg.rules[0].entry_pattern.push({
    ...duplicateLeg.rules[0].entry_pattern[0]
  });
  expectLedgerError(
    () => validatePostingRules(duplicateLeg, chart),
    "LEDGER_POSTING_RULES_INVALID"
  );

  const unknownDefinition = structuredClone(postingRules);
  unknownDefinition.rules[0].entry_pattern[0].definition_code = "UNKNOWN_DEF";
  expectLedgerError(
    () => validatePostingRules(unknownDefinition, chart),
    "LEDGER_POSTING_RULES_INVALID"
  );

  const badLegSide = structuredClone(postingRules);
  badLegSide.rules[0].entry_pattern[0].side = "BOTH";
  expectLedgerError(
    () => validatePostingRules(badLegSide, chart),
    "LEDGER_POSTING_RULES_INVALID"
  );

  const emptyActors = structuredClone(postingRules);
  emptyActors.rules[0].allowed_actor_types = [];
  expectLedgerError(
    () => validatePostingRules(emptyActors, chart),
    "LEDGER_POSTING_RULES_INVALID"
  );

  const foreignActor = structuredClone(postingRules);
  foreignActor.rules[0].allowed_actor_types = ["SERVICE", "ROOT"];
  expectLedgerError(
    () => validatePostingRules(foreignActor, chart),
    "LEDGER_POSTING_RULES_INVALID"
  );

  const productionRegistry = structuredClone(postingRules);
  productionRegistry.production_execution_enabled = true;
  expectLedgerError(
    () => validatePostingRules(productionRegistry, chart),
    "LEDGER_POSTING_RULES_INVALID"
  );
});

test("account configuration rejects duplicates and owner-scope violations", () => {
  const duplicateIdentity = {
    accounts: [
      ...structuredClone(accounts),
      {
        ...structuredClone(accounts[0]),
        account_id: "d0000000-0000-4000-8000-00000000000d"
      }
    ]
  };
  expectLedgerError(
    () => createLedger(duplicateIdentity),
    "LEDGER_CONFIGURATION_INVALID"
  );

  const unknownAsset = {
    accounts: accounts.map((account) =>
      account.account_id === accounts[0].account_id
        ? { ...account, asset_code: "FAKE" }
        : structuredClone(account)
    )
  };
  expectLedgerError(() => createLedger(unknownAsset), "LEDGER_CONFIGURATION_INVALID");

  const unknownDefinition = {
    accounts: accounts.map((account) =>
      account.account_id === accounts[0].account_id
        ? { ...account, definition_code: "UNKNOWN_DEF" }
        : structuredClone(account)
    )
  };
  expectLedgerError(
    () => createLedger(unknownDefinition),
    "LEDGER_CONFIGURATION_INVALID"
  );

  const missingOwner = {
    accounts: accounts.map((account) =>
      account.account_id === accounts[1].account_id
        ? { ...account, owner_reference: null }
        : structuredClone(account)
    )
  };
  expectLedgerError(() => createLedger(missingOwner), "LEDGER_CONFIGURATION_INVALID");

  const badOwner = {
    accounts: accounts.map((account) =>
      account.account_id === accounts[1].account_id
        ? { ...account, owner_reference: "bad owner" }
        : structuredClone(account)
    )
  };
  expectLedgerError(() => createLedger(badOwner), "LEDGER_CONFIGURATION_INVALID");

  const badUuid = {
    accounts: accounts.map((account) =>
      account.account_id === accounts[0].account_id
        ? { ...account, account_id: "account-1" }
        : structuredClone(account)
    )
  };
  expectLedgerError(() => createLedger(badUuid), "LEDGER_VALIDATION_FAILED");

  const duplicateAsset = { assets: [...assets, { code: "TBTC", scale: 8 }] };
  expectLedgerError(() => createLedger(duplicateAsset), "LEDGER_CONFIGURATION_INVALID");

  const emptyAssets = { assets: [] };
  expectLedgerError(() => createLedger(emptyAssets), "LEDGER_CONFIGURATION_INVALID");
});
