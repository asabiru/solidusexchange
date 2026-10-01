#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=custody_test}"
: "${PGDATABASE:=custody_test}"
: "${PGPASSWORD:=custody_test}"
: "${PSQL_DOCKER_IMAGE:=postgres:16.10-alpine3.22@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297}"

export PGPASSWORD

psql_command() {
  if command -v psql >/dev/null 2>&1; then
    psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" "$@"
  else
    docker run --rm --network host \
      -e PGPASSWORD \
      -v "$PWD:/workspace:ro" -w /workspace \
      "$PSQL_DOCKER_IMAGE" \
      psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" "$@"
  fi
}

psql_command -v ON_ERROR_STOP=1 -f migrations/0001_custody_projection_outbox.sql
psql_command -v ON_ERROR_STOP=1 -f tests/postgres-outbox.sql

concurrent_event='{
  "actor":{"subject":"custody_orchestrator","type":"service"},
  "aggregate_id":"withdrawal_concurrent_001",
  "aggregate_type":"withdrawal",
  "causation_id":"018f3f8a-0020-7000-8000-000000000020",
  "correlation_id":"018f3f8a-4000-7000-8000-000000000004",
  "data_classification":"highly-confidential",
  "event_id":"018f3f8a-0021-7000-8000-000000000021",
  "event_type":"CustodyIntentPrepared",
  "event_version":1,
  "idempotency_key":"custody_idempotency_concurrent_001",
  "occurred_at":"2026-10-01T12:02:00.000Z",
  "payload":{
    "approval_evidence_digest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "asset":"USDT",
    "custody_intent_id":"custody_intent_concurrent_001",
    "execution_authority":false,
    "expires_at":"2026-10-01T12:05:00.000Z",
    "intent_digest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "network":"TRON_TESTNET",
    "policy_digest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "production_signing_enabled":false,
    "status":"unsigned_intent_ready",
    "withdrawal_id":"withdrawal_concurrent_001"
  },
  "producer":"custody-orchestrator"
}'

output_one="$(mktemp)"
output_two="$(mktemp)"
trap 'rm -f "$output_one" "$output_two"' EXIT

psql_command -At \
  -c "SELECT replayed FROM custody_core.record_custody_projection(\$event\$$concurrent_event\$event\$::jsonb, repeat('d', 64));" \
  >"$output_one" &
pid_one=$!
psql_command -At \
  -c "SELECT replayed FROM custody_core.record_custody_projection(\$event\$$concurrent_event\$event\$::jsonb, repeat('d', 64));" \
  >"$output_two" &
pid_two=$!

wait "$pid_one"
wait "$pid_two"

cat "$output_one" "$output_two"
test "$(cat "$output_one" "$output_two" | sort | tr '\n' ' ')" = "f t "
test "$(psql_command -At -c \
  "SELECT count(*) FROM custody_core.custody_projection_outbox WHERE idempotency_key = 'custody_idempotency_concurrent_001';")" = "1"

echo "custody-postgres-outbox-ok"
