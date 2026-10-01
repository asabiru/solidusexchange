#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=custody_test}"
: "${PGDATABASE:=custody_test}"
: "${PGPASSWORD:=custody_test}"
: "${PSQL_DOCKER_IMAGE:=postgres:16.10-alpine3.22@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297}"

export PGPASSWORD

runtime_role="custody_core_runtime_test"

psql_command() {
  if command -v psql >/dev/null 2>&1; then
    psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" "$@"
  else
    docker run --rm --network host \
      -e PGPASSWORD \
      -v "$PWD:/workspace:ro" -w /workspace \
      "$PSQL_DOCKER_IMAGE" \
      psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" "$@"
  fi
}

expect_denied() {
  local label="$1"
  local expected="$2"
  local statement="$3"
  local output
  local status

  set +e
  output="$(psql_command -v ON_ERROR_STOP=1 -c "
    SET ROLE $runtime_role;
    $statement
  " 2>&1)"
  status=$?
  set -e

  printf '%s\n' "$output"
  if [[ "$status" -eq 0 ]]; then
    echo "$label unexpectedly succeeded." >&2
    exit 1
  fi
  grep -F "$expected" <<<"$output"
}

verify_runtime_catalog() {
  psql_command \
    -v ON_ERROR_STOP=1 \
    -v "custody_runtime_role=$runtime_role" \
    -Atq \
    -f tests/postgres-runtime-privilege-catalog.sql \
    | node scripts/verify-postgres-runtime-privilege-catalog.mjs
}

assert_runtime_catalog_rejected() {
  local statement="$1"
  local output
  local status

  set +e
  output="$(
    psql_command \
      -v ON_ERROR_STOP=1 \
      -v "custody_runtime_role=$runtime_role" \
      -Atq \
      -c "BEGIN; $statement" \
      -f tests/postgres-runtime-privilege-catalog.sql \
      -c "ROLLBACK;" \
      | node scripts/verify-postgres-runtime-privilege-catalog.mjs 2>&1
  )"
  status=$?
  set -e

  printf '%s\n' "$output"
  if [[ "$status" -eq 0 ]]; then
    echo "Custody runtime privilege drift unexpectedly matched the reviewed profile." >&2
    exit 1
  fi
  grep -F \
    "PostgreSQL custody runtime role or privileges differ from the reviewed least-privilege profile" \
    <<<"$output"
}

psql_command -v ON_ERROR_STOP=1 -c "
  CREATE ROLE $runtime_role
    NOLOGIN
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE
    NOINHERIT
    NOREPLICATION
    NOBYPASSRLS;
"

psql_command \
  -v ON_ERROR_STOP=1 \
  -v "custody_runtime_role=$runtime_role" \
  -f tests/runtime-writer-grants.sql

verify_runtime_catalog

assert_runtime_catalog_rejected \
  "GRANT SELECT ON TABLE custody_core.custody_projection_outbox TO $runtime_role;"
assert_runtime_catalog_rejected \
  "GRANT UPDATE (request_digest) ON TABLE custody_core.custody_projection_outbox TO $runtime_role;"
assert_runtime_catalog_rejected \
  "GRANT EXECUTE ON FUNCTION custody_core.record_custody_projection(jsonb, text)
     TO $runtime_role WITH GRANT OPTION;"
assert_runtime_catalog_rejected \
  "GRANT EXECUTE ON FUNCTION custody_core.reject_outbox_mutation() TO $runtime_role;"
assert_runtime_catalog_rejected \
  "GRANT USAGE ON TYPE custody_core.custody_projection_outbox TO $runtime_role;"
assert_runtime_catalog_rejected \
  "GRANT SELECT ON TABLE custody_core.schema_migrations TO PUBLIC;"
assert_runtime_catalog_rejected \
  "ALTER DEFAULT PRIVILEGES IN SCHEMA custody_core
     GRANT SELECT ON TABLES TO $runtime_role;"
assert_runtime_catalog_rejected \
  "ALTER ROLE $runtime_role LOGIN;"
assert_runtime_catalog_rejected \
  "ALTER ROLE $runtime_role SUPERUSER;"
assert_runtime_catalog_rejected \
  "ALTER ROLE $runtime_role INHERIT;"
assert_runtime_catalog_rejected \
  "ALTER ROLE $runtime_role SET search_path = public;"
assert_runtime_catalog_rejected \
  "GRANT $PGUSER TO $runtime_role;"

verify_runtime_catalog
echo "custody-postgres-runtime-privilege-catalog-negative-ok"

