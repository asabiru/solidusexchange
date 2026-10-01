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

assert_rejected() {
  local expected="$1"
  local replication_mode="$2"
  local journal_id="$3"
  local idempotency_key="$4"
  local artifact_statement="$5"
  local output
  local status

  set +e
  output="$(
    run_psql \
      -v ON_ERROR_STOP=1 \
      -c "SET session_replication_role = ${replication_mode};" \
      -c "
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
          '${journal_id}',
          'SYNTHETIC_PROVIDER_POSITION',
          'solidchange-dev',
          '${idempotency_key}',
          '7777777777777777777777777777777777777777777777777777777777777777',
          '78000000-0000-4000-8000-000000000078',
          NULL,
          '2026-09-25T14:00:00.000Z',
          '2026-09-25T14:00:01.000Z',
          'SERVICE',
          'financial-core-postgres-test',
          'policy-decision-demo-012',
          'ledger-dev-policy-v1',
          'synthetic-provider-position-v1',
          'synthetic-test',
          '${idempotency_key}',
          '8888888888888888888888888888888888888888888888888888888888888888',
          '2026-09-25T14:00:01.000Z'
        );
        ${artifact_statement}
        COMMIT;
      " \
      2>&1
  )"
  status=$?
  set -e

  printf '%s\n' "$output"
  if [[ "$status" -eq 0 ]]; then
    echo "Mismatched acceptance artifact unexpectedly committed." >&2
    exit 1
  fi
  grep -F "$expected" <<<"$output"
}

assert_timeline_rejected() {
  local expected="$1"
  local replication_mode="$2"
  local statement="$3"
  local output
  local status

  set +e
  output="$(
    run_psql \
      -v ON_ERROR_STOP=1 \
      -c "SET session_replication_role = ${replication_mode};" \
      -c "$statement" \
      2>&1
  )"
  status=$?
  set -e

  printf '%s\n' "$output"
  if [[ "$status" -eq 0 ]]; then
    echo "Mismatched acceptance timeline unexpectedly committed." >&2
    exit 1
  fi
  grep -F "$expected" <<<"$output"
}

for replication_mode in origin replica; do
  mode_suffix="${replication_mode}"

  assert_rejected \
    "ledger_idempotency_registry acceptance timestamp does not match journal" \
    "$replication_mode" \
    "71000000-0000-4000-8000-000000000071" \
    "acceptance-idempotency-${mode_suffix}-001" \
    "
      INSERT INTO financial_core.ledger_idempotency_registry (
        legal_entity_id,
        idempotency_key,
        command_digest,
        journal_id,
        first_seen_at
      ) VALUES (
        'solidchange-dev',
        'acceptance-idempotency-${mode_suffix}-001',
        '7777777777777777777777777777777777777777777777777777777777777777',
        '71000000-0000-4000-8000-000000000071',
        '2026-09-25T14:00:02.000Z'
      );
    "

  assert_rejected \
    "ledger_outbox_events acceptance timestamp does not match journal" \
    "$replication_mode" \
    "72000000-0000-4000-8000-000000000072" \
    "acceptance-outbox-${mode_suffix}-001" \
    "
      INSERT INTO financial_core.ledger_outbox_events (
        outbox_id,
        journal_id,
        event_type,
        payload,
        created_at
      ) VALUES (
        '73000000-0000-4000-8000-000000000073',
        '72000000-0000-4000-8000-000000000072',
        'internal.ledger.journal-accepted.v1',
        jsonb_build_object(
          'journal_id',
          '72000000-0000-4000-8000-000000000072',
          'command_digest',
          '7777777777777777777777777777777777777777777777777777777777777777'
        ),
        '2026-09-25T14:00:02.000Z'
      );
    "

  assert_timeline_rejected \
    "creation timestamp does not match acceptance timestamp" \
    "$replication_mode" \
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
        '74000000-0000-4000-8000-000000000074',
        'SYNTHETIC_PROVIDER_POSITION',
        'solidchange-dev',
        'acceptance-journal-${mode_suffix}-001',
        '9999999999999999999999999999999999999999999999999999999999999999',
        '75000000-0000-4000-8000-000000000075',
        NULL,
        '2026-09-25T14:30:00.000Z',
        '2026-09-25T14:30:01.000Z',
        'SERVICE',
        'financial-core-postgres-test',
        'policy-decision-demo-013',
        'ledger-dev-policy-v1',
        'synthetic-provider-position-v1',
        'synthetic-test',
        'acceptance-journal-${mode_suffix}-001',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '2026-09-25T14:30:02.000Z'
      );
      COMMIT;
    "

  assert_timeline_rejected \
    "entry timestamp does not match acceptance timestamp" \
    "$replication_mode" \
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
        '76000000-0000-4000-8000-000000000076',
        'SYNTHETIC_PROVIDER_POSITION',
        'solidchange-dev',
        'acceptance-entry-${mode_suffix}-001',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        '77000000-0000-4000-8000-000000000077',
        NULL,
        '2026-09-25T14:35:00.000Z',
        '2026-09-25T14:35:01.000Z',
        'SERVICE',
        'financial-core-postgres-test',
        'policy-decision-demo-014',
        'ledger-dev-policy-v1',
        'synthetic-provider-position-v1',
        'synthetic-test',
        'acceptance-entry-${mode_suffix}-001',
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        '2026-09-25T14:35:01.000Z'
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
        '78000000-0000-4000-8000-000000000078',
        '76000000-0000-4000-8000-000000000076',
        1,
        '10000000-0000-4000-8000-000000000001',
        'solidchange-dev',
        'TUSDT',
        'DEBIT',
        1.000000,
        '2026-09-25T14:35:02.000Z'
      );
      COMMIT;
    "
done

echo "postgres-acceptance-artifact-integrity-ok"
