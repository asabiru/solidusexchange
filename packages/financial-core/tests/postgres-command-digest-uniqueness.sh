#!/usr/bin/env bash

set -euo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=ledger_test}"
: "${PGDATABASE:=ledger_test}"
: "${PGPASSWORD:=ledger_test}"

PSQL_DOCKER_IMAGE="${PSQL_DOCKER_IMAGE:-}"
runtime_role="financial_core_runtime_test"
workspace="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
log_dir="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
holder_log="$log_dir/solidchange-command-digest-holder.log"
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

wait_for_advisory_lock() {
  local lock_key="$1"
  local attempt
  local acquired

  for attempt in {1..100}; do
    acquired="$(run_psql -Atq -c "SELECT pg_try_advisory_lock($lock_key);")"
    if [[ "$acquired" == "f" ]]; then
      return 0
    fi
    sleep 0.1
  done

  echo "Timed out waiting for advisory lock $lock_key." >&2
  return 1
}

smoke_digest="(SELECT command_digest FROM financial_core.ledger_journals WHERE journal_id = '70000000-0000-4000-8000-000000000007')"
debit_account="10000000-0000-4000-8000-000000000001"
credit_account="20000000-0000-4000-8000-000000000002"

journal_row() {
  local suffix="$1"
  local legal_entity="$2"
  local digest="$3"
  local accepted_at="$4"

  cat <<SQL
INSERT INTO financial_core.ledger_journals (
  journal_id, journal_type, legal_entity_id, idempotency_key, command_digest,
  correlation_id, effective_at, accepted_at, actor_type, actor_id,
  authorization_reference, policy_version, posting_rule_version, source_type,
  source_reference, evidence_digest, created_at
) VALUES (
  'd${suffix}000000-0000-4000-8000-00000000000${suffix}',
  'SYNTHETIC_PROVIDER_POSITION', '$legal_entity',
  'command-digest-uniqueness-${suffix}-key', $digest,
  'd${suffix}000000-0000-4000-8000-0000000000f${suffix}',
  '$accepted_at', '$accepted_at', 'SERVICE', 'financial-core-runtime-test',
  'digest-uniqueness-authorization-${suffix}', 'ledger-dev-policy-v1',
  'synthetic-provider-position-v1', 'synthetic-test',
  'digest-uniqueness-source-${suffix}', repeat('${suffix}', 64), '$accepted_at'
);
SQL
}

entry_rows() {
  local suffix="$1"
  local legal_entity="$2"
  local debit="$3"
  local credit="$4"
  local amount="$5"
  local accepted_at="$6"

  cat <<SQL
INSERT INTO financial_core.ledger_entries (
  entry_id, journal_id, sequence_number, account_id, legal_entity_id,
  asset_code, side, amount, created_at
) VALUES
  (
    'd${suffix}100000-0000-4000-8000-00000000000${suffix}',
    'd${suffix}000000-0000-4000-8000-00000000000${suffix}', 1, '$debit',
    '$legal_entity', 'TUSDT', 'DEBIT', $amount, '$accepted_at'
  ),
  (
    'd${suffix}200000-0000-4000-8000-00000000000${suffix}',
    'd${suffix}000000-0000-4000-8000-00000000000${suffix}', 2, '$credit',
    '$legal_entity', 'TUSDT', 'CREDIT', $amount, '$accepted_at'
  );
SQL
}

idempotency_row() {
  local suffix="$1"
  local legal_entity="$2"
  local digest="$3"
  local accepted_at="$4"

  cat <<SQL
INSERT INTO financial_core.ledger_idempotency_registry (
  legal_entity_id, idempotency_key, command_digest, journal_id, first_seen_at
) VALUES (
  '$legal_entity', 'command-digest-uniqueness-${suffix}-key', $digest,
  'd${suffix}000000-0000-4000-8000-00000000000${suffix}', '$accepted_at'
);
SQL
}

outbox_row() {
  local suffix="$1"
  local digest="$2"
  local accepted_at="$3"

  cat <<SQL
INSERT INTO financial_core.ledger_outbox_events (
  outbox_id, journal_id, event_type, payload, created_at
) VALUES (
  'd${suffix}300000-0000-4000-8000-00000000000${suffix}',
  'd${suffix}000000-0000-4000-8000-00000000000${suffix}',
  'internal.ledger.journal-accepted.v1',
  jsonb_build_object(
    'journal_id', 'd${suffix}000000-0000-4000-8000-00000000000${suffix}',
    'command_digest', $digest
  ),
  '$accepted_at'
);
SQL
}

