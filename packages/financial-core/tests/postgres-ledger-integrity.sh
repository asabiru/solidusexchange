#!/usr/bin/env bash

set -euo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=ledger_test}"
: "${PGDATABASE:=ledger_test}"
: "${PGPASSWORD:=ledger_test}"

PSQL_DOCKER_IMAGE="${PSQL_DOCKER_IMAGE:-}"
workspace="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$workspace"

run_psql() {
  if [[ -n "$PSQL_DOCKER_IMAGE" ]]; then
    docker run --rm -i --network host \
      -e PGPASSWORD="$PGPASSWORD" \
      -v "$workspace:/workspace:ro" -w /workspace \
      "$PSQL_DOCKER_IMAGE" \
      psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" "$@"
  else
    PGPASSWORD="$PGPASSWORD" \
      psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" "$@"
  fi
}

completeness_triggers=(
  "ledger_journals ledger_journals_complete"
  "ledger_entries ledger_entries_complete"
  "ledger_idempotency_registry ledger_idempotency_complete"
  "ledger_outbox_events ledger_outbox_complete"
  "ledger_journal_seals ledger_journal_seals_complete"
)

toggle_completeness() {
  local action="$1"
  local pair
  for pair in "${completeness_triggers[@]}"; do
    read -r table trigger <<<"$pair"
    printf 'ALTER TABLE financial_core.%s %s TRIGGER %s;\n' "$table" "$action" "$trigger"
  done
}

journal_row() {
  local journal_id="$1"
  local key="$2"
  local digest="$3"
  local created_at="${4:-2026-09-25T12:00:00.000Z}"

  cat <<SQL
INSERT INTO financial_core.ledger_journals (
  journal_id, journal_type, legal_entity_id, idempotency_key, command_digest,
  correlation_id, effective_at, accepted_at, actor_type, actor_id,
  authorization_reference, policy_version, posting_rule_version, source_type,
  source_reference, evidence_digest, created_at
) VALUES (
  '$journal_id', 'SYNTHETIC_PROVIDER_POSITION', 'solidchange-dev', '$key',
  $digest, 'e9000000-0000-4000-8000-0000000000e9',
  '2026-09-25T11:59:59.000Z', '2026-09-25T12:00:00.000Z', 'SERVICE',
  'financial-core-test', 'synthetic-integrity-authorization',
  'ledger-dev-policy-v1', 'synthetic-provider-position-v1', 'synthetic-test',
  'synthetic-integrity-source', repeat('a', 64), '$created_at'
);
SQL
}

entry_row() {
  local entry_id="$1"
  local journal_id="$2"
  local sequence="$3"
  local account_id="$4"
  local side="$5"
  local amount="$6"
  local legal_entity="${7:-solidchange-dev}"

  cat <<SQL
INSERT INTO financial_core.ledger_entries (
  entry_id, journal_id, sequence_number, account_id, legal_entity_id,
  asset_code, side, amount, created_at
) VALUES (
  '$entry_id', '$journal_id', $sequence, '$account_id', '$legal_entity',
  'TUSDT', '$side', $amount, '2026-09-25T12:00:00.000Z'
);
SQL
}

artifact_rows() {
  local journal_id="$1"
  local key="$2"
  local digest="$3"
  local outbox_id="$4"
  local entry_count="$5"

  cat <<SQL
INSERT INTO financial_core.ledger_idempotency_registry (
  legal_entity_id, idempotency_key, command_digest, journal_id, first_seen_at
) VALUES (
  'solidchange-dev', '$key', $digest, '$journal_id', '2026-09-25T12:00:00.000Z'
);
INSERT INTO financial_core.ledger_outbox_events (
  outbox_id, journal_id, event_type, payload, created_at
) VALUES (
  '$outbox_id', '$journal_id', 'internal.ledger.journal-accepted.v1',
  jsonb_build_object('journal_id', '$journal_id', 'command_digest', $digest),
  '2026-09-25T12:00:00.000Z'
);
INSERT INTO financial_core.ledger_journal_seals (
  journal_id, command_digest, entry_count, sealed_at
) VALUES ('$journal_id', $digest, $entry_count, '2026-09-25T12:00:00.000Z');
SQL
}

debit_account="10000000-0000-4000-8000-000000000001"
credit_account="20000000-0000-4000-8000-000000000002"

