-- Wave-75 audit hardening (dev-only groundwork, still no production path).
--
-- The 0002 event grammar bounded `at` by regex alone — shape, not reality.
-- PostgreSQL normalizes the ISO end-of-day spelling 'T24:00:00Z' into the
-- next day's cast instead of rejecting it, so a payload carrying that
-- timestamp landed cleanly while the replay fold's canonical-seconds
-- parser (src/deterministic.mjs fromIsoSeconds) refuses it — one stored
-- row that permanently poisons a namespace (load() returns it, replay
-- rejects it, the journal can never restore). This migration re-creates
-- valid_journal_event with a canonical round-trip check: the payload text
-- must survive unchanged through timestamptz, so any spelling the cast
-- normalizes away is rejected at insert. Every other non-real date the
-- regex admits (month 13, April 31, minute 60) already errors on the cast
-- and fails loudly before it can land.

BEGIN;

CREATE OR REPLACE FUNCTION matching_core.valid_journal_event(p_event jsonb)
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

  -- ...and a real canonical second: the text must survive the round trip
  -- through timestamptz unchanged. 'T24:00:00Z' is the live hole —
  -- PostgreSQL accepts it and rewrites it to the next day — while every
  -- other non-real spelling the regex admits errors on the cast, which
  -- fails the append loudly either way.
  IF to_char(
       (p_event ->> 'at')::timestamptz AT TIME ZONE 'UTC',
       'YYYY-MM-DD"T"HH24:MI:SS"Z"'
     ) IS DISTINCT FROM (p_event ->> 'at') THEN
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

INSERT INTO matching_core.schema_migrations (version, migration_name)
VALUES (3, '0003_journal_event_timestamp');

REVOKE ALL ON FUNCTION matching_core.valid_journal_event(jsonb) FROM PUBLIC;

COMMIT;
