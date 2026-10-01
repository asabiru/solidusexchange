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

verify_history() {
  psql_command \
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

echo "custody-postgres-migration-sequence-guard-ok"
echo "custody-postgres-migration-history-negative-ok"
