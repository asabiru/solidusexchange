#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=custody_test}"
: "${PGDATABASE:=custody_test}"
: "${PGPASSWORD:=custody_test}"
: "${RESTORE_DATABASE:=${PGDATABASE}_restore_test}"
: "${CORRUPT_RESTORE_DATABASE:=${PGDATABASE}_corrupt_restore_test}"
: "${CONSISTENCY_RESTORE_DATABASE:=${PGDATABASE}_consistency_restore_test}"
: "${CHAIN_RESTORE_DATABASE:=${PGDATABASE}_chain_restore_test}"
: "${PSQL_DOCKER_IMAGE:=postgres:16.10-alpine3.22@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297}"

export PGPASSWORD

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

if [[ "$CORRUPT_RESTORE_DATABASE" == "$RESTORE_DATABASE" ]] ||
  [[ "$CONSISTENCY_RESTORE_DATABASE" == "$RESTORE_DATABASE" ]] ||
  [[ "$CONSISTENCY_RESTORE_DATABASE" == "$CORRUPT_RESTORE_DATABASE" ]] ||
  [[ "$CHAIN_RESTORE_DATABASE" == "$RESTORE_DATABASE" ]] ||
  [[ "$CHAIN_RESTORE_DATABASE" == "$CORRUPT_RESTORE_DATABASE" ]] ||
  [[ "$CHAIN_RESTORE_DATABASE" == "$CONSISTENCY_RESTORE_DATABASE" ]]; then
  echo "Disposable restore databases must differ." >&2
  exit 1
fi

workspace="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backup_path="$(mktemp "${TMPDIR:-/tmp}/custody-core-backup.XXXXXX.dump")"
corrupt_backup_path="$(mktemp "${TMPDIR:-/tmp}/custody-core-backup-corrupt.XXXXXX.dump")"
consistency_backup_path="$(mktemp "${TMPDIR:-/tmp}/custody-core-backup-consistency.XXXXXX.dump")"
chain_backup_path="$(mktemp "${TMPDIR:-/tmp}/custody-core-backup-chain.XXXXXX.dump")"
consistency_log="$(mktemp "${TMPDIR:-/tmp}/custody-core-backup-consistency.XXXXXX.log")"
consistency_writer_pid=""

run_pg_tool() {
  if command -v psql >/dev/null 2>&1; then
    PGPASSWORD="$PGPASSWORD" "$@"
  else
    docker run --rm -i --network host \
      -e PGPASSWORD="$PGPASSWORD" \
      -v "$workspace:/workspace:ro" -w /workspace \
      "$PSQL_DOCKER_IMAGE" \
      "$@"
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
  rm -f \
    "$backup_path" \
    "$corrupt_backup_path" \
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
drop_restore_database "$CHAIN_RESTORE_DATABASE"

pre_transaction_snapshot="$(snapshot "$PGDATABASE")"

run_psql "$PGDATABASE" \
  -v ON_ERROR_STOP=1 \
  -f tests/postgres-backup-consistency.sql \
  >"$consistency_log" 2>&1 &
consistency_writer_pid=$!

wait_for_advisory_lock 390060

run_pg_tool \
  pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
    --format=custom \
    --schema=custody_core \
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
  echo "Concurrent custody backup contains a partial or unexpected state." >&2
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
    SELECT count(*) = 1
    FROM custody_core.custody_projection_outbox
    WHERE event_id = '018f3f8a-0060-7000-8000-000000000060';
  " \
  | grep -Fx "t"

run_psql "$CONSISTENCY_RESTORE_DATABASE" \
  -v ON_ERROR_STOP=1 \
  -Atq \
  -c "
    SELECT count(*) = 0
    FROM custody_core.custody_projection_outbox
    WHERE event_id = '018f3f8a-0060-7000-8000-000000000060';
  " \
  | grep -Fx "t"

echo "custody-postgres-backup-consistency-ok $consistency_digest"

source_snapshot="$(snapshot "$PGDATABASE")"
source_digest="$(
  printf '%s' "$source_snapshot" | sha256sum | cut -d ' ' -f 1
)"

run_pg_tool \
  pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
    --format=custom \
    --schema=custody_core \
    --no-owner \
    >"$backup_path"

run_pg_tool pg_restore --list <"$backup_path" >/dev/null

backup_size="$(wc -c <"$backup_path")"
if (( backup_size < 2 )); then
  echo "Custody-core backup is unexpectedly empty." >&2
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

