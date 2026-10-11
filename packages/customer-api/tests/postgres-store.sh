#!/usr/bin/env bash

set -euo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=customer_api_test}"
: "${PGDATABASE:=customer_api_test}"
: "${PGPASSWORD:=customer_api_test}"

PSQL_DOCKER_IMAGE="${PSQL_DOCKER_IMAGE:-}"
workspace="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$workspace"

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

for migration in migrations/*.sql; do
  run_psql -v ON_ERROR_STOP=1 -f "$migration"
done

# The store backend runs on the host (node + the pg driver from npm ci); only
# psql goes through the docker client when PSQL_DOCKER_IMAGE is set.
export CUSTOMER_API_STORE_DSN="postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}"

node --test tests/postgres-store-contract.mjs

run_psql -v ON_ERROR_STOP=1 -Atq \
  -c "SELECT count(*) FROM customer_api.schema_migrations WHERE version = 1 AND migration_name = '0001_customer_api_store';" \
  | grep -Fx 1 >/dev/null

run_psql -v ON_ERROR_STOP=1 -Atq \
  -c "SELECT count(*) FROM customer_api.rate_limit_buckets;" \
  | grep -Eq '^[1-9][0-9]*$' >/dev/null

# The migration's ENABLE ALWAYS guards must hold in the database itself —
# rejections are asserted on live statements, like custody-core's
# migration-history arm does.
assert_change_rejected() {
  local expected="$1"
  local statement="$2"
  local output
  local status

  set +e
  output="$(
    run_psql -v ON_ERROR_STOP=1 \
      -c "$statement" \
      2>&1
  )"
  status=$?
  set -e

  printf '%s\n' "$output"
  if [[ "$status" -eq 0 ]]; then
    echo "Invalid PostgreSQL customer-api migration history change unexpectedly committed." >&2
    exit 1
  fi
  grep -F "$expected" <<<"$output" >/dev/null
}

assert_change_rejected \
  "customer_api migration version 3 must follow installed version 1 with version 2" \
  "INSERT INTO customer_api.schema_migrations (version, migration_name)
   VALUES (3, '0003_skipped_migration');"

assert_change_rejected \
  "customer_api migration name 0009_wrong_version must encode version 2" \
  "INSERT INTO customer_api.schema_migrations (version, migration_name)
   VALUES (2, '0009_wrong_version');"

assert_change_rejected \
  "customer_api migration applied_at must be later than installed version 1" \
  "INSERT INTO customer_api.schema_migrations (
     version,
     migration_name,
     applied_at
   )
   SELECT 2, '0002_stale_timestamp', max(applied_at)
   FROM customer_api.schema_migrations;"

assert_change_rejected \
  "customer_api migration history is append-only" \
  "UPDATE customer_api.schema_migrations
      SET migration_name = migration_name
    WHERE version = 1;"

assert_change_rejected \
  "customer_api migration history is append-only" \
  "DELETE FROM customer_api.schema_migrations WHERE version = 1;"

assert_change_rejected \
  "customer_api migration history is append-only" \
  "TRUNCATE customer_api.schema_migrations;"

assert_change_rejected \
  "customer_api migration history is append-only" \
  "SET session_replication_role = replica;
   DELETE FROM customer_api.schema_migrations WHERE version = 1;"

# Replaying an already-applied migration must fail loudly and leave the
# catalog untouched.
set +e
replay_output="$(
  run_psql -v ON_ERROR_STOP=1 \
    -f migrations/0001_customer_api_store.sql \
    2>&1
)"
replay_status=$?
set -e

printf '%s\n' "$replay_output"
if [[ "$replay_status" -eq 0 ]]; then
  echo "Replaying PostgreSQL customer-api migration 0001 unexpectedly committed." >&2
  exit 1
fi
grep -F 'schema "customer_api" already exists' <<<"$replay_output" >/dev/null

run_psql -v ON_ERROR_STOP=1 -Atq \
  -c "SELECT count(*) FROM customer_api.schema_migrations;" \
  | grep -Fx 1 >/dev/null

echo "postgres-store-contract-ok"
