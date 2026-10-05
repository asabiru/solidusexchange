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
    -f tests/postgres-execution-surface-catalog.sql \
    | node scripts/verify-postgres-execution-surface-catalog.mjs
}

verify_with_drift() {
  local statement="$1"

  {
    printf '%s\n' "BEGIN;" "$statement"
    cat tests/postgres-execution-surface-catalog.sql
    printf '%s\n' "ROLLBACK;"
  } | run_psql -v ON_ERROR_STOP=1 -Atq \
    | node scripts/verify-postgres-execution-surface-catalog.mjs 2>&1
}

assert_catalog_rejected() {
  local expected="$1"
  local statement="$2"
  local output
  local status

  set +e
  output="$(verify_with_drift "$statement")"
  status=$?
  set -e

  printf '%s\n' "$output"
  if [[ "$status" -eq 0 ]]; then
    echo "PostgreSQL execution-surface drift unexpectedly passed: $statement" >&2
    exit 1
  fi
  grep -F "$expected" <<<"$output"
}

assert_catalog_accepted() {
  local statement="$1"
  local output
  local status

  set +e
  output="$(verify_with_drift "$statement")"
  status=$?
  set -e

  printf '%s\n' "$output"
  if [[ "$status" -ne 0 ]]; then
    echo "Unrelated PostgreSQL object unexpectedly failed: $statement" >&2
    exit 1
  fi
}

trigger_drift="PostgreSQL financial-core trigger inventory differs from the expected policy"
rule_drift="PostgreSQL financial-core rewrite rules differ from the expected policy"
shadow_drift="PostgreSQL financial-core schema contains search-path shadow objects"
database_shadow_drift="PostgreSQL database contains user-defined casts or pg_catalog objects that shadow financial-core built-ins"
builtin_drift="PostgreSQL built-in casts, pg_catalog functions or operators differ from the pinned PostgreSQL 16.10 catalog"

verify_catalog

assert_catalog_rejected "$trigger_drift" "
CREATE FUNCTION public.forge_migration() RETURNS TRIGGER LANGUAGE plpgsql AS \$\$
BEGIN
  NEW.version := 99;
  NEW.migration_name := '0042_forged';
  RETURN NEW;
END;
\$\$;
CREATE TRIGGER zz_forge_migration
BEFORE INSERT ON financial_core.schema_migrations
FOR EACH ROW EXECUTE FUNCTION public.forge_migration();
ALTER TABLE financial_core.schema_migrations
  ENABLE ALWAYS TRIGGER zz_forge_migration;"
assert_catalog_rejected "$trigger_drift" "
CREATE FUNCTION public.skip_mutation() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER AS \$\$ BEGIN RETURN NULL; END; \$\$;
CREATE TRIGGER aa_skip_mutation
BEFORE UPDATE OR DELETE ON financial_core.ledger_journals
FOR EACH ROW EXECUTE FUNCTION public.skip_mutation();"
assert_catalog_rejected "$trigger_drift" "
CREATE TRIGGER aa_suppress_updates
BEFORE UPDATE ON financial_core.ledger_entries
FOR EACH ROW EXECUTE FUNCTION pg_catalog.suppress_redundant_updates_trigger();"

assert_catalog_rejected "$rule_drift" "
CREATE RULE swallow_migrations AS
ON INSERT TO financial_core.schema_migrations DO INSTEAD NOTHING;"
assert_catalog_rejected "$rule_drift" "
CREATE RULE mask_journal_updates AS
ON UPDATE TO financial_core.ledger_journals DO INSTEAD NOTHING;"
assert_catalog_rejected "$rule_drift" "
CREATE RULE notify_entries AS
ON INSERT TO financial_core.ledger_entries DO ALSO NOTIFY financial_core_entries;"

assert_catalog_rejected "$shadow_drift" "
CREATE FUNCTION public.never_different(INTEGER, INTEGER) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS 'SELECT FALSE';
CREATE OPERATOR financial_core.<> (
  LEFTARG = INTEGER,
  RIGHTARG = INTEGER,
  FUNCTION = public.never_different
);"
assert_catalog_rejected "$shadow_drift" \
  "CREATE DOMAIN financial_core.timestamptz AS DATE;"
