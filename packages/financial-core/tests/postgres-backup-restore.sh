#!/usr/bin/env bash

set -euo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=ledger_test}"
: "${PGDATABASE:=ledger_test}"
: "${PGPASSWORD:=ledger_test}"
: "${RESTORE_DATABASE:=${PGDATABASE}_restore_test}"
: "${CORRUPT_RESTORE_DATABASE:=${PGDATABASE}_corrupt_restore_test}"

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

if [[ "$CORRUPT_RESTORE_DATABASE" == "$RESTORE_DATABASE" ]]; then
  echo "Corrupt and valid restore databases must differ." >&2
  exit 1
fi

backup_path="$(mktemp "${TMPDIR:-/tmp}/financial-core-backup.XXXXXX.dump")"
corrupt_backup_path="$(mktemp "${TMPDIR:-/tmp}/financial-core-backup-corrupt.XXXXXX.dump")"

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
