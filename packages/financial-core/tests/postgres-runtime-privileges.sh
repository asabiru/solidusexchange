#!/usr/bin/env bash

set -euo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=ledger_test}"
: "${PGDATABASE:=ledger_test}"
: "${PGPASSWORD:=ledger_test}"

PSQL_DOCKER_IMAGE="${PSQL_DOCKER_IMAGE:-}"
runtime_role="financial_core_runtime_test"
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

expect_denied() {
  local label="$1"
  local expected="$2"
  local statement="$3"
  local output
  local status

  set +e
  output="$(run_psql -v ON_ERROR_STOP=1 -c "
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
  run_psql \
    -v ON_ERROR_STOP=1 \
    -v "ledger_runtime_role=$runtime_role" \
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
    run_psql \
      -v ON_ERROR_STOP=1 \
      -v "ledger_runtime_role=$runtime_role" \
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
    echo "Runtime privilege drift unexpectedly matched the reviewed profile." >&2
    exit 1
  fi
  grep -F \
    "PostgreSQL runtime role or privileges differ from the reviewed least-privilege profile" \
    <<<"$output"
}

run_psql -v ON_ERROR_STOP=1 -c "
  CREATE ROLE $runtime_role
    NOLOGIN
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE
    NOINHERIT
    NOREPLICATION
    NOBYPASSRLS;
"

run_psql \
  -v ON_ERROR_STOP=1 \
  -v "ledger_runtime_role=$runtime_role" \
  -f tests/runtime-writer-grants.sql

verify_runtime_catalog

assert_runtime_catalog_rejected \
  "GRANT INSERT ON TABLE financial_core.schema_migrations TO $runtime_role;"
assert_runtime_catalog_rejected \
  "GRANT SELECT ON TABLE financial_core.ledger_outbox_delivery_attempts TO $runtime_role;"
assert_runtime_catalog_rejected \
  "GRANT UPDATE (actor_id) ON TABLE financial_core.ledger_journals TO $runtime_role;"
assert_runtime_catalog_rejected \
  "GRANT SELECT ON TABLE financial_core.ledger_entries TO $runtime_role WITH GRANT OPTION;"
assert_runtime_catalog_rejected \
  "GRANT EXECUTE ON FUNCTION financial_core.reject_mutation() TO $runtime_role;"
assert_runtime_catalog_rejected \
  "GRANT INSERT ON TABLE financial_core.ledger_accounts TO PUBLIC;"
assert_runtime_catalog_rejected \
  "CREATE ROLE financial_core_runtime_parent_test NOLOGIN;
   GRANT INSERT ON TABLE financial_core.schema_migrations
     TO financial_core_runtime_parent_test;
   GRANT financial_core_runtime_parent_test TO $runtime_role;"
assert_runtime_catalog_rejected \
  "ALTER ROLE $runtime_role LOGIN;"
assert_runtime_catalog_rejected \
  "ALTER ROLE $runtime_role SET search_path = public;"
assert_runtime_catalog_rejected \
  "SET LOCAL ROLE $runtime_role;
   ALTER ROLE $runtime_role IN DATABASE \"$PGDATABASE\" SET search_path = public;
   RESET ROLE;"
assert_runtime_catalog_rejected \
  "SET LOCAL ROLE $runtime_role;
   ALTER ROLE $runtime_role IN DATABASE \"$PGDATABASE\" SET TimeZone = 'Pacific/Kiritimati';
   RESET ROLE;"
assert_runtime_catalog_rejected \
  "SET LOCAL ROLE $runtime_role;
   ALTER ROLE $runtime_role IN DATABASE \"$PGDATABASE\" SET DateStyle = 'SQL, DMY';
   RESET ROLE;"
assert_runtime_catalog_rejected \
  "SET LOCAL ROLE $runtime_role;
   ALTER ROLE CURRENT_USER IN DATABASE postgres SET search_path = public;
   RESET ROLE;"
assert_runtime_catalog_rejected \
  "ALTER SCHEMA financial_core OWNER TO $runtime_role;"
assert_runtime_catalog_rejected \
  "GRANT TEMPORARY ON DATABASE \"$PGDATABASE\" TO PUBLIC;"
assert_runtime_catalog_rejected \
  "GRANT CREATE ON DATABASE \"$PGDATABASE\" TO $runtime_role;"

verify_runtime_catalog
echo "postgres-runtime-privilege-catalog-negative-ok"