complete_journal() {
  local suffix="$1"
  local digest="$2"
  local debit_amount="$3"
  local credit_amount="${4:-$3}"
  local journal_id="e${suffix}000000-0000-4000-8000-00000000000${suffix}"
  local key="postgres-integrity-${suffix}-key"

  journal_row "$journal_id" "$key" "$digest"
  entry_row "e${suffix}100000-0000-4000-8000-00000000000${suffix}" "$journal_id" 1 \
    "$debit_account" DEBIT "$debit_amount"
  entry_row "e${suffix}200000-0000-4000-8000-00000000000${suffix}" "$journal_id" 2 \
    "$credit_account" CREDIT "$credit_amount"
  artifact_rows "$journal_id" "$key" "$digest" \
    "e${suffix}300000-0000-4000-8000-00000000000${suffix}" 2
}

verify_integrity() {
  run_psql -v ON_ERROR_STOP=1 -Atq -f tests/postgres-ledger-integrity.sql \
    | node scripts/verify-postgres-ledger-integrity.mjs
}

verify_with_drift() {
  local statements="$1"

  {
    printf '%s\n' "BEGIN;" "$statements"
    cat tests/postgres-ledger-integrity.sql
    printf '%s\n' "ROLLBACK;"
  } | run_psql -v ON_ERROR_STOP=1 -Atq \
    | node scripts/verify-postgres-ledger-integrity.mjs 2>&1
}

assert_integrity_rejected() {
  local description="$1"
  local statements="$2"
  shift 2
  local output
  local status
  local expected

  set +e
  output="$(verify_with_drift "$statements")"
  status=$?
  set -e

  printf '%s\n' "$output"
  if [[ "$status" -eq 0 ]]; then
    echo "Invalid persisted ledger state unexpectedly passed: $description" >&2
    exit 1
  fi
  for expected in "$@"; do
    grep -F "\"check\":\"$expected\"" <<<"$output" >/dev/null || {
      echo "Missing $expected violation for: $description" >&2
      exit 1
    }
  done
}

assert_integrity_accepted() {
  local description="$1"
  local statements="$2"
  local output
  local status

  set +e
  output="$(verify_with_drift "$statements")"
  status=$?
  set -e

  printf '%s\n' "$output"
  if [[ "$status" -ne 0 ]]; then
    echo "Valid persisted ledger state unexpectedly failed: $description" >&2
    exit 1
  fi
}

verify_integrity

assert_integrity_accepted \
  "complete balanced journal accepted by every deferred trigger" \
  "$(complete_journal 1 "repeat('1', 64)" 2.5)
SET CONSTRAINTS ALL IMMEDIATE;"

assert_integrity_rejected \
  "migration owner disables completeness triggers for a one-entry unbalanced journal" \
  "$(toggle_completeness DISABLE)
$(journal_row e2000000-0000-4000-8000-000000000002 postgres-integrity-2-key "repeat('2', 64)")
$(entry_row e2100000-0000-4000-8000-000000000002 e2000000-0000-4000-8000-000000000002 1 "$debit_account" DEBIT 1000000)
$(toggle_completeness 'ENABLE ALWAYS')
SET CONSTRAINTS ALL IMMEDIATE;" \
  journal_entry_count journal_unbalanced_asset journal_idempotency journal_outbox journal_seal

assert_integrity_rejected \
  "migration owner disables completeness triggers for a two-entry unbalanced journal" \
  "$(toggle_completeness DISABLE)
$(complete_journal 3 "repeat('b', 64)" 5 4)
$(toggle_completeness 'ENABLE ALWAYS')" \
  journal_unbalanced_asset

assert_integrity_rejected \
  "migration owner omits the acceptance seal" \
  "$(toggle_completeness DISABLE)
$(complete_journal 4 "repeat('4', 64)" 7 | sed '/ledger_journal_seals (/,$d')
$(toggle_completeness 'ENABLE ALWAYS')" \
  journal_seal

assert_integrity_rejected \
  "migration owner drops digest uniqueness and reuses an accepted command digest for different journal content" \
  "ALTER TABLE financial_core.ledger_journals DROP CONSTRAINT ledger_journals_command_digest_unique;
