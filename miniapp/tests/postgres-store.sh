#!/usr/bin/env bash

set -euo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=miniapp_test}"
: "${PGDATABASE:=miniapp_test}"
: "${PGPASSWORD:=miniapp_test}"

PSQL_DOCKER_IMAGE="${PSQL_DOCKER_IMAGE:-}"
workspace="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$workspace"

run_psql() {
  if [[ -n "$PSQL_DOCKER_IMAGE" ]]; then
    docker run --rm -i --network host \
      -e PGPASSWORD="$PGPASSWORD" \
      -v "$workspace:/workspace:ro" -w /workspace \
      "$PSQL_DOCKER_IMAGE" \
      psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" "$@"
  else
    PGPASSWORD="$PGPASSWORD" \
      psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" "$@"
  fi
}

for migration in migrations/*.sql; do
  run_psql -v ON_ERROR_STOP=1 -f "$migration"
done

# The store backend runs on the host (node + the pg driver from npm ci); only
# psql goes through the docker client when PSQL_DOCKER_IMAGE is set.
export MINIAPP_SESSION_STORE_DSN="postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}"

# The contract arm runs against the TypeScript test build the same way the
# package's own suite does; rebuild it so the script is self-contained.
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json

node --test .test-dist/server/postgres-session-store-contract.js

run_psql -v ON_ERROR_STOP=1 -Atq \
  -c "SELECT count(*) FROM miniapp_control.schema_migrations WHERE version = 1 AND migration_name = '0001_customer_sessions';" \
  | grep -Fx 1 >/dev/null

run_psql -v ON_ERROR_STOP=1 -Atq \
  -c "SELECT count(*) FROM miniapp_control.customer_sessions;" \
  | grep -Eq '^[1-9][0-9]*$' >/dev/null

# The migration's ENABLE ALWAYS guards must hold in the database itself —
# rejections are asserted on live statements, like custody-core's
# migration-history arm does.
assert_change_rejected() {
  local expected="$1"
  local statement="$2"
  local output
  local status

  set +e
  output="$(
    run_psql -v ON_ERROR_STOP=1 \
      -c "$statement" \
      2>&1
  )"
  status=$?
  set -e

  printf '%s\n' "$output"
  if [[ "$status" -eq 0 ]]; then
    echo "Invalid PostgreSQL miniapp migration history change unexpectedly committed." >&2
    exit 1
  fi
  grep -F "$expected" <<<"$output" >/dev/null
}

assert_change_rejected \
  "miniapp_control migration version 3 must follow installed version 1 with version 2" \
  "INSERT INTO miniapp_control.schema_migrations (version, migration_name)
   VALUES (3, '0003_skipped_migration');"

assert_change_rejected \
  "miniapp_control migration name 0009_wrong_version must encode version 2" \
  "INSERT INTO miniapp_control.schema_migrations (version, migration_name)
   VALUES (2, '0009_wrong_version');"

assert_change_rejected \
  "miniapp_control migration 0002_stale_timestamp must be applied after" \
  "INSERT INTO miniapp_control.schema_migrations (
     version,
     migration_name,
     applied_at
   )
   SELECT 2, '0002_stale_timestamp', max(applied_at)
   FROM miniapp_control.schema_migrations;"

assert_change_rejected \
  "miniapp_control migration history is append-only" \
  "UPDATE miniapp_control.schema_migrations
      SET migration_name = migration_name
    WHERE version = 1;"

assert_change_rejected \
  "miniapp_control migration history is append-only" \
  "DELETE FROM miniapp_control.schema_migrations WHERE version = 1;"

assert_change_rejected \
  "miniapp_control migration history is append-only" \
  "TRUNCATE miniapp_control.schema_migrations;"

assert_change_rejected \
  "miniapp_control migration history is append-only" \
  "SET session_replication_role = replica;
   DELETE FROM miniapp_control.schema_migrations WHERE version = 1;"

# Migration 0001's guards must hold in the database itself: sessions are
# append-forward, digests unique, CHECKs and the mutation trigger reject
# what the store model forbids.
run_psql -v ON_ERROR_STOP=1 \
  -c "INSERT INTO miniapp_control.customer_sessions
        (session_id, subject, source, kyc, token_digest, device_digest,
         issued_at_ms, expires_at_ms, last_used_at_ms)
      VALUES ('sess_a1b2c3d4e5f6a7b8c9d0e1f2', 'dev-0000000000000000',
              'telegram', 'kyc-gated',
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              NULL, 1000, 2000, 1000);" >/dev/null

assert_change_rejected \
  'violates check constraint "customer_sessions_session_id_format"' \
  "INSERT INTO miniapp_control.customer_sessions
        (session_id, subject, source, kyc, token_digest, device_digest,
         issued_at_ms, expires_at_ms, last_used_at_ms)
      VALUES ('sess_bad', 'dev-0000000000000000',
              'telegram', 'kyc-gated',
              'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
              NULL, 1000, 2000, 1000);"

assert_change_rejected \
  'violates check constraint "customer_sessions_subject_format"' \
  "INSERT INTO miniapp_control.customer_sessions
        (session_id, subject, source, kyc, token_digest, device_digest,
         issued_at_ms, expires_at_ms, last_used_at_ms)
      VALUES ('sess_b0b2c3d4e5f6a7b8c9d0e1f2', 'syn_oper_liveassert',
              'telegram', 'kyc-gated',
              'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
              NULL, 1000, 2000, 1000);"

assert_change_rejected \
  'violates check constraint "customer_sessions_expires_after_issued"' \
  "INSERT INTO miniapp_control.customer_sessions
        (session_id, subject, source, kyc, token_digest, device_digest,
         issued_at_ms, expires_at_ms, last_used_at_ms)
      VALUES ('sess_b1b2c3d4e5f6a7b8c9d0e1f2', 'dev-0000000000000000',
              'telegram', 'kyc-gated',
              'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
              NULL, 2000, 1000, 2000);"

assert_change_rejected \
  'violates check constraint "customer_sessions_revoked_terminal"' \
  "INSERT INTO miniapp_control.customer_sessions
        (session_id, subject, source, kyc, token_digest, device_digest,
         issued_at_ms, expires_at_ms, last_used_at_ms, revoked, revoked_at_ms)
      VALUES ('sess_c1b2c3d4e5f6a7b8c9d0e1f2', 'dev-0000000000000000',
              'telegram', 'kyc-gated',
              'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
              NULL, 1000, 2000, 1000, false, 1500);"

assert_change_rejected \
  'duplicate key value violates unique constraint "customer_sessions_token_digest_uq"' \
  "INSERT INTO miniapp_control.customer_sessions
        (session_id, subject, source, kyc, token_digest, device_digest,
         issued_at_ms, expires_at_ms, last_used_at_ms)
      VALUES ('sess_d1b2c3d4e5f6a7b8c9d0e1f2', 'dev-0000000000000000',
              'telegram', 'kyc-gated',
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              NULL, 1100, 2100, 1100);"

assert_change_rejected \
  "customer session identity fields are immutable" \
  "UPDATE miniapp_control.customer_sessions
      SET subject = 'tg-0000000000000000'
    WHERE session_id = 'sess_a1b2c3d4e5f6a7b8c9d0e1f2';"

assert_change_rejected \
  "customer session expiry only moves forward" \
  "UPDATE miniapp_control.customer_sessions
      SET expires_at_ms = 500
    WHERE session_id = 'sess_a1b2c3d4e5f6a7b8c9d0e1f2';"

assert_change_rejected \
  "customer session last used only moves forward" \
  "UPDATE miniapp_control.customer_sessions
      SET last_used_at_ms = 500
    WHERE session_id = 'sess_a1b2c3d4e5f6a7b8c9d0e1f2';"

run_psql -v ON_ERROR_STOP=1 \
  -c "UPDATE miniapp_control.customer_sessions
         SET kyc = 'verified'
       WHERE session_id = 'sess_a1b2c3d4e5f6a7b8c9d0e1f2';" >/dev/null

assert_change_rejected \
  "customer session kyc only promotes gated to verified" \
  "UPDATE miniapp_control.customer_sessions
      SET kyc = 'kyc-gated'
    WHERE session_id = 'sess_a1b2c3d4e5f6a7b8c9d0e1f2';"

run_psql -v ON_ERROR_STOP=1 \
  -c "UPDATE miniapp_control.customer_sessions
         SET revoked = true, revoked_at_ms = 1500
       WHERE session_id = 'sess_a1b2c3d4e5f6a7b8c9d0e1f2';" >/dev/null

assert_change_rejected \
  "customer session revocation is terminal" \
  "UPDATE miniapp_control.customer_sessions
      SET revoked = false, revoked_at_ms = NULL
    WHERE session_id = 'sess_a1b2c3d4e5f6a7b8c9d0e1f2';"

# A session may be issued already device-bound (the login itself binds) —
# the trigger only forbids rebinding.
run_psql -v ON_ERROR_STOP=1 \
  -c "INSERT INTO miniapp_control.customer_sessions
        (session_id, subject, source, kyc, token_digest, device_digest,
         issued_at_ms, expires_at_ms, last_used_at_ms)
      VALUES ('sess_e1b2c3d4e5f6a7b8c9d0e1f2', 'dev-0000000000000000',
              'telegram', 'kyc-gated',
              'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
              'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
              1000, 2000, 1000);" >/dev/null

assert_change_rejected \
  "customer session device binding is one-time" \
  "UPDATE miniapp_control.customer_sessions
      SET device_digest =
            'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    WHERE session_id = 'sess_e1b2c3d4e5f6a7b8c9d0e1f2';"

assert_change_rejected \
  "miniapp_control.customer_sessions is append-only" \
  "TRUNCATE miniapp_control.customer_sessions;"

# Replaying an already-applied migration must fail loudly and leave the
# catalog untouched.
set +e
replay_output="$(
  run_psql -v ON_ERROR_STOP=1 \
    -f migrations/0001_customer_sessions.sql \
    2>&1
)"
replay_status=$?
set -e

printf '%s\n' "$replay_output"
if [[ "$replay_status" -eq 0 ]]; then
  echo "Replaying PostgreSQL miniapp migration 0001 unexpectedly committed." >&2
  exit 1
fi
grep -F 'schema "miniapp_control" already exists' <<<"$replay_output" >/dev/null

run_psql -v ON_ERROR_STOP=1 -Atq \
  -c "SELECT count(*) FROM miniapp_control.schema_migrations;" \
  | grep -Fx 1 >/dev/null

echo "miniapp-postgres-session-store-contract-ok"
