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

run_psql \
  -v ON_ERROR_STOP=1 \
  -Atq \
  -f tests/postgres-immutability-catalog.sql \
  | node scripts/verify-postgres-immutability-catalog.mjs

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