ALTER TABLE financial_core.ledger_idempotency_registry DROP CONSTRAINT ledger_idempotency_command_digest_unique;
ALTER TABLE financial_core.ledger_journal_seals DROP CONSTRAINT ledger_journal_seals_command_digest_unique;
DROP INDEX financial_core.ledger_outbox_events_command_digest_unique;
$(complete_journal 5 "(SELECT command_digest FROM financial_core.ledger_journals WHERE journal_id = '70000000-0000-4000-8000-000000000007')" 7)
SET CONSTRAINTS ALL IMMEDIATE;" \
  journal_command_digest_reused

assert_integrity_rejected \
  "migration owner disables amount validation for over-scale amounts" \
  "ALTER TABLE financial_core.ledger_entries DISABLE TRIGGER ledger_entries_validate_amount;
$(complete_journal 6 "repeat('6', 64)" 1.0000001)
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE financial_core.ledger_entries ENABLE ALWAYS TRIGGER ledger_entries_validate_amount;" \
  entry_amount_scale

assert_integrity_rejected \
  "migration owner disables amount and completeness validation for NaN amounts" \
  "ALTER TABLE financial_core.ledger_entries DISABLE TRIGGER ledger_entries_validate_amount;
$(toggle_completeness DISABLE)
$(complete_journal 7 "repeat('7', 64)" "'NaN'::NUMERIC")
$(toggle_completeness 'ENABLE ALWAYS')
ALTER TABLE financial_core.ledger_entries ENABLE ALWAYS TRIGGER ledger_entries_validate_amount;" \
  entry_amount_nonfinite

assert_integrity_rejected \
  "migration owner uses replica mode and disabled completeness for a foreign legal entity" \
  "SET LOCAL session_replication_role = replica;
$(toggle_completeness DISABLE)
$(journal_row e8000000-0000-4000-8000-000000000008 postgres-integrity-8-key "repeat('8', 64)")
$(entry_row e8100000-0000-4000-8000-000000000008 e8000000-0000-4000-8000-000000000008 1 "$debit_account" DEBIT 9 other-entity)
$(entry_row e8200000-0000-4000-8000-000000000008 e8000000-0000-4000-8000-000000000008 2 "$credit_account" CREDIT 9 other-entity)
$(artifact_rows e8000000-0000-4000-8000-000000000008 postgres-integrity-8-key "repeat('8', 64)" e8300000-0000-4000-8000-000000000008 2)
$(toggle_completeness 'ENABLE ALWAYS')
SET LOCAL session_replication_role = origin;" \
  entry_reference

assert_integrity_rejected \
  "migration owner disables completeness for a backdated journal creation timestamp" \
  "$(toggle_completeness DISABLE)
$(journal_row e9000000-0000-4000-8000-000000000009 postgres-integrity-9-key "repeat('9', 64)" 2026-09-25T11:00:00.000Z)
$(entry_row e9100000-0000-4000-8000-000000000009 e9000000-0000-4000-8000-000000000009 1 "$debit_account" DEBIT 3)
$(entry_row e9200000-0000-4000-8000-000000000009 e9000000-0000-4000-8000-000000000009 2 "$credit_account" CREDIT 3)
$(artifact_rows e9000000-0000-4000-8000-000000000009 postgres-integrity-9-key "repeat('9', 64)" e9300000-0000-4000-8000-000000000009 2)
$(toggle_completeness 'ENABLE ALWAYS')" \
  journal_timestamps

assert_integrity_rejected \
  "migration owner drops the uuid shape constraint and stores a nil correlation id" \
  "ALTER TABLE financial_core.ledger_journals
     DROP CONSTRAINT ledger_journals_correlation_id_rfc_shape;
$(toggle_completeness DISABLE)
$(journal_row ea000000-0000-4000-8000-00000000000a postgres-integrity-a-key "repeat('a', 64)" | sed 's/e9000000-0000-4000-8000-0000000000e9/00000000-0000-0000-0000-000000000000/')
$(entry_row ea100000-0000-4000-8000-00000000000a ea000000-0000-4000-8000-00000000000a 1 "$debit_account" DEBIT 3)
$(entry_row ea200000-0000-4000-8000-00000000000a ea000000-0000-4000-8000-00000000000a 2 "$credit_account" CREDIT 3)
$(artifact_rows ea000000-0000-4000-8000-00000000000a postgres-integrity-a-key "repeat('a', 64)" ea300000-0000-4000-8000-00000000000a 2)
$(toggle_completeness 'ENABLE ALWAYS')
ALTER TABLE financial_core.ledger_journals
  ADD CONSTRAINT ledger_journals_correlation_id_rfc_shape
  CHECK (
    correlation_id::TEXT ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) NOT VALID;" \
  journal_uuid_shape

