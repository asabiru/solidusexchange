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
  SELECT 'journal_uuid_shape', journal.journal_id::TEXT
    FROM financial_core.ledger_journals AS journal
   WHERE journal.journal_id::TEXT !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR journal.correlation_id::TEXT !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR (
        journal.causation_id IS NOT NULL
        AND journal.causation_id::TEXT !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )

  UNION ALL
  SELECT 'entry_uuid_shape', entry.entry_id::TEXT
    FROM financial_core.ledger_entries AS entry
   WHERE entry.entry_id::TEXT !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR entry.journal_id::TEXT !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR entry.account_id::TEXT !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'

  UNION ALL
  SELECT 'account_uuid_shape', account.account_id::TEXT
    FROM financial_core.ledger_accounts AS account
   WHERE account.account_id::TEXT !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'

  UNION ALL
  SELECT 'artifact_uuid_shape', bad_artifacts.subject
    FROM (
      SELECT 'idempotency/' || registry.journal_id::TEXT AS subject
        FROM financial_core.ledger_idempotency_registry AS registry
       WHERE registry.journal_id::TEXT !~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      UNION ALL
      SELECT 'outbox/' || outbox.outbox_id::TEXT
        FROM financial_core.ledger_outbox_events AS outbox
       WHERE outbox.outbox_id::TEXT !~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          OR outbox.journal_id::TEXT !~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      UNION ALL
      SELECT 'seal/' || seal.journal_id::TEXT
        FROM financial_core.ledger_journal_seals AS seal
       WHERE seal.journal_id::TEXT !~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      UNION ALL
      SELECT 'delivery/' || delivery.delivery_id::TEXT
        FROM financial_core.ledger_outbox_delivery_attempts AS delivery
       WHERE delivery.delivery_id::TEXT !~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          OR delivery.outbox_id::TEXT !~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ) AS bad_artifacts

  UNION ALL
  SELECT 'journal_timestamp_range', journal.journal_id::TEXT
    FROM financial_core.ledger_journals AS journal
   WHERE NOT (
       journal.effective_at BETWEEN '0001-01-01 00:00:00+14:00'::TIMESTAMPTZ
         AND '9999-12-31 23:59:59.999999-14:00'::TIMESTAMPTZ
     )
      OR NOT (
       journal.accepted_at BETWEEN '0001-01-01 00:00:00+14:00'::TIMESTAMPTZ
         AND '9999-12-31 23:59:59.999999-14:00'::TIMESTAMPTZ
     )
      OR NOT (
       journal.created_at BETWEEN '0001-01-01 00:00:00+14:00'::TIMESTAMPTZ
         AND '9999-12-31 23:59:59.999999-14:00'::TIMESTAMPTZ
     )

  UNION ALL
  SELECT 'artifact_timestamp_range', bad_artifact_times.subject
    FROM (
      SELECT 'entry/' || entry.entry_id::TEXT AS subject
        FROM financial_core.ledger_entries AS entry
       WHERE NOT (
         entry.created_at BETWEEN '0001-01-01 00:00:00+14:00'::TIMESTAMPTZ
           AND '9999-12-31 23:59:59.999999-14:00'::TIMESTAMPTZ
       )
      UNION ALL
      SELECT 'idempotency/' || registry.journal_id::TEXT
        FROM financial_core.ledger_idempotency_registry AS registry
       WHERE NOT (
         registry.first_seen_at BETWEEN '0001-01-01 00:00:00+14:00'::TIMESTAMPTZ
           AND '9999-12-31 23:59:59.999999-14:00'::TIMESTAMPTZ
       )
      UNION ALL
      SELECT 'outbox/' || outbox.outbox_id::TEXT
        FROM financial_core.ledger_outbox_events AS outbox
       WHERE NOT (
         outbox.created_at BETWEEN '0001-01-01 00:00:00+14:00'::TIMESTAMPTZ
           AND '9999-12-31 23:59:59.999999-14:00'::TIMESTAMPTZ
       )
      UNION ALL
      SELECT 'seal/' || seal.journal_id::TEXT
        FROM financial_core.ledger_journal_seals AS seal
       WHERE NOT (
         seal.sealed_at BETWEEN '0001-01-01 00:00:00+14:00'::TIMESTAMPTZ
           AND '9999-12-31 23:59:59.999999-14:00'::TIMESTAMPTZ
       )
      UNION ALL
      SELECT 'delivery/' || delivery.delivery_id::TEXT
        FROM financial_core.ledger_outbox_delivery_attempts AS delivery
       WHERE NOT (
         delivery.attempted_at BETWEEN '0001-01-01 00:00:00+14:00'::TIMESTAMPTZ
           AND '9999-12-31 23:59:59.999999-14:00'::TIMESTAMPTZ
       )
    ) AS bad_artifact_times

  UNION ALL
  SELECT 'config_timestamp_range', bad_config_times.subject
    FROM (
      SELECT 'asset/' || asset.asset_code AS subject
        FROM financial_core.ledger_assets AS asset
       WHERE NOT (
         asset.created_at BETWEEN '0001-01-01 00:00:00+14:00'::TIMESTAMPTZ
           AND '9999-12-31 23:59:59.999999-14:00'::TIMESTAMPTZ
       )
      UNION ALL
      SELECT 'definition/' || definition.definition_code
        FROM financial_core.account_definitions AS definition
       WHERE NOT (
         definition.created_at BETWEEN '0001-01-01 00:00:00+14:00'::TIMESTAMPTZ
           AND '9999-12-31 23:59:59.999999-14:00'::TIMESTAMPTZ
       )
      UNION ALL
      SELECT 'account/' || account.account_id::TEXT
        FROM financial_core.ledger_accounts AS account
       WHERE NOT (
         account.created_at BETWEEN '0001-01-01 00:00:00+14:00'::TIMESTAMPTZ
           AND '9999-12-31 23:59:59.999999-14:00'::TIMESTAMPTZ
       )
      UNION ALL
      SELECT 'rule/' || rule.journal_type || '/' || rule.posting_rule_version
        FROM financial_core.posting_rule_registry AS rule
       WHERE NOT (
         rule.created_at BETWEEN '0001-01-01 00:00:00+14:00'::TIMESTAMPTZ
           AND '9999-12-31 23:59:59.999999-14:00'::TIMESTAMPTZ
       )
      UNION ALL
      SELECT 'migration/' || migration.version::TEXT
        FROM financial_core.schema_migrations AS migration
       WHERE NOT (
         migration.applied_at BETWEEN '0001-01-01 00:00:00+14:00'::TIMESTAMPTZ
           AND '9999-12-31 23:59:59.999999-14:00'::TIMESTAMPTZ
       )
    ) AS bad_config_times

  UNION ALL
  SELECT 'chart_version_singleton', bad_versions.subject
    FROM (
      SELECT 'definition/' || definition.definition_code AS subject
        FROM financial_core.account_definitions AS definition
       WHERE definition.chart_version <> 1
      UNION ALL
      SELECT 'account/' || account.account_id::TEXT
        FROM financial_core.ledger_accounts AS account
       WHERE account.chart_version <> 1
    ) AS bad_versions

  UNION ALL
  SELECT 'rule_registry_shape',
    rule.journal_type || '/' || rule.posting_rule_version
    FROM financial_core.posting_rule_registry AS rule
   WHERE rule.registry_version <> 1
      OR cardinality(rule.allowed_actor_types) <> (
        SELECT count(*)
          FROM (
            SELECT DISTINCT unnest(rule.allowed_actor_types) AS actor_type
          ) AS unique_actor_types
      )
      OR EXISTS (
        SELECT 1
          FROM jsonb_array_elements(rule.entry_pattern) AS leg(value)
         WHERE jsonb_typeof(leg.value) <> 'object'
            OR leg.value - '{definition_code,side}'::TEXT[] <> '{}'::JSONB
            OR leg.value ->> 'definition_code' !~ '^[A-Z][A-Z0-9_]{2,63}$'
            OR (leg.value ->> 'side') NOT IN ('CREDIT', 'DEBIT')
            OR NOT EXISTS (
              SELECT 1
                FROM financial_core.account_definitions AS definition
               WHERE definition.definition_code = leg.value ->> 'definition_code'
            )
      )
      OR (
        SELECT count(*)
          FROM (
            SELECT DISTINCT
              leg.value ->> 'definition_code' AS definition_code,
              leg.value ->> 'side' AS side
              FROM jsonb_array_elements(rule.entry_pattern) AS leg(value)
          ) AS unique_legs
      ) <> jsonb_array_length(rule.entry_pattern)

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
