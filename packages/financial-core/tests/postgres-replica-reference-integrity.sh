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
    echo "Ledger reference violation unexpectedly succeeded in replica mode." >&2
    exit 1
  fi
  grep -F "$expected" <<<"$output"
}

assert_replica_rejected \
  "account definition 1/MISSING_DEFINITION does not exist" \
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
      '32000000-0000-4000-8000-000000000032',
      1,
      'MISSING_DEFINITION',
      'solidchange-dev',
      'TUSDT',
      NULL,
      '2026-09-25T11:10:00.000Z'
    );
  "

assert_replica_rejected \
  "asset TNOASSET does not exist" \
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
      '33000000-0000-4000-8000-000000000033',
      1,
      'TREASURY_ASSET',
      'solidchange-dev',
      'TNOASSET',
      NULL,
      '2026-09-25T11:11:00.000Z'
    );
  "

assert_replica_rejected \
  "references missing posting rule MISSING_RULE/missing-rule-v1" \
  -c "
    INSERT INTO financial_core.ledger_journals (
      journal_id,
      journal_type,
      legal_entity_id,
      idempotency_key,
      command_digest,
      correlation_id,
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
      '34000000-0000-4000-8000-000000000034',
      'MISSING_RULE',
      'solidchange-dev',
      'missing-rule-000000000034',
      repeat('3', 64),
      '34000000-0000-4000-8000-000000000035',
      '2026-09-25T11:12:00.000Z',
      '2026-09-25T11:12:01.000Z',
      'SERVICE',
      'ledger-reference-test',
      'authorization-reference-test',
      'policy-v1',
      'missing-rule-v1',
      'synthetic-test',
      'missing-rule-reference',
      repeat('4', 64),
      '2026-09-25T11:12:01.000Z'
    );
  "

assert_replica_rejected \
  "journal 35000000-0000-4000-8000-000000000035 does not exist" \
  -c "
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
      '35000000-0000-4000-8000-000000000036',
      '35000000-0000-4000-8000-000000000035',
      1,
      '10000000-0000-4000-8000-000000000001',
      'solidchange-dev',
      'TUSDT',
      'DEBIT',
      1.00,
      '2026-09-25T11:13:00.000Z'
    );
  "

assert_replica_rejected \
  "entries violate reference integrity" \
  -c "
    BEGIN;
    INSERT INTO financial_core.ledger_journals (
      journal_id,
      journal_type,
      legal_entity_id,
      idempotency_key,
      command_digest,
      correlation_id,
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
      '36000000-0000-4000-8000-000000000036',
      'SYNTHETIC_PROVIDER_POSITION',
      'solidchange-dev',
      'bad-account-ref-0000000036',
      repeat('5', 64),
      '36000000-0000-4000-8000-000000000037',
      '2026-09-25T11:14:00.000Z',
      '2026-09-25T11:14:01.000Z',
      'SERVICE',
      'ledger-reference-test',
      'authorization-reference-test',
      'policy-v1',
      'synthetic-provider-position-v1',
      'synthetic-test',
      'bad-account-reference',
      repeat('6', 64),
      '2026-09-25T11:14:01.000Z'
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
      '36000000-0000-4000-8000-000000000038',
      '36000000-0000-4000-8000-000000000036',
      1,
      '10000000-0000-4000-8000-000000000001',
      'wrong-legal-entity',
      'TUSDT',
      'DEBIT',
      1.00,
      '2026-09-25T11:14:01.000Z'
    );
    SET CONSTRAINTS ALL IMMEDIATE;
  "

assert_replica_rejected \
  "journal 37000000-0000-4000-8000-000000000037 does not exist" \
  -c "
    INSERT INTO financial_core.ledger_idempotency_registry (
      legal_entity_id,
      idempotency_key,
      command_digest,
      journal_id,
      first_seen_at
    ) VALUES (
      'solidchange-dev',
      'orphan-idempotency-00000037',
      repeat('7', 64),
      '37000000-0000-4000-8000-000000000037',
      '2026-09-25T11:15:00.000Z'
    );
  "

assert_replica_rejected \
  "journal 38000000-0000-4000-8000-000000000038 does not exist" \
  -c "
    INSERT INTO financial_core.ledger_journal_seals (
      journal_id,
      command_digest,
      entry_count,
      sealed_at
    ) VALUES (
      '38000000-0000-4000-8000-000000000038',
      repeat('8', 64),
      2,
      '2026-09-25T11:16:00.000Z'
    );
  "

assert_replica_rejected \
  "journal 39000000-0000-4000-8000-000000000039 does not exist" \
  -c "
    INSERT INTO financial_core.ledger_outbox_events (
      outbox_id,
      journal_id,
      event_type,
      payload,
      created_at
    ) VALUES (
      '39000000-0000-4000-8000-000000000040',
      '39000000-0000-4000-8000-000000000039',
      'internal.ledger.journal-accepted.v1',
      jsonb_build_object(
        'journal_id',
        '39000000-0000-4000-8000-000000000039',
        'command_digest',
        repeat('9', 64)
      ),
      '2026-09-25T11:17:00.000Z'
    );
  "

assert_replica_rejected \
  "outbox event 40000000-0000-4000-8000-000000000040 does not exist" \
  -c "
    INSERT INTO financial_core.ledger_outbox_delivery_attempts (
      delivery_id,
      outbox_id,
      attempted_at,
      outcome,
      response_digest
    ) VALUES (
      '40000000-0000-4000-8000-000000000041',
      '40000000-0000-4000-8000-000000000040',
      '2026-09-25T11:18:00.000Z',
      'SUCCEEDED',
      repeat('a', 64)
    );
  "

echo "postgres-replica-mode-reference-integrity-ok"
