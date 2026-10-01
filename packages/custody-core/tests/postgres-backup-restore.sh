#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=custody_test}"
: "${PGDATABASE:=custody_test}"
: "${PGPASSWORD:=custody_test}"
: "${RESTORE_DATABASE:=${PGDATABASE}_restore_test}"
: "${PSQL_DOCKER_IMAGE:=postgres:16.10-alpine3.22@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297}"

export PGPASSWORD

if [[ "$RESTORE_DATABASE" == "$PGDATABASE" ]]; then
  echo "Restore database must differ from the source database." >&2
  exit 1
fi
if [[ ! "$RESTORE_DATABASE" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
  echo "Restore database must be a PostgreSQL identifier." >&2
  exit 1
fi
if [[ "$RESTORE_DATABASE" != *_restore_test ]]; then
  echo "Restore database must use the disposable _restore_test suffix." >&2
  exit 1
fi

workspace="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backup_path="$(mktemp "${TMPDIR:-/tmp}/custody-core-backup.XXXXXX.dump")"

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
  run_pg_tool \
    dropdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" \
      --if-exists --force "$RESTORE_DATABASE"
}

cleanup() {
  drop_restore_database
  rm -f "$backup_path"
}
trap cleanup EXIT

snapshot() {
  local database="$1"
  run_psql "$database" \
    -v ON_ERROR_STOP=1 \
    -Atq \
    -f tests/postgres-state-snapshot.sql
}

drop_restore_database

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
