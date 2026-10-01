#!/usr/bin/env bash

set -euo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=ledger_test}"
: "${PGDATABASE:=ledger_test}"
: "${PGPASSWORD:=ledger_test}"
: "${RESTORE_DATABASE:=${PGDATABASE}_restore_test}"
: "${CORRUPT_RESTORE_DATABASE:=${PGDATABASE}_corrupt_restore_test}"
: "${CONSISTENCY_RESTORE_DATABASE:=${PGDATABASE}_consistency_restore_test}"

PSQL_DOCKER_IMAGE="${PSQL_DOCKER_IMAGE:-}"
workspace="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

validate_restore_database() {
  local database="$1"
  if [[ "$database" == "$PGDATABASE" ]]; then
    echo "Restore database must differ from the source database." >&2
    exit 1
  fi
  if [[ ! "$database" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
    echo "Restore database must be a PostgreSQL identifier." >&2
    exit 1
  fi
  if [[ "$database" != *_restore_test ]]; then
    echo "Restore database must use the disposable _restore_test suffix." >&2
    exit 1
  fi
}

validate_restore_database "$RESTORE_DATABASE"
validate_restore_database "$CORRUPT_RESTORE_DATABASE"
validate_restore_database "$CONSISTENCY_RESTORE_DATABASE"

if [[ "$CORRUPT_RESTORE_DATABASE" == "$RESTORE_DATABASE" ]] ||
  [[ "$CONSISTENCY_RESTORE_DATABASE" == "$RESTORE_DATABASE" ]] ||
  [[ "$CONSISTENCY_RESTORE_DATABASE" == "$CORRUPT_RESTORE_DATABASE" ]]; then
  echo "Disposable restore databases must differ." >&2
  exit 1
fi

backup_path="$(mktemp "${TMPDIR:-/tmp}/financial-core-backup.XXXXXX.dump")"
corrupt_backup_path="$(mktemp "${TMPDIR:-/tmp}/financial-core-backup-corrupt.XXXXXX.dump")"
consistency_backup_path="$(mktemp "${TMPDIR:-/tmp}/financial-core-backup-consistency.XXXXXX.dump")"
consistency_log="$(mktemp "${TMPDIR:-/tmp}/financial-core-backup-consistency.XXXXXX.log")"
consistency_writer_pid=""

run_pg_tool() {
  if [[ -n "$PSQL_DOCKER_IMAGE" ]]; then
    docker run --rm -i --network host \
      -e PGPASSWORD="$PGPASSWORD" \
      -v "$workspace:/workspace:ro" -w /workspace \
      "$PSQL_DOCKER_IMAGE" \
      "$@"
  else
    PGPASSWORD="$PGPASSWORD" "$@"
  fi
}

run_psql() {
  local database="$1"
  shift
  run_pg_tool \
    psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$database" "$@"
}

drop_restore_database() {
  local database="$1"
  run_pg_tool \
    dropdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" \
      --if-exists --force "$database"
}

cleanup() {
  if [[ -n "$consistency_writer_pid" ]] && kill -0 "$consistency_writer_pid" 2>/dev/null; then
    kill "$consistency_writer_pid" 2>/dev/null || true
    wait "$consistency_writer_pid" 2>/dev/null || true
  fi
  drop_restore_database "$RESTORE_DATABASE"
  drop_restore_database "$CORRUPT_RESTORE_DATABASE"
  drop_restore_database "$CONSISTENCY_RESTORE_DATABASE"
  rm -f \
    "$backup_path" \
    "$corrupt_backup_path" \
    "$consistency_backup_path" \
    "$consistency_log"
}
trap cleanup EXIT

snapshot() {
  local database="$1"
  run_psql "$database" \
    -v ON_ERROR_STOP=1 \
    -Atq \
    -f tests/postgres-state-snapshot.sql
}

wait_for_advisory_lock() {
  local lock_key="$1"
  local attempt
  local acquired

  for attempt in {1..100}; do
    acquired="$(run_psql "$PGDATABASE" -Atq -c "SELECT pg_try_advisory_lock($lock_key);")"
    if [[ "$acquired" == "f" ]]; then
      return 0
    fi
    sleep 0.1
  done

  echo "Timed out waiting for advisory lock $lock_key." >&2
  return 1
}

drop_restore_database "$RESTORE_DATABASE"
drop_restore_database "$CORRUPT_RESTORE_DATABASE"
drop_restore_database "$CONSISTENCY_RESTORE_DATABASE"

pre_transaction_snapshot="$(snapshot "$PGDATABASE")"

run_psql "$PGDATABASE" \
  -v ON_ERROR_STOP=1 \
  -f tests/postgres-backup-consistency.sql \
  >"$consistency_log" 2>&1 &
consistency_writer_pid=$!

wait_for_advisory_lock 390039

run_pg_tool \
  pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
    --format=custom \
    --schema=financial_core \
    --no-owner \
    >"$consistency_backup_path"

wait "$consistency_writer_pid"
consistency_writer_pid=""
cat "$consistency_log"

run_pg_tool \
  createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$CONSISTENCY_RESTORE_DATABASE"
run_pg_tool \
  pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" \
    -d "$CONSISTENCY_RESTORE_DATABASE" \
    --exit-on-error \
    --single-transaction \
    --no-owner \
    <"$consistency_backup_path"

consistency_snapshot="$(snapshot "$CONSISTENCY_RESTORE_DATABASE")"
pre_transaction_digest="$(
  printf '%s' "$pre_transaction_snapshot" | sha256sum | cut -d ' ' -f 1
)"
consistency_digest="$(
  printf '%s' "$consistency_snapshot" | sha256sum | cut -d ' ' -f 1
)"

