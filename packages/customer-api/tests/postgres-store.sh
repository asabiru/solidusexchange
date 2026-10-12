#!/usr/bin/env bash

set -euo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=customer_api_test}"
: "${PGDATABASE:=customer_api_test}"
: "${PGPASSWORD:=customer_api_test}"

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
export CUSTOMER_API_STORE_DSN="postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}"

node --test tests/postgres-store-contract.mjs
node --test tests/postgres-auth-session-contract.mjs

run_psql -v ON_ERROR_STOP=1 -Atq \
  -c "SELECT count(*) FROM customer_api.schema_migrations WHERE version = 1 AND migration_name = '0001_customer_api_store';" \
  | grep -Fx 1 >/dev/null

run_psql -v ON_ERROR_STOP=1 -Atq \
  -c "SELECT count(*) FROM customer_api.schema_migrations WHERE version = 2 AND migration_name = '0002_auth_sessions';" \
  | grep -Fx 1 >/dev/null

run_psql -v ON_ERROR_STOP=1 -Atq \
  -c "SELECT count(*) FROM customer_api.rate_limit_buckets;" \
  | grep -Eq '^[1-9][0-9]*$' >/dev/null

run_psql -v ON_ERROR_STOP=1 -Atq \
  -c "SELECT count(*) FROM customer_api.auth_sessions;" \
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
    echo "Invalid PostgreSQL customer-api migration history change unexpectedly committed." >&2
    exit 1
  fi
  grep -F "$expected" <<<"$output" >/dev/null
}

assert_change_rejected \
  "customer_api migration version 4 must follow installed version 2 with version 3" \
  "INSERT INTO customer_api.schema_migrations (version, migration_name)
   VALUES (4, '0004_skipped_migration');"

assert_change_rejected \
  "customer_api migration name 0009_wrong_version must encode version 3" \
  "INSERT INTO customer_api.schema_migrations (version, migration_name)
   VALUES (3, '0009_wrong_version');"

assert_change_rejected \
  "customer_api migration applied_at must be later than installed version 2" \
  "INSERT INTO customer_api.schema_migrations (
     version,
     migration_name,
     applied_at
   )
   SELECT 3, '0003_stale_timestamp', max(applied_at)
   FROM customer_api.schema_migrations;"

assert_change_rejected \
  "customer_api migration history is append-only" \
  "UPDATE customer_api.schema_migrations
      SET migration_name = migration_name
    WHERE version = 1;"

assert_change_rejected \
  "customer_api migration history is append-only" \
  "DELETE FROM customer_api.schema_migrations WHERE version = 1;"

assert_change_rejected \
  "customer_api migration history is append-only" \
  "TRUNCATE customer_api.schema_migrations;"

assert_change_rejected \
  "customer_api migration history is append-only" \
  "SET session_replication_role = replica;
   DELETE FROM customer_api.schema_migrations WHERE version = 1;"

# Migration 0002's guards must hold in the database itself: sessions are
# append-forward, digests unique, CHECKs and the mutation trigger reject
# what the store model forbids.
run_psql -v ON_ERROR_STOP=1 \
  -c "INSERT INTO customer_api.auth_sessions
        (session_id, subject, token_digest, device_digest,
         issued_at_ms, expires_at_ms, last_used_at_ms)
      VALUES ('sess_a1b2c3d4e5f6a7b8c9d0e1f2', 'syn_cust_liveassert',
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              NULL, 1000, 2000, 1000);" >/dev/null

assert_change_rejected \
  'violates check constraint "auth_sessions_session_id_check"' \
  "INSERT INTO customer_api.auth_sessions
        (session_id, subject, token_digest, device_digest,
         issued_at_ms, expires_at_ms, last_used_at_ms)
      VALUES ('sess_bad', 'syn_cust_liveassert',
              'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
              NULL, 1000, 2000, 1000);"

assert_change_rejected \
  'violates check constraint "auth_sessions_check"' \
  "INSERT INTO customer_api.auth_sessions
        (session_id, subject, token_digest, device_digest,
         issued_at_ms, expires_at_ms, last_used_at_ms)
      VALUES ('sess_b1b2c3d4e5f6a7b8c9d0e1f2', 'syn_cust_liveassert',
              'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
              NULL, 2000, 1000, 2000);"

assert_change_rejected \
  'violates check constraint "auth_sessions_check2"' \
  "INSERT INTO customer_api.auth_sessions
        (session_id, subject, token_digest, device_digest,
         issued_at_ms, expires_at_ms, last_used_at_ms, revoked, revoked_at_ms)
      VALUES ('sess_c1b2c3d4e5f6a7b8c9d0e1f2', 'syn_cust_liveassert',
              'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
              NULL, 1000, 2000, 1000, false, 1500);"

assert_change_rejected \
  'duplicate key value violates unique constraint "auth_sessions_token_digest_uq"' \
  "INSERT INTO customer_api.auth_sessions
        (session_id, subject, token_digest, device_digest,
         issued_at_ms, expires_at_ms, last_used_at_ms)
      VALUES ('sess_d1b2c3d4e5f6a7b8c9d0e1f2', 'syn_cust_liveassert',
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              NULL, 1100, 2100, 1100);"

