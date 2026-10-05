import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const expectedConstraintCounts = new Map([
  ["check", 62],
  ["constraint_trigger", 5],
  ["foreign_key", 10],
  ["primary_key", 11],
  ["unique", 11]
]);
const expectedCatalogSha256 =
  "6869090625181203697e140d01830b1e72fb56ce965b47a40e8ef261a18c8326";

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
assert.equal(actual.constraints.length, 99, "Unexpected PostgreSQL constraint count");
assert.equal(actual.indexes.length, 2, "Unexpected standalone PostgreSQL index count");

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
