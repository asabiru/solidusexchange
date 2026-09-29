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
  '15000000-0000-4000-8000-000000000015',
  'SYNTHETIC_PROVIDER_POSITION',
  'solidchange-dev',
  'postgres-precision-demo-001',
  repeat('3', 64),
  '16000000-0000-4000-8000-000000000016',
  NULL,
  '2026-09-25T10:40:00.000Z',
  '2026-09-25T10:40:01.000Z',
  'SERVICE',
  'financial-core-postgres-test',
  'policy-decision-demo-005',
  'ledger-dev-policy-v1',
  'synthetic-provider-position-v1',
  'synthetic-test',
  'postgres-precision-source-001',
  repeat('4', 64),
  '2026-09-25T10:40:01.000Z'
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
    '17000000-0000-4000-8000-000000000017',
    '15000000-0000-4000-8000-000000000015',
    1,
    '10000000-0000-4000-8000-000000000001',
    'solidchange-dev',
    'TUSDT',
    'DEBIT',
    (repeat('9', 76) || '.00')::NUMERIC,
    '2026-09-25T10:40:01.000Z'
  ),
  (
    '18000000-0000-4000-8000-000000000018',
    '15000000-0000-4000-8000-000000000015',
    2,
    '20000000-0000-4000-8000-000000000002',
    'solidchange-dev',
    'TUSDT',
    'CREDIT',
    (repeat('9', 76) || '.00')::NUMERIC,
    '2026-09-25T10:40:01.000Z'
  );

INSERT INTO financial_core.ledger_idempotency_registry (
  legal_entity_id,
  idempotency_key,
  command_digest,
  journal_id,
  first_seen_at
) VALUES (
  'solidchange-dev',
  'postgres-precision-demo-001',
  repeat('3', 64),
  '15000000-0000-4000-8000-000000000015',
  '2026-09-25T10:40:01.000Z'
);

INSERT INTO financial_core.ledger_outbox_events (
  outbox_id,
  journal_id,
  event_type,
  payload,
  created_at
) VALUES (
  '19000000-0000-4000-8000-000000000019',
  '15000000-0000-4000-8000-000000000015',
  'internal.ledger.journal-accepted.v1',
  jsonb_build_object(
    'journal_id',
    '15000000-0000-4000-8000-000000000015',
    'command_digest',
    repeat('3', 64)
  ),
  '2026-09-25T10:40:01.000Z'
);

INSERT INTO financial_core.ledger_journal_seals (
  journal_id,
  command_digest,
  entry_count,
  sealed_at
) VALUES (
  '15000000-0000-4000-8000-000000000015',
  repeat('3', 64),
  2,
  '2026-09-25T10:40:01.000Z'
);

COMMIT;
