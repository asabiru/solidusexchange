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
  '02000000-0000-4000-8000-000000000020',
  'SYNTHETIC_INCOMPLETE_POSITION',
  'solidchange-dev',
  'postgres-incomplete-demo-001',
  repeat('e', 64),
  '03000000-0000-4000-8000-000000000030',
  NULL,
  '2026-09-25T10:25:00.000Z',
  '2026-09-25T10:25:01.000Z',
  'SERVICE',
  'financial-core-postgres-test',
  'policy-decision-demo-003',
  'ledger-dev-policy-v1',
  'synthetic-incomplete-v1',
  'synthetic-test',
  'postgres-incomplete-source-001',
  repeat('f', 64),
  '2026-09-25T10:25:01.000Z'
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
  '04000000-0000-4000-8000-000000000040',
  '02000000-0000-4000-8000-000000000020',
  1,
  '10000000-0000-4000-8000-000000000001',
  'solidchange-dev',
  'TUSD',
  'DEBIT',
  5.00,
  '2026-09-25T10:25:01.000Z'
);

INSERT INTO financial_core.ledger_idempotency_registry (
  legal_entity_id,
  idempotency_key,
  command_digest,
  journal_id,
  first_seen_at
) VALUES (
  'solidchange-dev',
  'postgres-incomplete-demo-001',
  repeat('e', 64),
  '02000000-0000-4000-8000-000000000020',
  '2026-09-25T10:25:01.000Z'
);

INSERT INTO financial_core.ledger_outbox_events (
  outbox_id,
  journal_id,
  event_type,
  payload,
  created_at
) VALUES (
  '05000000-0000-4000-8000-000000000050',
  '02000000-0000-4000-8000-000000000020',
  'internal.ledger.journal-accepted.v1',
  jsonb_build_object(
    'journal_id',
    '02000000-0000-4000-8000-000000000020',
    'command_digest',
    repeat('e', 64)
  ),
  '2026-09-25T10:25:01.000Z'
);

SET CONSTRAINTS ALL IMMEDIATE;

COMMIT;
