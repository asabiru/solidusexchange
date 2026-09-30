import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const expectedCatalogSha256 =
  "64db1d5d815e6792e9ba5112c58a8b407f7a611f8da87df011a25ba99be4532d";

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
assert.equal(actual.schemas.length, 1, "Unexpected PostgreSQL schema ACL count");
assert.equal(actual.relations.length, 13, "Unexpected PostgreSQL relation ACL count");
assert.equal(actual.functions.length, 7, "Unexpected PostgreSQL function ACL count");
assert.equal(actual.columns.length, 102, "Unexpected PostgreSQL column ACL count");
assert.equal(
  actual.default_privileges.length,
  0,
  "Unexpected PostgreSQL default privilege policy"
);

const actualCatalogSha256 = createHash("sha256")
  .update(JSON.stringify(canonicalize(actual)))
  .digest("hex");
assert.equal(
  actualCatalogSha256,
  expectedCatalogSha256,
  "PostgreSQL ownership or access-control catalog differs from the expected policy"
);

console.log("postgres-access-control-catalog-ok");