run_psql -v ON_ERROR_STOP=1 -c "
  SET ROLE $runtime_role;
  ALTER ROLE $runtime_role IN DATABASE \"$PGDATABASE\" SET TimeZone = 'Pacific/Kiritimati';
"
set +e
grants_output="$(
  run_psql \
    -v ON_ERROR_STOP=1 \
    -v "ledger_runtime_role=$runtime_role" \
    -f tests/runtime-writer-grants.sql 2>&1
)"
grants_status=$?
set -e
run_psql -v ON_ERROR_STOP=1 -c "
  ALTER ROLE $runtime_role IN DATABASE \"$PGDATABASE\" RESET ALL;
"
printf '%s\n' "$grants_output"
if [[ "$grants_status" -eq 0 ]]; then
  echo "Runtime grants unexpectedly accepted per-database session defaults." >&2
  exit 1
fi
grep -F \
  "runtime writer must not carry role or per-database session defaults" \
  <<<"$grants_output"
verify_runtime_catalog
echo "runtime-writer-session-defaults-negative-ok"

run_psql -v ON_ERROR_STOP=1 -Atq -c "
  SELECT CASE
    WHEN has_schema_privilege('$runtime_role', 'financial_core', 'USAGE')
     AND NOT has_schema_privilege('$runtime_role', 'financial_core', 'CREATE')
     AND has_table_privilege(
       '$runtime_role',
       'financial_core.ledger_journals',
       'SELECT'
     )
     AND has_table_privilege(
       '$runtime_role',
       'financial_core.ledger_journals',
       'INSERT'
     )
     AND has_table_privilege(
       '$runtime_role',
       'financial_core.ledger_entries',
       'SELECT'
     )
     AND has_table_privilege(
       '$runtime_role',
       'financial_core.ledger_entries',
       'INSERT'
     )
     AND NOT EXISTS (
       SELECT 1
         FROM unnest(ARRAY[
           'UPDATE',
           'DELETE',
           'TRUNCATE',
           'REFERENCES',
           'TRIGGER'
         ]) AS denied(privilege)
        WHERE has_table_privilege(
          '$runtime_role',
          'financial_core.ledger_journals',
          denied.privilege
        )
     )
     AND NOT EXISTS (
       SELECT 1
         FROM unnest(ARRAY[
           'UPDATE',
           'DELETE',
           'TRUNCATE',
           'REFERENCES',
           'TRIGGER'
         ]) AS denied(privilege)
        WHERE has_table_privilege(
          '$runtime_role',
          'financial_core.ledger_entries',
          denied.privilege
        )
     )
     AND NOT EXISTS (
       SELECT 1
         FROM unnest(ARRAY[
           'INSERT',
           'UPDATE',
           'DELETE',
           'TRUNCATE',
           'REFERENCES',
           'TRIGGER'
         ]) AS denied(privilege)
        WHERE has_table_privilege(
          '$runtime_role',
          'financial_core.ledger_assets',
          denied.privilege
        )
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc AS function
         JOIN pg_catalog.pg_namespace AS namespace
           ON namespace.oid = function.pronamespace
        WHERE namespace.nspname = 'financial_core'
          AND has_function_privilege(
            '$runtime_role',
            function.oid,
            'EXECUTE'
          )
     )
    THEN 'runtime-privilege-shape-ok'
    ELSE 'runtime-privilege-shape-failed'
  END;
" | grep -Fx "runtime-privilege-shape-ok"

