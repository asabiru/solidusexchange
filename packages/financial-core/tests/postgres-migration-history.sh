#!/usr/bin/env bash

set -euo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=ledger_test}"
: "${PGDATABASE:=ledger_test}"
: "${PGPASSWORD:=ledger_test}"
: "${OUT_OF_ORDER_DATABASE:=${PGDATABASE}_migration_order_test}"

PSQL_DOCKER_IMAGE="${PSQL_DOCKER_IMAGE:-}"
workspace="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "$OUT_OF_ORDER_DATABASE" == "$PGDATABASE" ]]; then
  echo "Out-of-order database must differ from the canonical database." >&2
  exit 1
fi
if [[ ! "$OUT_OF_ORDER_DATABASE" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
  echo "Out-of-order database must be a PostgreSQL identifier." >&2
  exit 1
fi
if [[ "$OUT_OF_ORDER_DATABASE" != *_migration_order_test ]]; then
  echo "Out-of-order database must use the disposable _migration_order_test suffix." >&2
  exit 1
fi

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

drop_out_of_order_database() {
  run_pg_tool \
    dropdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" \
      --if-exists --force "$OUT_OF_ORDER_DATABASE"
}

cleanup() {
  drop_out_of_order_database >/dev/null 2>&1 || true
}
trap cleanup EXIT

verify_history() {
  local database="${1:-$PGDATABASE}"
  run_psql "$database" \
    -v ON_ERROR_STOP=1 \
    -Atq \
    -f tests/postgres-migration-history.sql \
    | node scripts/verify-postgres-migration-history.mjs
}

assert_history_rejected() {
  local statement="$1"
  local output
  local status

  set +e
  output="$(
    {
      printf '%s\n' "BEGIN;" "$statement"
      cat tests/postgres-migration-history.sql
      printf '%s\n' "ROLLBACK;"
    } | run_psql "$PGDATABASE" -v ON_ERROR_STOP=1 -Atq \
      | node scripts/verify-postgres-migration-history.mjs 2>&1
  )"
  status=$?
  set -e

  printf '%s\n' "$output"
  if [[ "$status" -eq 0 ]]; then
    echo "Unexpected PostgreSQL migration history matched the canonical manifest." >&2
    exit 1
  fi
  grep -F \
    "PostgreSQL migration history differs from canonical manifest" \
    <<<"$output"
}

assert_sequence_rejected() {
  local expected="$1"
  local statement="$2"
  local output
  local status

  set +e
  output="$(
    run_psql "$PGDATABASE" \
      -v ON_ERROR_STOP=1 \
      -c "$statement" \
      2>&1
  )"
  status=$?
  set -e

  printf '%s\n' "$output"
  if [[ "$status" -eq 0 ]]; then
    echo "Invalid PostgreSQL migration sequence unexpectedly committed." >&2
    exit 1
  fi
  grep -F "$expected" <<<"$output"
}

assert_out_of_order_history_rejected() {
  local migration
  local output
  local status
  local migrations=(
    "0001_ledger_foundation.sql"
    "0003_ledger_acceptance_seal.sql"
    "0002_ledger_verification_views.sql"
    "0004_ledger_truncate_guard.sql"
    "0005_ledger_trigger_replication_guard.sql"
    "0006_ledger_invariant_replication_guard.sql"
    "0007_ledger_replica_reference_guard.sql"
    "0008_ledger_acceptance_artifact_guard.sql"
    "0009_ledger_acceptance_timeline_guard.sql"
    "0010_ledger_finite_timestamp_guard.sql"
    "0011_ledger_migration_sequence_guard.sql"
  )

  drop_out_of_order_database
  run_pg_tool \
    createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" \
      "$OUT_OF_ORDER_DATABASE"

  for migration in "${migrations[@]}"; do
    run_psql "$OUT_OF_ORDER_DATABASE" \
      -v ON_ERROR_STOP=1 \
      -f "migrations/$migration" \
      >/dev/null
    if [[ "$migration" == "0003_ledger_acceptance_seal.sql" ]]; then
      sleep 0.02
    fi
  done

  set +e
  output="$(
    run_psql "$OUT_OF_ORDER_DATABASE" \
      -v ON_ERROR_STOP=1 \
      -Atq \
      -f tests/postgres-migration-history.sql \
      | node scripts/verify-postgres-migration-history.mjs 2>&1
  )"
  status=$?
  set -e

  printf '%s\n' "$output"
  if [[ "$status" -eq 0 ]]; then
    echo "Out-of-order PostgreSQL migration history unexpectedly passed." >&2
    exit 1
  fi
  grep -F \
    "PostgreSQL migrations were not applied in canonical version order" \
    <<<"$output"

  drop_out_of_order_database
  echo "postgres-migration-order-negative-ok"
}

verify_history

assert_history_rejected \
  "ALTER TABLE financial_core.schema_migrations
     DISABLE TRIGGER schema_migrations_validate_sequence;
   INSERT INTO financial_core.schema_migrations (version, migration_name)
   VALUES (9999, '9999_unreviewed_migration');"

verify_history

assert_sequence_rejected \
  "migration version 13 must follow installed version 11 with version 12" \
  "INSERT INTO financial_core.schema_migrations (version, migration_name)
   VALUES (13, '0013_skipped_migration');"

assert_sequence_rejected \
  "migration name 0013_wrong_version must encode version 12" \
  "INSERT INTO financial_core.schema_migrations (version, migration_name)
   VALUES (12, '0013_wrong_version');"

assert_sequence_rejected \
  "migration applied_at must be later than installed version 11" \
  "INSERT INTO financial_core.schema_migrations (
     version,
     migration_name,
     applied_at
   )
   SELECT 12, '0012_stale_timestamp', max(applied_at)
   FROM financial_core.schema_migrations;"

assert_sequence_rejected \
  "migration version 13 must follow installed version 11 with version 12" \
  "SET session_replication_role = replica;
   INSERT INTO financial_core.schema_migrations (version, migration_name)
   VALUES (13, '0013_replica_skip');"

verify_history

assert_out_of_order_history_rejected

echo "postgres-migration-sequence-guard-ok"
echo "postgres-migration-history-negative-ok"
