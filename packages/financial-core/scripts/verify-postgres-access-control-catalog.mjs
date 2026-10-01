import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const expectedCatalogSha256 =
  "31b1118b44c3a3c0d968db5baef6577fa287ba80aa1289194f56be3678cfde1a";

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
assert.equal(actual.functions.length, 8, "Unexpected PostgreSQL function ACL count");
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
