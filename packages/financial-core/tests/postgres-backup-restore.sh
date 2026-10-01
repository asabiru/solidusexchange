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
: "${CHAIN_RESTORE_DATABASE:=${PGDATABASE}_chain_restore_test}"
: "${PARTIAL_RESTORE_DATABASE:=${PGDATABASE}_partial_restore_test}"

PSQL_DOCKER_IMAGE="${PSQL_DOCKER_IMAGE:-}"
workspace="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
scope_test_schema="financial_core_backup_scope_test"

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
validate_restore_database "$CHAIN_RESTORE_DATABASE"
validate_restore_database "$PARTIAL_RESTORE_DATABASE"

if [[ "$CORRUPT_RESTORE_DATABASE" == "$RESTORE_DATABASE" ]] ||
  [[ "$CONSISTENCY_RESTORE_DATABASE" == "$RESTORE_DATABASE" ]] ||
  [[ "$CONSISTENCY_RESTORE_DATABASE" == "$CORRUPT_RESTORE_DATABASE" ]] ||
  [[ "$CHAIN_RESTORE_DATABASE" == "$RESTORE_DATABASE" ]] ||
  [[ "$CHAIN_RESTORE_DATABASE" == "$CORRUPT_RESTORE_DATABASE" ]] ||
  [[ "$CHAIN_RESTORE_DATABASE" == "$CONSISTENCY_RESTORE_DATABASE" ]] ||
  [[ "$PARTIAL_RESTORE_DATABASE" == "$RESTORE_DATABASE" ]] ||
  [[ "$PARTIAL_RESTORE_DATABASE" == "$CORRUPT_RESTORE_DATABASE" ]] ||
  [[ "$PARTIAL_RESTORE_DATABASE" == "$CONSISTENCY_RESTORE_DATABASE" ]] ||
  [[ "$PARTIAL_RESTORE_DATABASE" == "$CHAIN_RESTORE_DATABASE" ]]; then
  echo "Disposable restore databases must differ." >&2
  exit 1
fi

backup_path="$(mktemp "${TMPDIR:-/tmp}/financial-core-backup.XXXXXX.dump")"
corrupt_backup_path="$(mktemp "${TMPDIR:-/tmp}/financial-core-backup-corrupt.XXXXXX.dump")"
partial_backup_path="$(mktemp "${TMPDIR:-/tmp}/financial-core-backup-partial.XXXXXX.dump")"
consistency_backup_path="$(mktemp "${TMPDIR:-/tmp}/financial-core-backup-consistency.XXXXXX.dump")"
chain_backup_path="$(mktemp "${TMPDIR:-/tmp}/financial-core-backup-chain.XXXXXX.dump")"
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
  drop_restore_database "$CHAIN_RESTORE_DATABASE"
  drop_restore_database "$PARTIAL_RESTORE_DATABASE"
  run_psql "$PGDATABASE" \
    -v ON_ERROR_STOP=1 \
    -c "DROP SCHEMA IF EXISTS ${scope_test_schema} CASCADE;" \
    >/dev/null 2>&1 || true
  rm -f \
    "$backup_path" \
    "$corrupt_backup_path" \
    "$partial_backup_path" \
    "$consistency_backup_path" \
    "$chain_backup_path" \
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

verify_migration_history() {
  local database="$1"
  run_psql "$database" \
    -v ON_ERROR_STOP=1 \
    -Atq \
    -f tests/postgres-migration-history.sql \
    | node scripts/verify-postgres-migration-history.mjs
}

assert_restored_history_drift_rejected() {
  local database="$1"
  local output
  local status

  set +e
  output="$(
    {
      printf '%s\n' \
        "BEGIN;" \
        "INSERT INTO financial_core.schema_migrations (version, migration_name)" \
        "VALUES (12, '0012_unreviewed_restore_drift');"
      cat tests/postgres-migration-history.sql
      printf '%s\n' "ROLLBACK;"
    } | run_psql "$database" -v ON_ERROR_STOP=1 -Atq \
      | node scripts/verify-postgres-migration-history.mjs 2>&1
  )"
  status=$?
  set -e

  printf '%s\n' "$output"
  if [[ "$status" -eq 0 ]]; then
    echo "Restored database with unreviewed migration history unexpectedly passed." >&2
    exit 1
  fi
  grep -F \
    "PostgreSQL migration history differs from canonical manifest" \
    <<<"$output"

  verify_migration_history "$database"
  echo "postgres-backup-migration-history-negative-ok"
}

