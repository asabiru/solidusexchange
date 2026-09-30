import assert from "node:assert/strict";

const immediateTriggers = [
  ["ledger_accounts", "ledger_accounts_validate", "validate_account"],
  [
    "ledger_entries",
    "ledger_entries_reject_sealed_journal",
    "reject_sealed_journal_entry"
  ],
  ["ledger_entries", "ledger_entries_validate_amount", "validate_entry_amount"],
  [
    "ledger_outbox_delivery_attempts",
    "ledger_delivery_attempts_validate_outbox",
    "validate_delivery_attempt_reference"
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
  actual,
  expected,
  "PostgreSQL invariant-trigger catalog differs from the expected policy"
);

console.log("postgres-invariant-trigger-catalog-ok");
