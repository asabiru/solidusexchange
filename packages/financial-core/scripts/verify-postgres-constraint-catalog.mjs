import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const expectedConstraintCounts = new Map([
  ["check", 49],
  ["constraint_trigger", 5],
  ["foreign_key", 10],
  ["primary_key", 11],
  ["unique", 8]
]);
const expectedCatalogSha256 =
  "e34a68c6e736c7d5b95947d64dffcfa75e39fe2aaa90eb2eaf2d59ad1fc23c47";

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
}

const actual = JSON.parse(input);
assert.equal(actual.constraints.length, 83, "Unexpected PostgreSQL constraint count");
assert.equal(actual.indexes.length, 1, "Unexpected standalone PostgreSQL index count");

const actualConstraintCounts = new Map();
for (const constraint of actual.constraints) {
  actualConstraintCounts.set(
    constraint.constraint_type,
    (actualConstraintCounts.get(constraint.constraint_type) ?? 0) + 1
  );
}
assert.deepStrictEqual(
  actualConstraintCounts,
  expectedConstraintCounts,
  "PostgreSQL constraint types differ from the expected policy"
);

const actualCatalogSha256 = createHash("sha256")
  .update(JSON.stringify(canonicalize(actual)))
  .digest("hex");
assert.equal(
  actualCatalogSha256,
  expectedCatalogSha256,
  "PostgreSQL constraint or standalone-index catalog differs from the expected policy"
);

console.log("postgres-constraint-catalog-ok");
