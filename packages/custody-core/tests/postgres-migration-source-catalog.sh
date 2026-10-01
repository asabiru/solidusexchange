#!/usr/bin/env bash

set -euo pipefail

workspace="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/custody-migration-source.XXXXXX")"
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
    echo "Invalid custody migration source catalog unexpectedly passed." >&2
    exit 1
  fi
  grep -F "$expected" <<<"$output"
}

node "$workspace/scripts/verify-postgres-migration-source-catalog.mjs"

mkdir "$scratch/changed"
cp -R "$workspace/migrations/." "$scratch/changed/"
printf '\n-- unreviewed source drift\n' \
  >>"$scratch/changed/0001_custody_projection_outbox.sql"
assert_source_catalog_rejected \
  "PostgreSQL custody migration source digest differs for 0001_custody_projection_outbox.sql" \
  "$scratch/changed"

mkdir "$scratch/missing"
assert_source_catalog_rejected \
  "PostgreSQL custody migration source files differ from canonical manifest" \
  "$scratch/missing"

mkdir "$scratch/extra"
cp -R "$workspace/migrations/." "$scratch/extra/"
cp \
  "$scratch/extra/0001_custody_projection_outbox.sql" \
  "$scratch/extra/9999_unreviewed_migration.sql"
assert_source_catalog_rejected \
  "PostgreSQL custody migration source files differ from canonical manifest" \
  "$scratch/extra"

echo "custody-postgres-migration-source-catalog-negative-ok"
