-- Re-validates every persisted journal from stored rows, independently of
-- trigger state, so owner-level trigger toggling cannot leave invalid data
-- that the catalog regressions would still accept.
WITH journal_entry_counts AS (
  SELECT
    journal.journal_id,
    count(entry.entry_id) AS entry_count
    FROM financial_core.ledger_journals AS journal
    LEFT JOIN financial_core.ledger_entries AS entry
      ON entry.journal_id = journal.journal_id
   GROUP BY journal.journal_id
),
violations AS (
  SELECT 'journal_entry_count' AS check_name, counts.journal_id::TEXT AS subject
    FROM journal_entry_counts AS counts
   WHERE counts.entry_count NOT BETWEEN 2 AND 1000

  UNION ALL
  SELECT 'journal_unbalanced_asset', entry.journal_id::TEXT || '/' || entry.asset_code
    FROM financial_core.ledger_entries AS entry
   GROUP BY entry.journal_id, entry.asset_code
  HAVING pg_catalog.sum(
    CASE WHEN entry.side = 'DEBIT' THEN entry.amount ELSE -entry.amount END
  ) IS DISTINCT FROM 0::NUMERIC

  UNION ALL
  SELECT 'entry_amount_nonfinite', entry.entry_id::TEXT
    FROM financial_core.ledger_entries AS entry
   WHERE entry.amount::TEXT IN ('NaN', 'Infinity', '-Infinity')

  UNION ALL
  SELECT 'entry_amount_not_positive', entry.entry_id::TEXT
    FROM financial_core.ledger_entries AS entry
   WHERE entry.amount::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
     AND NOT entry.amount > 0

  UNION ALL
  SELECT 'entry_amount_scale', entry.entry_id::TEXT
    FROM financial_core.ledger_entries AS entry
    LEFT JOIN financial_core.ledger_assets AS asset
      ON asset.asset_code = entry.asset_code
   WHERE entry.amount::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
     AND (
       asset.asset_code IS NULL
       OR asset.enabled_for_posting IS NOT TRUE
       OR pg_catalog.scale(entry.amount) > asset.decimal_places
       OR pg_catalog.char_length(
         pg_catalog.replace(pg_catalog.replace(entry.amount::TEXT, '.', ''), '-', '')
       ) > 78
     )

  UNION ALL
  SELECT 'entry_reference', entry.entry_id::TEXT
    FROM financial_core.ledger_entries AS entry
    LEFT JOIN financial_core.ledger_journals AS journal
      ON journal.journal_id = entry.journal_id
    LEFT JOIN financial_core.ledger_accounts AS account
      ON account.account_id = entry.account_id
     AND account.legal_entity_id = entry.legal_entity_id
     AND account.asset_code = entry.asset_code
   WHERE journal.journal_id IS NULL
      OR account.account_id IS NULL
      OR entry.legal_entity_id IS DISTINCT FROM journal.legal_entity_id

  UNION ALL
  SELECT 'journal_timestamps', journal.journal_id::TEXT
    FROM financial_core.ledger_journals AS journal
   WHERE journal.created_at IS DISTINCT FROM journal.accepted_at
      OR EXISTS (
        SELECT 1
          FROM financial_core.ledger_entries AS entry
         WHERE entry.journal_id = journal.journal_id
           AND entry.created_at IS DISTINCT FROM journal.accepted_at
      )

  UNION ALL
  SELECT 'journal_posting_rule', journal.journal_id::TEXT
    FROM financial_core.ledger_journals AS journal
    LEFT JOIN financial_core.posting_rule_registry AS rule
      ON rule.journal_type = journal.journal_type
     AND rule.posting_rule_version = journal.posting_rule_version
   WHERE rule.journal_type IS NULL
      OR NOT (journal.actor_type = ANY (rule.allowed_actor_types))

  UNION ALL
  SELECT 'journal_entry_pattern', actual.journal_id::TEXT || '/' || actual.asset_code
    FROM (
      SELECT
        entry.journal_id,
        entry.asset_code,
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'definition_code', account.definition_code,
            'side', entry.side
          )
          ORDER BY account.definition_code COLLATE "C", entry.side COLLATE "C"
        ) AS entry_pattern
        FROM financial_core.ledger_entries AS entry
        JOIN financial_core.ledger_accounts AS account
          ON account.account_id = entry.account_id
       GROUP BY entry.journal_id, entry.asset_code
    ) AS actual
    JOIN financial_core.ledger_journals AS journal
      ON journal.journal_id = actual.journal_id
    LEFT JOIN financial_core.posting_rule_registry AS rule
      ON rule.journal_type = journal.journal_type
     AND rule.posting_rule_version = journal.posting_rule_version
   WHERE actual.entry_pattern IS DISTINCT FROM (
     SELECT pg_catalog.jsonb_agg(
       rule_entry.value
       ORDER BY
         rule_entry.value ->> 'definition_code' COLLATE "C",
         rule_entry.value ->> 'side' COLLATE "C"
     )
       FROM pg_catalog.jsonb_array_elements(rule.entry_pattern) AS rule_entry(value)
   )

  UNION ALL
  SELECT 'journal_idempotency', journal.journal_id::TEXT
    FROM financial_core.ledger_journals AS journal
   WHERE NOT EXISTS (
     SELECT 1
       FROM financial_core.ledger_idempotency_registry AS registry
      WHERE registry.journal_id = journal.journal_id
        AND registry.legal_entity_id = journal.legal_entity_id
        AND registry.idempotency_key = journal.idempotency_key
        AND registry.command_digest = journal.command_digest
        AND registry.first_seen_at = journal.accepted_at
   )

  UNION ALL
  SELECT 'journal_outbox', journal.journal_id::TEXT
    FROM financial_core.ledger_journals AS journal
   WHERE NOT EXISTS (
     SELECT 1
       FROM financial_core.ledger_outbox_events AS outbox
      WHERE outbox.journal_id = journal.journal_id
        AND outbox.payload ->> 'journal_id' = journal.journal_id::TEXT
        AND outbox.payload ->> 'command_digest' = journal.command_digest
        AND outbox.created_at = journal.accepted_at
   )

  UNION ALL
  SELECT 'journal_seal', journal.journal_id::TEXT
    FROM financial_core.ledger_journals AS journal
    JOIN journal_entry_counts AS counts
      ON counts.journal_id = journal.journal_id
   WHERE NOT EXISTS (
     SELECT 1
       FROM financial_core.ledger_journal_seals AS seal
      WHERE seal.journal_id = journal.journal_id
        AND seal.command_digest = journal.command_digest
        AND seal.entry_count = counts.entry_count
        AND seal.sealed_at = journal.accepted_at
   )

  UNION ALL
  SELECT 'journal_command_digest_reused', journal.journal_id::TEXT
    FROM financial_core.ledger_journals AS journal
   WHERE EXISTS (
     SELECT 1
       FROM financial_core.ledger_journals AS other
      WHERE other.command_digest = journal.command_digest
        AND other.journal_id <> journal.journal_id
   )

  UNION ALL
  SELECT 'artifact_reference', 'idempotency/' || registry.journal_id::TEXT
    FROM financial_core.ledger_idempotency_registry AS registry
   WHERE NOT EXISTS (
     SELECT 1
       FROM financial_core.ledger_journals AS journal
      WHERE journal.journal_id = registry.journal_id
   )

  UNION ALL
  SELECT 'artifact_reference', 'outbox/' || outbox.journal_id::TEXT
    FROM financial_core.ledger_outbox_events AS outbox
   WHERE NOT EXISTS (
     SELECT 1
       FROM financial_core.ledger_journals AS journal
      WHERE journal.journal_id = outbox.journal_id
   )

  UNION ALL
  SELECT 'artifact_reference', 'seal/' || seal.journal_id::TEXT
    FROM financial_core.ledger_journal_seals AS seal
   WHERE NOT EXISTS (
     SELECT 1
       FROM financial_core.ledger_journals AS journal
      WHERE journal.journal_id = seal.journal_id
   )
)
SELECT pg_catalog.jsonb_build_object(
  'journal_count', (SELECT count(*) FROM financial_core.ledger_journals),
  'entry_count', (SELECT count(*) FROM financial_core.ledger_entries),
  'violations', COALESCE(
    (
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('check', check_name, 'subject', subject)
        ORDER BY check_name COLLATE "C", subject COLLATE "C"
      )
        FROM violations
    ),
    '[]'::JSONB
  )
)::TEXT;
