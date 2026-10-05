import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const expectedCatalogSha256 =
  "20bf051480d2ce27da8beb8f9d7ea1ca4361f4cabae3b05380a627c046796450";

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
assert.equal(actual.schemas.length, 1, "Unexpected custody schema count");
assert.equal(actual.relations.length, 2, "Unexpected custody relation count");
assert.equal(actual.columns.length, 19, "Unexpected custody column count");
assert.equal(actual.constraints.length, 34, "Unexpected custody constraint count");
assert.equal(actual.indexes.length, 7, "Unexpected custody index count");
assert.equal(actual.triggers.length, 5, "Unexpected custody trigger count");
assert.equal(actual.functions.length, 4, "Unexpected custody function count");
assert.equal(
  actual.default_privileges.length,
  0,
  "Unexpected custody default privilege policy"
);
assert.deepEqual(
  actual.triggers.map(({ trigger_name: triggerName, enabled }) => ({
    triggerName,
    enabled
  })),
  [
    {
      triggerName: "custody_projection_outbox_append_only",
      enabled: "A"
    },
    {
      triggerName: "custody_projection_outbox_reject_truncate",
      enabled: "A"
    },
    {
      triggerName: "schema_migrations_append_only",
      enabled: "A"
    },
    {
      triggerName: "schema_migrations_reject_truncate",
      enabled: "A"
    },
    {
      triggerName: "schema_migrations_validate_sequence",
      enabled: "A"
    }
  ],
  "Custody mutation triggers must remain enabled in every replication mode"
);

const actualCatalogSha256 = createHash("sha256")
  .update(JSON.stringify(canonicalize(actual)))
  .digest("hex");
assert.equal(
  actualCatalogSha256,
  expectedCatalogSha256,
  "PostgreSQL custody catalog differs from the expected policy"
);

console.log("custody-postgres-catalog-ok");