assert_catalog_rejected "$shadow_drift" \
  "CREATE TYPE financial_core.timestamptz AS (value DATE);"
assert_catalog_rejected "$shadow_drift" \
  "CREATE TYPE financial_core.side AS ENUM ('DEBIT', 'CREDIT');"
assert_catalog_rejected "$shadow_drift" \
  "CREATE TYPE financial_core.int4range AS RANGE (SUBTYPE = INTEGER);"
assert_catalog_rejected "$shadow_drift" \
  "CREATE COLLATION financial_core.\"C\" FROM pg_catalog.\"POSIX\";"
assert_catalog_rejected "$shadow_drift" \
  "CREATE OPERATOR FAMILY financial_core.integer_ops USING btree;"
assert_catalog_rejected "$shadow_drift" \
  "CREATE TEXT SEARCH CONFIGURATION financial_core.english (COPY = pg_catalog.english);"

assert_catalog_rejected "$database_shadow_drift" "
CREATE FUNCTION public.forge_migration_version(TEXT) RETURNS INTEGER
LANGUAGE sql STABLE AS \$\$SELECT CASE WHEN \$1 = '0099' THEN NULL::INTEGER ELSE pg_catalog.int4in(pg_catalog.textout(\$1)) END\$\$;
CREATE CAST (TEXT AS INTEGER) WITH FUNCTION public.forge_migration_version(TEXT);"
assert_catalog_rejected "$database_shadow_drift" \
  "CREATE CAST (TEXT AS INTEGER) WITH INOUT AS IMPLICIT;"
assert_catalog_rejected "$database_shadow_drift" \
  "CREATE CAST (BIGINT AS TIMESTAMPTZ) WITHOUT FUNCTION;"
assert_catalog_rejected "$database_shadow_drift" "
CREATE FUNCTION pg_catalog.to_jsonb(financial_core.ledger_outbox_events) RETURNS JSONB
LANGUAGE sql IMMUTABLE AS 'SELECT ''{}''::JSONB';"
assert_catalog_rejected "$database_shadow_drift" "
CREATE FUNCTION public.never_equal(INTEGER, INTEGER) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS 'SELECT FALSE';
CREATE OPERATOR pg_catalog.=== (
  LEFTARG = INTEGER,
  RIGHTARG = INTEGER,
  FUNCTION = public.never_equal
);"

assert_catalog_rejected "$builtin_drift" "
CREATE FUNCTION public.never_not_equal(INTEGER, INTEGER) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS 'SELECT FALSE';
UPDATE pg_catalog.pg_operator
SET oprcode = 'public.never_not_equal'::pg_catalog.regproc
WHERE oid = '<>(integer,integer)'::pg_catalog.regoperator;"
assert_catalog_rejected "$builtin_drift" \
  "ALTER FUNCTION pg_catalog.lower(TEXT) SET search_path = public;"
assert_catalog_rejected "$builtin_drift" "
UPDATE pg_catalog.pg_cast SET castcontext = 'i'
WHERE castsource = 'bigint'::pg_catalog.regtype
  AND casttarget = 'integer'::pg_catalog.regtype;"

assert_catalog_accepted "
CREATE DOMAIN public.timestamptz AS DATE;
CREATE TABLE public.unrelated_hook_target (value INTEGER);
CREATE FUNCTION public.unrelated_hook() RETURNS TRIGGER
LANGUAGE plpgsql AS \$\$ BEGIN RETURN NEW; END; \$\$;
CREATE TRIGGER unrelated_hook
BEFORE INSERT ON public.unrelated_hook_target
FOR EACH ROW EXECUTE FUNCTION public.unrelated_hook();
CREATE RULE unrelated_rule AS
ON INSERT TO public.unrelated_hook_target DO ALSO NOTIFY unrelated_hook_target;"

verify_catalog

echo "postgres-execution-surface-catalog-negative-ok"
