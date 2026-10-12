#!/usr/bin/env bash

set -euo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=backoffice_test}"
: "${PGDATABASE:=backoffice_test}"
: "${PGPASSWORD:=backoffice_test}"

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
export BACKOFFICE_SESSION_STORE_DSN="postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}"

# The contract arm runs against the TypeScript test build the same way the
# package's own suite does; rebuild it so the script is self-contained.
rm -rf .test-dist
./node_modules/.bin/tsc -p tsconfig.test.json

node --test .test-dist/server/postgres-session-store-contract.js

run_psql -v ON_ERROR_STOP=1 -Atq \
  -c "SELECT count(*) FROM backoffice_control.schema_migrations WHERE version = 1 AND migration_name = '0001_append_only_audit';" \
  | grep -Fx 1 >/dev/null

run_psql -v ON_ERROR_STOP=1 -Atq \
  -c "SELECT count(*) FROM backoffice_control.schema_migrations WHERE version = 2 AND migration_name = '0002_operator_sessions';" \
  | grep -Fx 1 >/dev/null

run_psql -v ON_ERROR_STOP=1 -Atq \
  -c "SELECT count(*) FROM backoffice_control.operator_sessions;" \
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
    echo "Invalid PostgreSQL backoffice migration history change unexpectedly committed." >&2
    exit 1
  fi
  grep -F "$expected" <<<"$output" >/dev/null
}

assert_change_rejected \
  "backoffice_control migration version 4 must follow installed version 2 with version 3" \
  "INSERT INTO backoffice_control.schema_migrations (version, migration_name)
   VALUES (4, '0004_skipped_migration');"

assert_change_rejected \
  "backoffice_control migration name 0009_wrong_version must encode version 3" \
  "INSERT INTO backoffice_control.schema_migrations (version, migration_name)
   VALUES (3, '0009_wrong_version');"

assert_change_rejected \
  "backoffice_control migration applied_at must be later than installed version 2" \
  "INSERT INTO backoffice_control.schema_migrations (
     version,
     migration_name,
     applied_at
   )
   SELECT 3, '0003_stale_timestamp', max(applied_at)
   FROM backoffice_control.schema_migrations;"

assert_change_rejected \
  "backoffice_control migration history is append-only" \
  "UPDATE backoffice_control.schema_migrations
      SET migration_name = migration_name
    WHERE version = 1;"

assert_change_rejected \
  "backoffice_control migration history is append-only" \
  "DELETE FROM backoffice_control.schema_migrations WHERE version = 1;"

assert_change_rejected \
  "backoffice_control migration history is append-only" \
  "TRUNCATE backoffice_control.schema_migrations;"

assert_change_rejected \
  "backoffice_control migration history is append-only" \
  "SET session_replication_role = replica;
   DELETE FROM backoffice_control.schema_migrations WHERE version = 1;"

# Migration 0002's guards must hold in the database itself: sessions are
# append-forward, digests unique, CHECKs and the mutation trigger reject
# what the store model forbids.
run_psql -v ON_ERROR_STOP=1 \
  -c "INSERT INTO backoffice_control.operator_sessions
        (session_id, subject, email, name, role, token_digest, device_digest,
         issued_at_ms, expires_at_ms, last_used_at_ms)
      VALUES ('sess_a1b2c3d4e5f6a7b8c9d0e1f2', 'syn_oper_liveassert',
              'live@dev.solidchange.invalid', 'Live Assert', 'auditor',
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              NULL, 1000, 2000, 1000);" >/dev/null

assert_change_rejected \
  'violates check constraint "operator_sessions_session_id_check"' \
  "INSERT INTO backoffice_control.operator_sessions
        (session_id, subject, email, name, role, token_digest, device_digest,
         issued_at_ms, expires_at_ms, last_used_at_ms)
      VALUES ('sess_bad', 'syn_oper_liveassert',
              'live@dev.solidchange.invalid', 'Live Assert', 'auditor',
              'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
              NULL, 1000, 2000, 1000);"

