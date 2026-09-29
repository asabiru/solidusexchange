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
  '31000000-0000-4000-8000-000000000031',
  'SYNTHETIC_PROVIDER_POSITION',
  'solidchange-dev',
  'postgres-rule-actor-demo-001',
  repeat('7', 64),
  '32000000-0000-4000-8000-000000000032',
  NULL,
  '2026-09-25T10:50:00.000Z',
  '2026-09-25T10:50:01.000Z',
  'OPERATOR',
  'operator-rule-test',
  'policy-decision-demo-007',
  'ledger-dev-policy-v1',
  'synthetic-provider-position-v1',
  'synthetic-test',
  'postgres-rule-actor-source-001',
  repeat('8', 64),
  '2026-09-25T10:50:01.000Z'
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
    '33000000-0000-4000-8000-000000000033',
    '31000000-0000-4000-8000-000000000031',
    1,
    '10000000-0000-4000-8000-000000000001',
    'solidchange-dev',
    'TUSDT',
    'DEBIT',
    7.00,
    '2026-09-25T10:50:01.000Z'
  ),
  (
    '34000000-0000-4000-8000-000000000034',
    '31000000-0000-4000-8000-000000000031',
    2,
    '20000000-0000-4000-8000-000000000002',
    'solidchange-dev',
    'TUSDT',
    'CREDIT',
    7.00,
    '2026-09-25T10:50:01.000Z'
  );

INSERT INTO financial_core.ledger_idempotency_registry (
  legal_entity_id,
  idempotency_key,
  command_digest,
  journal_id,
  first_seen_at
) VALUES (
  'solidchange-dev',
  'postgres-rule-actor-demo-001',
  repeat('7', 64),
  '31000000-0000-4000-8000-000000000031',
  '2026-09-25T10:50:01.000Z'
);

INSERT INTO financial_core.ledger_outbox_events (
  outbox_id,
  journal_id,
  event_type,
  payload,
  created_at
) VALUES (
  '35000000-0000-4000-8000-000000000035',
  '31000000-0000-4000-8000-000000000031',
  'internal.ledger.journal-accepted.v1',
  jsonb_build_object(
    'journal_id',
    '31000000-0000-4000-8000-000000000031',
    'command_digest',
    repeat('7', 64)
  ),
  '2026-09-25T10:50:01.000Z'
);

INSERT INTO financial_core.ledger_journal_seals (
  journal_id,
  command_digest,
  entry_count,
  sealed_at
) VALUES (
  '31000000-0000-4000-8000-000000000031',
  repeat('7', 64),
  2,
  '2026-09-25T10:50:01.000Z'
);

SET CONSTRAINTS ALL IMMEDIATE;

COMMIT;