assert_integrity_rejected \
  "migration owner drops the timestamp range constraint and stores a five-digit year" \
  "ALTER TABLE financial_core.ledger_journals
     DROP CONSTRAINT ledger_journals_effective_at_range;
$(toggle_completeness DISABLE)
$(journal_row eb000000-0000-4000-8000-00000000000b postgres-integrity-b-key "repeat('9', 64)" | sed 's/2026-09-25T11:59:59.000Z/15000-01-01T00:00:00Z/')
$(entry_row eb100000-0000-4000-8000-00000000000b eb000000-0000-4000-8000-00000000000b 1 "$debit_account" DEBIT 3)
$(entry_row eb200000-0000-4000-8000-00000000000b eb000000-0000-4000-8000-00000000000b 2 "$credit_account" CREDIT 3)
$(artifact_rows eb000000-0000-4000-8000-00000000000b postgres-integrity-b-key "repeat('9', 64)" eb300000-0000-4000-8000-00000000000b 2)
$(toggle_completeness 'ENABLE ALWAYS')
ALTER TABLE financial_core.ledger_journals
  ADD CONSTRAINT ledger_journals_effective_at_range
  CHECK (
    effective_at >= '0001-01-01 00:00:00+14:00'::TIMESTAMPTZ
    AND effective_at <= '9999-12-31 23:59:59.999999-14:00'::TIMESTAMPTZ
  ) NOT VALID;" \
  journal_timestamp_range

assert_integrity_rejected \
  "migration owner drops entry and artifact uuid shape constraints for non-RFC identifiers" \
  "ALTER TABLE financial_core.ledger_entries
     DROP CONSTRAINT ledger_entries_entry_id_rfc_shape;
ALTER TABLE financial_core.ledger_outbox_events
     DROP CONSTRAINT ledger_outbox_outbox_id_rfc_shape;
$(toggle_completeness DISABLE)
$(journal_row ec000000-0000-4000-8000-00000000000c postgres-integrity-c-key "repeat('8', 64)")
$(entry_row ec100000-0000-4000-8000-00000000000c ec000000-0000-4000-8000-00000000000c 1 "$debit_account" DEBIT 3 | sed 's/ec100000-0000-4000-8000-00000000000c/11111111-1111-1111-1111-111111111111/')
$(entry_row ec200000-0000-4000-8000-00000000000c ec000000-0000-4000-8000-00000000000c 2 "$credit_account" CREDIT 3)
$(artifact_rows ec000000-0000-4000-8000-00000000000c postgres-integrity-c-key "repeat('8', 64)" ffffffff-ffff-ffff-ffff-ffffffffffff 2)
$(toggle_completeness 'ENABLE ALWAYS')
ALTER TABLE financial_core.ledger_entries
  ADD CONSTRAINT ledger_entries_entry_id_rfc_shape
  CHECK (
    entry_id::TEXT ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) NOT VALID;
ALTER TABLE financial_core.ledger_outbox_events
  ADD CONSTRAINT ledger_outbox_outbox_id_rfc_shape
  CHECK (
    outbox_id::TEXT ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) NOT VALID;" \
  entry_uuid_shape artifact_uuid_shape

assert_integrity_rejected \
  "migration owner drops singleton and uuid guards for a version-2 account definition" \
  "ALTER TABLE financial_core.account_definitions
     DROP CONSTRAINT account_definitions_chart_version_singleton;
ALTER TABLE financial_core.ledger_accounts
     DROP CONSTRAINT ledger_accounts_chart_version_singleton;
ALTER TABLE financial_core.ledger_accounts
     DROP CONSTRAINT ledger_accounts_account_id_rfc_shape;
INSERT INTO financial_core.account_definitions (
   chart_version, definition_code, category, account_class, normal_side,
   owner_scope, purpose, created_at
 ) VALUES (
   2, 'DRIFT_V2_DEF', 'treasury', 'ASSET', 'DEBIT', 'optional',
   'Drifted version-two account definition.', '2026-09-25T12:00:00.000Z'
 );
INSERT INTO financial_core.ledger_accounts (
   account_id, chart_version, definition_code, legal_entity_id, asset_code,
   owner_reference, created_at
 ) VALUES (
   '00000000-0000-0000-0000-000000000000', 2, 'DRIFT_V2_DEF', 'solidchange-dev',
   'TUSDT', 'drift', '2026-09-25T12:00:00.000Z'
 );