assert_change_rejected \
  'violates check constraint "operator_sessions_expires_after_issued"' \
  "INSERT INTO backoffice_control.operator_sessions
        (session_id, subject, email, name, role, token_digest, device_digest,
         issued_at_ms, expires_at_ms, last_used_at_ms)
      VALUES ('sess_b1b2c3d4e5f6a7b8c9d0e1f2', 'syn_oper_liveassert',
              'live@dev.solidchange.invalid', 'Live Assert', 'auditor',
              'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
              NULL, 2000, 1000, 2000);"

assert_change_rejected \
  'violates check constraint "operator_sessions_revoked_terminal"' \
  "INSERT INTO backoffice_control.operator_sessions
        (session_id, subject, email, name, role, token_digest, device_digest,
         issued_at_ms, expires_at_ms, last_used_at_ms, revoked, revoked_at_ms)
      VALUES ('sess_c1b2c3d4e5f6a7b8c9d0e1f2', 'syn_oper_liveassert',
              'live@dev.solidchange.invalid', 'Live Assert', 'auditor',
              'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
              NULL, 1000, 2000, 1000, false, 1500);"

assert_change_rejected \
  'duplicate key value violates unique constraint "operator_sessions_token_digest_uq"' \
  "INSERT INTO backoffice_control.operator_sessions
        (session_id, subject, email, name, role, token_digest, device_digest,
         issued_at_ms, expires_at_ms, last_used_at_ms)
      VALUES ('sess_d1b2c3d4e5f6a7b8c9d0e1f2', 'syn_oper_liveassert',
              'live@dev.solidchange.invalid', 'Live Assert', 'auditor',
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              NULL, 1100, 2100, 1100);"

assert_change_rejected \
  "operator_sessions session_id, subject, email, name, role and issued_at_ms are immutable" \
  "UPDATE backoffice_control.operator_sessions
      SET subject = 'syn_oper_mutatedsub'
    WHERE session_id = 'sess_a1b2c3d4e5f6a7b8c9d0e1f2';"

assert_change_rejected \
  "operator_sessions expires_at_ms only moves forward" \
  "UPDATE backoffice_control.operator_sessions
      SET expires_at_ms = 500
    WHERE session_id = 'sess_a1b2c3d4e5f6a7b8c9d0e1f2';"

assert_change_rejected \
  "operator_sessions last_used_at_ms only moves forward" \
  "UPDATE backoffice_control.operator_sessions
      SET last_used_at_ms = 500
    WHERE session_id = 'sess_a1b2c3d4e5f6a7b8c9d0e1f2';"

run_psql -v ON_ERROR_STOP=1 \
  -c "UPDATE backoffice_control.operator_sessions
         SET revoked = true, revoked_at_ms = 1500
       WHERE session_id = 'sess_a1b2c3d4e5f6a7b8c9d0e1f2';" >/dev/null

assert_change_rejected \
  "operator_sessions revocation is terminal" \
  "UPDATE backoffice_control.operator_sessions
      SET token_digest =
            'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
    WHERE session_id = 'sess_a1b2c3d4e5f6a7b8c9d0e1f2';"

# A session may be issued already device-bound (the login itself binds) —
# the trigger only forbids rebinding.
run_psql -v ON_ERROR_STOP=1 \
  -c "INSERT INTO backoffice_control.operator_sessions
        (session_id, subject, email, name, role, token_digest, device_digest,
         issued_at_ms, expires_at_ms, last_used_at_ms)
      VALUES ('sess_e1b2c3d4e5f6a7b8c9d0e1f2', 'syn_oper_liveassert',
              'live@dev.solidchange.invalid', 'Live Assert', 'auditor',
              'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
              'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
              1000, 2000, 1000);" >/dev/null

assert_change_rejected \
  "operator_sessions device binding is one-time" \
  "UPDATE backoffice_control.operator_sessions
      SET device_digest =
            'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    WHERE session_id = 'sess_e1b2c3d4e5f6a7b8c9d0e1f2';"

