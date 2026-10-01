#!/usr/bin/env bash

set -euo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=ledger_test}"
: "${PGDATABASE:=ledger_test}"
: "${PGPASSWORD:=ledger_test}"

PSQL_DOCKER_IMAGE="${PSQL_DOCKER_IMAGE:-}"
workspace="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

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

verify_catalog() {
  run_psql \
    -v ON_ERROR_STOP=1 \
    -Atq \
    -f tests/postgres-immutability-catalog.sql \
    | node scripts/verify-postgres-immutability-catalog.mjs
}

expect_trigger_definition_drift() {
  local output
  local status

  set +e
  output="$(
    {
      printf '%s\n' \
        "BEGIN;" \
        "DROP TRIGGER account_definitions_append_only" \
        "  ON financial_core.account_definitions;" \
        "CREATE TRIGGER account_definitions_append_only" \
        "BEFORE UPDATE OR DELETE ON financial_core.account_definitions" \
        "FOR EACH ROW" \
        "WHEN (false)" \
        "EXECUTE FUNCTION financial_core.reject_mutation();" \
        "ALTER TABLE financial_core.account_definitions" \
        "  ENABLE ALWAYS TRIGGER account_definitions_append_only;"
      cat tests/postgres-immutability-catalog.sql
      printf '%s\n' "ROLLBACK;"
    } | run_psql -v ON_ERROR_STOP=1 -Atq \
      | node scripts/verify-postgres-immutability-catalog.mjs 2>&1
  )"
  status=$?
  set -e

  printf '%s\n' "$output"
  if [[ "$status" -eq 0 ]]; then
    echo "PostgreSQL immutability trigger-definition drift unexpectedly passed." >&2
    exit 1
  fi
  grep -F \
    "PostgreSQL immutability trigger definitions differ from the expected policy" \
    <<<"$output"
}

verify_catalog
expect_trigger_definition_drift
verify_catalog
echo "postgres-immutability-catalog-negative-ok"

assert_replica_mutation_rejected() {
  local statement="$1"

  set +e
  output="$(
    run_psql \
      -v ON_ERROR_STOP=1 \
      -c "SET session_replication_role = replica; $statement" \
      2>&1
  )"
  status=$?
  set -e

  printf '%s\n' "$output"
  if [[ "$status" -eq 0 ]]; then
    echo "Mutation unexpectedly succeeded in replica mode: $statement" >&2
    exit 1
  fi
  grep -F "financial_core tables are append-only" <<<"$output"
}

assert_replica_mutation_rejected \
  "UPDATE financial_core.schema_migrations SET migration_name = migration_name WHERE version = 5;"
assert_replica_mutation_rejected \
  "DELETE FROM financial_core.schema_migrations WHERE version = 5;"
assert_replica_mutation_rejected \
  "TRUNCATE TABLE financial_core.ledger_entries CASCADE;"

echo "postgres-replication-mode-immutability-ok"
