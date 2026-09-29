BEGIN;

INSERT INTO financial_core.schema_migrations (version, migration_name)
VALUES (2, '0002_ledger_verification_views');

CREATE VIEW financial_core.ledger_account_projections
WITH (security_invoker = TRUE)
AS
SELECT
  account.account_id,
  account.legal_entity_id,
  account.asset_code,
  asset.decimal_places,
  account.chart_version,
  account.definition_code,
  definition.normal_side,
  count(DISTINCT entry.journal_id) AS journal_count,
  count(entry.entry_id) AS entry_count,
  COALESCE(sum(entry.amount) FILTER (WHERE entry.side = 'DEBIT'), 0::NUMERIC)
    AS debit_total,
  COALESCE(sum(entry.amount) FILTER (WHERE entry.side = 'CREDIT'), 0::NUMERIC)
    AS credit_total,
  CASE definition.normal_side
    WHEN 'DEBIT' THEN
      COALESCE(sum(entry.amount) FILTER (WHERE entry.side = 'DEBIT'), 0::NUMERIC)
      - COALESCE(sum(entry.amount) FILTER (WHERE entry.side = 'CREDIT'), 0::NUMERIC)
    ELSE
      COALESCE(sum(entry.amount) FILTER (WHERE entry.side = 'CREDIT'), 0::NUMERIC)
      - COALESCE(sum(entry.amount) FILTER (WHERE entry.side = 'DEBIT'), 0::NUMERIC)
  END AS normal_balance
FROM financial_core.ledger_accounts AS account
JOIN financial_core.account_definitions AS definition
  ON definition.chart_version = account.chart_version
 AND definition.definition_code = account.definition_code
JOIN financial_core.ledger_assets AS asset
  ON asset.asset_code = account.asset_code
LEFT JOIN financial_core.ledger_entries AS entry
  ON entry.account_id = account.account_id
GROUP BY
  account.account_id,
  account.legal_entity_id,
  account.asset_code,
  asset.decimal_places,
  account.chart_version,
  account.definition_code,
  definition.normal_side;

CREATE VIEW financial_core.ledger_trial_balance
WITH (security_invoker = TRUE)
AS
SELECT
  entry.legal_entity_id,
  entry.asset_code,
  asset.decimal_places,
  count(DISTINCT entry.journal_id) AS journal_count,
  count(entry.entry_id) AS entry_count,
  sum(entry.amount) FILTER (WHERE entry.side = 'DEBIT') AS debit_total,
  sum(entry.amount) FILTER (WHERE entry.side = 'CREDIT') AS credit_total,
  sum(
    CASE
      WHEN entry.side = 'DEBIT' THEN entry.amount
      ELSE -entry.amount
    END
  ) AS difference,
  sum(
    CASE
      WHEN entry.side = 'DEBIT' THEN entry.amount
      ELSE -entry.amount
    END
  ) = 0 AS balanced
FROM financial_core.ledger_entries AS entry
JOIN financial_core.ledger_assets AS asset
  ON asset.asset_code = entry.asset_code
GROUP BY
  entry.legal_entity_id,
  entry.asset_code,
  asset.decimal_places;

REVOKE ALL ON financial_core.ledger_account_projections FROM PUBLIC;
REVOKE ALL ON financial_core.ledger_trial_balance FROM PUBLIC;

COMMIT;
