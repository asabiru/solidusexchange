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

run_psql \
  -v ON_ERROR_STOP=1 \
  -Atq \
  -f tests/postgres-invariant-trigger-catalog.sql \
  | node scripts/verify-postgres-invariant-trigger-catalog.mjs

assert_replica_rejected() {
  local expected="$1"
  shift

  set +e
  output="$(
    run_psql \
      -v ON_ERROR_STOP=1 \
      -c "SET session_replication_role = replica;" \
      "$@" \
      2>&1
  )"
  status=$?
  set -e

  printf '%s\n' "$output"
  if [[ "$status" -eq 0 ]]; then
    echo "Ledger invariant unexpectedly succeeded in replica mode." >&2
    exit 1
  fi
  grep -F "$expected" <<<"$output"
}

assert_replica_rejected \
  "owner reference is required for account definition PROVIDER_PAYABLE_LIABILITY" \
  -c "
    INSERT INTO financial_core.ledger_accounts (
      account_id,
      chart_version,
      definition_code,
      legal_entity_id,
      asset_code,
      owner_reference,
      created_at
    ) VALUES (
      '31000000-0000-4000-8000-000000000031',
      1,
      'PROVIDER_PAYABLE_LIABILITY',
      'solidchange-dev',
      'TUSDT',
      NULL,
      '2026-09-25T11:00:00.000Z'
    );
  "
assert_replica_rejected \
  "amount exceeds ledger precision limit" \
  -f tests/postgres-reject-precision.sql
assert_replica_rejected \
  "is sealed" \
  -f tests/postgres-reject-late-entry.sql
assert_replica_rejected \
  "requires at least two entries" \
  -f tests/postgres-reject-incomplete.sql

echo "postgres-replica-mode-invariants-ok"