scope_snapshot() {
  local database="$1"
  run_psql "$database" \
    -v ON_ERROR_STOP=1 \
    -Atq \
    -c "
      SELECT jsonb_agg(to_jsonb(sentinel) ORDER BY marker)::text
      FROM ${scope_test_schema}.sentinel;
    "
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

catalog_checks=(
  tests/postgres-owner-truncate-guard.sh
  tests/postgres-immutability-catalog.sh
  tests/postgres-trigger-function-catalog.sh
  tests/postgres-invariant-trigger-catalog.sh
  tests/postgres-constraint-catalog.sh
  tests/postgres-relation-catalog.sh
  tests/postgres-access-control-catalog.sh
)

drop_restore_database "$RESTORE_DATABASE"
drop_restore_database "$CORRUPT_RESTORE_DATABASE"
drop_restore_database "$CONSISTENCY_RESTORE_DATABASE"
drop_restore_database "$CHAIN_RESTORE_DATABASE"
drop_restore_database "$PARTIAL_RESTORE_DATABASE"

run_psql "$PGDATABASE" \
  -v ON_ERROR_STOP=1 \
  -c "
    DROP SCHEMA IF EXISTS ${scope_test_schema} CASCADE;
    CREATE SCHEMA ${scope_test_schema};
    CREATE TABLE ${scope_test_schema}.sentinel (
      marker text PRIMARY KEY,
      payload jsonb NOT NULL
    );
    INSERT INTO ${scope_test_schema}.sentinel (marker, payload)
    VALUES ('source-only', '{\"scope\":\"source\"}');
  "

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

source_snapshot="$(snapshot "$PGDATABASE")"
source_digest="$(printf '%s' "$source_snapshot" | sha256sum | cut -d ' ' -f 1)"

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

run_psql "$PGDATABASE" \
  -v ON_ERROR_STOP=1 \
  -Atq \
  -c "SELECT count(*) > 0 FROM financial_core.ledger_outbox_events;" \
  | grep -Fx "t"

run_pg_tool \
  pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
    --format=custom \
    --schema=financial_core \
    --exclude-table-data=financial_core.ledger_outbox_events \
    --no-owner \
    >"$partial_backup_path"

run_pg_tool pg_restore --list <"$partial_backup_path" >/dev/null
run_pg_tool \
  createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$PARTIAL_RESTORE_DATABASE"
run_pg_tool \
  pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" \
    -d "$PARTIAL_RESTORE_DATABASE" \
    --exit-on-error \
    --single-transaction \
    --no-owner \
    <"$partial_backup_path"

for check in "${catalog_checks[@]}"; do
  PGDATABASE="$PARTIAL_RESTORE_DATABASE" bash "$check"
done
verify_migration_history "$PARTIAL_RESTORE_DATABASE"

partial_snapshot="$(snapshot "$PARTIAL_RESTORE_DATABASE")"
partial_digest="$(printf '%s' "$partial_snapshot" | sha256sum | cut -d ' ' -f 1)"

if [[ "$partial_snapshot" == "$source_snapshot" ]]; then
  echo "Incomplete financial-core restore unexpectedly matched the source recovery state." >&2
  exit 1
fi

run_psql "$PARTIAL_RESTORE_DATABASE" \
  -v ON_ERROR_STOP=1 \
  -Atq \
  -c "SELECT count(*) = 0 FROM financial_core.ledger_outbox_events;" \
  | grep -Fx "t"

source_after_partial_restore="$(snapshot "$PGDATABASE")"
if [[ "$source_after_partial_restore" != "$source_snapshot" ]]; then
  echo "Incomplete recovery regression changed the source state." >&2
  exit 1
fi

printf 'postgres-backup-partial-restore-negative-ok %s\n' "$partial_digest"

run_pg_tool \
  createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$RESTORE_DATABASE"
run_psql "$RESTORE_DATABASE" \
  -v ON_ERROR_STOP=1 \
  -c "
    CREATE SCHEMA ${scope_test_schema};
    CREATE TABLE ${scope_test_schema}.sentinel (
      marker text PRIMARY KEY,
      payload jsonb NOT NULL
    );
    INSERT INTO ${scope_test_schema}.sentinel (marker, payload)
    VALUES ('target-only', '{\"scope\":\"target\"}');
  "

target_scope_snapshot="$(scope_snapshot "$RESTORE_DATABASE")"
run_pg_tool \
  pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$RESTORE_DATABASE" \
    --exit-on-error \
    --single-transaction \
    --no-owner \
    <"$backup_path"

for check in "${catalog_checks[@]}"; do
  PGDATABASE="$RESTORE_DATABASE" bash "$check"
done

verify_migration_history "$RESTORE_DATABASE"
assert_restored_history_drift_rejected "$RESTORE_DATABASE"

restored_snapshot="$(snapshot "$RESTORE_DATABASE")"
restored_digest="$(printf '%s' "$restored_snapshot" | sha256sum | cut -d ' ' -f 1)"

if [[ "$restored_snapshot" != "$source_snapshot" ]]; then
  echo "Restored financial-core state differs from the source state." >&2
  printf 'source=%s\nrestored=%s\n' "$source_digest" "$restored_digest" >&2
  exit 1
fi

restored_scope_snapshot="$(scope_snapshot "$RESTORE_DATABASE")"
if [[ "$restored_scope_snapshot" != "$target_scope_snapshot" ]]; then
  echo "Restore changed unrelated target state." >&2
  exit 1
fi

printf 'postgres-backup-restore-ok %s\n' "$restored_digest"

set +e
restore_collision_output="$(
  run_pg_tool \
    pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$RESTORE_DATABASE" \
      --exit-on-error \
      --single-transaction \
      --no-owner \
      <"$backup_path" 2>&1
)"
restore_collision_status=$?
set -e

