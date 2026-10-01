\set ON_ERROR_STOP on

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
  'ac000000-0000-4000-8000-0000000000a1',
  'SYNTHETIC_PROVIDER_POSITION',
  'solidchange-dev',
  'backup-consistency-demo-001',
  'acacacacacacacacacacacacacacacacacacacacacacacacacacacacacacacac',
  'ac000000-0000-4000-8000-0000000000a2',
  NULL,
  '2026-09-25T14:00:00.000Z',
  '2026-09-25T14:00:01.000Z',
  'SERVICE',
  'financial-core-backup-test',
  'policy-decision-backup-001',
  'ledger-dev-policy-v1',
  'synthetic-provider-position-v1',
  'synthetic-test',
  'backup-consistency-source-001',
  'acacacacacacacacacacacacacacacacacacacacacacacacacacacacacacacac',
  '2026-09-25T14:00:01.000Z'
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
    'ac000000-0000-4000-8000-0000000000a3',
    'ac000000-0000-4000-8000-0000000000a1',
    1,
    '10000000-0000-4000-8000-000000000001',
    'solidchange-dev',
    'TUSDT',
    'DEBIT',
    7.000000,
    '2026-09-25T14:00:01.000Z'
  ),
  (
    'ac000000-0000-4000-8000-0000000000a4',
    'ac000000-0000-4000-8000-0000000000a1',
    2,
    '20000000-0000-4000-8000-000000000002',
    'solidchange-dev',
    'TUSDT',
    'CREDIT',
    7.000000,
    '2026-09-25T14:00:01.000Z'
  );

INSERT INTO financial_core.ledger_idempotency_registry (
  legal_entity_id,
  idempotency_key,
  command_digest,
  journal_id,
  first_seen_at
) VALUES (
  'solidchange-dev',
  'backup-consistency-demo-001',
  'acacacacacacacacacacacacacacacacacacacacacacacacacacacacacacacac',
  'ac000000-0000-4000-8000-0000000000a1',
  '2026-09-25T14:00:01.000Z'
);

INSERT INTO financial_core.ledger_outbox_events (
  outbox_id,
  journal_id,
  event_type,
  payload,
  created_at
) VALUES (
  'ac000000-0000-4000-8000-0000000000a5',
  'ac000000-0000-4000-8000-0000000000a1',
  'internal.ledger.journal-accepted.v1',
  jsonb_build_object(
    'journal_id', 'ac000000-0000-4000-8000-0000000000a1',
    'command_digest', 'acacacacacacacacacacacacacacacacacacacacacacacacacacacacacacacac'
  ),
  '2026-09-25T14:00:01.000Z'
);

INSERT INTO financial_core.ledger_journal_seals (
  journal_id,
  command_digest,
  entry_count,
  sealed_at
) VALUES (
  'ac000000-0000-4000-8000-0000000000a1',
  'acacacacacacacacacacacacacacacacacacacacacacacacacacacacacacacac',
  2,
  '2026-09-25T14:00:01.000Z'
);

SELECT pg_advisory_lock(390039);
SELECT pg_sleep(10);

COMMIT;
