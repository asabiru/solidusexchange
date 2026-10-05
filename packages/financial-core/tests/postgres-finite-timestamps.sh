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

assert_infinite_timestamp_rejected() {
  local expected_constraint="$1"
  local statement="$2"

  set +e
  output="$(
    run_psql \
      -v ON_ERROR_STOP=1 \
      -c "SET session_replication_role = replica; ${statement}" \
      2>&1
  )"
  status=$?
  set -e

  printf '%s\n' "$output"
  if [[ "$status" -eq 0 ]]; then
    echo "Infinite timestamp unexpectedly committed in replica mode." >&2
    exit 1
  fi
  grep -F "violates check constraint \"${expected_constraint}\"" <<<"$output"
}

assert_infinite_timestamp_rejected \
  "schema_migrations_applied_at_finite" \
  "
    INSERT INTO financial_core.schema_migrations (
      version,
      migration_name,
      applied_at
    ) VALUES (
      13,
      '0013_finite_timestamp_probe',
      'infinity'
    );
  "

assert_infinite_timestamp_rejected \
  "ledger_assets_created_at_finite" \
  "
    INSERT INTO financial_core.ledger_assets (
      asset_code,
      decimal_places,
      enabled_for_posting,
      evidence_reference,
      created_at
    ) VALUES (
      'TINF',
      2,
      FALSE,
      'finite-timestamp-negative-probe',
      '-infinity'
    );
  "

assert_infinite_timestamp_rejected \
  "account_definitions_created_at_finite" \
  "
    INSERT INTO financial_core.account_definitions (
      chart_version,
      definition_code,
      category,
      account_class,
      normal_side,
      owner_scope,
      purpose,
      created_at
    ) VALUES (
      1,
      'FINITE_TIMESTAMP_PROBE',
      'treasury',
      'ASSET',
      'DEBIT',
      'forbidden',
      'Reject non-finite account-definition timestamps.',
      'infinity'
    );
  "

assert_infinite_timestamp_rejected \
  "posting_rule_registry_created_at_finite" \
  "
    INSERT INTO financial_core.posting_rule_registry (
      registry_version,
      journal_type,
      posting_rule_version,
      status,
      runtime_boundary,
      production_execution_enabled,
      scope,
      allowed_actor_types,
      entry_pattern,
      purpose,
      created_at
    ) VALUES (
      1,
      'FINITE_TIMESTAMP_PROBE',
      'finite-timestamp-probe-v1',
      'draft',
      'dev-dry-run',
      FALSE,
      'synthetic-test-only',
      ARRAY['SERVICE'],
      '[
        {\"definition_code\":\"TREASURY_ASSET\",\"side\":\"DEBIT\"},
        {\"definition_code\":\"PROVIDER_PAYABLE_LIABILITY\",\"side\":\"CREDIT\"}
      ]'::JSONB,
      'Reject non-finite posting-rule timestamps.',
      '-infinity'
    );
  "

assert_infinite_timestamp_rejected \
  "ledger_accounts_created_at_finite" \
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
      'a1000000-0000-4000-8000-000000000001',
      1,
      'TREASURY_ASSET',
      'solidchange-dev',
      'TUSDT',
      'finite-timestamp-probe',
      'infinity'
    );
  "

assert_infinite_timestamp_rejected \
  "ledger_journals_effective_at_finite" \
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
      'a2000000-0000-4000-8000-000000000002',
      'SYNTHETIC_PROVIDER_POSITION',
      'solidchange-dev',
      'finite-effective-at-probe',
      repeat('a', 64),
      'a3000000-0000-4000-8000-000000000003',
      NULL,
      'infinity',
      '2026-10-01T12:00:00.000Z',
      'SERVICE',
      'financial-core-postgres-test',
      'finite-effective-at-probe',
      'ledger-dev-policy-v1',
      'synthetic-provider-position-v1',
      'synthetic-test',
      'finite-effective-at-probe',
      repeat('b', 64),
      '2026-10-01T12:00:00.000Z'
    );
  "

assert_infinite_timestamp_rejected \
  "ledger_journals_accepted_at_finite" \
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
      'a4000000-0000-4000-8000-000000000004',
      'SYNTHETIC_PROVIDER_POSITION',
      'solidchange-dev',
      'finite-accepted-at-probe',
      repeat('c', 64),
      'a5000000-0000-4000-8000-000000000005',
      NULL,
      '2026-10-01T12:05:00.000Z',
      '-infinity',
      'SERVICE',
      'financial-core-postgres-test',
      'finite-accepted-at-probe',
      'ledger-dev-policy-v1',
      'synthetic-provider-position-v1',
      'synthetic-test',
      'finite-accepted-at-probe',
      repeat('d', 64),
      '2026-10-01T12:05:00.000Z'
    );
  "

