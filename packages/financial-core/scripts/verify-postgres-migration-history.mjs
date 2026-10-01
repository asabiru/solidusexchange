import assert from "node:assert/strict";

const expectedHistory = [
  { migration_name: "0001_ledger_foundation", version: 1 },
  { migration_name: "0002_ledger_verification_views", version: 2 },
  { migration_name: "0003_ledger_acceptance_seal", version: 3 },
  { migration_name: "0004_ledger_truncate_guard", version: 4 },
  { migration_name: "0005_ledger_trigger_replication_guard", version: 5 },
  { migration_name: "0006_ledger_invariant_replication_guard", version: 6 },
  { migration_name: "0007_ledger_replica_reference_guard", version: 7 },
  { migration_name: "0008_ledger_acceptance_artifact_guard", version: 8 },
  { migration_name: "0009_ledger_acceptance_timeline_guard", version: 9 },
  { migration_name: "0010_ledger_finite_timestamp_guard", version: 10 }
];

let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
}

const actual = JSON.parse(input);
assert.deepStrictEqual(
  actual.history,
  expectedHistory,
  "PostgreSQL migration history differs from canonical manifest"
);
assert.equal(
  actual.applied_in_version_order,
  true,
  "PostgreSQL migrations were not applied in canonical version order"
);

console.log("postgres-migration-history-ok");