psql_command -v ON_ERROR_STOP=1 -Atq -c "
  SELECT CASE
    WHEN has_schema_privilege('$runtime_role', 'custody_core', 'USAGE')
      AND NOT has_schema_privilege('$runtime_role', 'custody_core', 'CREATE')
      AND NOT has_any_column_privilege(
        '$runtime_role',
        'custody_core.custody_projection_outbox',
        'SELECT, INSERT, UPDATE, REFERENCES'
      )
      AND NOT has_table_privilege(
        '$runtime_role',
        'custody_core.custody_projection_outbox',
        'DELETE, TRUNCATE, TRIGGER'
      )
      AND NOT has_any_column_privilege(
        '$runtime_role',
        'custody_core.schema_migrations',
        'SELECT, INSERT, UPDATE, REFERENCES'
      )
      AND NOT has_table_privilege(
        '$runtime_role',
        'custody_core.schema_migrations',
        'DELETE, TRUNCATE, TRIGGER'
      )
      AND has_function_privilege(
        '$runtime_role',
        'custody_core.record_custody_projection(jsonb, text)',
        'EXECUTE'
      )
      AND NOT has_function_privilege(
        '$runtime_role',
        'custody_core.validate_migration_sequence()',
        'EXECUTE'
      )
      AND NOT has_function_privilege(
        '$runtime_role',
        'custody_core.reject_migration_history_mutation()',
        'EXECUTE'
      )
      AND NOT has_function_privilege(
        '$runtime_role',
        'custody_core.reject_outbox_mutation()',
        'EXECUTE'
      )
      AND (
        SELECT procedure.prosecdef
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'custody_core'
          AND procedure.proname = 'record_custody_projection'
      )
      AND (
        SELECT procedure.proconfig
          = ARRAY['search_path=pg_catalog, custody_core']
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'custody_core'
          AND procedure.proname = 'record_custody_projection'
      )
    THEN 'custody-runtime-privilege-shape-ok'
    ELSE 'custody-runtime-privilege-shape-failed'
  END;
" | grep -Fx "custody-runtime-privilege-shape-ok"

runtime_event='{
  "actor":{"subject":"custody_orchestrator","type":"service"},
  "aggregate_id":"withdrawal_runtime_001",
  "aggregate_type":"withdrawal",
  "causation_id":"018f3f8a-0030-7000-8000-000000000030",
  "correlation_id":"018f3f8a-4000-7000-8000-000000000004",
  "data_classification":"highly-confidential",
  "event_id":"018f3f8a-0031-7000-8000-000000000031",
  "event_type":"CustodyIntentPrepared",
  "event_version":1,
  "idempotency_key":"custody_idempotency_runtime_001",
  "occurred_at":"2026-10-01T12:02:00.000Z",
  "payload":{
    "approval_evidence_digest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "asset":"USDT",
    "custody_intent_id":"custody_intent_runtime_001",
    "execution_authority":false,
    "expires_at":"2026-10-01T12:05:00.000Z",
    "intent_digest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "network":"TRON_TESTNET",
    "policy_digest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "production_signing_enabled":false,
    "status":"unsigned_intent_ready",
    "withdrawal_id":"withdrawal_runtime_001"
  },
  "producer":"custody-orchestrator"
}'

test "$(psql_command -At -c "
  SET ROLE $runtime_role;
  SELECT replayed
  FROM custody_core.record_custody_projection(
    \$event\$$runtime_event\$event\$::jsonb,
    repeat('d', 64)
  );
")" = "SET
f"

test "$(psql_command -At -c "
  SET ROLE $runtime_role;
  SELECT replayed
  FROM custody_core.record_custody_projection(
    \$event\$$runtime_event\$event\$::jsonb,
    repeat('d', 64)
  );
")" = "SET
t"

expect_denied \
  "direct custody outbox select" \
  "permission denied for table custody_projection_outbox" \
  "SELECT * FROM custody_core.custody_projection_outbox;"
expect_denied \
  "direct custody outbox insert" \
  "permission denied for table custody_projection_outbox" \
  "INSERT INTO custody_core.custody_projection_outbox DEFAULT VALUES;"
expect_denied \
  "direct custody outbox update" \
  "permission denied for table custody_projection_outbox" \
  "UPDATE custody_core.custody_projection_outbox SET request_digest = repeat('f', 64);"
expect_denied \
  "direct custody outbox delete" \
  "permission denied for table custody_projection_outbox" \
  "DELETE FROM custody_core.custody_projection_outbox;"
expect_denied \
  "direct custody outbox truncate" \
  "permission denied for table custody_projection_outbox" \
  "TRUNCATE custody_core.custody_projection_outbox;"
expect_denied \
  "direct custody migration history select" \
  "permission denied for table schema_migrations" \
  "SELECT * FROM custody_core.schema_migrations;"
expect_denied \
  "direct custody migration history insert" \
  "permission denied for table schema_migrations" \
  "INSERT INTO custody_core.schema_migrations (version, migration_name) VALUES (3, '0003_runtime_bypass');"
expect_denied \
  "custody schema object creation" \
  "permission denied for schema custody_core" \
  "CREATE TABLE custody_core.runtime_bypass (value text);"
expect_denied \
  "custody trigger disable" \
  "must be owner of table custody_projection_outbox" \
  "ALTER TABLE custody_core.custody_projection_outbox DISABLE TRIGGER ALL;"

test "$(psql_command -Atq -c "
  SELECT count(*)
  FROM custody_core.custody_projection_outbox
  WHERE idempotency_key = 'custody_idempotency_runtime_001';
")" = "1"

echo "custody-postgres-runtime-privileges-ok"
