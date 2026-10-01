\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  event_document jsonb := jsonb_build_object(
    'actor', jsonb_build_object(
      'subject', 'custody_orchestrator',
      'type', 'service'
    ),
    'aggregate_id', 'withdrawal_restore_continuity',
    'aggregate_type', 'withdrawal',
    'causation_id', '018f3f8a-0062-7000-8000-000000000062',
    'correlation_id', '018f3f8a-4002-7000-8000-000000000042',
    'data_classification', 'highly-confidential',
    'event_id', '018f3f8a-0061-7000-8000-000000000061',
    'event_type', 'CustodyIntentPrepared',
    'event_version', 1,
    'idempotency_key', 'custody_idempotency_restore_continuity',
    'occurred_at', '2026-10-01T12:04:00.000Z',
    'payload', jsonb_build_object(
      'approval_evidence_digest', repeat('5', 64),
      'asset', 'USDT',
      'custody_intent_id', 'custody_intent_restore_continuity',
      'execution_authority', false,
      'expires_at', '2026-10-01T12:07:00.000Z',
      'intent_digest', repeat('6', 64),
      'network', 'TRON_TESTNET',
      'policy_digest', repeat('7', 64),
      'production_signing_enabled', false,
      'status', 'unsigned_intent_ready',
      'withdrawal_id', 'withdrawal_restore_continuity'
    ),
    'producer', 'custody-orchestrator'
  );
  result record;
BEGIN
  SELECT *
  INTO result
  FROM custody_core.record_custody_projection(
    event_document,
    repeat('8', 64)
  );
  IF result.replayed THEN
    RAISE EXCEPTION 'restored custody projection was incorrectly marked as replayed';
  END IF;

  SELECT *
  INTO result
  FROM custody_core.record_custody_projection(
    event_document,
    repeat('8', 64)
  );
  IF NOT result.replayed OR result.recorded_event IS DISTINCT FROM event_document THEN
    RAISE EXCEPTION 'restored custody projection did not replay exactly';
  END IF;
END;
$$;

COMMIT;