if [[ "$consistency_snapshot" != "$pre_transaction_snapshot" ]]; then
  echo "Concurrent backup contains a partial or unexpected ledger state." >&2
  printf \
    'before=%s\nrestored=%s\n' \
    "$pre_transaction_digest" \
    "$consistency_digest" \
    >&2
  exit 1
fi

run_psql "$PGDATABASE" \
  -v ON_ERROR_STOP=1 \
  -Atq \
  -c "
    SELECT
      (
        SELECT count(*)
        FROM financial_core.ledger_journals
        WHERE journal_id = 'ac000000-0000-4000-8000-0000000000a1'
      ) = 1
      AND (
        SELECT count(*)
        FROM financial_core.ledger_entries
        WHERE journal_id = 'ac000000-0000-4000-8000-0000000000a1'
      ) = 2
      AND (
        SELECT count(*)
        FROM financial_core.ledger_idempotency_registry
        WHERE journal_id = 'ac000000-0000-4000-8000-0000000000a1'
      ) = 1
      AND (
        SELECT count(*)
        FROM financial_core.ledger_outbox_events
        WHERE journal_id = 'ac000000-0000-4000-8000-0000000000a1'
      ) = 1
      AND (
        SELECT count(*)
        FROM financial_core.ledger_journal_seals
        WHERE journal_id = 'ac000000-0000-4000-8000-0000000000a1'
      ) = 1;
  " \
  | grep -Fx "t"

run_psql "$CONSISTENCY_RESTORE_DATABASE" \
  -v ON_ERROR_STOP=1 \
  -Atq \
  -c "
    SELECT count(*) = 0
    FROM (
      SELECT journal_id
      FROM financial_core.ledger_journals
      WHERE journal_id = 'ac000000-0000-4000-8000-0000000000a1'
      UNION ALL
      SELECT journal_id
      FROM financial_core.ledger_entries
      WHERE journal_id = 'ac000000-0000-4000-8000-0000000000a1'
      UNION ALL
      SELECT journal_id
      FROM financial_core.ledger_idempotency_registry
      WHERE journal_id = 'ac000000-0000-4000-8000-0000000000a1'
      UNION ALL
      SELECT journal_id
      FROM financial_core.ledger_outbox_events
      WHERE journal_id = 'ac000000-0000-4000-8000-0000000000a1'
      UNION ALL
      SELECT journal_id
      FROM financial_core.ledger_journal_seals
      WHERE journal_id = 'ac000000-0000-4000-8000-0000000000a1'
    ) AS acceptance_artifacts;
  " \
  | grep -Fx "t"

printf 'postgres-backup-consistency-ok %s\n' "$consistency_digest"

run_pg_tool \
  pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
    --format=custom \
    --schema=financial_core \
    --no-owner \
    >"$backup_path"

run_pg_tool pg_restore --list <"$backup_path" >/dev/null

backup_size="$(wc -c <"$backup_path")"
if (( backup_size < 2 )); then
  echo "Financial-core backup is unexpectedly empty." >&2
  exit 1
fi
cp "$backup_path" "$corrupt_backup_path"
truncate -s "$((backup_size / 2))" "$corrupt_backup_path"

run_pg_tool \
  createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$CORRUPT_RESTORE_DATABASE"

set +e
corrupt_restore_output="$(
  run_pg_tool \
    pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" \
      -d "$CORRUPT_RESTORE_DATABASE" \
      --exit-on-error \
      --single-transaction \
      --no-owner \
      <"$corrupt_backup_path" 2>&1
)"
corrupt_restore_status=$?
set -e

printf '%s\n' "$corrupt_restore_output"
if [[ "$corrupt_restore_status" -eq 0 ]]; then
  echo "Corrupted financial-core backup unexpectedly restored." >&2
  exit 1
fi

run_psql "$CORRUPT_RESTORE_DATABASE" \
  -v ON_ERROR_STOP=1 \
  -Atq \
  -c "SELECT pg_catalog.to_regnamespace('financial_core') IS NULL;" \
  | grep -Fx "t"

echo "postgres-backup-corruption-ok"

