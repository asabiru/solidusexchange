#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=custody_test}"
: "${PGDATABASE:=custody_test}"
: "${PGPASSWORD:=custody_test}"
: "${PSQL_DOCKER_IMAGE:=postgres:16.10-alpine3.22@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297}"

export PGPASSWORD

psql_command() {
  if command -v psql >/dev/null 2>&1; then
    psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" "$@"
  else
    docker run --rm -i --network host \
      -e PGPASSWORD \
      -v "$PWD:/workspace:ro" -w /workspace \
      "$PSQL_DOCKER_IMAGE" \
      psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" "$@"
  fi
}

verify_catalog() {
  psql_command \
    -v ON_ERROR_STOP=1 \
    -Atq \
    -f tests/postgres-catalog.sql \
    | node scripts/verify-postgres-catalog.mjs
}

expect_catalog_drift() {
  local statement="$1"
  local output
  local status

  set +e
  output="$(
    {
      printf '%s\n' "BEGIN;" "$statement"
      cat tests/postgres-catalog.sql
      printf '%s\n' "ROLLBACK;"
    } | psql_command -v ON_ERROR_STOP=1 -Atq \
      | node scripts/verify-postgres-catalog.mjs 2>&1
  )"
  status=$?
  set -e

  if [[ "$status" -eq 0 ]]; then
    echo "Custody PostgreSQL catalog drift unexpectedly passed." >&2
    exit 1
  fi
  grep -E -m 1 \
    "PostgreSQL custody catalog differs from the expected policy|Unexpected custody (column|constraint|index) count|Custody mutation triggers must remain enabled" \
    <<<"$output"
}

verify_catalog

expect_catalog_drift \
  "ALTER TABLE custody_core.custody_projection_outbox ADD COLUMN bypass text;"
expect_catalog_drift \
  "ALTER TABLE custody_core.custody_projection_outbox DISABLE TRIGGER custody_projection_outbox_append_only;"
expect_catalog_drift \
  "GRANT SELECT ON custody_core.custody_projection_outbox TO PUBLIC;"
expect_catalog_drift \
  "ALTER FUNCTION custody_core.record_custody_projection(jsonb, text) SECURITY INVOKER;"
expect_catalog_drift \
  "ALTER FUNCTION custody_core.record_custody_projection(jsonb, text) RESET search_path;"
expect_catalog_drift \
  "ALTER TABLE custody_core.custody_projection_outbox DROP CONSTRAINT custody_projection_network_testnet;"
expect_catalog_drift \
  "CREATE INDEX custody_projection_bypass ON custody_core.custody_projection_outbox (asset);"

verify_catalog

echo "custody-postgres-catalog-negative-ok"