ALTER TABLE financial_core.account_definitions
  ADD CONSTRAINT account_definitions_chart_version_singleton
  CHECK (chart_version = 1) NOT VALID;
ALTER TABLE financial_core.ledger_accounts
  ADD CONSTRAINT ledger_accounts_chart_version_singleton
  CHECK (chart_version = 1) NOT VALID;
ALTER TABLE financial_core.ledger_accounts
  ADD CONSTRAINT ledger_accounts_account_id_rfc_shape
  CHECK (
    account_id::TEXT ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) NOT VALID;" \
  account_uuid_shape chart_version_singleton

assert_integrity_rejected \
  "migration owner disables rule validation and drops the version singleton for a malformed rule" \
  "ALTER TABLE financial_core.posting_rule_registry
     DISABLE TRIGGER posting_rule_registry_validate;
ALTER TABLE financial_core.posting_rule_registry
     DROP CONSTRAINT posting_rule_registry_version_singleton;
INSERT INTO financial_core.posting_rule_registry (
   registry_version, journal_type, posting_rule_version, status, runtime_boundary,
   production_execution_enabled, scope, allowed_actor_types, entry_pattern,
   purpose, created_at
 ) VALUES (
   2, 'DRIFT_RULE', 'drift-rule-v1', 'draft', 'dev-dry-run', FALSE,
   'synthetic-test-only', ARRAY['SERVICE', 'SERVICE'],
   '[{\"definition_code\":\"TREASURY_ASSET\",\"side\":\"DEBIT\"},{\"definition_code\":\"TREASURY_ASSET\",\"side\":\"DEBIT\"}]'::JSONB,
   'Drifted malformed posting rule.', '2026-09-25T12:00:00.000Z'
 );
ALTER TABLE financial_core.posting_rule_registry
  ADD CONSTRAINT posting_rule_registry_version_singleton
  CHECK (registry_version = 1) NOT VALID;
ALTER TABLE financial_core.posting_rule_registry
  ENABLE ALWAYS TRIGGER posting_rule_registry_validate;" \
  rule_registry_shape

assert_integrity_rejected \
  "migration owner drops artifact timestamp range for a delivery attempt year 15000" \
  "ALTER TABLE financial_core.ledger_outbox_delivery_attempts
     DROP CONSTRAINT ledger_delivery_attempts_attempted_at_range;
INSERT INTO financial_core.ledger_outbox_delivery_attempts (
   delivery_id, outbox_id, attempted_at, outcome, response_digest, error_code
 ) VALUES (
   'ed000000-0000-4000-8000-00000000000d',
   'b0000000-0000-4000-8000-00000000000b',
   '15000-01-01T00:00:00Z', 'FAILED', NULL, 'DRIFT_PROBE'
 );
ALTER TABLE financial_core.ledger_outbox_delivery_attempts
  ADD CONSTRAINT ledger_delivery_attempts_attempted_at_range
  CHECK (
    attempted_at >= '0001-01-01 00:00:00+14:00'::TIMESTAMPTZ
    AND attempted_at <= '9999-12-31 23:59:59.999999-14:00'::TIMESTAMPTZ
  ) NOT VALID;" \
  artifact_timestamp_range

assert_integrity_rejected \
  "migration owner drops config timestamp range for a BC account definition" \
  "ALTER TABLE financial_core.account_definitions
     DROP CONSTRAINT account_definitions_created_at_range;
INSERT INTO financial_core.account_definitions (
   chart_version, definition_code, category, account_class, normal_side,
   owner_scope, purpose, created_at
 ) VALUES (
   1, 'DRIFT_BC_DEF', 'treasury', 'ASSET', 'DEBIT', 'optional',
   'Drifted BC-dated account definition.', '0100-06-01 00:00:00 BC'
 );
ALTER TABLE financial_core.account_definitions
  ADD CONSTRAINT account_definitions_created_at_range
  CHECK (
    created_at >= '0001-01-01 00:00:00+14:00'::TIMESTAMPTZ
    AND created_at <= '9999-12-31 23:59:59.999999-14:00'::TIMESTAMPTZ
  ) NOT VALID;" \
  config_timestamp_range

verify_integrity

echo "postgres-ledger-integrity-negative-ok"
