import assert from "node:assert/strict";
import test from "node:test";

import { LedgerError } from "../src/ledger.mjs";
import { createMigrationPipeline } from "../src/migration.mjs";
import { createSessionDLedger } from "../src/session-d.mjs";

const clock = () => "2026-10-15T12:00:00.000Z";
const TREASURY = "40000000-0000-4000-8000-000000000004";

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
    account_id: TREASURY,
    definition_code: "TREASURY_ASSET",
    legal_entity_id: "solidchange-dev",
    asset_code: "TUSDT",
    owner_reference: "treasury-demo",
    created_at: "2026-09-25T10:00:00.000Z"
  },
  {
    account_id: "20000000-0000-4000-8000-000000000002",
    definition_code: "CUSTOMER_SETTLED_LIABILITY",
    legal_entity_id: "solidchange-dev",
    asset_code: "TUSDT",
    owner_reference: "customer-demo",
    created_at: "2026-09-25T10:00:00.000Z"
  }
];
const assets = [{ code: "TUSDT", scale: 6 }];

function createLedger() {
  return createSessionDLedger({ accounts, assets, clock });
}

function createPipeline() {
  return createMigrationPipeline({
    transformation_version: "migration-transform-v1",
    legal_entity_id: "solidchange-dev",
    treasury_account_id: TREASURY,
    settled_account_for: () => "20000000-0000-4000-8000-000000000002",
    clock
  });
}

function snapshot(records) {
  return {
    source_system: "legacy_solid",
    snapshot_id: "snap_demo_001",
    extracted_at: "2026-10-14T00:00:00.000Z",
    records
  };
}

function balanceRow(pk, customer, amount, status = "settled") {
  return {
    source_table: "balances",
    source_primary_key: pk,
    record_type: "customer_balance",
    customer_reference: customer,
    asset_code: "TUSDT",
    amount,
    legacy_status: status
  };
}

test("snapshot registration pins counts, digests and rejects duplicates", () => {
  const pipeline = createPipeline();
  const snap = pipeline.registerSnapshot(
    snapshot([
      balanceRow("row-1", "cust-1", "25.5"),
      balanceRow("row-2", "cust-2", "10.0")
    ])
  );
  assert.equal(snap.record_count, 2);
  assert.equal(snap.counts.customer_balance, 2);
  assert.equal(snap.payload_digest.length, 64);
  assert.throws(
    () =>
      pipeline.registerSnapshot(
        snapshot([
          balanceRow("row-1", "cust-1", "1"),
          balanceRow("row-1", "cust-1", "2")
        ])
      ),
    /duplicate source row/
  );
  assert.throws(
    () => pipeline.registerSnapshot(snapshot([{ source_table: "t", source_primary_key: "k", record_type: "unknown" }])),
    (error) => error instanceof LedgerError && error.code === "MIGRATION_INPUT_INVALID"
  );
});

test("classification routes pending/disputed rows to cases, never to openings", () => {
  const pipeline = createPipeline();
  pipeline.registerSnapshot(
    snapshot([
      balanceRow("row-1", "cust-1", "25.5"),
      balanceRow("row-2", "cust-2", "9.9", "disputed"),
      balanceRow("row-3", "cust-3", "4.0", "pending"),
      balanceRow("row-4", "cust-4", "0", "settled")
    ])
  );
  assert.equal(pipeline.classifyAll(), 4);
  const report = pipeline.report();
  const cases = report.cases;
  assert.equal(cases.length, 3);
  assert.deepEqual(
    cases.map((entry) => entry.classification).sort(),
    ["disputed", "pending", "unresolved"]
  );
  const positions = pipeline.reconstructPositions();
  assert.equal(positions.length, 1);
  assert.equal(positions[0].opening_balance_minor, "25500000000000000000");
  assert.equal(report.evidence_digest.length, 64);
  for (const entry of report.classified) {
    assert.equal(entry.migration_run_id, pipeline.migration_run_id);
    assert.equal(entry.transformation_version, "migration-transform-v1");
    if (entry.result === "case") assert.ok(entry.linked_case.startsWith("migration_case_"));
  }
});

test("opening journals post through the session-d draft registry as balanced commands", () => {
  const ledger = createLedger();
  const pipeline = createPipeline();
  pipeline.registerSnapshot(
    snapshot([
      balanceRow("row-1", "cust-1", "25.5"),
      balanceRow("row-2", "cust-1", "4.5")
    ])
  );
  pipeline.classifyAll();
  const commands = pipeline.buildOpeningCommands({ asset_scale: 6 });
  assert.equal(commands.length, 1);
  const [command] = commands;
  assert.equal(command.journal_type, "SYNTHETIC_MIGRATION_OPENING");
  assert.equal(command.actor.type, "MIGRATION_JOB");
  assert.equal(command.source.type, "migration_opening");
  const journal = ledger.post(command);
  assert.equal(journal.command_digest.length, 64);
  // 30.0 TUSDT across two rows collapsed into one customer position.
  assert.equal(ledger.ledger.getProjection("20000000-0000-4000-8000-000000000002").normal_balance, "30.000000");
  assert.equal(ledger.ledger.getProjection(TREASURY).normal_balance, "30.000000");
});

test("reconciliation reports matches, breaks and never balances by plug", () => {
  const pipeline = createPipeline();
  pipeline.registerSnapshot(
    snapshot([
      balanceRow("row-1", "cust-1", "25.5"),
      balanceRow("row-2", "cust-2", "10.0")
    ])
  );
  pipeline.classifyAll();
  const report = pipeline.reconcileStatements(
    [
      { customer_reference: "cust-1", asset_code: "TUSDT", amount: "25.500000" },
      { customer_reference: "cust-2", asset_code: "TUSDT", amount: "11.000000" },
      { customer_reference: "cust-ghost", asset_code: "TUSDT", amount: "1.000000" }
    ],
    { asset_scale: 6 }
  );
  assert.equal(report.matched, 1);
  assert.equal(report.breaks.length, 2);
  assert.equal(report.breaks[0].reason, "balance_mismatch");
  assert.equal(report.breaks[1].reason, "no_reconstructed_position");
  assert.equal(report.balanced, false);
});

test("the full dry-run ends in a balanced ledger and a digest-stamped evidence pack", () => {
  const ledger = createLedger();
  const pipeline = createPipeline();
  pipeline.registerSnapshot(
    snapshot([
      balanceRow("row-1", "cust-1", "25.5"),
      balanceRow("row-2", "cust-2", "10.0"),
      balanceRow("row-3", "cust-3", "5.0", "pending")
    ])
  );
  pipeline.classifyAll();
  for (const command of pipeline.buildOpeningCommands({ asset_scale: 6 })) {
    ledger.post(command);
  }
  const trial = ledger.ledger.getTrialBalance();
  for (const row of trial) {
    assert.equal(row.balanced, true);
  }
  const report = pipeline.report();
  assert.equal(report.cases.length, 1);
  assert.equal(report.positions.length, 2);
  assert.equal(report.evidence_digest.length, 64);
});
