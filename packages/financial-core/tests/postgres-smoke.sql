\set ON_ERROR_STOP on

INSERT INTO financial_core.ledger_assets (
  asset_code,
  decimal_places,
  enabled_for_posting,
  evidence_reference,
  created_at
) VALUES (
  'TUSD',
  2,
  TRUE,
  'synthetic-asset-approval-demo',
  '2026-09-25T10:00:00.000Z'
);

INSERT INTO financial_core.account_definitions (
  chart_version,
  definition_code,
  category,
  account_class,
  normal_side,
  owner_scope,
  purpose,
  created_at
) VALUES
  (
    1,
    'TREASURY_ASSET',
    'treasury',
    'ASSET',
    'DEBIT',
    'optional',
    'Synthetic treasury asset for migration verification.',
    '2026-09-25T10:00:00.000Z'
  ),
  (
    1,
    'PROVIDER_PAYABLE_LIABILITY',
    'provider',
    'LIABILITY',
    'CREDIT',
    'required',
    'Synthetic provider payable for migration verification.',
    '2026-09-25T10:00:00.000Z'
  );

INSERT INTO financial_core.ledger_accounts (
  account_id,
  chart_version,
  definition_code,
  legal_entity_id,
  asset_code,
  owner_reference,
  created_at
) VALUES
  (
    '10000000-0000-4000-8000-000000000001',
    1,
    'TREASURY_ASSET',
    'solidchange-dev',
    'TUSD',
    'treasury-demo',
    '2026-09-25T10:00:00.000Z'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    1,
    'PROVIDER_PAYABLE_LIABILITY',
    'solidchange-dev',
    'TUSD',
    'provider-demo',
    '2026-09-25T10:00:00.000Z'
  );

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
  '70000000-0000-4000-8000-000000000007',
  'SYNTHETIC_PROVIDER_POSITION',
  'solidchange-dev',
  'postgres-smoke-demo-001',
  repeat('a', 64),
  '80000000-0000-4000-8000-000000000008',
  NULL,
  '2026-09-25T10:15:00.000Z',
  '2026-09-25T10:15:01.000Z',
  'SERVICE',
  'financial-core-postgres-test',
  'policy-decision-demo-001',
  'ledger-dev-policy-v1',
  'synthetic-provider-position-v1',
  'synthetic-test',
  'postgres-smoke-source-001',
  repeat('b', 64),
  '2026-09-25T10:15:01.000Z'
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
    '90000000-0000-4000-8000-000000000009',
    '70000000-0000-4000-8000-000000000007',
    1,
    '10000000-0000-4000-8000-000000000001',
    'solidchange-dev',
    'TUSD',
    'DEBIT',
    25.50,
    '2026-09-25T10:15:01.000Z'
  ),
  (
    'a0000000-0000-4000-8000-00000000000a',
    '70000000-0000-4000-8000-000000000007',
    2,
    '20000000-0000-4000-8000-000000000002',
    'solidchange-dev',
    'TUSD',
    'CREDIT',
    25.50,
    '2026-09-25T10:15:01.000Z'
  );

INSERT INTO financial_core.ledger_idempotency_registry (
  legal_entity_id,
  idempotency_key,
  command_digest,
  journal_id,
  first_seen_at
) VALUES (
  'solidchange-dev',
  'postgres-smoke-demo-001',
  repeat('a', 64),
  '70000000-0000-4000-8000-000000000007',
  '2026-09-25T10:15:01.000Z'
);

INSERT INTO financial_core.ledger_outbox_events (
  outbox_id,
  journal_id,
  event_type,
  payload,
  created_at
) VALUES (
  'b0000000-0000-4000-8000-00000000000b',
  '70000000-0000-4000-8000-000000000007',
  'internal.ledger.journal-accepted.v1',
  jsonb_build_object(
    'journal_id',
    '70000000-0000-4000-8000-000000000007',
    'command_digest',
    repeat('a', 64)
  ),
  '2026-09-25T10:15:01.000Z'
);

COMMIT;

DO $$
DECLARE
  debit_total NUMERIC;
  credit_total NUMERIC;
  difference NUMERIC;
  is_balanced BOOLEAN;
BEGIN
  SELECT
    sum(amount) FILTER (WHERE side = 'DEBIT'),
    sum(amount) FILTER (WHERE side = 'CREDIT')
    INTO debit_total, credit_total
    FROM financial_core.ledger_entries
   WHERE journal_id = '70000000-0000-4000-8000-000000000007';

  IF debit_total <> 25.50 OR credit_total <> 25.50 THEN
    RAISE EXCEPTION 'unexpected accepted journal totals';
  END IF;

  SELECT
    trial.debit_total,
    trial.credit_total,
    trial.difference,
    trial.balanced
    INTO debit_total, credit_total, difference, is_balanced
    FROM financial_core.ledger_trial_balance AS trial
   WHERE trial.legal_entity_id = 'solidchange-dev'
     AND trial.asset_code = 'TUSD';

  IF
    debit_total <> 25.50
    OR credit_total <> 25.50
    OR difference <> 0
    OR is_balanced IS NOT TRUE
  THEN
    RAISE EXCEPTION 'unexpected trial balance';
  END IF;

  SELECT
    projection.debit_total,
    projection.credit_total,
    projection.normal_balance
    INTO debit_total, credit_total, difference
    FROM financial_core.ledger_account_projections AS projection
   WHERE projection.account_id = '10000000-0000-4000-8000-000000000001';

  IF debit_total <> 25.50 OR credit_total <> 0 OR difference <> 25.50 THEN
    RAISE EXCEPTION 'unexpected account projection';
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    UPDATE financial_core.ledger_entries
       SET amount = 99.00
     WHERE entry_id = '90000000-0000-4000-8000-000000000009';
    RAISE EXCEPTION 'append-only mutation unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class
     WHERE oid IN (
       'financial_core.ledger_account_projections'::REGCLASS,
       'financial_core.ledger_trial_balance'::REGCLASS
     )
       AND NOT ('security_invoker=true' = ANY(COALESCE(reloptions, ARRAY[]::TEXT[])))
  ) THEN
    RAISE EXCEPTION 'ledger verification view is not security-invoker';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_class AS relation
      CROSS JOIN LATERAL aclexplode(
        COALESCE(relation.relacl, acldefault('r', relation.relowner))
      ) AS privilege
     WHERE relation.oid IN (
       'financial_core.ledger_account_projections'::REGCLASS,
       'financial_core.ledger_trial_balance'::REGCLASS
     )
       AND privilege.grantee = 0
  ) THEN
    RAISE EXCEPTION 'PUBLIC privilege exists on ledger verification view';
  END IF;
END;
$$;
