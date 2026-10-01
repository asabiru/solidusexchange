import assert from "node:assert/strict";

const sourceHashes = [
  [
    "assert_journal_complete",
    "4e1a98ab0f8c17b5f8766964a6e5dcad8c544c6a42de6cf93ca5189b505d074d"
  ],
  [
    "reject_mutation",
    "847ab651294717b019cd3bff394cd1d760125f29586fd61b88ed5633957e1cf0"
  ],
  [
    "reject_sealed_journal_entry",
    "4eb506b1c167b6e0e3cecaca098d39a3e595cb8c9aad13f43a94513b5a97098a"
  ],
  [
    "validate_acceptance_artifact_timestamp",
    "86b347d14d51fb8b4414b7991accb790e595bb8b02534185e27476c2e81202f7"
  ],
  [
    "validate_account",
    "daf3a4ff8ddbfd73792cf187470c59e73cdf5d8c5537aaafed5d937d30993b69"
  ],
  [
    "validate_delivery_attempt_reference",
    "92bb59f42b959f9091e8787dc889b2c4af5a57a17ebcbceed6bb64892c5fd1a1"
  ],
  [
    "validate_entry_amount",
    "2e2f6652dd1c9895f6849cfb1de46c5f5a6498c0fe000646157dc509832240bf"
  ]
];

let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
}

const actual = JSON.parse(input);
const expected = sourceHashes.map(([functionName, sourceSha256]) => ({
  function_schema: "financial_core",
  function_name: functionName,
  identity_arguments: "",
  language: "plpgsql",
  return_type: "trigger",
  security_definer: false,
  leakproof: false,
  strict: false,
  volatility: "volatile",
  parallel: "unsafe",
  config: ["search_path=financial_core, pg_catalog"],
  non_owner_execute: false,
  public_execute: false,
  source_sha256: sourceSha256
}));

assert.deepStrictEqual(
  actual,
  expected,
  "PostgreSQL trigger-function catalog differs from the expected policy"
);

console.log("postgres-trigger-function-catalog-ok");