seal_row() {
  local suffix="$1"
  local digest="$2"
  local accepted_at="$3"

  cat <<SQL
INSERT INTO financial_core.ledger_journal_seals (
  journal_id, command_digest, entry_count, sealed_at
) VALUES (
  'd${suffix}000000-0000-4000-8000-00000000000${suffix}', $digest, 2, '$accepted_at'
);
SQL
}

complete_journal() {
  local suffix="$1"
  local legal_entity="$2"
  local debit="$3"
  local credit="$4"
  local digest="$5"
  local amount="$6"
  local accepted_at="$7"

  journal_row "$suffix" "$legal_entity" "$digest" "$accepted_at"
  entry_rows "$suffix" "$legal_entity" "$debit" "$credit" "$amount" "$accepted_at"
  idempotency_row "$suffix" "$legal_entity" "$digest" "$accepted_at"
  outbox_row "$suffix" "$digest" "$accepted_at"
  seal_row "$suffix" "$digest" "$accepted_at"
}

completeness_triggers=(
  "ledger_journals ledger_journals_complete"
  "ledger_entries ledger_entries_complete"
  "ledger_idempotency_registry ledger_idempotency_complete"
  "ledger_outbox_events ledger_outbox_complete"
  "ledger_journal_seals ledger_journal_seals_complete"
)

disable_completeness() {
  local pair
  for pair in "${completeness_triggers[@]}"; do
    read -r table trigger <<<"$pair"
    printf 'ALTER TABLE financial_core.%s DISABLE TRIGGER %s;\n' "$table" "$trigger"
  done
}

ledger_state() {
  run_psql -v ON_ERROR_STOP=1 -Atq -c "
    SELECT (SELECT count(*) FROM financial_core.ledger_journals)
      || '/' || (SELECT count(*) FROM financial_core.ledger_entries)
      || '/' || (SELECT count(*) FROM financial_core.ledger_idempotency_registry)
      || '/' || (SELECT count(*) FROM financial_core.ledger_outbox_events)
      || '/' || (SELECT count(*) FROM financial_core.ledger_journal_seals)
      || '/' || (SELECT count(*) FROM financial_core.ledger_accounts);
  "
}

assert_digest_rejected() {
  local description="$1"
  local constraint="$2"
  local statements="$3"
  local output
  local status

  set +e
  output="$(run_psql -v ON_ERROR_STOP=1 -c "
    BEGIN;
    $statements
    COMMIT;
  " 2>&1)"
  status=$?
  set -e

  printf '%s\n' "$output"
  if [[ "$status" -eq 0 ]]; then
    echo "Reused command digest unexpectedly committed: $description" >&2
    exit 1
  fi
  grep -F "duplicate key value violates unique constraint \"$constraint\"" \
    <<<"$output" >/dev/null || {
    echo "Missing $constraint rejection for: $description" >&2
    exit 1
  }
}

run_psql -v ON_ERROR_STOP=1 -Atq -c "
  SELECT 1 / (count(*)::INTEGER)
    FROM pg_catalog.pg_roles
   WHERE rolname = '$runtime_role';
  SELECT 1 / (count(*)::INTEGER)
    FROM financial_core.ledger_journals
   WHERE journal_id = '70000000-0000-4000-8000-000000000007';
" >/dev/null

state_before="$(ledger_state)"

assert_digest_rejected \
  "runtime writer reuses an accepted digest under a new key and different content" \
  ledger_journals_command_digest_unique \
  "SET LOCAL ROLE $runtime_role;
   $(complete_journal 1 solidchange-dev "$debit_account" "$credit_account" \
     "$smoke_digest" 999.5 2026-10-01T10:00:00.000Z)"

assert_digest_rejected \
  "runtime writer reuses an accepted digest in another legal entity" \
  ledger_journals_command_digest_unique \
  "INSERT INTO financial_core.ledger_accounts (
     account_id, chart_version, definition_code, legal_entity_id, asset_code,
     owner_reference, created_at
   ) VALUES
     ('dd000000-0000-4000-8000-0000000000d1', 1, 'TREASURY_ASSET',
      'solidchange-digest-other', 'TUSDT', 'treasury-digest-other',
      '2026-10-01T09:00:00.000Z'),
     ('dd000000-0000-4000-8000-0000000000d2', 1, 'PROVIDER_PAYABLE_LIABILITY',
      'solidchange-digest-other', 'TUSDT', 'provider-digest-other',
      '2026-10-01T09:00:00.000Z');
   SET LOCAL ROLE $runtime_role;
   $(complete_journal 2 solidchange-digest-other \
     dd000000-0000-4000-8000-0000000000d1 dd000000-0000-4000-8000-0000000000d2 \
     "$smoke_digest" 7 2026-10-01T10:01:00.000Z)"

