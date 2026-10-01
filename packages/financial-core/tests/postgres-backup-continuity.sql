\set ON_ERROR_STOP on

BEGIN;

CREATE TEMPORARY TABLE restore_projection_baseline ON COMMIT DROP AS
SELECT
  account_id,
  journal_count,
  entry_count,
  debit_total,
  credit_total,
  normal_balance
FROM financial_core.ledger_account_projections
WHERE account_id IN (
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002'
);

CREATE TEMPORARY TABLE restore_trial_balance_baseline ON COMMIT DROP AS
SELECT
  journal_count,
  entry_count,
  debit_total,
  credit_total,
  difference
FROM financial_core.ledger_trial_balance
WHERE legal_entity_id = 'solidchange-dev'
  AND asset_code = 'TUSDT';

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
  'bc000000-0000-4000-8000-0000000000b1',
  'SYNTHETIC_PROVIDER_POSITION',
  'solidchange-dev',
  'restore-continuity-demo-001',
  'bcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbc',
  'bc000000-0000-4000-8000-0000000000b2',
  NULL,
  '2026-09-25T14:30:00.000Z',
  '2026-09-25T14:30:01.000Z',
  'SERVICE',
  'financial-core-restore-test',
  'policy-decision-restore-001',
  'ledger-dev-policy-v1',
  'synthetic-provider-position-v1',
  'synthetic-test',
  'restore-continuity-source-001',
  'bcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbc',
  '2026-09-25T14:30:01.000Z'
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
    'bc000000-0000-4000-8000-0000000000b3',
    'bc000000-0000-4000-8000-0000000000b1',
    1,
    '10000000-0000-4000-8000-000000000001',
    'solidchange-dev',
    'TUSDT',
    'DEBIT',
    11.000000,
    '2026-09-25T14:30:01.000Z'
  ),
  (
    'bc000000-0000-4000-8000-0000000000b4',
    'bc000000-0000-4000-8000-0000000000b1',
    2,
    '20000000-0000-4000-8000-000000000002',
    'solidchange-dev',
    'TUSDT',
    'CREDIT',
    11.000000,
    '2026-09-25T14:30:01.000Z'
  );

INSERT INTO financial_core.ledger_idempotency_registry (
  legal_entity_id,
  idempotency_key,
  command_digest,
  journal_id,
  first_seen_at
) VALUES (
  'solidchange-dev',
  'restore-continuity-demo-001',
  'bcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbc',
  'bc000000-0000-4000-8000-0000000000b1',
  '2026-09-25T14:30:01.000Z'
);

INSERT INTO financial_core.ledger_outbox_events (
  outbox_id,
  journal_id,
  event_type,
  payload,
  created_at
) VALUES (
  'bc000000-0000-4000-8000-0000000000b5',
  'bc000000-0000-4000-8000-0000000000b1',
  'internal.ledger.journal-accepted.v1',
  jsonb_build_object(
    'journal_id', 'bc000000-0000-4000-8000-0000000000b1',
    'command_digest', 'bcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbc'
  ),
  '2026-09-25T14:30:01.000Z'
);

INSERT INTO financial_core.ledger_journal_seals (
  journal_id,
  command_digest,
  entry_count,
  sealed_at
) VALUES (
  'bc000000-0000-4000-8000-0000000000b1',
  'bcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbc',
  2,
  '2026-09-25T14:30:01.000Z'
);

DO $$
DECLARE
  treasury_before restore_projection_baseline%ROWTYPE;
  treasury_after financial_core.ledger_account_projections%ROWTYPE;
  provider_before restore_projection_baseline%ROWTYPE;
  provider_after financial_core.ledger_account_projections%ROWTYPE;
  trial_before restore_trial_balance_baseline%ROWTYPE;
  trial_after financial_core.ledger_trial_balance%ROWTYPE;
BEGIN
  SELECT *
  INTO STRICT treasury_before
  FROM restore_projection_baseline
  WHERE account_id = '10000000-0000-4000-8000-000000000001';

  SELECT *
  INTO STRICT treasury_after
  FROM financial_core.ledger_account_projections
  WHERE account_id = '10000000-0000-4000-8000-000000000001';

  IF
    treasury_after.journal_count <> treasury_before.journal_count + 1
    OR treasury_after.entry_count <> treasury_before.entry_count + 1
    OR treasury_after.debit_total <> treasury_before.debit_total + 11
    OR treasury_after.credit_total <> treasury_before.credit_total
    OR treasury_after.normal_balance <> treasury_before.normal_balance + 11
  THEN
    RAISE EXCEPTION 'restored treasury projection did not advance';
  END IF;

  SELECT *
  INTO STRICT provider_before
  FROM restore_projection_baseline
  WHERE account_id = '20000000-0000-4000-8000-000000000002';

  SELECT *
  INTO STRICT provider_after
  FROM financial_core.ledger_account_projections
  WHERE account_id = '20000000-0000-4000-8000-000000000002';

  IF
    provider_after.journal_count <> provider_before.journal_count + 1
    OR provider_after.entry_count <> provider_before.entry_count + 1
    OR provider_after.debit_total <> provider_before.debit_total
    OR provider_after.credit_total <> provider_before.credit_total + 11
    OR provider_after.normal_balance <> provider_before.normal_balance + 11
  THEN
    RAISE EXCEPTION 'restored provider projection did not advance';
  END IF;

  SELECT *
  INTO STRICT trial_before
  FROM restore_trial_balance_baseline;

  SELECT *
  INTO STRICT trial_after
  FROM financial_core.ledger_trial_balance
  WHERE legal_entity_id = 'solidchange-dev'
    AND asset_code = 'TUSDT';

  IF
    trial_after.journal_count <> trial_before.journal_count + 1
    OR trial_after.entry_count <> trial_before.entry_count + 2
    OR trial_after.debit_total <> trial_before.debit_total + 11
    OR trial_after.credit_total <> trial_before.credit_total + 11
    OR trial_after.difference <> trial_before.difference
    OR trial_after.balanced IS NOT TRUE
  THEN
    RAISE EXCEPTION 'restored trial balance did not remain balanced';
  END IF;
END;
$$;

COMMIT;
