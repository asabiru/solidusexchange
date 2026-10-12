import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const expectedCatalogSha256 =
  "0c82e7e8698add8410d598671af395e3c89a870afc7d10e01a580a8229a47ea1";

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
assert.equal(actual.relations.length, 13, "Unexpected PostgreSQL relation count");
assert.equal(actual.columns.length, 102, "Unexpected PostgreSQL column count");
assert.equal(
  actual.columns.filter((column) => column.not_null).length,
  77,
  "Unexpected PostgreSQL NOT NULL column count"
);
assert.equal(
  actual.relations.filter((relation) => relation.relation_type === "table").length,
  11,
  "Unexpected PostgreSQL table count"
);
assert.equal(
  actual.relations.filter((relation) => relation.relation_type === "view").length,
  2,
  "Unexpected PostgreSQL view count"
);
assert.deepStrictEqual(
  actual.policies,
  [],
  "Unexpected PostgreSQL row-level security policies in financial_core"
);
assert.deepStrictEqual(
  actual.publications,
  [],
  "Unexpected PostgreSQL logical replication publications touching financial_core"
);
assert.deepStrictEqual(
  actual.statistics,
  [],
  "Unexpected PostgreSQL extended statistics in financial_core"
);
assert.deepStrictEqual(
  actual.event_triggers,
  [],
  "Unexpected PostgreSQL event triggers"
);

const actualCatalogSha256 = createHash("sha256")
  .update(JSON.stringify(canonicalize(actual)))
  .digest("hex");
assert.equal(
  actualCatalogSha256,
  expectedCatalogSha256,
  "PostgreSQL relation or column catalog differs from the expected policy"
);

console.log("postgres-relation-catalog-ok");
