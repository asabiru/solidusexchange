#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=custody_test}"
: "${PGDATABASE:=custody_test}"
: "${PGPASSWORD:=custody_test}"
: "${PSQL_DOCKER_IMAGE:=postgres:16.10-alpine3.22@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297}"
: "${ROLLBACK_DATABASE:=${PGDATABASE}_migration_rollback_test}"

export PGPASSWORD

if [[ "$ROLLBACK_DATABASE" == "$PGDATABASE" ]]; then
  echo "Rollback database must differ from the canonical database." >&2
  exit 1
fi
if [[ ! "$ROLLBACK_DATABASE" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
  echo "Rollback database must be a PostgreSQL identifier." >&2
  exit 1
fi
if [[ "$ROLLBACK_DATABASE" != *_migration_rollback_test ]]; then
  echo "Rollback database must use the disposable _migration_rollback_test suffix." >&2
  exit 1
fi

scratch="$(mktemp -d "${TMPDIR:-/tmp}/solidchange-custody-migration-rollback.XXXXXX")"

run_pg_tool() {
  if command -v "$1" >/dev/null 2>&1; then
    "$@"
  else
    docker run --rm -i --network host \
      -e PGPASSWORD \
      "$PSQL_DOCKER_IMAGE" \
      "$@"
  fi
}

psql_database() {
  local database="$1"
  shift

  if command -v psql >/dev/null 2>&1; then
    psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$database" "$@"
  else
    docker run --rm -i --network host \
      -e PGPASSWORD \
      -v "$PWD:/workspace:ro" -w /workspace \
      "$PSQL_DOCKER_IMAGE" \
      psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$database" "$@"
  fi
}

psql_command() {
  psql_database "$PGDATABASE" "$@"
}

drop_rollback_database() {
  run_pg_tool \
    dropdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" \
      --if-exists --force "$ROLLBACK_DATABASE"
}

cleanup() {
  drop_rollback_database >/dev/null 2>&1 || true
  rm -rf "$scratch"
}
trap cleanup EXIT

verify_history() {
  local database="${1:-$PGDATABASE}"

  psql_database "$database" \
    -v ON_ERROR_STOP=1 \
    -Atq \
    -f tests/postgres-migration-history.sql \
    | node scripts/verify-postgres-migration-history.mjs
}

assert_history_rejected() {
  local expected="$1"
  local statement="$2"
  local output
  local status

  set +e
  output="$(
    {
      printf '%s\n' "BEGIN;" "$statement"
      cat tests/postgres-migration-history.sql
      printf '%s\n' "ROLLBACK;"
    } | psql_command -v ON_ERROR_STOP=1 -Atq \
      | node scripts/verify-postgres-migration-history.mjs 2>&1
  )"
  status=$?
  set -e

  printf '%s\n' "$output"
  if [[ "$status" -eq 0 ]]; then
    echo "Unexpected PostgreSQL custody migration history matched the canonical manifest." >&2
    exit 1
  fi
  grep -F "$expected" <<<"$output"
}

assert_statement_rejected() {
  local expected="$1"
  local statement="$2"
  local output
  local status

  set +e
  output="$(
    psql_command \
      -v ON_ERROR_STOP=1 \
      -c "$statement" \
      2>&1
  )"
  status=$?
  set -e

  printf '%s\n' "$output"
  if [[ "$status" -eq 0 ]]; then
    echo "Invalid PostgreSQL custody migration history change unexpectedly committed." >&2
    exit 1
  fi
  grep -F "$expected" <<<"$output"
}

