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
  '24000000-0000-4000-8000-000000000024',
  'SYNTHETIC_PROVIDER_POSITION',
  'solidchange-dev',
  'postgres-nonfinite-demo-001',
  repeat('7', 64),
  '25000000-0000-4000-8000-000000000025',
  NULL,
  '2026-09-25T10:50:00.000Z',
  '2026-09-25T10:50:01.000Z',
  'SERVICE',
  'financial-core-postgres-test',
  'policy-decision-demo-007',
  'ledger-dev-policy-v1',
  'synthetic-provider-position-v1',
  'synthetic-test',
  'postgres-nonfinite-source-001',
  repeat('8', 64),
  '2026-09-25T10:50:01.000Z'
);

DO $$
DECLARE
  nonfinite_amount TEXT;
BEGIN
  FOREACH nonfinite_amount IN ARRAY ARRAY['Infinity', '-Infinity']
  LOOP
    BEGIN
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
        '26000000-0000-4000-8000-000000000026',
        '24000000-0000-4000-8000-000000000024',
        1,
        '10000000-0000-4000-8000-000000000001',
        'solidchange-dev',
        'TUSDT',
        'DEBIT',
        nonfinite_amount::NUMERIC,
        '2026-09-25T10:50:01.000Z'
      );
      RAISE EXCEPTION 'non-finite amount % unexpectedly accepted', nonfinite_amount;
    EXCEPTION
      WHEN SQLSTATE '22003' THEN
        IF SQLERRM <> 'amount must be finite' THEN
          RAISE;
        END IF;
    END;
  END LOOP;
END;
$$;

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
  '26000000-0000-4000-8000-000000000026',
  '24000000-0000-4000-8000-000000000024',
  1,
  '10000000-0000-4000-8000-000000000001',
  'solidchange-dev',
  'TUSDT',
  'DEBIT',
  'NaN'::NUMERIC,
  '2026-09-25T10:50:01.000Z'
);

COMMIT;
