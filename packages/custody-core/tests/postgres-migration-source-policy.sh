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
  "$scratch/non-contiguous/0001_custody_projection_outbox.sql" \
  "$scratch/non-contiguous/0002_custody_projection_outbox.sql"
assert_source_policy_rejected \
  "PostgreSQL custody migration source versions must form a contiguous sequence starting at 0001" \
  "$scratch/non-contiguous"

echo "custody-postgres-migration-source-policy-negative-ok"
