BEGIN;

CREATE SCHEMA custody_core;

CREATE FUNCTION custody_core.reject_outbox_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'custody projection outbox is append-only';
END;
$$;

CREATE TABLE custody_core.custody_projection_outbox (
  event_id uuid PRIMARY KEY,
  approval_event_id uuid NOT NULL UNIQUE,
  correlation_id uuid NOT NULL,
  withdrawal_id text NOT NULL UNIQUE,
  custody_intent_id text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  request_digest text NOT NULL,
  intent_digest text NOT NULL,
  policy_digest text NOT NULL,
  approval_evidence_digest text NOT NULL,
  asset text NOT NULL,
  network text NOT NULL,
  occurred_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  event_document jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT custody_projection_event_uuid_v7 CHECK (
    event_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT custody_projection_approval_uuid_v7 CHECK (
    approval_event_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT custody_projection_correlation_uuid_v7 CHECK (
    correlation_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT custody_projection_distinct_event_ids CHECK (
    event_id <> approval_event_id
  ),
  CONSTRAINT custody_projection_withdrawal_reference CHECK (
    withdrawal_id ~ '^withdrawal_[a-z0-9_]{1,116}$'
  ),
  CONSTRAINT custody_projection_intent_reference CHECK (
    custody_intent_id ~ '^custody_intent_[a-z0-9_]{1,112}$'
  ),
  CONSTRAINT custody_projection_idempotency_reference CHECK (
    idempotency_key ~ '^custody_idempotency_[a-z0-9_]{1,107}$'
  ),
  CONSTRAINT custody_projection_request_digest CHECK (
    request_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT custody_projection_intent_digest CHECK (
    intent_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT custody_projection_policy_digest CHECK (
    policy_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT custody_projection_approval_digest CHECK (
    approval_evidence_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT custody_projection_asset CHECK (
    asset ~ '^[A-Z0-9]{2,16}$'
  ),
  CONSTRAINT custody_projection_network_testnet CHECK (
    network ~ '^[A-Z0-9]+_TESTNET$'
  ),
  CONSTRAINT custody_projection_finite_timestamps CHECK (
    occurred_at > '-infinity'::timestamptz
    AND occurred_at < 'infinity'::timestamptz
    AND expires_at > '-infinity'::timestamptz
    AND expires_at < 'infinity'::timestamptz
    AND recorded_at > '-infinity'::timestamptz
    AND recorded_at < 'infinity'::timestamptz
  ),
  CONSTRAINT custody_projection_unexpired CHECK (
    expires_at > occurred_at
  ),
  CONSTRAINT custody_projection_event_shape CHECK (
    jsonb_typeof(event_document) = 'object'
    AND event_document ?& ARRAY[
      'actor',
      'aggregate_id',
      'aggregate_type',
      'causation_id',
      'correlation_id',
      'data_classification',
      'event_id',
      'event_type',
      'event_version',
      'idempotency_key',
      'occurred_at',
      'payload',
      'producer'
    ]
    AND event_document - ARRAY[
      'actor',
      'aggregate_id',
      'aggregate_type',
      'causation_id',
      'correlation_id',
      'data_classification',
      'event_id',
      'event_type',
      'event_version',
      'idempotency_key',
      'occurred_at',
      'payload',
      'producer'
    ] = '{}'::jsonb
  ),
  CONSTRAINT custody_projection_actor_shape CHECK (
    jsonb_typeof(event_document -> 'actor') = 'object'
    AND event_document -> 'actor' ?& ARRAY['subject', 'type']
    AND (event_document -> 'actor') - ARRAY['subject', 'type'] = '{}'::jsonb
    AND event_document -> 'actor' ->> 'type' = 'service'
    AND event_document -> 'actor' ->> 'subject' = 'custody_orchestrator'
  ),
  CONSTRAINT custody_projection_payload_shape CHECK (
    jsonb_typeof(event_document -> 'payload') = 'object'
    AND event_document -> 'payload' ?& ARRAY[
      'approval_evidence_digest',
      'asset',
      'custody_intent_id',
      'execution_authority',
      'expires_at',
      'intent_digest',
      'network',
      'policy_digest',
      'production_signing_enabled',
      'status',
      'withdrawal_id'
    ]
    AND (event_document -> 'payload') - ARRAY[
      'approval_evidence_digest',
      'asset',
      'custody_intent_id',
      'execution_authority',
      'expires_at',
      'intent_digest',
      'network',
      'policy_digest',
      'production_signing_enabled',
      'status',
      'withdrawal_id'
    ] = '{}'::jsonb
  ),
  CONSTRAINT custody_projection_event_constants CHECK (
    event_document ->> 'event_type' = 'CustodyIntentPrepared'
    AND (event_document ->> 'event_version')::integer = 1
    AND event_document ->> 'producer' = 'custody-orchestrator'
    AND event_document ->> 'aggregate_type' = 'withdrawal'
    AND event_document ->> 'data_classification' = 'highly-confidential'
  ),
  CONSTRAINT custody_projection_event_identity CHECK (
    (event_document ->> 'event_id')::uuid = event_id
    AND (event_document ->> 'causation_id')::uuid = approval_event_id
    AND (event_document ->> 'correlation_id')::uuid = correlation_id
    AND event_document ->> 'aggregate_id' = withdrawal_id
    AND event_document ->> 'idempotency_key' = idempotency_key
  ),
  CONSTRAINT custody_projection_event_timeline CHECK (
    event_document ->> 'occurred_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    AND (event_document ->> 'occurred_at')::timestamptz = occurred_at
    AND event_document -> 'payload' ->> 'expires_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    AND (event_document -> 'payload' ->> 'expires_at')::timestamptz = expires_at
  ),
  CONSTRAINT custody_projection_payload_identity CHECK (
    event_document -> 'payload' ->> 'withdrawal_id' = withdrawal_id
    AND event_document -> 'payload' ->> 'custody_intent_id' = custody_intent_id
    AND event_document -> 'payload' ->> 'intent_digest' = intent_digest
    AND event_document -> 'payload' ->> 'policy_digest' = policy_digest
    AND event_document -> 'payload' ->> 'approval_evidence_digest' = approval_evidence_digest
    AND event_document -> 'payload' ->> 'asset' = asset
    AND event_document -> 'payload' ->> 'network' = network
  ),
  CONSTRAINT custody_projection_unsigned_status CHECK (
    event_document -> 'payload' ->> 'status' = 'unsigned_intent_ready'
    AND event_document -> 'payload' -> 'execution_authority' = 'false'::jsonb
    AND event_document -> 'payload' -> 'production_signing_enabled' = 'false'::jsonb
  )
);

CREATE TRIGGER custody_projection_outbox_append_only
BEFORE UPDATE OR DELETE ON custody_core.custody_projection_outbox
FOR EACH ROW
EXECUTE FUNCTION custody_core.reject_outbox_mutation();

ALTER TABLE custody_core.custody_projection_outbox
  ENABLE ALWAYS TRIGGER custody_projection_outbox_append_only;

CREATE TRIGGER custody_projection_outbox_reject_truncate
BEFORE TRUNCATE ON custody_core.custody_projection_outbox
FOR EACH STATEMENT
EXECUTE FUNCTION custody_core.reject_outbox_mutation();

ALTER TABLE custody_core.custody_projection_outbox
  ENABLE ALWAYS TRIGGER custody_projection_outbox_reject_truncate;

CREATE FUNCTION custody_core.record_custody_projection(
  p_event_document jsonb,
  p_request_digest text
)
RETURNS TABLE (
  recorded_event jsonb,
  replayed boolean
)
LANGUAGE plpgsql
SET search_path = pg_catalog, custody_core
AS $$
DECLARE
  existing custody_core.custody_projection_outbox%ROWTYPE;
  inserted custody_core.custody_projection_outbox%ROWTYPE;
  projected_idempotency_key text := p_event_document ->> 'idempotency_key';
BEGIN
  SELECT *
  INTO existing
  FROM custody_core.custody_projection_outbox
  WHERE idempotency_key = projected_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF existing.request_digest IS DISTINCT FROM p_request_digest
       OR existing.event_document IS DISTINCT FROM p_event_document THEN
      RAISE EXCEPTION 'custody projection idempotency conflict';
    END IF;
    RETURN QUERY SELECT existing.event_document, true;
    RETURN;
  END IF;

  BEGIN
    INSERT INTO custody_core.custody_projection_outbox (
      event_id,
      approval_event_id,
      correlation_id,
      withdrawal_id,
      custody_intent_id,
      idempotency_key,
      request_digest,
      intent_digest,
      policy_digest,
      approval_evidence_digest,
      asset,
      network,
      occurred_at,
      expires_at,
      event_document
    )
    VALUES (
      (p_event_document ->> 'event_id')::uuid,
      (p_event_document ->> 'causation_id')::uuid,
      (p_event_document ->> 'correlation_id')::uuid,
      p_event_document ->> 'aggregate_id',
      p_event_document -> 'payload' ->> 'custody_intent_id',
      projected_idempotency_key,
      p_request_digest,
      p_event_document -> 'payload' ->> 'intent_digest',
      p_event_document -> 'payload' ->> 'policy_digest',
      p_event_document -> 'payload' ->> 'approval_evidence_digest',
      p_event_document -> 'payload' ->> 'asset',
      p_event_document -> 'payload' ->> 'network',
      (p_event_document ->> 'occurred_at')::timestamptz,
      (p_event_document -> 'payload' ->> 'expires_at')::timestamptz,
      p_event_document
    )
    RETURNING * INTO inserted;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT *
      INTO existing
      FROM custody_core.custody_projection_outbox
      WHERE idempotency_key = projected_idempotency_key
      FOR UPDATE;

      IF FOUND THEN
        IF existing.request_digest IS NOT DISTINCT FROM p_request_digest
           AND existing.event_document IS NOT DISTINCT FROM p_event_document THEN
          RETURN QUERY SELECT existing.event_document, true;
          RETURN;
        END IF;
        RAISE EXCEPTION 'custody projection idempotency conflict';
      END IF;
      RAISE EXCEPTION 'custody projection identity conflict';
  END;

  RETURN QUERY SELECT inserted.event_document, false;
END;
$$;

REVOKE ALL ON SCHEMA custody_core FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA custody_core FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA custody_core FROM PUBLIC;

COMMIT;
