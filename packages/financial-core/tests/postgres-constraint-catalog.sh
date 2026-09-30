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
  -f tests/postgres-constraint-catalog.sql \
  | node scripts/verify-postgres-constraint-catalog.mjs

assert_replica_constraint_rejected() {
  local expected="$1"
  local statement="$2"

  set +e
  output="$(
    run_psql \
      -v ON_ERROR_STOP=1 \
      -c "SET session_replication_role = replica; $statement" \
      2>&1
  )"
  status=$?
  set -e

  printf '%s\n' "$output"
  if [[ "$status" -eq 0 ]]; then
    echo "Ledger constraint violation unexpectedly succeeded in replica mode." >&2
    exit 1
  fi
  grep -F "$expected" <<<"$output"
}

assert_replica_constraint_rejected \
  'violates check constraint "ledger_entries_amount_check"' \
  "
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
      '51000000-0000-4000-8000-000000000051',
      'SYNTHETIC_PROVIDER_POSITION',
      'solidchange-dev',
      'constraint-check-demo-001',
      repeat('1', 64),
      '52000000-0000-4000-8000-000000000052',
      NULL,
      '2026-09-25T12:00:00.000Z',
      '2026-09-25T12:00:01.000Z',
      'SERVICE',
      'financial-core-postgres-test',
      'policy-decision-demo-009',
      'ledger-dev-policy-v1',
      'synthetic-provider-position-v1',
      'synthetic-test',
      'constraint-check-source-001',
      repeat('2', 64),
      '2026-09-25T12:00:01.000Z'
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
    ) VALUES (
      '53000000-0000-4000-8000-000000000053',
      '51000000-0000-4000-8000-000000000051',
      1,
      '10000000-0000-4000-8000-000000000001',
      'solidchange-dev',
      'TUSDT',
      'DEBIT',
      0,
      '2026-09-25T12:00:01.000Z'
    );
    COMMIT;
  "

assert_replica_constraint_rejected \
  'violates unique constraint "ledger_entries_journal_id_sequence_number_key"' \
  "
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
      '54000000-0000-4000-8000-000000000054',
      'SYNTHETIC_PROVIDER_POSITION',
      'solidchange-dev',
      'constraint-unique-demo-001',
      repeat('3', 64),
      '55000000-0000-4000-8000-000000000055',
      NULL,
      '2026-09-25T12:05:00.000Z',
      '2026-09-25T12:05:01.000Z',
      'SERVICE',
      'financial-core-postgres-test',
      'policy-decision-demo-010',
      'ledger-dev-policy-v1',
      'synthetic-provider-position-v1',
      'synthetic-test',
      'constraint-unique-source-001',
      repeat('4', 64),
      '2026-09-25T12:05:01.000Z'
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
        '56000000-0000-4000-8000-000000000056',
        '54000000-0000-4000-8000-000000000054',
        1,
        '10000000-0000-4000-8000-000000000001',
        'solidchange-dev',
        'TUSDT',
        'DEBIT',
        1,
        '2026-09-25T12:05:01.000Z'
      ),
      (
        '57000000-0000-4000-8000-000000000057',
        '54000000-0000-4000-8000-000000000054',
        1,
        '20000000-0000-4000-8000-000000000002',
        'solidchange-dev',
        'TUSDT',
        'CREDIT',
        1,
        '2026-09-25T12:05:01.000Z'
      );
    COMMIT;
  "

assert_replica_constraint_rejected \
  'violates unique constraint "ledger_idempotency_registry_pkey"' \
  "
    INSERT INTO financial_core.ledger_idempotency_registry (
      legal_entity_id,
      idempotency_key,
      command_digest,
      journal_id,
      first_seen_at
    ) VALUES (
      'solidchange-dev',
      'provider-position-demo-001',
      repeat('5', 64),
      '58000000-0000-4000-8000-000000000058',
      '2026-09-25T12:10:00.000Z'
    );
  "

assert_replica_constraint_rejected \
  'violates unique constraint "ledger_accounts_identity"' \
  "
    INSERT INTO financial_core.ledger_accounts (
      account_id,
      chart_version,
      definition_code,
      legal_entity_id,
      asset_code,
      owner_reference,
      created_at
    ) VALUES (
      '59000000-0000-4000-8000-000000000059',
      1,
      'TREASURY_ASSET',
      'solidchange-dev',
      'TUSDT',
      'treasury-demo',
      '2026-09-25T12:15:00.000Z'
    );
  "

echo "postgres-replica-mode-constraint-integrity-ok"
