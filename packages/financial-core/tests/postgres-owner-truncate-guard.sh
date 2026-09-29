#!/usr/bin/env bash

set -euo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=ledger_test}"
: "${PGDATABASE:=ledger_test}"
: "${PGPASSWORD:=ledger_test}"

PSQL_DOCKER_IMAGE="${PSQL_DOCKER_IMAGE:-}"
workspace="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tables=(
  schema_migrations
  ledger_assets
  account_definitions
  ledger_accounts
  ledger_journals
  ledger_entries
  ledger_idempotency_registry
  ledger_outbox_events
  ledger_outbox_delivery_attempts
  posting_rule_registry
  ledger_journal_seals
)

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

for table in "${tables[@]}"; do
  set +e
  output="$(
    run_psql \
      -v ON_ERROR_STOP=1 \
      -c "TRUNCATE TABLE financial_core.$table CASCADE;" \
      2>&1
  )"
  status=$?
  set -e

  printf '%s\n' "$output"
  if [[ "$status" -eq 0 ]]; then
    echo "TRUNCATE unexpectedly succeeded for financial_core.$table." >&2
    exit 1
  fi
  grep -F "financial_core tables are append-only" <<<"$output"
done

run_psql -v ON_ERROR_STOP=1 -Atq -c "
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
        FROM financial_core.schema_migrations
       WHERE version = 4
         AND migration_name = '0004_ledger_truncate_guard'
    )
    AND (
      SELECT count(*)
        FROM pg_catalog.pg_trigger AS trigger
        JOIN pg_catalog.pg_class AS relation
          ON relation.oid = trigger.tgrelid
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname = 'financial_core'
         AND trigger.tgname LIKE '%_reject_truncate'
         AND trigger.tgisinternal = FALSE
    ) = 11
    THEN 'postgres-owner-truncate-guard-ok'
    ELSE 'postgres-owner-truncate-guard-failed'
  END;
" | grep -Fx "postgres-owner-truncate-guard-ok"