assert_digest_rejected \
  "migration owner in replica mode with completeness disabled reuses a journal digest" \
  ledger_journals_command_digest_unique \
  "SET LOCAL session_replication_role = replica;
   $(disable_completeness)
   $(journal_row 3 solidchange-dev "$smoke_digest" 2026-10-01T10:02:00.000Z)"

assert_digest_rejected \
  "migration owner in replica mode reuses a digest in the idempotency registry" \
  ledger_idempotency_command_digest_unique \
  "SET LOCAL session_replication_role = replica;
   $(disable_completeness)
   $(journal_row 4 solidchange-dev "repeat('4', 63) || 'd'" 2026-10-01T10:03:00.000Z)
   $(idempotency_row 4 solidchange-dev "$smoke_digest" 2026-10-01T10:03:00.000Z)"

assert_digest_rejected \
  "migration owner in replica mode reuses a digest in the outbox payload" \
  ledger_outbox_events_command_digest_unique \
  "SET LOCAL session_replication_role = replica;
   $(disable_completeness)
   $(journal_row 5 solidchange-dev "repeat('5', 63) || 'd'" 2026-10-01T10:04:00.000Z)
   $(outbox_row 5 "$smoke_digest" 2026-10-01T10:04:00.000Z)"

assert_digest_rejected \
  "migration owner in replica mode reuses a digest in the acceptance seal" \
  ledger_journal_seals_command_digest_unique \
  "SET LOCAL session_replication_role = replica;
   $(disable_completeness)
   $(journal_row 6 solidchange-dev "repeat('6', 63) || 'd'" 2026-10-01T10:05:00.000Z)
   $(seal_row 6 "$smoke_digest" 2026-10-01T10:05:00.000Z)"

state_after_rejections="$(ledger_state)"
if [[ "$state_after_rejections" != "$state_before" ]]; then
  echo "Rejected digest reuse changed ledger state: $state_before -> $state_after_rejections" >&2
  exit 1
fi

shared_digest="repeat('7', 63) || 'd'"

run_psql -v ON_ERROR_STOP=1 -c "
  SET ROLE $runtime_role;
  BEGIN;
  $(complete_journal 7 solidchange-dev "$debit_account" "$credit_account" \
    "$shared_digest" 3 2026-10-01T10:06:00.000Z)
  SET CONSTRAINTS ALL IMMEDIATE;
  RESET ROLE;
  SELECT pg_advisory_lock(310041);
  SELECT pg_sleep(5);
  COMMIT;
" >"$holder_log" 2>&1 &
holder_pid=$!

wait_for_advisory_lock 310041

set +e
contender_output="$(run_psql -v ON_ERROR_STOP=1 -c "
  SET ROLE $runtime_role;
  BEGIN;
  $(complete_journal 8 solidchange-dev "$debit_account" "$credit_account" \
    "$shared_digest" 4 2026-10-01T10:07:00.000Z)
  COMMIT;
" 2>&1)"
contender_status=$?
set -e

holder_status=0
wait "$holder_pid" || holder_status=$?
cat "$holder_log"
printf '%s\n' "$contender_output"

if [[ "$holder_status" -ne 0 ]]; then
  echo "First concurrent runtime journal with a fresh digest failed." >&2
  exit 1
fi
if [[ "$contender_status" -eq 0 ]]; then
  echo "Concurrent runtime journal reusing an uncommitted digest unexpectedly committed." >&2
  exit 1
fi
grep -F 'duplicate key value violates unique constraint "ledger_journals_command_digest_unique"' \
  <<<"$contender_output"

run_psql -v ON_ERROR_STOP=1 -Atq -c "
  SELECT CASE
    WHEN (SELECT count(*) FROM financial_core.ledger_journals
          WHERE command_digest = repeat('7', 63) || 'd') = 1
     AND (SELECT count(*) FROM financial_core.ledger_journals
          WHERE journal_id = 'd7000000-0000-4000-8000-000000000007') = 1
     AND (SELECT count(*) FROM financial_core.ledger_journals
          WHERE journal_id = 'd8000000-0000-4000-8000-000000000008') = 0
     AND NOT EXISTS (
       SELECT 1 FROM financial_core.ledger_journals
        GROUP BY command_digest HAVING count(*) > 1
     )
    THEN 'concurrent-command-digest-ok'
    ELSE 'concurrent-command-digest-failed'
  END;
" | grep -Fx "concurrent-command-digest-ok"

echo "postgres-command-digest-uniqueness-ok"