if [[ "$corrupt_restore_status" -eq 0 ]]; then
  printf '%s\n' "$corrupt_restore_output" >&2
  echo "Corrupted custody-core backup unexpectedly restored." >&2
  exit 1
fi

if [[ "$(run_psql "$CORRUPT_RESTORE_DATABASE" -Atq -c "SELECT to_regnamespace('custody_core') IS NULL;")" != "t" ]]; then
  printf '%s\n' "$corrupt_restore_output" >&2
  echo "Corrupted custody-core restore left a partial schema." >&2
  exit 1
fi

echo "custody-postgres-backup-corruption-ok"

run_pg_tool \
  createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$RESTORE_DATABASE"
run_pg_tool \
  pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" \
    -d "$RESTORE_DATABASE" \
    --exit-on-error \
    --single-transaction \
    --no-owner \
    <"$backup_path"

PGHOST="$PGHOST" \
PGPORT="$PGPORT" \
PGUSER="$PGUSER" \
PGDATABASE="$RESTORE_DATABASE" \
PGPASSWORD="$PGPASSWORD" \
PSQL_DOCKER_IMAGE="$PSQL_DOCKER_IMAGE" \
  bash tests/postgres-catalog.sh

restored_snapshot="$(snapshot "$RESTORE_DATABASE")"
restored_digest="$(
  printf '%s' "$restored_snapshot" | sha256sum | cut -d ' ' -f 1
)"

if [[ "$restored_snapshot" != "$source_snapshot" ]]; then
  echo "Restored custody-core state differs from the source state." >&2
  printf 'source=%s\nrestored=%s\n' "$source_digest" "$restored_digest" >&2
  exit 1
fi

printf 'custody-postgres-backup-restore-ok %s\n' "$restored_digest"

run_psql "$RESTORE_DATABASE" \
  -v ON_ERROR_STOP=1 \
  -f tests/postgres-backup-continuity.sql

run_psql "$RESTORE_DATABASE" \
  -v ON_ERROR_STOP=1 \
  -Atq \
  -c "
    SELECT
      count(*) = 1
      AND bool_and(request_digest = repeat('8', 64))
      AND bool_and(event_document -> 'payload' ->> 'status' = 'unsigned_intent_ready')
      AND bool_and(event_document -> 'payload' -> 'execution_authority' = 'false'::jsonb)
      AND bool_and(event_document -> 'payload' -> 'production_signing_enabled' = 'false'::jsonb)
    FROM custody_core.custody_projection_outbox
    WHERE event_id = '018f3f8a-0061-7000-8000-000000000061';
  " \
  | grep -Fx "t"

source_after_continuity="$(snapshot "$PGDATABASE")"
if [[ "$source_after_continuity" != "$source_snapshot" ]]; then
  echo "Restored custody continuity test changed the source state." >&2
  exit 1
fi

restored_continuity_snapshot="$(snapshot "$RESTORE_DATABASE")"
restored_continuity_digest="$(
  printf '%s' "$restored_continuity_snapshot" | sha256sum | cut -d ' ' -f 1
)"

if [[ "$restored_continuity_snapshot" == "$restored_snapshot" ]]; then
  echo "Restored custody state did not advance after a new projection." >&2
  exit 1
fi

printf 'custody-postgres-backup-continuity-ok %s\n' "$restored_continuity_digest"

run_pg_tool \
  pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$RESTORE_DATABASE" \
    --format=custom \
    --schema=custody_core \
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

PGHOST="$PGHOST" \
PGPORT="$PGPORT" \
PGUSER="$PGUSER" \
PGDATABASE="$CHAIN_RESTORE_DATABASE" \
PGPASSWORD="$PGPASSWORD" \
PSQL_DOCKER_IMAGE="$PSQL_DOCKER_IMAGE" \
  bash tests/postgres-catalog.sh

chain_snapshot="$(snapshot "$CHAIN_RESTORE_DATABASE")"
chain_digest="$(
  printf '%s' "$chain_snapshot" | sha256sum | cut -d ' ' -f 1
)"

if [[ "$chain_snapshot" != "$restored_continuity_snapshot" ]]; then
  echo "Second-generation custody restore differs from the active restored state." >&2
  printf \
    'active_restore=%s\nsecond_restore=%s\n' \
    "$restored_continuity_digest" \
    "$chain_digest" \
    >&2
  exit 1
fi

printf 'custody-postgres-backup-chain-ok %s\n' "$chain_digest"
