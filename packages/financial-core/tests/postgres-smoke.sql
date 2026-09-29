\set ON_ERROR_STOP on
\if :{?command_vector_json}
\else
  \echo 'command_vector_json psql variable is required'
  SELECT 1 / 0;
\endif

INSERT INTO financial_core.ledger_assets (
  asset_code,
  decimal_places,
  enabled_for_posting,
  evidence_reference,
  created_at
)
SELECT
  vector.value #>> '{asset,code}',
  (vector.value #>> '{asset,scale}')::SMALLINT,
  TRUE,
  'synthetic-asset-approval-demo',
  '2026-09-25T10:00:00.000Z'
FROM (SELECT :'command_vector_json'::JSONB AS value) AS vector;

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

WITH vector AS (
  SELECT :'command_vector_json'::JSONB AS value
)
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
    (SELECT value #>> '{asset,code}' FROM vector),
    'treasury-demo',
    '2026-09-25T10:00:00.000Z'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    1,
    'PROVIDER_PAYABLE_LIABILITY',
    'solidchange-dev',
    (SELECT value #>> '{asset,code}' FROM vector),
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
)
SELECT
  (vector.value #>> '{command,journal_id}')::UUID,
  vector.value #>> '{command,journal_type}',
  vector.value #>> '{command,legal_entity_id}',
  vector.value #>> '{command,idempotency_key}',
  vector.value #>> '{expected_digest}',
  (vector.value #>> '{command,correlation_id}')::UUID,
  NULLIF(vector.value #>> '{command,causation_id}', '')::UUID,
  (vector.value #>> '{command,effective_at}')::TIMESTAMPTZ,
  '2026-09-25T10:15:01.000Z',
  vector.value #>> '{command,actor,type}',
  vector.value #>> '{command,actor,id}',
  vector.value #>> '{command,authorization_reference}',
  vector.value #>> '{command,policy_version}',
  vector.value #>> '{command,posting_rule_version}',
  vector.value #>> '{command,source,type}',
  vector.value #>> '{command,source,reference}',
  vector.value #>> '{command,source,evidence_digest}',
  '2026-09-25T10:15:01.000Z'
FROM (SELECT :'command_vector_json'::JSONB AS value) AS vector;

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
)
SELECT
  (entry.value ->> 'entry_id')::UUID,
  (vector.value #>> '{command,journal_id}')::UUID,
  entry.ordinality::SMALLINT,
  (entry.value ->> 'account_id')::UUID,
  vector.value #>> '{command,legal_entity_id}',
  entry.value ->> 'asset_code',
  entry.value ->> 'side',
  (entry.value ->> 'amount')::NUMERIC,
  '2026-09-25T10:15:01.000Z'
FROM (SELECT :'command_vector_json'::JSONB AS value) AS vector
CROSS JOIN LATERAL jsonb_array_elements(
  vector.value #> '{command,entries}'
) WITH ORDINALITY AS entry(value, ordinality);

INSERT INTO financial_core.ledger_idempotency_registry (
  legal_entity_id,
  idempotency_key,
  command_digest,
  journal_id,
  first_seen_at
)
SELECT
  vector.value #>> '{command,legal_entity_id}',
  vector.value #>> '{command,idempotency_key}',
  vector.value #>> '{expected_digest}',
  (vector.value #>> '{command,journal_id}')::UUID,
  '2026-09-25T10:15:01.000Z'
FROM (SELECT :'command_vector_json'::JSONB AS value) AS vector;

INSERT INTO financial_core.ledger_outbox_events (
  outbox_id,
  journal_id,
  event_type,
  payload,
  created_at
)
SELECT
  'b0000000-0000-4000-8000-00000000000b',
  (vector.value #>> '{command,journal_id}')::UUID,
  'internal.ledger.journal-accepted.v1',
  jsonb_build_object(
    'journal_id',
    vector.value #>> '{command,journal_id}',
    'command_digest',
    vector.value #>> '{expected_digest}'
  ),
  '2026-09-25T10:15:01.000Z'
FROM (SELECT :'command_vector_json'::JSONB AS value) AS vector;

INSERT INTO financial_core.ledger_journal_seals (
  journal_id,
  command_digest,
  entry_count,
  sealed_at
)
SELECT
  (vector.value #>> '{command,journal_id}')::UUID,
  vector.value #>> '{expected_digest}',
  jsonb_array_length(vector.value #> '{command,entries}')::SMALLINT,
  '2026-09-25T10:15:01.000Z'
FROM (SELECT :'command_vector_json'::JSONB AS value) AS vector;

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
     AND trial.asset_code = 'TUSDT';

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
  BEGIN
    DELETE FROM financial_core.ledger_entries
     WHERE entry_id = '90000000-0000-4000-8000-000000000009';
    RAISE EXCEPTION 'append-only deletion unexpectedly succeeded';
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
       'financial_core.ledger_trial_balance'::REGCLASS,
       'financial_core.posting_rule_registry'::REGCLASS,
       'financial_core.ledger_journal_seals'::REGCLASS
     )
       AND privilege.grantee = 0
  ) THEN
    RAISE EXCEPTION 'PUBLIC privilege exists on protected ledger relation';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM financial_core.posting_rule_registry
     WHERE journal_type = 'SYNTHETIC_PROVIDER_POSITION'
       AND posting_rule_version = 'synthetic-provider-position-v1'
       AND allowed_actor_types = ARRAY['SERVICE']
       AND production_execution_enabled = FALSE
       AND runtime_boundary = 'dev-dry-run'
  ) THEN
    RAISE EXCEPTION 'synthetic posting rule is not database-bound';
  END IF;
END;
$$;
