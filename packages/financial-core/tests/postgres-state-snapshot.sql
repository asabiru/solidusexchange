WITH relation_names (relation_name) AS (
  VALUES
    ('account_definitions'),
    ('ledger_account_projections'),
    ('ledger_accounts'),
    ('ledger_assets'),
    ('ledger_entries'),
    ('ledger_idempotency_registry'),
    ('ledger_journal_seals'),
    ('ledger_journals'),
    ('ledger_outbox_delivery_attempts'),
    ('ledger_outbox_events'),
    ('ledger_trial_balance'),
    ('posting_rule_registry'),
    ('schema_migrations')
),
state_rows (relation_name, sort_key, row_data) AS (
  SELECT
    'account_definitions',
    lpad(definition.chart_version::TEXT, 10, '0') || '|' || definition.definition_code,
    to_jsonb(definition)
  FROM financial_core.account_definitions AS definition
  UNION ALL
  SELECT
    'ledger_account_projections',
    projection.account_id::TEXT,
    to_jsonb(projection)
  FROM financial_core.ledger_account_projections AS projection
  UNION ALL
  SELECT
    'ledger_accounts',
    account.account_id::TEXT,
    to_jsonb(account)
  FROM financial_core.ledger_accounts AS account
  UNION ALL
  SELECT
    'ledger_assets',
    asset.asset_code,
    to_jsonb(asset)
  FROM financial_core.ledger_assets AS asset
  UNION ALL
  SELECT
    'ledger_entries',
    entry.entry_id::TEXT,
    to_jsonb(entry)
  FROM financial_core.ledger_entries AS entry
  UNION ALL
  SELECT
    'ledger_idempotency_registry',
    registry.legal_entity_id || '|' || registry.idempotency_key,
    to_jsonb(registry)
  FROM financial_core.ledger_idempotency_registry AS registry
  UNION ALL
  SELECT
    'ledger_journal_seals',
    seal.journal_id::TEXT,
    to_jsonb(seal)
  FROM financial_core.ledger_journal_seals AS seal
  UNION ALL
  SELECT
    'ledger_journals',
    journal.journal_id::TEXT,
    to_jsonb(journal)
  FROM financial_core.ledger_journals AS journal
  UNION ALL
  SELECT
    'ledger_outbox_delivery_attempts',
    attempt.delivery_id::TEXT,
    to_jsonb(attempt)
  FROM financial_core.ledger_outbox_delivery_attempts AS attempt
  UNION ALL
  SELECT
    'ledger_outbox_events',
    event.outbox_id::TEXT,
    to_jsonb(event)
  FROM financial_core.ledger_outbox_events AS event
  UNION ALL
  SELECT
    'ledger_trial_balance',
    trial_balance.legal_entity_id || '|' || trial_balance.asset_code,
    to_jsonb(trial_balance)
  FROM financial_core.ledger_trial_balance AS trial_balance
  UNION ALL
  SELECT
    'posting_rule_registry',
    rule.journal_type || '|' || rule.posting_rule_version,
    to_jsonb(rule)
  FROM financial_core.posting_rule_registry AS rule
  UNION ALL
  SELECT
    'schema_migrations',
    lpad(migration.version::TEXT, 10, '0'),
    to_jsonb(migration)
  FROM financial_core.schema_migrations AS migration
),
relation_rows AS (
  SELECT
    relation_name,
    jsonb_agg(row_data ORDER BY sort_key COLLATE "C") AS rows
  FROM state_rows
  GROUP BY relation_name
)
SELECT jsonb_build_object(
  'format',
  'financial-core-state-v1',
  'relations',
  jsonb_object_agg(
    names.relation_name,
    COALESCE(rows.rows, '[]'::JSONB)
    ORDER BY names.relation_name
  )
)::TEXT
FROM relation_names AS names
LEFT JOIN relation_rows AS rows USING (relation_name);
