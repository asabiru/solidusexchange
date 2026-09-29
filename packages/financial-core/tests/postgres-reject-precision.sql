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
  '21000000-0000-4000-8000-000000000021',
  'SYNTHETIC_PROVIDER_POSITION',
  'solidchange-dev',
  'postgres-precision-demo-002',
  repeat('5', 64),
  '22000000-0000-4000-8000-000000000022',
  NULL,
  '2026-09-25T10:45:00.000Z',
  '2026-09-25T10:45:01.000Z',
  'SERVICE',
  'financial-core-postgres-test',
  'policy-decision-demo-006',
  'ledger-dev-policy-v1',
  'synthetic-provider-position-v1',
  'synthetic-test',
  'postgres-precision-source-002',
  repeat('6', 64),
  '2026-09-25T10:45:01.000Z'
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
  '23000000-0000-4000-8000-000000000023',
  '21000000-0000-4000-8000-000000000021',
  1,
  '10000000-0000-4000-8000-000000000001',
  'solidchange-dev',
  'TUSD',
  'DEBIT',
  (repeat('9', 77) || '.00')::NUMERIC,
  '2026-09-25T10:45:01.000Z'
);

COMMIT;
