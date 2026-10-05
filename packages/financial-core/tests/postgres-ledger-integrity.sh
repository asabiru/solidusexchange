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

verify_integrity

echo "postgres-ledger-integrity-negative-ok"
