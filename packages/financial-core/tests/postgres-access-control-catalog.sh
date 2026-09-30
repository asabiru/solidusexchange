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
    -f tests/postgres-access-control-catalog.sql \
    | node scripts/verify-postgres-access-control-catalog.mjs
}

assert_catalog_rejected() {
  local statement="$1"
  local output
  local status

  set +e
  output="$(
    {
      printf '%s\n' "BEGIN;" "$statement"
      cat tests/postgres-access-control-catalog.sql
      printf '%s\n' "ROLLBACK;"
    } | run_psql -v ON_ERROR_STOP=1 -Atq \
      | node scripts/verify-postgres-access-control-catalog.mjs 2>&1
  )"
  status=$?
  set -e

  printf '%s\n' "$output"
  if [[ "$status" -eq 0 ]]; then
    echo "Unsafe PostgreSQL privilege unexpectedly matched the catalog." >&2
    exit 1
  fi
  grep -F \
    "PostgreSQL ownership or access-control catalog differs from the expected policy" \
    <<<"$output"
}

verify_catalog

assert_catalog_rejected \
  "GRANT USAGE ON SCHEMA financial_core TO PUBLIC;"
assert_catalog_rejected \
  "GRANT SELECT ON TABLE financial_core.ledger_entries TO PUBLIC;"
assert_catalog_rejected \
  "GRANT SELECT (amount) ON TABLE financial_core.ledger_entries TO PUBLIC;"
assert_catalog_rejected \
  "GRANT EXECUTE ON FUNCTION financial_core.reject_mutation() TO PUBLIC;"

verify_catalog

echo "postgres-access-control-catalog-negative-ok"
