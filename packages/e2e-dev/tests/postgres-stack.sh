#!/usr/bin/env bash

set -euo pipefail

# Postgres persistence arm of the e2e dev stack: brings up the pinned
# postgres service from tests/postgres-stack.compose.yaml, applies the
# customer-api and matching-core migrations (same files and conventions
# as packages/*/tests/postgres-*.sh), then runs the contract suite that
# proves rate-limit state survives a customer-api restart and that the
# matching journal survives across helper processes. `npm test` stays
# docker-free — this arm runs only here and in CI. When docker or the
# compose plugin is unavailable it prints a loud notice and does nothing.

POSTGRES_IMAGE="postgres:16.10-alpine3.22@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297"
COMPOSE_FILE="packages/e2e-dev/tests/postgres-stack.compose.yaml"

: "${PGUSER:=solidchange_e2e_dev}"
: "${PGDATABASE:=solidchange_e2e_dev}"
: "${PGPASSWORD:=solidchange_e2e_dev}"

# Empty means psql on the host; unset defaults to the pinned image, since
# the arm only runs where docker works. Explicit PSQL_DOCKER_IMAGE=""
# selects a host psql, matching the package-level harness convention.
if [[ -z "${PSQL_DOCKER_IMAGE+x}" ]]; then
  PSQL_DOCKER_IMAGE="$POSTGRES_IMAGE"
fi

workspace="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_root="$(cd "$workspace/../.." && pwd)"
cd "$repo_root"

if ! command -v docker >/dev/null 2>&1; then
  echo "postgres-stack SKIPPED: docker is not installed; the PostgreSQL persistence arm of the e2e dev stack needs a docker daemon." >&2
elif ! docker info >/dev/null 2>&1; then
  echo "postgres-stack SKIPPED: a docker daemon is not reachable; the PostgreSQL persistence arm of the e2e dev stack was not exercised." >&2
elif ! docker compose version >/dev/null 2>&1; then
  echo "postgres-stack SKIPPED: the docker compose plugin is unavailable; the PostgreSQL persistence arm of the e2e dev stack was not exercised." >&2
else
  export E2E_POSTGRES_PASSWORD="$PGPASSWORD"

  cleanup() {
    docker compose -f "$COMPOSE_FILE" down -v --remove-orphans >/dev/null 2>&1 || true
  }
  trap cleanup EXIT

  docker compose -f "$COMPOSE_FILE" up -d --wait

  address="$(docker compose -f "$COMPOSE_FILE" port postgres 5432)"
  PGHOST="${address%:*}"
  PGPORT="${address##*:}"

  run_psql() {
    if [[ -n "$PSQL_DOCKER_IMAGE" ]]; then
      docker run --rm -i --network host \
        -e PGPASSWORD="$PGPASSWORD" \
        -v "$repo_root:/workspace:ro" -w /workspace \
        "$PSQL_DOCKER_IMAGE" \
        psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" "$@"
    else
      PGPASSWORD="$PGPASSWORD" \
        psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" "$@"
    fi
  }

  for migration in packages/customer-api/migrations/*.sql packages/matching-core/migrations/*.sql; do
    run_psql -v ON_ERROR_STOP=1 -f "$migration"
  done

  # The store backends run on the host (node + the pg driver installed by
  # npm ci in each package); only psql goes through the docker client.
  export CUSTOMER_API_STORE="postgres"
  export CUSTOMER_API_STORE_DSN="postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}"
  export MATCHING_CORE_STORE="postgres"
  export MATCHING_CORE_STORE_DSN="$CUSTOMER_API_STORE_DSN"

  node --test packages/e2e-dev/tests/postgres-stack-contract.mjs

  # Both schemas landed and the arm wrote real state into them.
  run_psql -v ON_ERROR_STOP=1 -Atq \
    -c "SELECT count(*) FROM customer_api.schema_migrations WHERE version = 1 AND migration_name = '0001_customer_api_store';" \
    | grep -Fx 1 >/dev/null

  run_psql -v ON_ERROR_STOP=1 -Atq \
    -c "SELECT count(*) FROM matching_core.schema_migrations WHERE version = 1 AND migration_name = '0001_matching_journal';" \
    | grep -Fx 1 >/dev/null

  run_psql -v ON_ERROR_STOP=1 -Atq \
    -c "SELECT count(*) FROM customer_api.rate_limit_buckets;" \
    | grep -Eq '^[1-9][0-9]*$' >/dev/null

  run_psql -v ON_ERROR_STOP=1 -Atq \
    -c "SELECT count(*) FROM matching_core.matching_journal;" \
    | grep -Eq '^[1-9][0-9]*$' >/dev/null

  # Replaying an already-applied migration must fail loudly and leave the
  # catalogs untouched — the arm is disposable, but the migrations are not
  # allowed to be idempotent in-place. The applied-migration count is
  # schema-local and grows with the catalog, so the replay is checked
  # against a pre-replay snapshot rather than a fixed count.
  customer_migration_count="$(
    run_psql -v ON_ERROR_STOP=1 -Atq \
      -c "SELECT count(*) FROM customer_api.schema_migrations;" \
      | tr -d '[:space:]'
  )"
  journal_migration_count="$(
    run_psql -v ON_ERROR_STOP=1 -Atq \
      -c "SELECT count(*) FROM matching_core.schema_migrations;" \
      | tr -d '[:space:]'
  )"
  case "$customer_migration_count$journal_migration_count" in
    ''|*[!0-9]*) echo "postgres-stack: schema_migrations counts are not numeric" >&2; exit 1 ;;
  esac

  set +e
  customer_replay_output="$(
    run_psql -v ON_ERROR_STOP=1 \
      -f packages/customer-api/migrations/0001_customer_api_store.sql \
      2>&1
  )"
  customer_replay_status=$?
  set -e

  printf '%s\n' "$customer_replay_output"
  if [[ "$customer_replay_status" -eq 0 ]]; then
    echo "Replaying PostgreSQL customer-api migration 0001 unexpectedly committed." >&2
    exit 1
  fi
  grep -F 'schema "customer_api" already exists' <<<"$customer_replay_output" >/dev/null

  set +e
  journal_replay_output="$(
    run_psql -v ON_ERROR_STOP=1 \
      -f packages/matching-core/migrations/0001_matching_journal.sql \
      2>&1
  )"
  journal_replay_status=$?
  set -e

  printf '%s\n' "$journal_replay_output"
  if [[ "$journal_replay_status" -eq 0 ]]; then
    echo "Replaying PostgreSQL matching-core migration 0001 unexpectedly committed." >&2
    exit 1
  fi
  grep -F 'schema "matching_core" already exists' <<<"$journal_replay_output" >/dev/null

  run_psql -v ON_ERROR_STOP=1 -Atq \
    -c "SELECT count(*) FROM customer_api.schema_migrations;" \
    | grep -Fx "$customer_migration_count" >/dev/null

  run_psql -v ON_ERROR_STOP=1 -Atq \
    -c "SELECT count(*) FROM matching_core.schema_migrations;" \
    | grep -Fx "$journal_migration_count" >/dev/null

  echo "postgres-stack-ok"
fi
