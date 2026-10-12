BEGIN;

INSERT INTO financial_core.schema_migrations (version, migration_name)
VALUES (13, '0013_ledger_representation_guard');

-- The JS ledger model accepts only RFC 4122 UUIDs with version 1-8 and the
-- 8/9/a/b variant. PostgreSQL uuid columns accept any well-formed value, so
-- identifiers the JS validators reject (nil, max, wrong variant) must be
-- pinned here to keep stored rows inside the JS-representable space.

ALTER TABLE financial_core.ledger_accounts
  ADD CONSTRAINT ledger_accounts_account_id_rfc_shape
  CHECK (
    account_id::TEXT ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );

ALTER TABLE financial_core.ledger_journals
  ADD CONSTRAINT ledger_journals_journal_id_rfc_shape
  CHECK (
    journal_id::TEXT ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  ADD CONSTRAINT ledger_journals_correlation_id_rfc_shape
  CHECK (
    correlation_id::TEXT ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  ADD CONSTRAINT ledger_journals_causation_id_rfc_shape
  CHECK (
    causation_id IS NULL
    OR causation_id::TEXT ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );

ALTER TABLE financial_core.ledger_entries
  ADD CONSTRAINT ledger_entries_entry_id_rfc_shape
  CHECK (
    entry_id::TEXT ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  ADD CONSTRAINT ledger_entries_journal_id_rfc_shape
  CHECK (
    journal_id::TEXT ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  ADD CONSTRAINT ledger_entries_account_id_rfc_shape
  CHECK (
    account_id::TEXT ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );

ALTER TABLE financial_core.ledger_idempotency_registry
  ADD CONSTRAINT ledger_idempotency_journal_id_rfc_shape
  CHECK (
    journal_id::TEXT ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );

ALTER TABLE financial_core.ledger_outbox_events
  ADD CONSTRAINT ledger_outbox_outbox_id_rfc_shape
  CHECK (
    outbox_id::TEXT ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  ADD CONSTRAINT ledger_outbox_journal_id_rfc_shape
  CHECK (
    journal_id::TEXT ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );

ALTER TABLE financial_core.ledger_outbox_delivery_attempts
  ADD CONSTRAINT ledger_delivery_delivery_id_rfc_shape
  CHECK (
    delivery_id::TEXT ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  ADD CONSTRAINT ledger_delivery_outbox_id_rfc_shape
  CHECK (
    outbox_id::TEXT ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );

ALTER TABLE financial_core.ledger_journal_seals
  ADD CONSTRAINT ledger_journal_seals_journal_id_rfc_shape
  CHECK (
    journal_id::TEXT ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );

-- The JS date-time grammar only denotes four-digit years 0001-9999 with a
-- numeric zone offset of at most 14:00. Persisted timestamps must stay inside
-- the instants such literals can express; the finite guards still reject the
-- infinite endpoints first.

ALTER TABLE financial_core.schema_migrations
  ADD CONSTRAINT schema_migrations_applied_at_range
  CHECK (
    applied_at >= '0001-01-01 00:00:00+14:00'::TIMESTAMPTZ
    AND applied_at <= '9999-12-31 23:59:59.999999-14:00'::TIMESTAMPTZ
  );

ALTER TABLE financial_core.ledger_assets
  ADD CONSTRAINT ledger_assets_created_at_range
  CHECK (
    created_at >= '0001-01-01 00:00:00+14:00'::TIMESTAMPTZ
    AND created_at <= '9999-12-31 23:59:59.999999-14:00'::TIMESTAMPTZ
  );

ALTER TABLE financial_core.account_definitions
  ADD CONSTRAINT account_definitions_created_at_range
  CHECK (
    created_at >= '0001-01-01 00:00:00+14:00'::TIMESTAMPTZ
    AND created_at <= '9999-12-31 23:59:59.999999-14:00'::TIMESTAMPTZ
  );

ALTER TABLE financial_core.ledger_accounts
  ADD CONSTRAINT ledger_accounts_created_at_range
  CHECK (
    created_at >= '0001-01-01 00:00:00+14:00'::TIMESTAMPTZ
    AND created_at <= '9999-12-31 23:59:59.999999-14:00'::TIMESTAMPTZ
  );

ALTER TABLE financial_core.ledger_journals
  ADD CONSTRAINT ledger_journals_effective_at_range
  CHECK (
    effective_at >= '0001-01-01 00:00:00+14:00'::TIMESTAMPTZ
    AND effective_at <= '9999-12-31 23:59:59.999999-14:00'::TIMESTAMPTZ
  ),
  ADD CONSTRAINT ledger_journals_accepted_at_range
  CHECK (
    accepted_at >= '0001-01-01 00:00:00+14:00'::TIMESTAMPTZ
    AND accepted_at <= '9999-12-31 23:59:59.999999-14:00'::TIMESTAMPTZ
  ),
  ADD CONSTRAINT ledger_journals_created_at_range
  CHECK (
    created_at >= '0001-01-01 00:00:00+14:00'::TIMESTAMPTZ
    AND created_at <= '9999-12-31 23:59:59.999999-14:00'::TIMESTAMPTZ
  );

ALTER TABLE financial_core.ledger_entries
  ADD CONSTRAINT ledger_entries_created_at_range
  CHECK (
    created_at >= '0001-01-01 00:00:00+14:00'::TIMESTAMPTZ
    AND created_at <= '9999-12-31 23:59:59.999999-14:00'::TIMESTAMPTZ
  );

ALTER TABLE financial_core.ledger_idempotency_registry
  ADD CONSTRAINT ledger_idempotency_first_seen_at_range
  CHECK (
    first_seen_at >= '0001-01-01 00:00:00+14:00'::TIMESTAMPTZ
    AND first_seen_at <= '9999-12-31 23:59:59.999999-14:00'::TIMESTAMPTZ
  );

ALTER TABLE financial_core.ledger_outbox_events
  ADD CONSTRAINT ledger_outbox_created_at_range
  CHECK (
    created_at >= '0001-01-01 00:00:00+14:00'::TIMESTAMPTZ
    AND created_at <= '9999-12-31 23:59:59.999999-14:00'::TIMESTAMPTZ
  );

ALTER TABLE financial_core.ledger_outbox_delivery_attempts
  ADD CONSTRAINT ledger_delivery_attempts_attempted_at_range
  CHECK (
    attempted_at >= '0001-01-01 00:00:00+14:00'::TIMESTAMPTZ
    AND attempted_at <= '9999-12-31 23:59:59.999999-14:00'::TIMESTAMPTZ
  );

ALTER TABLE financial_core.posting_rule_registry
  ADD CONSTRAINT posting_rule_registry_created_at_range
  CHECK (
    created_at >= '0001-01-01 00:00:00+14:00'::TIMESTAMPTZ
    AND created_at <= '9999-12-31 23:59:59.999999-14:00'::TIMESTAMPTZ
  );

ALTER TABLE financial_core.ledger_journal_seals
  ADD CONSTRAINT ledger_journal_seals_sealed_at_range
  CHECK (
    sealed_at >= '0001-01-01 00:00:00+14:00'::TIMESTAMPTZ
    AND sealed_at <= '9999-12-31 23:59:59.999999-14:00'::TIMESTAMPTZ
  );

-- The JS chart and posting-rule registry are fixed at version 1; rows that
-- claim any other version have no JS counterpart.

ALTER TABLE financial_core.account_definitions
  ADD CONSTRAINT account_definitions_chart_version_singleton
  CHECK (chart_version = 1);

ALTER TABLE financial_core.ledger_accounts
  ADD CONSTRAINT ledger_accounts_chart_version_singleton
  CHECK (chart_version = 1);

ALTER TABLE financial_core.posting_rule_registry
  ADD CONSTRAINT posting_rule_registry_version_singleton
  CHECK (registry_version = 1);

-- Mirror the JS posting-rule registry admission: each entry_pattern leg must
-- be exactly {definition_code, side} with a registered-code shape and a real
-- side, signatures must not repeat, and actor types must not repeat.

CREATE FUNCTION financial_core.validate_posting_rule()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = financial_core, pg_catalog
AS $$
BEGIN
  IF (
    SELECT count(*)
      FROM (
        SELECT DISTINCT actor_type
          FROM unnest(NEW.allowed_actor_types) AS actor_type
      ) AS unique_actor_types
  ) <> cardinality(NEW.allowed_actor_types) THEN
    RAISE EXCEPTION 'posting rule %/% repeats an actor type',
      NEW.journal_type,
      NEW.posting_rule_version
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(NEW.entry_pattern) AS leg(value)
     WHERE jsonb_typeof(leg.value) <> 'object'
        OR leg.value - '{definition_code,side}'::TEXT[] <> '{}'::JSONB
        OR leg.value ->> 'definition_code' !~ '^[A-Z][A-Z0-9_]{2,63}$'
        OR (leg.value ->> 'side') NOT IN ('CREDIT', 'DEBIT')
        OR NOT EXISTS (
          SELECT 1
            FROM financial_core.account_definitions AS definition
           WHERE definition.definition_code = leg.value ->> 'definition_code'
        )
  ) THEN
    RAISE EXCEPTION 'posting rule %/% has an invalid entry leg',
      NEW.journal_type,
      NEW.posting_rule_version
      USING ERRCODE = '23514';
  END IF;

  IF (
    SELECT count(*)
      FROM (
        SELECT DISTINCT
          leg.value ->> 'definition_code' AS definition_code,
          leg.value ->> 'side' AS side
          FROM jsonb_array_elements(NEW.entry_pattern) AS leg(value)
      ) AS unique_legs
  ) <> jsonb_array_length(NEW.entry_pattern) THEN
    RAISE EXCEPTION 'posting rule %/% repeats an entry leg',
      NEW.journal_type,
      NEW.posting_rule_version
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER posting_rule_registry_validate
BEFORE INSERT ON financial_core.posting_rule_registry
FOR EACH ROW
EXECUTE FUNCTION financial_core.validate_posting_rule();

ALTER TABLE financial_core.posting_rule_registry
  ENABLE ALWAYS TRIGGER posting_rule_registry_validate;

REVOKE ALL ON FUNCTION financial_core.validate_posting_rule() FROM PUBLIC;

COMMIT;