run_pg_tool \
  createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$RESTORE_DATABASE"
run_pg_tool \
  pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$RESTORE_DATABASE" \
    --exit-on-error \
    --single-transaction \
    --no-owner \
    <"$backup_path"

catalog_checks=(
  tests/postgres-owner-truncate-guard.sh
  tests/postgres-immutability-catalog.sh
  tests/postgres-trigger-function-catalog.sh
  tests/postgres-invariant-trigger-catalog.sh
  tests/postgres-constraint-catalog.sh
  tests/postgres-relation-catalog.sh
  tests/postgres-access-control-catalog.sh
)

for check in "${catalog_checks[@]}"; do
  PGDATABASE="$RESTORE_DATABASE" bash "$check"
done

source_snapshot="$(snapshot "$PGDATABASE")"
restored_snapshot="$(snapshot "$RESTORE_DATABASE")"
source_digest="$(printf '%s' "$source_snapshot" | sha256sum | cut -d ' ' -f 1)"
restored_digest="$(printf '%s' "$restored_snapshot" | sha256sum | cut -d ' ' -f 1)"

if [[ "$restored_snapshot" != "$source_snapshot" ]]; then
  echo "Restored financial-core state differs from the source state." >&2
  printf 'source=%s\nrestored=%s\n' "$source_digest" "$restored_digest" >&2
  exit 1
fi

printf 'postgres-backup-restore-ok %s\n' "$restored_digest"

run_psql "$RESTORE_DATABASE" \
  -v ON_ERROR_STOP=1 \
  -f tests/postgres-backup-continuity.sql

run_psql "$RESTORE_DATABASE" \
  -v ON_ERROR_STOP=1 \
  -Atq \
  -c "
    SELECT
      (
        SELECT count(*)
        FROM financial_core.ledger_journals
        WHERE journal_id = 'bc000000-0000-4000-8000-0000000000b1'
          AND created_at = accepted_at
      ) = 1
      AND (
        SELECT
          count(*) = 2
          AND bool_and(entry.created_at = journal.accepted_at)
          AND sum(entry.amount) FILTER (WHERE entry.side = 'DEBIT') = 11
          AND sum(entry.amount) FILTER (WHERE entry.side = 'CREDIT') = 11
        FROM financial_core.ledger_entries AS entry
        JOIN financial_core.ledger_journals AS journal USING (journal_id)
        WHERE entry.journal_id = 'bc000000-0000-4000-8000-0000000000b1'
      )
      AND (
        SELECT count(*)
        FROM financial_core.ledger_idempotency_registry AS registry
        JOIN financial_core.ledger_journals AS journal USING (journal_id)
        WHERE registry.journal_id = 'bc000000-0000-4000-8000-0000000000b1'
          AND registry.command_digest = journal.command_digest
          AND registry.first_seen_at = journal.accepted_at
      ) = 1
      AND (
        SELECT count(*)
        FROM financial_core.ledger_outbox_events AS outbox
        JOIN financial_core.ledger_journals AS journal USING (journal_id)
        WHERE outbox.journal_id = 'bc000000-0000-4000-8000-0000000000b1'
          AND outbox.created_at = journal.accepted_at
          AND outbox.payload = jsonb_build_object(
            'journal_id', journal.journal_id,
            'command_digest', journal.command_digest
          )
      ) = 1
      AND (
        SELECT count(*)
        FROM financial_core.ledger_journal_seals AS seal
        JOIN financial_core.ledger_journals AS journal USING (journal_id)
        WHERE seal.journal_id = 'bc000000-0000-4000-8000-0000000000b1'
          AND seal.command_digest = journal.command_digest
          AND seal.entry_count = 2
          AND seal.sealed_at = journal.accepted_at
      ) = 1;
  " \
  | grep -Fx "t"

run_psql "$PGDATABASE" \
  -v ON_ERROR_STOP=1 \
  -Atq \
  -c "
    SELECT count(*) = 0
    FROM (
      SELECT journal_id
      FROM financial_core.ledger_journals
      WHERE journal_id = 'bc000000-0000-4000-8000-0000000000b1'
      UNION ALL
      SELECT journal_id
      FROM financial_core.ledger_entries
      WHERE journal_id = 'bc000000-0000-4000-8000-0000000000b1'
      UNION ALL
      SELECT journal_id
      FROM financial_core.ledger_idempotency_registry
      WHERE journal_id = 'bc000000-0000-4000-8000-0000000000b1'
      UNION ALL
      SELECT journal_id
      FROM financial_core.ledger_outbox_events
      WHERE journal_id = 'bc000000-0000-4000-8000-0000000000b1'
      UNION ALL
      SELECT journal_id
      FROM financial_core.ledger_journal_seals
      WHERE journal_id = 'bc000000-0000-4000-8000-0000000000b1'
    ) AS acceptance_artifacts;
  " \
  | grep -Fx "t"

echo "postgres-backup-continuity-ok"
