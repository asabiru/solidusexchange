\set ON_ERROR_STOP on

CREATE FUNCTION pg_temp.custody_event(
  event_id text DEFAULT '018f3f8a-0017-7000-8000-000000000017',
  approval_event_id text DEFAULT '018f3f8a-0012-7000-8000-000000000012',
  withdrawal_id text DEFAULT 'withdrawal_001',
  custody_intent_id text DEFAULT 'custody_intent_001',
  idempotency_key text DEFAULT 'custody_idempotency_001',
  network text DEFAULT 'TRON_TESTNET',
  production_signing_enabled boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'actor', jsonb_build_object(
      'subject', 'custody_orchestrator',
      'type', 'service'
    ),
    'aggregate_id', withdrawal_id,
    'aggregate_type', 'withdrawal',
    'causation_id', approval_event_id,
    'correlation_id', '018f3f8a-4000-7000-8000-000000000004',
    'data_classification', 'highly-confidential',
    'event_id', event_id,
    'event_type', 'CustodyIntentPrepared',
    'event_version', 1,
    'idempotency_key', idempotency_key,
    'occurred_at', '2026-10-01T12:02:00.000Z',
    'payload', jsonb_build_object(
      'approval_evidence_digest', repeat('a', 64),
      'asset', 'USDT',
      'custody_intent_id', custody_intent_id,
      'execution_authority', false,
      'expires_at', '2026-10-01T12:05:00.000Z',
      'intent_digest', repeat('b', 64),
      'network', network,
      'policy_digest', repeat('c', 64),
      'production_signing_enabled', production_signing_enabled,
      'status', 'unsigned_intent_ready',
      'withdrawal_id', withdrawal_id
    ),
    'producer', 'custody-orchestrator'
  );
$$;

DO $$
DECLARE
  result record;
BEGIN
  SELECT *
  INTO result
  FROM custody_core.record_custody_projection(
    pg_temp.custody_event(),
    repeat('d', 64)
  );
  IF result.replayed THEN
    RAISE EXCEPTION 'first custody projection was incorrectly marked as a replay';
  END IF;

  SELECT *
  INTO result
  FROM custody_core.record_custody_projection(
    pg_temp.custody_event(),
    repeat('d', 64)
  );
  IF NOT result.replayed THEN
    RAISE EXCEPTION 'exact custody projection replay was not recognized';
  END IF;
END;
$$;

DO $$
BEGIN
  PERFORM *
  FROM custody_core.record_custody_projection(
    pg_temp.custody_event(),
    NULL
  );
  RAISE EXCEPTION 'null request digest replay was accepted';
EXCEPTION
  WHEN raise_exception THEN
    IF SQLERRM <> 'custody projection idempotency conflict' THEN
      RAISE;
    END IF;
END;
$$;

DO $$
BEGIN
  PERFORM *
  FROM custody_core.record_custody_projection(
    pg_temp.custody_event(
      event_id => '018f3f8a-0018-7000-8000-000000000018'
    ),
    repeat('e', 64)
  );
  RAISE EXCEPTION 'changed idempotent replay was accepted';
EXCEPTION
  WHEN raise_exception THEN
    IF SQLERRM <> 'custody projection idempotency conflict' THEN
      RAISE;
    END IF;
END;
$$;

DO $$
BEGIN
  PERFORM *
  FROM custody_core.record_custody_projection(
    pg_temp.custody_event(
      event_id => '018f3f8a-0018-7000-8000-000000000018',
      approval_event_id => '018f3f8a-0012-7000-8000-000000000012',
      withdrawal_id => 'withdrawal_002',
      custody_intent_id => 'custody_intent_002',
      idempotency_key => 'custody_idempotency_002'
    ),
    repeat('e', 64)
  );
  RAISE EXCEPTION 'duplicate approval source identity was accepted';
EXCEPTION
  WHEN raise_exception THEN
    IF SQLERRM <> 'custody projection identity conflict' THEN
      RAISE;
    END IF;
END;
$$;

DO $$
BEGIN
  PERFORM *
  FROM custody_core.record_custody_projection(
    pg_temp.custody_event(
      event_id => '018f3f8a-0018-7000-8000-000000000018',
      approval_event_id => '018f3f8a-0019-7000-8000-000000000019',
      withdrawal_id => 'withdrawal_002',
      custody_intent_id => 'custody_intent_002',
      idempotency_key => 'custody_idempotency_002',
      network => 'TRON_MAINNET'
    ),
    repeat('e', 64)
  );
  RAISE EXCEPTION 'mainnet custody projection was accepted';
EXCEPTION
  WHEN check_violation THEN
    IF position('custody_projection_network_testnet' IN SQLERRM) = 0 THEN
      RAISE;
    END IF;
END;
$$;

DO $$
BEGIN
  PERFORM *
  FROM custody_core.record_custody_projection(
    pg_temp.custody_event(
      event_id => '018f3f8a-0018-7000-8000-000000000018',
      approval_event_id => '018f3f8a-0019-7000-8000-000000000019',
      withdrawal_id => 'withdrawal_002',
      custody_intent_id => 'custody_intent_002',
      idempotency_key => 'custody_idempotency_002',
      production_signing_enabled => true
    ),
    repeat('e', 64)
  );
  RAISE EXCEPTION 'signing-enabled custody projection was accepted';
EXCEPTION
  WHEN check_violation THEN
    IF position('custody_projection_unsigned_status' IN SQLERRM) = 0 THEN
      RAISE;
    END IF;
END;
$$;

DO $$
BEGIN
  UPDATE custody_core.custody_projection_outbox
  SET request_digest = repeat('f', 64);
  RAISE EXCEPTION 'custody outbox update was accepted';
EXCEPTION
  WHEN raise_exception THEN
    IF SQLERRM <> 'custody projection outbox is append-only' THEN
      RAISE;
    END IF;
END;
$$;

DO $$
BEGIN
  DELETE FROM custody_core.custody_projection_outbox;
  RAISE EXCEPTION 'custody outbox delete was accepted';
EXCEPTION
  WHEN raise_exception THEN
    IF SQLERRM <> 'custody projection outbox is append-only' THEN
      RAISE;
    END IF;
END;
$$;

DO $$
BEGIN
  TRUNCATE custody_core.custody_projection_outbox;
  RAISE EXCEPTION 'custody outbox truncate was accepted';
EXCEPTION
  WHEN raise_exception THEN
    IF SQLERRM <> 'custody projection outbox is append-only' THEN
      RAISE;
    END IF;
END;
$$;

SET session_replication_role = replica;

DO $$
BEGIN
  UPDATE custody_core.custody_projection_outbox
  SET request_digest = repeat('f', 64);
  RAISE EXCEPTION 'replica-mode custody outbox update was accepted';
EXCEPTION
  WHEN raise_exception THEN
    IF SQLERRM <> 'custody projection outbox is append-only' THEN
      RAISE;
    END IF;
END;
$$;

RESET session_replication_role;

DO $$
DECLARE
  projection_count bigint;
BEGIN
  SELECT count(*)
  INTO projection_count
  FROM custody_core.custody_projection_outbox;
  IF projection_count <> 1 THEN
    RAISE EXCEPTION 'custody outbox contains % rows instead of 1', projection_count;
  END IF;
END;
$$;
