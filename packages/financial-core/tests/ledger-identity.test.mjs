import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { LedgerError, createInMemoryLedger } from "../src/ledger.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const chart = JSON.parse(readFileSync(join(root, "chart-of-accounts.json"), "utf8"));
const postingRules = JSON.parse(readFileSync(join(root, "posting-rules.json"), "utf8"));
const commandDigestVector = JSON.parse(
  readFileSync(join(root, "tests", "command-digest-vector.json"), "utf8")
);
const assetCode = commandDigestVector.asset.code;

const accounts = [
  {
    account_id: "1a000000-0000-4000-8000-00000000000a",
    definition_code: "TREASURY_ASSET",
    legal_entity_id: "solidchange-dev",
    asset_code: assetCode,
    owner_reference: "treasury-location-demo",
    created_at: "2026-09-25T10:00:00.000Z"
  },
  {
    account_id: "2b000000-0000-4000-8000-00000000000b",
    definition_code: "PROVIDER_PAYABLE_LIABILITY",
    legal_entity_id: "solidchange-dev",
    asset_code: assetCode,
    owner_reference: "provider-demo",
    created_at: "2026-09-25T10:00:00.000Z"
  }
];
const assets = [{ code: assetCode, scale: commandDigestVector.asset.scale }];

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
  const base = structuredClone(commandDigestVector.command);
  base.entries[0].account_id = accounts[0].account_id;
  base.entries[1].account_id = accounts[1].account_id;
  return { ...base, ...overrides };
}

function expectLedgerError(action, code) {
  assert.throws(action, (error) => error instanceof LedgerError && error.code === code);
}

test("entry IDs stay globally unique across journals", () => {
  const ledger = createLedger();
  ledger.post(command());

  const reusedIdentity = command({
    journal_id: "71000000-0000-4000-8000-000000000071",
    idempotency_key: "provider-position-demo-002",
    correlation_id: "81000000-0000-4000-8000-000000000081"
  });
  expectLedgerError(() => ledger.post(reusedIdentity), "LEDGER_DUPLICATE_ENTRY");
  assert.equal(ledger.listJournals().length, 1);
});

test("rejected postings consume no entry identity", () => {
  const ledger = createLedger();
  const unbalanced = command({
    entries: [command().entries[0], { ...command().entries[1], amount: "1.000000" }]
  });
  expectLedgerError(() => ledger.post(unbalanced), "LEDGER_UNBALANCED_JOURNAL");

  const accepted = ledger.post(command());
  assert.equal(accepted.entries.length, 2);
  assert.equal(ledger.listJournals().length, 1);
});

test("entry IDs collide across case variants inside one journal", () => {
  const ledger = createLedger();
  const twins = command();
  twins.entries[0].entry_id = "a0000000-0000-4000-8000-00000000000a";
  twins.entries[1].entry_id = "A0000000-0000-4000-8000-00000000000A";
  expectLedgerError(() => ledger.post(twins), "LEDGER_VALIDATION_FAILED");
});

test("cross-journal entry reuse is rejected for case variants too", () => {
  const ledger = createLedger();
  ledger.post(command());

  const caseTwin = command({
    journal_id: "71000000-0000-4000-8000-000000000071",
    idempotency_key: "provider-position-demo-002",
    correlation_id: "81000000-0000-4000-8000-000000000081"
  });
  caseTwin.entries[0].entry_id = "A0000000-0000-4000-8000-00000000000A";
  caseTwin.entries[1].entry_id = "b0000000-0000-4000-8000-00000000000b";
  expectLedgerError(() => ledger.post(caseTwin), "LEDGER_DUPLICATE_ENTRY");
  assert.equal(ledger.listJournals().length, 1);
});

test("a case-variant journal ID cannot fork a second journal", () => {
  const ledger = createLedger();
  ledger.post(command({ journal_id: "ab000000-0000-4000-8000-0000000000ab" }));

  const fork = command({
    journal_id: "AB000000-0000-4000-8000-0000000000AB",
    idempotency_key: "provider-position-demo-002",
    correlation_id: "81000000-0000-4000-8000-000000000081"
  });
  expectLedgerError(() => ledger.post(fork), "LEDGER_DUPLICATE_JOURNAL");
  assert.equal(ledger.listJournals().length, 1);
});

test("a case-variant repost replays idempotently under the canonical digest", () => {
  const ledger = createLedger();
  const first = ledger.post(command({ journal_id: "ab000000-0000-4000-8000-0000000000ab" }));
  const replay = ledger.post(command({ journal_id: "AB000000-0000-4000-8000-0000000000AB" }));

  assert.deepEqual(replay, first);
  assert.equal(replay.journal_id, "ab000000-0000-4000-8000-0000000000ab");
  assert.equal(ledger.listJournals().length, 1);
});

test("account IDs collide across case variants at registration", () => {
  const colliding = [
    ...structuredClone(accounts),
    {
      ...structuredClone(accounts[0]),
      account_id: "1A000000-0000-4000-8000-00000000000A",
      owner_reference: "second-owner-ref"
    }
  ];
  expectLedgerError(
    () => createLedger({ accounts: colliding }),
    "LEDGER_CONFIGURATION_INVALID"
  );
});

test("entry account references and projections resolve canonically", () => {
  const ledger = createLedger();
  const mixed = command();
  mixed.entries[0].account_id = "1A000000-0000-4000-8000-00000000000A";
  mixed.entries[1].account_id = "2B000000-0000-4000-8000-00000000000B";
  const accepted = ledger.post(mixed);

  assert.equal(accepted.entries[0].account_id, accounts[0].account_id);
  assert.equal(accepted.entries[1].account_id, accounts[1].account_id);

  const projection = ledger.getProjection("1A000000-0000-4000-8000-00000000000A");
  assert.equal(projection.account_id, accounts[0].account_id);
  assert.equal(projection.normal_balance, "25.500000");
});
