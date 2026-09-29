#!/usr/bin/env bash

set -euo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=ledger_test}"
: "${PGDATABASE:=ledger_test}"
: "${PGPASSWORD:=ledger_test}"

PSQL_DOCKER_IMAGE="${PSQL_DOCKER_IMAGE:-}"
workspace="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
log_dir="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
acceptance_log="$log_dir/solidchange-concurrent-acceptance.log"

run_psql() {
  if [[ -n "$PSQL_DOCKER_IMAGE" ]]; then
    docker run --rm --network host \
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

run_psql -v ON_ERROR_STOP=1 -c "
  INSERT INTO financial_core.ledger_assets (
    asset_code,
    decimal_places,
    enabled_for_posting,
    evidence_reference,
    created_at
  ) VALUES (
    'TCON',
    6,
    TRUE,
    'synthetic-concurrency-asset',
    '2026-09-25T11:00:00.000Z'
  );

  INSERT INTO financial_core.ledger_accounts (
    account_id,
    chart_version,
    definition_code,
    legal_entity_id,
    asset_code,
    owner_reference,
    created_at
  ) VALUES
    (
      'ab000000-0000-4000-8000-0000000000b1',
      1,
      'TREASURY_ASSET',
      'solidchange-dev',
      'TCON',
      'treasury-concurrency',
      '2026-09-25T11:00:00.000Z'
    ),
    (
      'ab000000-0000-4000-8000-0000000000b2',
      1,
      'PROVIDER_PAYABLE_LIABILITY',
      'solidchange-dev',
      'TCON',
      'provider-concurrency',
      '2026-09-25T11:00:00.000Z'
    );
"

run_psql -v ON_ERROR_STOP=1 -c "
  BEGIN;

  INSERT INTO financial_core.ledger_journals (
    journal_id,
    journal_type,
    legal_entity_id,
    idempotency_key,
    command_digest,
    correlation_id,
    causation_id,
    effective_at,
    accepted_at,
    actor_type,
    actor_id,
    authorization_reference,
    policy_version,
    posting_rule_version,
    source_type,
    source_reference,
    evidence_digest,
    created_at
  ) VALUES (
    'aa000000-0000-4000-8000-0000000000a1',
    'SYNTHETIC_PROVIDER_POSITION',
    'solidchange-dev',
    'concurrent-acceptance-demo-001',
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'aa000000-0000-4000-8000-0000000000a2',
    NULL,
    '2026-09-25T11:00:00.000Z',
    '2026-09-25T11:00:01.000Z',
    'SERVICE',
    'financial-core-test',
    'policy-decision-concurrency-001',
    'ledger-dev-policy-v1',
    'synthetic-provider-position-v1',
    'synthetic-test',
    'concurrency-source-001',
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    '2026-09-25T11:00:01.000Z'
  );

  INSERT INTO financial_core.ledger_entries (
    entry_id,
    journal_id,
    sequence_number,
    account_id,
    legal_entity_id,
    asset_code,
    side,
    amount,
    created_at
  ) VALUES
    (
      'aa000000-0000-4000-8000-0000000000a3',
      'aa000000-0000-4000-8000-0000000000a1',
      1,
      '10000000-0000-4000-8000-000000000001',
      'solidchange-dev',
      'TUSDT',
      'DEBIT',
      10.000000,
      '2026-09-25T11:00:01.000Z'
    ),
    (
      'aa000000-0000-4000-8000-0000000000a4',
      'aa000000-0000-4000-8000-0000000000a1',
      2,
      '20000000-0000-4000-8000-000000000002',
      'solidchange-dev',
      'TUSDT',
      'CREDIT',
      10.000000,
      '2026-09-25T11:00:01.000Z'
    );

  INSERT INTO financial_core.ledger_idempotency_registry (
    legal_entity_id,
    idempotency_key,
    command_digest,
    journal_id,
    first_seen_at
  ) VALUES (
    'solidchange-dev',
    'concurrent-acceptance-demo-001',
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'aa000000-0000-4000-8000-0000000000a1',
    '2026-09-25T11:00:01.000Z'
  );

  INSERT INTO financial_core.ledger_outbox_events (
    outbox_id,
    journal_id,
    event_type,
    payload,
    created_at
  ) VALUES (
    'aa000000-0000-4000-8000-0000000000a5',
    'aa000000-0000-4000-8000-0000000000a1',
    'internal.ledger.journal-accepted.v1',
    jsonb_build_object(
      'journal_id', 'aa000000-0000-4000-8000-0000000000a1',
      'command_digest', 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
    ),
    '2026-09-25T11:00:01.000Z'
  );

  INSERT INTO financial_core.ledger_journal_seals (
    journal_id,
    command_digest,
    entry_count,
    sealed_at
  ) VALUES (
    'aa000000-0000-4000-8000-0000000000a1',
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    2,
    '2026-09-25T11:00:01.000Z'
  );

  SELECT pg_advisory_lock(310031);
  SELECT pg_sleep(10);
  COMMIT;
" >"$acceptance_log" 2>&1 &
acceptance_pid=$!

wait_for_advisory_lock 310031

set +e
overlap_output="$(run_psql -v ON_ERROR_STOP=1 -c "
  BEGIN;
  INSERT INTO financial_core.ledger_entries (
    entry_id,
    journal_id,
    sequence_number,
    account_id,
    legal_entity_id,
    asset_code,
    side,
    amount,
    created_at
  ) VALUES
    (
      'aa000000-0000-4000-8000-0000000000a6',
      'aa000000-0000-4000-8000-0000000000a1',
      3,
      'ab000000-0000-4000-8000-0000000000b1',
      'solidchange-dev',
      'TCON',
      'DEBIT',
      1.000000,
      '2026-09-25T11:00:02.000Z'
    ),
    (
      'aa000000-0000-4000-8000-0000000000a7',
      'aa000000-0000-4000-8000-0000000000a1',
      4,
      'ab000000-0000-4000-8000-0000000000b2',
      'solidchange-dev',
      'TCON',
      'CREDIT',
      1.000000,
      '2026-09-25T11:00:02.000Z'
    );
  COMMIT;
" 2>&1)"
overlap_status=$?
set -e

wait "$acceptance_pid"
cat "$acceptance_log"
printf '%s\n' "$overlap_output"

if [[ "$overlap_status" -eq 0 ]]; then
  echo "Concurrent late entries unexpectedly committed." >&2
  exit 1
fi
grep -F 'violates foreign key constraint "ledger_entries_journal_id_legal_entity_id_fkey"' \
  <<<"$overlap_output"

set +e
sealed_entry_output="$(run_psql -v ON_ERROR_STOP=1 -c "
  BEGIN;
  INSERT INTO financial_core.ledger_entries (
    entry_id,
    journal_id,
    sequence_number,
    account_id,
    legal_entity_id,
    asset_code,
    side,
    amount,
    created_at
  ) VALUES
    (
      'aa000000-0000-4000-8000-0000000000a8',
      'aa000000-0000-4000-8000-0000000000a1',
      3,
      'ab000000-0000-4000-8000-0000000000b1',
      'solidchange-dev',
      'TCON',
      'DEBIT',
      1.000000,
      '2026-09-25T11:00:03.000Z'
    ),
    (
      'aa000000-0000-4000-8000-0000000000a9',
      'aa000000-0000-4000-8000-0000000000a1',
      4,
      'ab000000-0000-4000-8000-0000000000b2',
      'solidchange-dev',
      'TCON',
      'CREDIT',
      1.000000,
      '2026-09-25T11:00:03.000Z'
    );
  COMMIT;
" 2>&1)"
sealed_entry_status=$?
set -e

printf '%s\n' "$sealed_entry_output"
if [[ "$sealed_entry_status" -eq 0 ]]; then
  echo "Post-acceptance late entries unexpectedly committed." >&2
  exit 1
fi
grep -F "journal aa000000-0000-4000-8000-0000000000a1 is sealed" \
  <<<"$sealed_entry_output"

run_psql -v ON_ERROR_STOP=1 -Atq -c "
  SELECT CASE
    WHEN (SELECT count(*) FROM financial_core.ledger_entries
          WHERE journal_id = 'aa000000-0000-4000-8000-0000000000a1') = 2
     AND (SELECT count(*) FROM financial_core.ledger_journal_seals
          WHERE journal_id = 'aa000000-0000-4000-8000-0000000000a1') = 1
    THEN 'concurrent-late-entry-ok'
    ELSE 'concurrent-late-entry-failed'
  END;
" | grep -Fx "concurrent-late-entry-ok"
