import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const expectedTriggerDefinitionCatalogSha256 =
  "8bafd5ddb88ffb57c14d9543c074120f0a0b17e663a27a730a6ac2bc95292a19";

const protectedTables = [
  ["account_definitions", "account_definitions_append_only", "account_definitions_reject_truncate"],
  ["ledger_accounts", "ledger_accounts_append_only", "ledger_accounts_reject_truncate"],
  ["ledger_assets", "ledger_assets_append_only", "ledger_assets_reject_truncate"],
  ["ledger_entries", "ledger_entries_append_only", "ledger_entries_reject_truncate"],
  [
    "ledger_idempotency_registry",
    "ledger_idempotency_append_only",
    "ledger_idempotency_reject_truncate"
  ],
  [
    "ledger_journal_seals",
    "ledger_journal_seals_append_only",
    "ledger_journal_seals_reject_truncate"
  ],
  ["ledger_journals", "ledger_journals_append_only", "ledger_journals_reject_truncate"],
  [
    "ledger_outbox_delivery_attempts",
    "ledger_delivery_attempts_append_only",
    "ledger_delivery_attempts_reject_truncate"
  ],
  [
    "ledger_outbox_events",
    "ledger_outbox_append_only",
    "ledger_outbox_reject_truncate"
  ],
  [
    "posting_rule_registry",
    "posting_rule_registry_append_only",
    "posting_rule_registry_reject_truncate"
  ],
  ["schema_migrations", "schema_migrations_append_only", "schema_migrations_reject_truncate"]
];

let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
}

const actual = JSON.parse(input);
const actualMetadata = actual.map(
  ({ definition_sha256: _definitionSha256, ...metadata }) => metadata
);
const expected = protectedTables.flatMap(
  ([tableName, appendOnlyTrigger, truncateTrigger]) => [
    {
      table_name: tableName,
      trigger_name: appendOnlyTrigger,
      enabled: "A",
      row_level: true,
      before: true,
      events: ["DELETE", "UPDATE"],
      function_schema: "financial_core",
      function_name: "reject_mutation"
    },
    {
      table_name: tableName,
      trigger_name: truncateTrigger,
      enabled: "A",
      row_level: false,
      before: true,
      events: ["TRUNCATE"],
      function_schema: "financial_core",
      function_name: "reject_mutation"
    }
  ]
).toSorted((left, right) =>
  Buffer.compare(
    Buffer.from(`${left.table_name}\0${left.trigger_name}`, "utf8"),
    Buffer.from(`${right.table_name}\0${right.trigger_name}`, "utf8")
  )
);

assert.deepStrictEqual(
  actualMetadata,
  expected,
  "PostgreSQL immutability trigger catalog differs from the expected policy"
);

const actualTriggerDefinitionCatalogSha256 = createHash("sha256")
  .update(
    JSON.stringify(
      actual.map(
        ({ table_name, trigger_name, definition_sha256 }) => ({
          table_name,
          trigger_name,
          definition_sha256
        })
      )
    )
  )
  .digest("hex");
assert.equal(
  actualTriggerDefinitionCatalogSha256,
  expectedTriggerDefinitionCatalogSha256,
  "PostgreSQL immutability trigger definitions differ from the expected policy"
);

console.log("postgres-immutability-catalog-ok");
