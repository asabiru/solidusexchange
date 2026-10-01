#!/usr/bin/env bash

set -euo pipefail

workspace="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/custody-migration-policy.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT

assert_source_policy_rejected() {
  local expected="$1"
  local directory="$2"
  local output
  local status

  set +e
  output="$(
    node "$workspace/scripts/verify-postgres-migration-source-policy.mjs" \
      "$directory" \
      2>&1
  )"
  status=$?
  set -e

  printf '%s\n' "$output"
  if [[ "$status" -eq 0 ]]; then
    echo "Invalid custody migration source policy unexpectedly passed." >&2
    exit 1
  fi
  grep -F "$expected" <<<"$output"
}

node "$workspace/scripts/verify-postgres-migration-source-policy.mjs"

mkdir "$scratch/non-atomic"
cp -R "$workspace/migrations/." "$scratch/non-atomic/"
tail -n +2 "$scratch/non-atomic/0001_custody_projection_outbox.sql" \
  >"$scratch/non-atomic/0001_custody_projection_outbox.sql.tmp"
mv \
  "$scratch/non-atomic/0001_custody_projection_outbox.sql.tmp" \
  "$scratch/non-atomic/0001_custody_projection_outbox.sql"
assert_source_policy_rejected \
  "PostgreSQL custody migration must contain exactly one top-level BEGIN and COMMIT transaction boundary: 0001_custody_projection_outbox.sql" \
  "$scratch/non-atomic"

mkdir "$scratch/hidden-rollback"
cp -R "$workspace/migrations/." "$scratch/hidden-rollback/"
sed -i \
  "/^COMMIT;$/i ROLLBACK;" \
  "$scratch/hidden-rollback/0001_custody_projection_outbox.sql"
assert_source_policy_rejected \
  "PostgreSQL custody migration must contain exactly one top-level BEGIN and COMMIT transaction boundary: 0001_custody_projection_outbox.sql" \
  "$scratch/hidden-rollback"

mkdir "$scratch/psql-meta-command"
cp -R "$workspace/migrations/." "$scratch/psql-meta-command/"
sed -i \
  '/^COMMIT;$/i\\\\ir unreviewed.sql' \
  "$scratch/psql-meta-command/0001_custody_projection_outbox.sql"
assert_source_policy_rejected \
  "PostgreSQL custody migration must not execute psql meta-commands: 0001_custody_projection_outbox.sql" \
  "$scratch/psql-meta-command"

mkdir "$scratch/non-canonical"
cp -R "$workspace/migrations/." "$scratch/non-canonical/"
mv \
  "$scratch/non-canonical/0001_custody_projection_outbox.sql" \
  "$scratch/non-canonical/1_custody_projection_outbox.sql"
assert_source_policy_rejected \
  "PostgreSQL custody migration filename is not canonical: 1_custody_projection_outbox.sql" \
  "$scratch/non-canonical"

mkdir "$scratch/non-contiguous"
cp -R "$workspace/migrations/." "$scratch/non-contiguous/"
mv \
  "$scratch/non-contiguous/0002_custody_migration_history.sql" \
  "$scratch/non-contiguous/0003_custody_migration_history.sql"
assert_source_policy_rejected \
  "PostgreSQL custody migration source versions must form a contiguous sequence starting at 0001" \
  "$scratch/non-contiguous"

mkdir "$scratch/missing-history-bootstrap"
cp -R "$workspace/migrations/." "$scratch/missing-history-bootstrap/"
rm "$scratch/missing-history-bootstrap/0002_custody_migration_history.sql"
assert_source_policy_rejected \
  "PostgreSQL custody migration source policy requires the history bootstrap migration 0002" \
  "$scratch/missing-history-bootstrap"

mkdir "$scratch/wrong-history"
cp -R "$workspace/migrations/." "$scratch/wrong-history/"
sed -i \
  "s/VALUES (2, '0002_custody_migration_history');/VALUES (3, '0002_custody_migration_history');/" \
  "$scratch/wrong-history/0002_custody_migration_history.sql"
assert_source_policy_rejected \
  "PostgreSQL custody migration history rows must match canonical source history: 0002_custody_migration_history.sql" \
  "$scratch/wrong-history"

mkdir "$scratch/missing-baseline-history"
cp -R "$workspace/migrations/." "$scratch/missing-baseline-history/"
sed -i \
  "/^VALUES (1, '0001_custody_projection_outbox');$/d; /^INSERT INTO custody_core.schema_migrations (version, migration_name)$/{N; /\\nVALUES (2, /!d}" \
  "$scratch/missing-baseline-history/0002_custody_migration_history.sql"
assert_source_policy_rejected \
  "PostgreSQL custody migration history rows must match canonical source history: 0002_custody_migration_history.sql" \
  "$scratch/missing-baseline-history"

mkdir "$scratch/pre-history-row"
cp -R "$workspace/migrations/." "$scratch/pre-history-row/"
sed -i \
  "/^COMMIT;$/i INSERT INTO custody_core.schema_migrations (version, migration_name)\\nVALUES (1, '0001_custody_projection_outbox');" \
  "$scratch/pre-history-row/0001_custody_projection_outbox.sql"
assert_source_policy_rejected \
  "PostgreSQL custody migration history rows must match canonical source history: 0001_custody_projection_outbox.sql" \
  "$scratch/pre-history-row"

mkdir "$scratch/history-rewrite"
cp -R "$workspace/migrations/." "$scratch/history-rewrite/"
sed -i \
  "/^COMMIT;$/i UPDATE custody_core.schema_migrations SET applied_at = now();" \
  "$scratch/history-rewrite/0002_custody_migration_history.sql"
assert_source_policy_rejected \
  "PostgreSQL custody migration must change history only through canonical history rows: 0002_custody_migration_history.sql" \
  "$scratch/history-rewrite"

mkdir "$scratch/duplicate-history-table"
cp -R "$workspace/migrations/." "$scratch/duplicate-history-table/"
sed -i \
  "/^COMMIT;$/i CREATE TABLE IF NOT EXISTS custody_core.schema_migrations (version integer);" \
  "$scratch/duplicate-history-table/0001_custody_projection_outbox.sql"
assert_source_policy_rejected \
  "PostgreSQL custody migration history table must be created only by the history bootstrap migration: 0001_custody_projection_outbox.sql" \
  "$scratch/duplicate-history-table"

echo "custody-postgres-migration-source-policy-negative-ok"
