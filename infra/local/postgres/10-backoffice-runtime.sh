#!/bin/sh
# Runs once on first database initialisation, after the backoffice migration.
# Creates the least-privilege runtime role documented in backoffice/README.md.
set -eu

runtime_password=$(cat /run/solidchange-dev/audit-db-runtime.password)

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  -v runtime_password="$runtime_password" <<'SQL'
CREATE ROLE backoffice_runtime LOGIN PASSWORD :'runtime_password';
GRANT USAGE ON SCHEMA backoffice_control TO backoffice_runtime;
GRANT SELECT ON backoffice_control.audit_schema TO backoffice_runtime;
GRANT SELECT, INSERT ON backoffice_control.audit_events TO backoffice_runtime;
SQL
