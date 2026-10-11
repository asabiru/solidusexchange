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

echo "postgres-store-contract-ok"
