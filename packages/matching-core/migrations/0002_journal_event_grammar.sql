-- Wave-71 audit hardening (dev-only groundwork, still no production path).
--
-- 0001 constrained the journal's columns but left the payload document
-- nearly free-form: rows whose payload violated the engine's event grammar
-- landed cleanly and then poisoned the namespace (load() returns them,
-- replayMatchingEngine rejects them, so the journal can never restore).
-- This migration mirrors the replay fold's per-type envelope grammar in
-- valid_journal_event(payload), bounds `at` to the JS-representable range,
-- caps payload size, and teaches append_matching_journal idempotent
-- redelivery: a retry after a lost or timed-out response dedupes
-- already-recorded identical events instead of misreading them as a seq
-- conflict.
--
-- The journal table stays unbounded by design (dev-only groundwork; no
-- TTL or archival applies) — boundedness now lives on the payload document,
-- not the stream length.

BEGIN;

-- Mirrors the per-type event grammar replayMatchingEngine folds
-- (src/replay.mjs): exact allowed key sets per type, required keys, id and
-- owner patterns, enum values, canonical decimal spelling, and the pinned
-- posting = 'none' literal. Storage knows grammar, not semantics —
-- instrument registry membership, per-instrument scale, and stream-level
-- bookkeeping remain the replay fold's job.
CREATE FUNCTION matching_core.valid_journal_event(p_event jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  v_type text;
  v_allowed text[];
  v_required text[];
  v_field text;
BEGIN
  IF p_event IS NULL OR jsonb_typeof(p_event) <> 'object' THEN
    RETURN false;
  END IF;

  -- seq: a JSON number carrying a positive safe integer.
  IF jsonb_typeof(p_event -> 'seq') IS DISTINCT FROM 'number'
     OR (p_event ->> 'seq')::numeric <> pg_catalog.trunc((p_event ->> 'seq')::numeric)
     OR (p_event ->> 'seq')::numeric < 1
     OR (p_event ->> 'seq')::numeric > 9007199254740991 THEN
    RETURN false;
  END IF;

  -- at: canonical ISO-8601 whole-second UTC text (the engine's spelling).
  IF jsonb_typeof(p_event -> 'at') IS DISTINCT FROM 'string'
     OR (p_event ->> 'at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' THEN
    RETURN false;
  END IF;

  -- posting: pinned literal — journal events are data, never postings.
  IF (p_event ->> 'posting') IS DISTINCT FROM 'none' THEN
    RETURN false;
  END IF;

  v_type := p_event ->> 'type';
  v_allowed := CASE v_type
    WHEN 'accepted' THEN ARRAY['at','instrument','order_id','order_type','owner','posting','price','quantity','seq','side','type']
    WHEN 'resting' THEN ARRAY['at','instrument','order_id','posting','price','quantity','seq','side','type']
    WHEN 'partially_filled' THEN ARRAY['at','fill_id','instrument','maker_order_id','order_id','posting','price','quantity','remaining_quantity','seq','side','taker_order_id','type']
    WHEN 'filled' THEN ARRAY['at','fill_id','instrument','maker_order_id','order_id','posting','price','quantity','remaining_quantity','seq','side','taker_order_id','type']
    WHEN 'cancelled' THEN ARRAY['at','instrument','order_id','posting','price','quantity','seq','side','type']
    WHEN 'amended' THEN ARRAY['at','instrument','order_id','posting','previous_price','previous_quantity','price','quantity','seq','side','type']
    WHEN 'rejected' THEN ARRAY['at','instrument','order_id','posting','quantity','reason','seq','side','type']
    ELSE NULL
  END;
  IF v_allowed IS NULL OR (p_event - v_allowed) <> '{}'::jsonb THEN
    RETURN false;
  END IF;
  v_required := CASE v_type
    WHEN 'accepted' THEN ARRAY['at','instrument','order_id','order_type','posting','quantity','seq','side','type']
    WHEN 'rejected' THEN ARRAY['at','instrument','order_id','posting','reason','seq','side','type']
    ELSE v_allowed
  END;
  IF NOT (p_event ?& v_required) THEN
    RETURN false;
  END IF;

  IF v_type = 'rejected' THEN
    -- Rejections echo what was rejected: order_id/instrument/side are
    -- present but may be JSON null or any string.
    IF jsonb_typeof(p_event -> 'order_id') NOT IN ('null', 'string')
       OR jsonb_typeof(p_event -> 'instrument') NOT IN ('null', 'string')
       OR jsonb_typeof(p_event -> 'side') NOT IN ('null', 'string') THEN
      RETURN false;
    END IF;
    IF jsonb_typeof(p_event -> 'reason') IS DISTINCT FROM 'string'
       OR (p_event ->> 'reason') NOT IN (
         'invalid_order', 'invalid_order_id', 'invalid_instrument',
         'unknown_instrument', 'invalid_side', 'invalid_owner',
         'invalid_type', 'invalid_price', 'non_positive_price',
         'invalid_quantity', 'non_positive_quantity', 'duplicate_order_id',
         'self_trade', 'insufficient_liquidity', 'order_not_resting',
         'no_change', 'quantity_below_filled'
       ) THEN
      RETURN false;
    END IF;
    -- Only self_trade and insufficient_liquidity rejections carry quantity.
    IF (p_event ? 'quantity') IS DISTINCT FROM
       ((p_event ->> 'reason') = 'self_trade'
        OR (p_event ->> 'reason') = 'insufficient_liquidity') THEN
      RETURN false;
    END IF;
  ELSE
    IF jsonb_typeof(p_event -> 'order_id') IS DISTINCT FROM 'string'
       OR (p_event ->> 'order_id') !~ '^ord_[0-9a-f]{24}$' THEN
      RETURN false;
    END IF;
    IF jsonb_typeof(p_event -> 'instrument') IS DISTINCT FROM 'string'
       OR char_length(p_event ->> 'instrument') = 0 THEN
      RETURN false;
    END IF;
    IF jsonb_typeof(p_event -> 'side') IS DISTINCT FROM 'string'
       OR (p_event ->> 'side') NOT IN ('buy', 'sell') THEN
      RETURN false;
    END IF;
  END IF;

  IF v_type = 'accepted' THEN
    IF jsonb_typeof(p_event -> 'order_type') IS DISTINCT FROM 'string'
       OR (p_event ->> 'order_type') NOT IN ('limit', 'market') THEN
      RETURN false;
    END IF;
    -- Limit orders carry a price; market orders must not.
    IF (p_event ? 'price') IS DISTINCT FROM ((p_event ->> 'order_type') = 'limit') THEN
      RETURN false;
    END IF;
    IF p_event ? 'owner'
       AND (jsonb_typeof(p_event -> 'owner') IS DISTINCT FROM 'string'
            OR (p_event ->> 'owner') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$') THEN
      RETURN false;
    END IF;
  END IF;

  IF v_type = 'partially_filled' OR v_type = 'filled' THEN
    IF jsonb_typeof(p_event -> 'fill_id') IS DISTINCT FROM 'string'
       OR (p_event ->> 'fill_id') !~ '^fll_[0-9a-f]{24}$'
       OR jsonb_typeof(p_event -> 'maker_order_id') IS DISTINCT FROM 'string'
       OR (p_event ->> 'maker_order_id') !~ '^ord_[0-9a-f]{24}$'
       OR jsonb_typeof(p_event -> 'taker_order_id') IS DISTINCT FROM 'string'
       OR (p_event ->> 'taker_order_id') !~ '^ord_[0-9a-f]{24}$' THEN
      RETURN false;
    END IF;
  END IF;

  -- Decimal fields: canonical non-negative decimal strings with at most
  -- 18 integer+fraction digits (the engine's canonical spelling bound;
  -- the per-instrument scale stays the replay fold's check).
  FOREACH v_field IN ARRAY ARRAY['price','quantity','remaining_quantity','previous_price','previous_quantity'] LOOP
    IF p_event ? v_field
       AND (jsonb_typeof(p_event -> v_field) IS DISTINCT FROM 'string'
            OR (p_event ->> v_field) !~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
            OR char_length(replace(p_event ->> v_field, '.', '')) > 18) THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
END;
$$;

-- `at` stays inside the range a JavaScript Date can represent (and the
-- deterministic clock emits): year-0001 events are PG-finite but not
-- JS-representable, and >9999-12-31 overflows the engine's epoch bound.
ALTER TABLE matching_core.matching_journal
  ADD CONSTRAINT matching_journal_at_js_range CHECK (
    at >= TIMESTAMPTZ '1970-01-01T00:00:00Z'
    AND at <= TIMESTAMPTZ '9999-12-31T23:59:59Z'
  );

ALTER TABLE matching_core.matching_journal
  ADD CONSTRAINT matching_journal_payload_event CHECK (
    matching_core.valid_journal_event(payload)
  );

-- Payload documents are small; a pathological echo is bounded at 64KiB of
-- canonical jsonb text (real events are well under 1KiB).
ALTER TABLE matching_core.matching_journal
  ADD CONSTRAINT matching_journal_payload_size CHECK (
    octet_length(payload::text) <= 65536
  );

COMMENT ON TABLE matching_core.matching_journal IS
  'Dev-only append-only matching-engine journal: unbounded by design '
  '(no TTL or archival applies); boundedness lives on each payload '
  'document, not on stream length.';

-- Idempotent redelivery: entries re-delivering already-recorded seqs must
-- carry the identical recorded payload — a retry after a lost response
-- dedupes instead of colliding — while a conflicting re-play still rejects
-- and a batch past the tail still must continue contiguously.
CREATE OR REPLACE FUNCTION matching_core.append_matching_journal(p_namespace text, p_events jsonb)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  base_seq bigint;
  first_seq bigint;
BEGIN
  IF p_namespace IS NULL OR p_namespace !~ '^[a-z0-9_-]{1,64}$' THEN
    RAISE EXCEPTION 'matching journal namespace must match ^[a-z0-9_-]{1,64}$'
      USING ERRCODE = '23514';
  END IF;
  IF p_events IS NULL OR jsonb_typeof(p_events) <> 'array' THEN
    RAISE EXCEPTION 'matching journal append requires a JSON array of events'
      USING ERRCODE = '23514';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(hashtext(p_namespace));

  SELECT COALESCE(MAX(journal.seq), 0)
    INTO base_seq
    FROM matching_core.matching_journal AS journal
   WHERE journal.namespace = p_namespace;

  IF jsonb_array_length(p_events) > 0 THEN
    first_seq := (p_events -> 0 ->> 'seq')::bigint;

    -- The batch is internally contiguous from its first seq.
    IF EXISTS (
      SELECT 1
        FROM jsonb_array_elements(p_events) WITH ORDINALITY AS entry(value, ordinality)
       WHERE (entry.value ->> 'seq')::bigint IS DISTINCT FROM first_seq + entry.ordinality - 1
    ) THEN
      RAISE EXCEPTION 'matching journal append must continue the recorded stream contiguously'
        USING ERRCODE = '23514';
    END IF;

    -- Past the recorded tail is always a gap.
    IF first_seq > base_seq + 1 THEN
      RAISE EXCEPTION 'matching journal append must continue seq %',
        base_seq + 1
        USING ERRCODE = '23514';
    END IF;

    -- Inside the recorded range every re-delivered event must equal what
    -- was recorded: identical redelivery dedupes, conflict rejects.
    IF first_seq <= base_seq AND EXISTS (
      SELECT 1
        FROM jsonb_array_elements(p_events) AS entry(value)
       WHERE (entry.value ->> 'seq')::bigint <= base_seq
         AND NOT EXISTS (
           SELECT 1
             FROM matching_core.matching_journal AS journal
            WHERE journal.namespace = p_namespace
              AND journal.seq = (entry.value ->> 'seq')::bigint
              AND journal.payload = entry.value
         )
    ) THEN
      RAISE EXCEPTION 'matching journal append conflicts with the recorded stream'
        USING ERRCODE = '23514';
    END IF;

    INSERT INTO matching_core.matching_journal (namespace, seq, at, type, payload)
    SELECT p_namespace,
           (entry.value ->> 'seq')::bigint,
           (entry.value ->> 'at')::timestamptz,
           entry.value ->> 'type',
           entry.value
      FROM jsonb_array_elements(p_events) AS entry(value)
     WHERE (entry.value ->> 'seq')::bigint > base_seq;

    RETURN GREATEST(base_seq, first_seq + jsonb_array_length(p_events) - 1);
  END IF;

  RETURN base_seq;
END;
$$;

INSERT INTO matching_core.schema_migrations (version, migration_name)
VALUES (2, '0002_journal_event_grammar');

REVOKE ALL ON FUNCTION matching_core.valid_journal_event(jsonb) FROM PUBLIC;

COMMIT;
