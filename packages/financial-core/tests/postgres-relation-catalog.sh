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
  -f tests/postgres-relation-catalog.sql \
  | node scripts/verify-postgres-relation-catalog.mjs

assert_replica_not_null_rejected() {
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
    echo "Ledger NOT NULL violation unexpectedly succeeded in replica mode." >&2
    exit 1
  fi
  grep -F "$expected" <<<"$output"
}

assert_replica_not_null_rejected \
  'null value in column "command_digest" of relation "ledger_journals" violates not-null constraint' \
  "
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
      '61000000-0000-4000-8000-000000000061',
      'SYNTHETIC_PROVIDER_POSITION',
      'solidchange-dev',
      'relation-null-journal-001',
      NULL,
      '62000000-0000-4000-8000-000000000062',
      NULL,
      '2026-09-25T13:00:00.000Z',
      '2026-09-25T13:00:01.000Z',
      'SERVICE',
      'financial-core-postgres-test',
      'policy-decision-demo-011',
      'ledger-dev-policy-v1',
      'synthetic-provider-position-v1',
      'synthetic-test',
      'relation-null-journal-source-001',
      repeat('6', 64),
      '2026-09-25T13:00:01.000Z'
    );
  "

assert_replica_not_null_rejected \
  'null value in column "amount" of relation "ledger_entries" violates not-null constraint' \
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
      '63000000-0000-4000-8000-000000000063',
      'SYNTHETIC_PROVIDER_POSITION',
      'solidchange-dev',
      'relation-null-entry-001',
      repeat('7', 64),
      '64000000-0000-4000-8000-000000000064',
      NULL,
      '2026-09-25T13:05:00.000Z',
      '2026-09-25T13:05:01.000Z',
      'SERVICE',
      'financial-core-postgres-test',
      'policy-decision-demo-012',
      'ledger-dev-policy-v1',
      'synthetic-provider-position-v1',
      'synthetic-test',
      'relation-null-entry-source-001',
      repeat('8', 64),
      '2026-09-25T13:05:01.000Z'
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
      '65000000-0000-4000-8000-000000000065',
      '63000000-0000-4000-8000-000000000063',
      1,
      '10000000-0000-4000-8000-000000000001',
      'solidchange-dev',
      'TUSDT',
      'DEBIT',
      NULL,
      '2026-09-25T13:05:01.000Z'
    );
    COMMIT;
  "

assert_replica_not_null_rejected \
  'null value in column "payload" of relation "ledger_outbox_events" violates not-null constraint' \
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
      '66000000-0000-4000-8000-000000000066',
      'SYNTHETIC_PROVIDER_POSITION',
      'solidchange-dev',
      'relation-null-outbox-001',
      repeat('9', 64),
      '67000000-0000-4000-8000-000000000067',
      NULL,
      '2026-09-25T13:10:00.000Z',
      '2026-09-25T13:10:01.000Z',
      'SERVICE',
      'financial-core-postgres-test',
      'policy-decision-demo-013',
      'ledger-dev-policy-v1',
      'synthetic-provider-position-v1',
      'synthetic-test',
      'relation-null-outbox-source-001',
      repeat('a', 64),
      '2026-09-25T13:10:01.000Z'
    );
    INSERT INTO financial_core.ledger_outbox_events (
      outbox_id,
      journal_id,
      event_type,
      payload,
      created_at
    ) VALUES (
      '68000000-0000-4000-8000-000000000068',
      '66000000-0000-4000-8000-000000000066',
      'internal.ledger.journal-accepted.v1',
      NULL,
      '2026-09-25T13:10:01.000Z'
    );
    COMMIT;
  "

echo "postgres-replica-mode-not-null-integrity-ok"
