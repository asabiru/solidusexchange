import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const expectedTriggerDefinitionCatalogSha256 =
  "921cdfb3b9fe1888452bf7f2737f2a0bb9885899d15d4798fd2c7f5562f4c49d";

const immediateTriggers = [
  ["ledger_accounts", "ledger_accounts_validate", "validate_account"],
  [
    "ledger_idempotency_registry",
    "ledger_idempotency_validate_acceptance_timestamp",
    "validate_acceptance_artifact_timestamp"
  ],
  [
    "ledger_entries",
    "ledger_entries_reject_sealed_journal",
    "reject_sealed_journal_entry"
  ],
  ["ledger_entries", "ledger_entries_validate_amount", "validate_entry_amount"],
  [
    "ledger_outbox_events",
    "ledger_outbox_validate_acceptance_timestamp",
    "validate_acceptance_artifact_timestamp"
  ],
  [
    "ledger_outbox_delivery_attempts",
    "ledger_delivery_attempts_validate_outbox",
    "validate_delivery_attempt_reference"
  ],
  [
    "posting_rule_registry",
    "posting_rule_registry_validate",
    "validate_posting_rule"
  ],
  [
    "schema_migrations",
    "schema_migrations_validate_sequence",
    "validate_migration_sequence"
  ]
];

const deferredTriggers = [
  ["ledger_entries", "ledger_entries_complete"],
  ["ledger_idempotency_registry", "ledger_idempotency_complete"],
  ["ledger_journal_seals", "ledger_journal_seals_complete"],
  ["ledger_journals", "ledger_journals_complete"],
  ["ledger_outbox_events", "ledger_outbox_complete"]
];

let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
}

const actual = JSON.parse(input);
const actualMetadata = actual.map(
  ({ definition_sha256: _definitionSha256, ...metadata }) => metadata
);
const expected = [
  ...immediateTriggers.map(([tableName, triggerName, functionName]) => ({
    table_name: tableName,
    trigger_name: triggerName,
    enabled: "A",
    row_level: true,
    before: true,
    events: ["INSERT"],
    constraint: false,
    deferrable: false,
    initially_deferred: false,
    function_schema: "financial_core",
    function_name: functionName
  })),
  ...deferredTriggers.map(([tableName, triggerName]) => ({
    table_name: tableName,
    trigger_name: triggerName,
    enabled: "A",
    row_level: true,
    before: false,
    events: ["INSERT"],
    constraint: true,
    deferrable: true,
    initially_deferred: true,
    function_schema: "financial_core",
    function_name: "assert_journal_complete"
  }))
].toSorted((left, right) =>
  Buffer.compare(
    Buffer.from(`${left.table_name}\0${left.trigger_name}`, "utf8"),
    Buffer.from(`${right.table_name}\0${right.trigger_name}`, "utf8")
  )
);

assert.deepStrictEqual(
  actualMetadata,
  expected,
  "PostgreSQL invariant-trigger catalog differs from the expected policy"
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
  "PostgreSQL invariant trigger definitions differ from the expected policy"
);

console.log("postgres-invariant-trigger-catalog-ok");