printf '%s\n' "$restore_collision_output"
if [[ "$restore_collision_status" -eq 0 ]]; then
  echo "Backup unexpectedly restored into an occupied financial-core target." >&2
  exit 1
fi

collision_snapshot="$(snapshot "$RESTORE_DATABASE")"
collision_digest="$(
  printf '%s' "$collision_snapshot" | sha256sum | cut -d ' ' -f 1
)"

if [[ "$collision_snapshot" != "$restored_snapshot" ]]; then
  echo "Rejected restore changed the occupied financial-core target." >&2
  printf \
    'before=%s\nafter=%s\n' \
    "$restored_digest" \
    "$collision_digest" \
    >&2
  exit 1
fi

collision_scope_snapshot="$(scope_snapshot "$RESTORE_DATABASE")"
if [[ "$collision_scope_snapshot" != "$target_scope_snapshot" ]]; then
  echo "Rejected restore changed unrelated target state." >&2
  exit 1
fi

printf 'postgres-backup-collision-ok %s\n' "$collision_digest"
scope_digest="$(
  printf '%s' "$collision_scope_snapshot" | sha256sum | cut -d ' ' -f 1
)"
printf 'postgres-backup-scope-isolation-ok %s\n' "$scope_digest"

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

continuity_snapshot="$(snapshot "$RESTORE_DATABASE")"
continuity_digest="$(
  printf '%s' "$continuity_snapshot" | sha256sum | cut -d ' ' -f 1
)"

run_pg_tool \
  pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$RESTORE_DATABASE" \
    --format=custom \
    --schema=financial_core \
    --no-owner \
    >"$chain_backup_path"

run_pg_tool pg_restore --list <"$chain_backup_path" >/dev/null

run_pg_tool \
  createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$CHAIN_RESTORE_DATABASE"
run_pg_tool \
  pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" \
    -d "$CHAIN_RESTORE_DATABASE" \
    --exit-on-error \
    --single-transaction \
    --no-owner \
    <"$chain_backup_path"

for check in "${catalog_checks[@]}"; do
  PGDATABASE="$CHAIN_RESTORE_DATABASE" bash "$check"
done

verify_migration_history "$CHAIN_RESTORE_DATABASE"

chain_snapshot="$(snapshot "$CHAIN_RESTORE_DATABASE")"
chain_digest="$(printf '%s' "$chain_snapshot" | sha256sum | cut -d ' ' -f 1)"

if [[ "$chain_snapshot" != "$continuity_snapshot" ]]; then
  echo "Second-generation restore differs from the active restored state." >&2
  printf \
    'active_restore=%s\nsecond_restore=%s\n' \
    "$continuity_digest" \
    "$chain_digest" \
    >&2
  exit 1
fi

printf 'postgres-backup-chain-ok %s\n' "$chain_digest"