assert_change_rejected \
  "operator_sessions history is append-forward; truncation is blocked" \
  "TRUNCATE backoffice_control.operator_sessions;"

# The same guards must hold for replica-apply connections: ENABLE ALWAYS
# keeps the triggers firing when session_replication_role = replica.
assert_change_rejected \
  "operator_sessions session_id, subject, email, name, role and issued_at_ms are immutable" \
  "SET session_replication_role = replica;
   UPDATE backoffice_control.operator_sessions
      SET subject = 'syn_oper_replmut'
    WHERE session_id = 'sess_a1b2c3d4e5f6a7b8c9d0e1f2';"

assert_change_rejected \
  "operator_sessions revocation is terminal" \
  "SET session_replication_role = replica;
   UPDATE backoffice_control.operator_sessions
      SET expires_at_ms = 2500
    WHERE session_id = 'sess_a1b2c3d4e5f6a7b8c9d0e1f2';"

assert_change_rejected \
  "operator_sessions history is append-forward; truncation is blocked" \
  "SET session_replication_role = replica;
   TRUNCATE backoffice_control.operator_sessions;"

# A tombstone without the boolean flag is the other half of the terminal
# invariant — the CHECK is symmetric.
assert_change_rejected \
  'violates check constraint "operator_sessions_revoked_terminal"' \
  "INSERT INTO backoffice_control.operator_sessions
        (session_id, subject, email, name, role, token_digest, device_digest,
         issued_at_ms, expires_at_ms, last_used_at_ms, revoked, revoked_at_ms)
      VALUES ('sess_f1b2c3d4e5f6a7b8c9d0e1f2', 'syn_oper_liveassert',
              'live@dev.solidchange.invalid', 'Live Assert', 'auditor',
              'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
              NULL, 1000, 2000, 1000, true, NULL);"

# DELETE is intentionally allowed on the session table: the store's own
# evictions and the expiry sweep delete rows. The append-forward model is
# enforced by grants (REVOKE ALL FROM PUBLIC), not by the trigger.
run_psql -v ON_ERROR_STOP=1 \
  -c "INSERT INTO backoffice_control.operator_sessions
        (session_id, subject, email, name, role, token_digest, device_digest,
         issued_at_ms, expires_at_ms, last_used_at_ms)
      VALUES ('sess_d1b2c3d4e5f6a7b8c9d0e1f2', 'syn_oper_liveassert',
              'live@dev.solidchange.invalid', 'Live Assert', 'auditor',
              '9999999999999999999999999999999999999999999999999999999999999999',
              NULL, 1000, 2000, 1000);" >/dev/null

run_psql -v ON_ERROR_STOP=1 -Atq \
  -c "DELETE FROM backoffice_control.operator_sessions
       WHERE session_id = 'sess_d1b2c3d4e5f6a7b8c9d0e1f2'
      RETURNING session_id;" \
  | grep -Fx 'sess_d1b2c3d4e5f6a7b8c9d0e1f2' >/dev/null

# Replaying an already-applied migration must fail loudly and leave the
# catalog untouched.
set +e
replay_output="$(
  run_psql -v ON_ERROR_STOP=1 \
    -f migrations/0002_operator_sessions.sql \
    2>&1
)"
replay_status=$?
set -e

printf '%s\n' "$replay_output"
if [[ "$replay_status" -eq 0 ]]; then
  echo "Replaying PostgreSQL backoffice migration 0002 unexpectedly committed." >&2
  exit 1
fi
grep -F 'relation "schema_migrations" already exists' <<<"$replay_output" >/dev/null

run_psql -v ON_ERROR_STOP=1 -Atq \
  -c "SELECT count(*) FROM backoffice_control.schema_migrations;" \
  | grep -Fx 2 >/dev/null

echo "backoffice-postgres-session-store-contract-ok"
