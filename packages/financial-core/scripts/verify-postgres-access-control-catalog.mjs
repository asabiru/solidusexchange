import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const expectedCatalogSha256 =
  "2c9616c4d502dc398bbea504b59e92cb861bcd71d3738fb05c849f8f513b0cff";

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
assert.equal(actual.functions.length, 6, "Unexpected PostgreSQL function ACL count");
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
