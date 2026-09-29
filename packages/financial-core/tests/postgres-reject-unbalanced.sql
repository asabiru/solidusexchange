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
  'c0000000-0000-4000-8000-00000000000c',
  'SYNTHETIC_UNBALANCED_POSITION',
  'solidchange-dev',
  'postgres-unbalanced-demo-001',
  repeat('c', 64),
  'd0000000-0000-4000-8000-00000000000d',
  NULL,
  '2026-09-25T10:20:00.000Z',
  '2026-09-25T10:20:01.000Z',
  'SERVICE',
  'financial-core-postgres-test',
  'policy-decision-demo-002',
  'ledger-dev-policy-v1',
  'synthetic-unbalanced-v1',
  'synthetic-test',
  'postgres-unbalanced-source-001',
  repeat('d', 64),
  '2026-09-25T10:20:01.000Z'
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
    'e0000000-0000-4000-8000-00000000000e',
    'c0000000-0000-4000-8000-00000000000c',
    1,
    '10000000-0000-4000-8000-000000000001',
    'solidchange-dev',
    'TUSD',
    'DEBIT',
    10.00,
    '2026-09-25T10:20:01.000Z'
  ),
  (
    'f0000000-0000-4000-8000-00000000000f',
    'c0000000-0000-4000-8000-00000000000c',
    2,
    '20000000-0000-4000-8000-000000000002',
    'solidchange-dev',
    'TUSD',
    'CREDIT',
    9.99,
    '2026-09-25T10:20:01.000Z'
  );

INSERT INTO financial_core.ledger_idempotency_registry (
  legal_entity_id,
  idempotency_key,
  command_digest,
  journal_id,
  first_seen_at
) VALUES (
  'solidchange-dev',
  'postgres-unbalanced-demo-001',
  repeat('c', 64),
  'c0000000-0000-4000-8000-00000000000c',
  '2026-09-25T10:20:01.000Z'
);

INSERT INTO financial_core.ledger_outbox_events (
  outbox_id,
  journal_id,
  event_type,
  payload,
  created_at
) VALUES (
  '01000000-0000-4000-8000-000000000010',
  'c0000000-0000-4000-8000-00000000000c',
  'internal.ledger.journal-accepted.v1',
  jsonb_build_object(
    'journal_id',
    'c0000000-0000-4000-8000-00000000000c',
    'command_digest',
    repeat('c', 64)
  ),
  '2026-09-25T10:20:01.000Z'
);

SET CONSTRAINTS ALL IMMEDIATE;

COMMIT;
