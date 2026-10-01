#!/usr/bin/env bash

set -euo pipefail

workspace="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/solidchange-migration-source.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT

assert_source_catalog_rejected() {
  local expected="$1"
  local directory="$2"
  local output
  local status

  set +e
  output="$(
    node "$workspace/scripts/verify-postgres-migration-source-catalog.mjs" \
      "$directory" \
      2>&1
  )"
  status=$?
  set -e

  printf '%s\n' "$output"
  if [[ "$status" -eq 0 ]]; then
    echo "Invalid PostgreSQL migration source catalog unexpectedly passed." >&2
    exit 1
  fi
  grep -F "$expected" <<<"$output"
}

node "$workspace/scripts/verify-postgres-migration-source-catalog.mjs"

mkdir "$scratch/changed"
cp -R "$workspace/migrations/." "$scratch/changed/"
printf '\n-- unreviewed source drift\n' \
  >> "$scratch/changed/0001_ledger_foundation.sql"
assert_source_catalog_rejected \
  "PostgreSQL migration source digest differs for 0001_ledger_foundation.sql" \
  "$scratch/changed"

mkdir "$scratch/missing"
cp -R "$workspace/migrations/." "$scratch/missing/"
rm "$scratch/missing/0011_ledger_migration_sequence_guard.sql"
assert_source_catalog_rejected \
  "PostgreSQL migration source files differ from canonical manifest" \
  "$scratch/missing"

mkdir "$scratch/extra"
cp -R "$workspace/migrations/." "$scratch/extra/"
cp \
  "$scratch/extra/0011_ledger_migration_sequence_guard.sql" \
  "$scratch/extra/9999_unreviewed_migration.sql"
assert_source_catalog_rejected \
  "PostgreSQL migration source files differ from canonical manifest" \
  "$scratch/extra"

echo "postgres-migration-source-catalog-negative-ok"