assert_infinite_timestamp_rejected \
  "ledger_journals_created_at_finite" \
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
      'a6000000-0000-4000-8000-000000000006',
      'SYNTHETIC_PROVIDER_POSITION',
      'solidchange-dev',
      'finite-created-at-probe',
      repeat('e', 64),
      'a7000000-0000-4000-8000-000000000007',
      NULL,
      '2026-10-01T12:10:00.000Z',
      '2026-10-01T12:10:01.000Z',
      'SERVICE',
      'financial-core-postgres-test',
      'finite-created-at-probe',
      'ledger-dev-policy-v1',
      'synthetic-provider-position-v1',
      'synthetic-test',
      'finite-created-at-probe',
      repeat('f', 64),
      'infinity'
    );
  "

assert_infinite_timestamp_rejected \
  "ledger_entries_created_at_finite" \
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
      'a8000000-0000-4000-8000-000000000008',
      'SYNTHETIC_PROVIDER_POSITION',
      'solidchange-dev',
      'finite-entry-created-at-probe',
      repeat('1', 64),
      'a9000000-0000-4000-8000-000000000009',
      NULL,
      '2026-10-01T12:15:00.000Z',
      '2026-10-01T12:15:01.000Z',
      'SERVICE',
      'financial-core-postgres-test',
      'finite-entry-created-at-probe',
      'ledger-dev-policy-v1',
      'synthetic-provider-position-v1',
      'synthetic-test',
      'finite-entry-created-at-probe',
      repeat('2', 64),
      '2026-10-01T12:15:01.000Z'
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
      'aa000000-0000-4000-8000-00000000000a',
      'a8000000-0000-4000-8000-000000000008',
      1,
      '10000000-0000-4000-8000-000000000001',
      'solidchange-dev',
      'TUSDT',
      'DEBIT',
      1,
      '-infinity'
    );
    COMMIT;
  "

assert_infinite_timestamp_rejected \
  "ledger_idempotency_first_seen_at_finite" \
  "
    BEGIN;
    ALTER TABLE financial_core.ledger_idempotency_registry
      DISABLE TRIGGER ledger_idempotency_validate_acceptance_timestamp;
    INSERT INTO financial_core.ledger_idempotency_registry (
      legal_entity_id,
      idempotency_key,
      command_digest,
      journal_id,
      first_seen_at
    ) VALUES (
      'solidchange-dev',
      'finite-idempotency-probe',
      repeat('3', 64),
      '70000000-0000-4000-8000-000000000007',
      'infinity'
    );
    COMMIT;
  "

assert_infinite_timestamp_rejected \
  "ledger_outbox_created_at_finite" \
  "
    BEGIN;
    ALTER TABLE financial_core.ledger_outbox_events
      DISABLE TRIGGER ledger_outbox_validate_acceptance_timestamp;
    INSERT INTO financial_core.ledger_outbox_events (
      outbox_id,
      journal_id,
      event_type,
      payload,
      created_at
    ) VALUES (
      'ab000000-0000-4000-8000-00000000000b',
      '70000000-0000-4000-8000-000000000007',
      'internal.ledger.journal-accepted.v1',
      jsonb_build_object(
        'journal_id',
        '70000000-0000-4000-8000-000000000007',
        'command_digest',
        repeat('3', 64)
      ),
      '-infinity'
    );
    COMMIT;
  "

assert_infinite_timestamp_rejected \
  "ledger_delivery_attempts_attempted_at_finite" \
  "
    INSERT INTO financial_core.ledger_outbox_delivery_attempts (
      delivery_id,
      outbox_id,
      attempted_at,
      outcome,
      response_digest,
      error_code
    ) VALUES (
      'ac000000-0000-4000-8000-00000000000c',
      'b0000000-0000-4000-8000-00000000000b',
      'infinity',
      'FAILED',
      NULL,
      'FINITE_TIMESTAMP_PROBE'
    );
  "

assert_infinite_timestamp_rejected \
  "ledger_journal_seals_sealed_at_finite" \
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
      'ad000000-0000-4000-8000-00000000000d',
      'SYNTHETIC_PROVIDER_POSITION',
      'solidchange-dev',
      'finite-seal-probe',
      repeat('5', 64),
      'ae000000-0000-4000-8000-00000000000e',
      NULL,
      '2026-10-01T12:20:00.000Z',
      '2026-10-01T12:20:01.000Z',
      'SERVICE',
      'financial-core-postgres-test',
      'finite-seal-probe',
      'ledger-dev-policy-v1',
      'synthetic-provider-position-v1',
      'synthetic-test',
      'finite-seal-probe',
      repeat('6', 64),
      '2026-10-01T12:20:01.000Z'
    );
    INSERT INTO financial_core.ledger_journal_seals (
      journal_id,
      command_digest,
      entry_count,
      sealed_at
    ) VALUES (
      'ad000000-0000-4000-8000-00000000000d',
      repeat('5', 64),
      2,
      '-infinity'
    );
    COMMIT;
  "

printf 'postgres-finite-timestamps-ok\n'
