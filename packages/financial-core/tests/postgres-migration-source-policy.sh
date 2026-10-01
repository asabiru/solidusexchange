#!/usr/bin/env bash

set -euo pipefail

workspace="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/solidchange-migration-policy.XXXXXX")"
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
    echo "Invalid PostgreSQL migration source policy unexpectedly passed." >&2
    exit 1
  fi
  grep -F "$expected" <<<"$output"
}

node "$workspace/scripts/verify-postgres-migration-source-policy.mjs"

mkdir "$scratch/non-atomic"
cp -R "$workspace/migrations/." "$scratch/non-atomic/"
tail -n +2 "$scratch/non-atomic/0001_ledger_foundation.sql" \
  > "$scratch/non-atomic/0001_ledger_foundation.sql.tmp"
mv \
  "$scratch/non-atomic/0001_ledger_foundation.sql.tmp" \
  "$scratch/non-atomic/0001_ledger_foundation.sql"
assert_source_policy_rejected \
  "PostgreSQL migration must contain exactly one top-level BEGIN and COMMIT transaction boundary: 0001_ledger_foundation.sql" \
  "$scratch/non-atomic"

mkdir "$scratch/wrong-history"
cp -R "$workspace/migrations/." "$scratch/wrong-history/"
sed -i \
  "s/VALUES (2, '0002_ledger_verification_views');/VALUES (3, '0002_ledger_verification_views');/" \
  "$scratch/wrong-history/0002_ledger_verification_views.sql"
assert_source_policy_rejected \
  "PostgreSQL migration history row must match its filename: 0002_ledger_verification_views.sql" \
  "$scratch/wrong-history"

mkdir "$scratch/duplicate-history"
cp -R "$workspace/migrations/." "$scratch/duplicate-history/"
sed -i \
  "/^COMMIT;$/i INSERT INTO financial_core.schema_migrations (version, migration_name)\\nVALUES (2, '0002_ledger_verification_views');" \
  "$scratch/duplicate-history/0002_ledger_verification_views.sql"
assert_source_policy_rejected \
  "PostgreSQL migration must record exactly one canonical history row: 0002_ledger_verification_views.sql" \
  "$scratch/duplicate-history"

mkdir "$scratch/non-contiguous"
cp -R "$workspace/migrations/." "$scratch/non-contiguous/"
mv \
  "$scratch/non-contiguous/0003_ledger_acceptance_seal.sql" \
  "$scratch/non-contiguous/0012_ledger_acceptance_seal.sql"
assert_source_policy_rejected \
  "PostgreSQL migration source versions must form a contiguous sequence starting at 0001" \
  "$scratch/non-contiguous"

echo "postgres-migration-source-policy-negative-ok"
