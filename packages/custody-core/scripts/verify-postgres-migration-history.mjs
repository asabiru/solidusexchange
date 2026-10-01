import assert from "node:assert/strict";

const expectedHistory = [
  { migration_name: "0001_custody_projection_outbox", version: 1 },
  { migration_name: "0002_custody_migration_history", version: 2 }
];

let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
}

const actual = JSON.parse(input);
assert.deepStrictEqual(
  actual.history,
  expectedHistory,
  "PostgreSQL custody migration history differs from canonical manifest"
);
assert.equal(
  actual.applied_in_version_order,
  true,
  "PostgreSQL custody migrations were not applied in canonical version order"
);

console.log("custody-postgres-migration-history-ok");