run_psql -v ON_ERROR_STOP=1 -Atq -c "
  SET ROLE $runtime_role;
  BEGIN;

  INSERT INTO financial_core.ledger_journals (
    journal_id,
    journal_type,
    legal_entity_id,
    idempotency_key,
    command_digest,
    correlation_id,
    causation_id,
    effective_at,
    accepted_at,
    actor_type,
    actor_id,
    authorization_reference,
    policy_version,
    posting_rule_version,
    source_type,
    source_reference,
    evidence_digest,
    created_at
  ) VALUES (
    'ba000000-0000-4000-8000-0000000000b1',
    'SYNTHETIC_PROVIDER_POSITION',
    'solidchange-dev',
    'runtime-privilege-demo-001',
    'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    'ba000000-0000-4000-8000-0000000000b2',
    NULL,
    '2026-09-29T19:30:00.000Z',
    '2026-09-29T19:30:01.000Z',
    'SERVICE',
    'financial-core-runtime-test',
    'policy-decision-runtime-001',
    'ledger-dev-policy-v1',
    'synthetic-provider-position-v1',
    'synthetic-test',
    'runtime-privilege-source-001',
    'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    '2026-09-29T19:30:01.000Z'
  );

  INSERT INTO financial_core.ledger_entries (
    entry_id,
    journal_id,
    sequence_number,
    account_id,
    legal_entity_id,
    asset_code,
    side,
    amount,
    created_at
  ) VALUES
    (
      'ba000000-0000-4000-8000-0000000000b3',
      'ba000000-0000-4000-8000-0000000000b1',
      1,
      '10000000-0000-4000-8000-000000000001',
      'solidchange-dev',
      'TUSDT',
      'DEBIT',
      12.000000,
      '2026-09-29T19:30:01.000Z'
    ),
    (
      'ba000000-0000-4000-8000-0000000000b4',
      'ba000000-0000-4000-8000-0000000000b1',
      2,
      '20000000-0000-4000-8000-000000000002',
      'solidchange-dev',
      'TUSDT',
      'CREDIT',
      12.000000,
      '2026-09-29T19:30:01.000Z'
    );

  INSERT INTO financial_core.ledger_idempotency_registry (
    legal_entity_id,
    idempotency_key,
    command_digest,
    journal_id,
    first_seen_at
  ) VALUES (
    'solidchange-dev',
    'runtime-privilege-demo-001',
    'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    'ba000000-0000-4000-8000-0000000000b1',
    '2026-09-29T19:30:01.000Z'
  );

  INSERT INTO financial_core.ledger_outbox_events (
    outbox_id,
    journal_id,
    event_type,
    payload,
    created_at
  ) VALUES (
    'ba000000-0000-4000-8000-0000000000b5',
    'ba000000-0000-4000-8000-0000000000b1',
    'internal.ledger.journal-accepted.v1',
    jsonb_build_object(
      'journal_id', 'ba000000-0000-4000-8000-0000000000b1',
      'command_digest', 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    ),
    '2026-09-29T19:30:01.000Z'
  );

  INSERT INTO financial_core.ledger_journal_seals (
    journal_id,
    command_digest,
    entry_count,
    sealed_at
  ) VALUES (
    'ba000000-0000-4000-8000-0000000000b1',
    'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    2,
    '2026-09-29T19:30:01.000Z'
  );

  COMMIT;
  RESET ROLE;

  SELECT CASE
    WHEN (
      SELECT count(*)
        FROM financial_core.ledger_entries
       WHERE journal_id = 'ba000000-0000-4000-8000-0000000000b1'
    ) = 2
     AND (
      SELECT count(*)
        FROM financial_core.ledger_journal_seals
       WHERE journal_id = 'ba000000-0000-4000-8000-0000000000b1'
    ) = 1
    THEN 'runtime-acceptance-ok'
    ELSE 'runtime-acceptance-failed'
  END;
" | grep -Fx "runtime-acceptance-ok"

expect_denied \
  "runtime UPDATE" \
  "permission denied for table ledger_journals" \
  "UPDATE financial_core.ledger_journals
      SET actor_id = 'tampered'
    WHERE journal_id = 'ba000000-0000-4000-8000-0000000000b1';"

expect_denied \
  "runtime DELETE" \
  "permission denied for table ledger_entries" \
  "DELETE FROM financial_core.ledger_entries
    WHERE journal_id = 'ba000000-0000-4000-8000-0000000000b1';"

expect_denied \
  "runtime TRUNCATE" \
  "permission denied for table ledger_entries" \
  "TRUNCATE financial_core.ledger_entries;"

expect_denied \
  "runtime DDL" \
  "must be owner of table ledger_entries" \
  "ALTER TABLE financial_core.ledger_entries DISABLE TRIGGER ALL;"

expect_denied \
  "runtime migration history INSERT" \
  "permission denied for table schema_migrations" \
  "INSERT INTO financial_core.schema_migrations (version, migration_name)
   VALUES (12, '0012_runtime_forged_migration');"

expect_denied \
  "runtime configuration INSERT" \
  "permission denied for table ledger_assets" \
  "INSERT INTO financial_core.ledger_assets (
     asset_code,
     decimal_places,
     enabled_for_posting,
     evidence_reference
   ) VALUES (
     'TBAD',
     6,
     TRUE,
     'runtime-must-not-configure-assets'
   );"

expect_denied \
  "runtime temporary type shadowing" \
  "permission denied to create temporary tables in database" \
  "CREATE DOMAIN pg_temp.timestamptz AS pg_catalog.date;"

echo "runtime-writer-privileges-ok"