assert_change_rejected \
  "auth_sessions session_id, subject and issued_at_ms are immutable" \
  "UPDATE customer_api.auth_sessions
      SET subject = 'syn_cust_mutatedsub'
    WHERE session_id = 'sess_a1b2c3d4e5f6a7b8c9d0e1f2';"

assert_change_rejected \
  "auth_sessions expires_at_ms only moves forward" \
  "UPDATE customer_api.auth_sessions
      SET expires_at_ms = 500
    WHERE session_id = 'sess_a1b2c3d4e5f6a7b8c9d0e1f2';"

assert_change_rejected \
  "auth_sessions last_used_at_ms only moves forward" \
  "UPDATE customer_api.auth_sessions
      SET last_used_at_ms = 500
    WHERE session_id = 'sess_a1b2c3d4e5f6a7b8c9d0e1f2';"

run_psql -v ON_ERROR_STOP=1 \
  -c "UPDATE customer_api.auth_sessions
         SET revoked = true, revoked_at_ms = 1500
       WHERE session_id = 'sess_a1b2c3d4e5f6a7b8c9d0e1f2';" >/dev/null

assert_change_rejected \
  "auth_sessions revocation is terminal" \
  "UPDATE customer_api.auth_sessions
      SET token_digest =
            'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
    WHERE session_id = 'sess_a1b2c3d4e5f6a7b8c9d0e1f2';"

assert_change_rejected \
  "auth_sessions history is append-forward; truncation is blocked" \
  "TRUNCATE customer_api.auth_sessions;"

# The same guards must hold for replica-apply connections: ENABLE ALWAYS
# keeps the triggers firing when session_replication_role = replica.
assert_change_rejected \
  "auth_sessions session_id, subject and issued_at_ms are immutable" \
  "SET session_replication_role = replica;
   UPDATE customer_api.auth_sessions
      SET subject = 'syn_cust_replmut'
    WHERE session_id = 'sess_a1b2c3d4e5f6a7b8c9d0e1f2';"

assert_change_rejected \
  "auth_sessions revocation is terminal" \
  "SET session_replication_role = replica;
   UPDATE customer_api.auth_sessions
      SET expires_at_ms = 2500
    WHERE session_id = 'sess_a1b2c3d4e5f6a7b8c9d0e1f2';"

assert_change_rejected \
  "auth_sessions history is append-forward; truncation is blocked" \
  "SET session_replication_role = replica;
   TRUNCATE customer_api.auth_sessions;"

# A tombstone without the boolean flag is the other half of the terminal
# invariant — the CHECK is symmetric.
assert_change_rejected \
  'violates check constraint "auth_sessions_check2"' \
  "INSERT INTO customer_api.auth_sessions
        (session_id, subject, token_digest, device_digest,
         issued_at_ms, expires_at_ms, last_used_at_ms, revoked, revoked_at_ms)
      VALUES ('sess_f1b2c3d4e5f6a7b8c9d0e1f2', 'syn_cust_liveassert',
              'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
              NULL, 1000, 2000, 1000, true, NULL);"

# DELETE is intentionally allowed on the session table: the store's own
# evictions and the expiry sweep delete rows. The append-forward model is
# enforced by grants (REVOKE ALL FROM PUBLIC), not by the trigger.
run_psql -v ON_ERROR_STOP=1 \
  -c "INSERT INTO customer_api.auth_sessions
        (session_id, subject, token_digest, device_digest,
         issued_at_ms, expires_at_ms, last_used_at_ms)
      VALUES ('sess_e1b2c3d4e5f6a7b8c9d0e1f2', 'syn_cust_liveassert',
              'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
              NULL, 1000, 2000, 1000);" >/dev/null

run_psql -v ON_ERROR_STOP=1 -Atq \
  -c "DELETE FROM customer_api.auth_sessions
       WHERE session_id = 'sess_e1b2c3d4e5f6a7b8c9d0e1f2'
      RETURNING session_id;" \
  | grep -Fx 'sess_e1b2c3d4e5f6a7b8c9d0e1f2' >/dev/null

# Replaying an already-applied migration must fail loudly and leave the
# catalog untouched.
set +e
replay_output="$(
  run_psql -v ON_ERROR_STOP=1 \
    -f migrations/0001_customer_api_store.sql \
    2>&1
)"
replay_status=$?
set -e

printf '%s\n' "$replay_output"
if [[ "$replay_status" -eq 0 ]]; then
  echo "Replaying PostgreSQL customer-api migration 0001 unexpectedly committed." >&2
  exit 1
fi
grep -F 'schema "customer_api" already exists' <<<"$replay_output" >/dev/null

set +e
replay_output="$(
  run_psql -v ON_ERROR_STOP=1 \
    -f migrations/0002_auth_sessions.sql \
    2>&1
)"
replay_status=$?
set -e

printf '%s\n' "$replay_output"
if [[ "$replay_status" -eq 0 ]]; then
  echo "Replaying PostgreSQL customer-api migration 0002 unexpectedly committed." >&2
  exit 1
fi
grep -F 'relation "auth_sessions" already exists' <<<"$replay_output" >/dev/null

run_psql -v ON_ERROR_STOP=1 -Atq \
  -c "SELECT count(*) FROM customer_api.schema_migrations;" \
  | grep -Fx 2 >/dev/null

echo "postgres-store-contract-ok"
