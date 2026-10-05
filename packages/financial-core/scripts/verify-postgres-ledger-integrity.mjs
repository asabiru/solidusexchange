import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lines = readFileSync(0, "utf8").trim().split("\n");
assert.equal(lines.length, 1, "PostgreSQL ledger integrity report must be one JSON line");
const report = JSON.parse(lines[0]);

assert(Number.isInteger(report.journal_count), "Missing persisted journal count");
assert(Number.isInteger(report.entry_count), "Missing persisted entry count");
assert(Array.isArray(report.violations), "Missing persisted ledger violations");
assert.deepStrictEqual(
  report.violations,
  [],
  `Persisted PostgreSQL ledger journals violate acceptance invariants: ${JSON.stringify(report.violations)}`
);

console.log(
  `postgres-ledger-integrity-ok journals=${report.journal_count} entries=${report.entry_count}`
);
