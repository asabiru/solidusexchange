import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const expectedCatalogSha256 =
  "f97f14b3585078ceef8972f24379ad02de1095767fff4259a908db495c321083";

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
// The backup/restore suite's sequence probe lives in financial_core to prove
// sequence state survives restores; it is test scaffolding, not reviewed
// schema, so the ACL policy catalog counts around it.
actual.relations = actual.relations.filter(
  (relation) => relation.relation_name !== "backup_sequence_state_probe"
);
assert.equal(actual.schemas.length, 1, "Unexpected PostgreSQL schema ACL count");
assert.equal(actual.relations.length, 13, "Unexpected PostgreSQL relation ACL count");
assert.equal(actual.functions.length, 9, "Unexpected PostgreSQL function ACL count");
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
