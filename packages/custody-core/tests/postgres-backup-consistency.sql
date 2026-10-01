\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  PERFORM *
  FROM custody_core.record_custody_projection(
    jsonb_build_object(
      'actor', jsonb_build_object(
        'subject', 'custody_orchestrator',
        'type', 'service'
      ),
      'aggregate_id', 'withdrawal_backup_consistency',
      'aggregate_type', 'withdrawal',
      'causation_id', '018f3f8a-0059-7000-8000-000000000059',
      'correlation_id', '018f3f8a-4001-7000-8000-000000000041',
      'data_classification', 'highly-confidential',
      'event_id', '018f3f8a-0060-7000-8000-000000000060',
      'event_type', 'CustodyIntentPrepared',
      'event_version', 1,
      'idempotency_key', 'custody_idempotency_backup_consistency',
      'occurred_at', '2026-10-01T12:03:00.000Z',
      'payload', jsonb_build_object(
        'approval_evidence_digest', repeat('1', 64),
        'asset', 'USDT',
        'custody_intent_id', 'custody_intent_backup_consistency',
        'execution_authority', false,
        'expires_at', '2026-10-01T12:06:00.000Z',
        'intent_digest', repeat('2', 64),
        'network', 'TRON_TESTNET',
        'policy_digest', repeat('3', 64),
        'production_signing_enabled', false,
        'status', 'unsigned_intent_ready',
        'withdrawal_id', 'withdrawal_backup_consistency'
      ),
      'producer', 'custody-orchestrator'
    ),
    repeat('4', 64)
  );

  PERFORM pg_advisory_lock(390060);
  PERFORM pg_sleep(10);
END;
$$;

COMMIT;
