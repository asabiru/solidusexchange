#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=custody_test}"
: "${PGDATABASE:=custody_test}"
: "${PGPASSWORD:=custody_test}"
: "${RESTORE_DATABASE:=${PGDATABASE}_restore_test}"
: "${CORRUPT_RESTORE_DATABASE:=${PGDATABASE}_corrupt_restore_test}"
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

if [[ "$CORRUPT_RESTORE_DATABASE" == "$RESTORE_DATABASE" ]]; then
  echo "Disposable restore databases must differ." >&2
  exit 1
fi

workspace="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backup_path="$(mktemp "${TMPDIR:-/tmp}/custody-core-backup.XXXXXX.dump")"
corrupt_backup_path="$(mktemp "${TMPDIR:-/tmp}/custody-core-backup-corrupt.XXXXXX.dump")"

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
  drop_restore_database "$RESTORE_DATABASE"
  drop_restore_database "$CORRUPT_RESTORE_DATABASE"
  rm -f "$backup_path" "$corrupt_backup_path"
}
trap cleanup EXIT

snapshot() {
  local database="$1"
  run_psql "$database" \
    -v ON_ERROR_STOP=1 \
    -Atq \
    -f tests/postgres-state-snapshot.sql
}

drop_restore_database "$RESTORE_DATABASE"
drop_restore_database "$CORRUPT_RESTORE_DATABASE"

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