assert_failed_history_bootstrap_rolled_back() {
  local failed_migration="$scratch/0002_custody_migration_history.sql"
  local output
  local status

  drop_rollback_database
  run_pg_tool \
    createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" \
      "$ROLLBACK_DATABASE"
  psql_database "$ROLLBACK_DATABASE" \
    -v ON_ERROR_STOP=1 \
    -f migrations/0001_custody_projection_outbox.sql \
    >/dev/null

  sed \
    '/^REVOKE ALL ON TABLE custody_core.schema_migrations FROM PUBLIC;$/i SELECT 1 / 0;' \
    migrations/0002_custody_migration_history.sql \
    >"$failed_migration"

  set +e
  output="$(
    psql_database "$ROLLBACK_DATABASE" \
      -v ON_ERROR_STOP=1 \
      <"$failed_migration" \
      2>&1
  )"
  status=$?
  set -e

  printf '%s\n' "$output"
  if [[ "$status" -eq 0 ]]; then
    echo "Intentionally failed PostgreSQL custody migration unexpectedly committed." >&2
    exit 1
  fi
  grep -F "division by zero" <<<"$output"

  psql_database "$ROLLBACK_DATABASE" \
    -v ON_ERROR_STOP=1 \
    -Atq \
    -c "
      SELECT
        to_regclass('custody_core.custody_projection_outbox') IS NOT NULL
        AND to_regprocedure(
          'custody_core.record_custody_projection(jsonb,text)'
        ) IS NOT NULL
        AND to_regclass('custody_core.schema_migrations') IS NULL
        AND to_regprocedure(
          'custody_core.reject_migration_history_mutation()'
        ) IS NULL
        AND to_regprocedure(
          'custody_core.validate_migration_sequence()'
        ) IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_trigger
          WHERE tgname IN (
            'schema_migrations_validate_sequence',
            'schema_migrations_append_only',
            'schema_migrations_reject_truncate'
          )
        );
    " \
    | grep -Fx "t"

  psql_database "$ROLLBACK_DATABASE" \
    -v ON_ERROR_STOP=1 \
    -f migrations/0002_custody_migration_history.sql \
    >/dev/null
  verify_history "$ROLLBACK_DATABASE"
  psql_database "$ROLLBACK_DATABASE" \
    -v ON_ERROR_STOP=1 \
    -Atq \
    -c "
      SELECT
        to_regclass('custody_core.schema_migrations') IS NOT NULL
        AND to_regprocedure(
          'custody_core.reject_migration_history_mutation()'
        ) IS NOT NULL
        AND to_regprocedure(
          'custody_core.validate_migration_sequence()'
        ) IS NOT NULL
        AND (
          SELECT array_agg(trigger_record.tgname ORDER BY trigger_record.tgname)
          FROM pg_catalog.pg_trigger AS trigger_record
          WHERE trigger_record.tgrelid =
            'custody_core.schema_migrations'::regclass
            AND NOT trigger_record.tgisinternal
        ) = ARRAY[
          'schema_migrations_append_only',
          'schema_migrations_reject_truncate',
          'schema_migrations_validate_sequence'
        ]::name[];
    " \
    | grep -Fx "t"

  drop_rollback_database
  echo "custody-postgres-migration-rollback-ok"
}

verify_history

assert_history_rejected \
  "PostgreSQL custody migration history differs from canonical manifest" \
  "ALTER TABLE custody_core.schema_migrations
     DISABLE TRIGGER schema_migrations_validate_sequence;
   INSERT INTO custody_core.schema_migrations (version, migration_name)
   VALUES (9999, '9999_unreviewed_migration');"

assert_history_rejected \
  "PostgreSQL custody migrations were not applied in canonical version order" \
  "ALTER TABLE custody_core.schema_migrations
     DISABLE TRIGGER schema_migrations_append_only;
   UPDATE custody_core.schema_migrations
      SET applied_at = applied_at + interval '1 day'
    WHERE version = 1;"

verify_history

assert_statement_rejected \
  "custody migration version 4 must follow installed version 2 with version 3" \
  "INSERT INTO custody_core.schema_migrations (version, migration_name)
   VALUES (4, '0004_skipped_migration');"

assert_statement_rejected \
  "custody migration version 2 must follow installed version 2 with version 3" \
  "INSERT INTO custody_core.schema_migrations (version, migration_name)
   VALUES (2, '0002_duplicate_migration');"

assert_statement_rejected \
  "custody migration name 0004_wrong_version must encode version 3" \
  "INSERT INTO custody_core.schema_migrations (version, migration_name)
   VALUES (3, '0004_wrong_version');"

assert_statement_rejected \
  "custody migration applied_at must be later than installed version 2" \
  "INSERT INTO custody_core.schema_migrations (
     version,
     migration_name,
     applied_at
   )
   SELECT 3, '0003_stale_timestamp', max(applied_at)
   FROM custody_core.schema_migrations;"

assert_statement_rejected \
  "custody migration version 4 must follow installed version 2 with version 3" \
  "SET session_replication_role = replica;
   INSERT INTO custody_core.schema_migrations (version, migration_name)
   VALUES (4, '0004_replica_skip');"

assert_statement_rejected \
  "custody migration history is append-only" \
  "UPDATE custody_core.schema_migrations
      SET migration_name = migration_name
    WHERE version = 1;"

assert_statement_rejected \
  "custody migration history is append-only" \
  "DELETE FROM custody_core.schema_migrations WHERE version = 2;"

assert_statement_rejected \
  "custody migration history is append-only" \
  "TRUNCATE custody_core.schema_migrations;"

assert_statement_rejected \
  "custody migration history is append-only" \
  "SET session_replication_role = replica;
   DELETE FROM custody_core.schema_migrations WHERE version = 2;"

verify_history

assert_failed_history_bootstrap_rolled_back

echo "custody-postgres-migration-sequence-guard-ok"
echo "custody-postgres-migration-history-negative-ok"
