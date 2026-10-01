\if :{?ledger_runtime_role}
\else
\echo 'ledger_runtime_role is required'
SELECT 1 / 0;
\endif

SELECT set_config(
  'financial_core.ledger_runtime_role',
  :'ledger_runtime_role',
  FALSE
);

DO $$
DECLARE
  runtime_role TEXT := current_setting('financial_core.ledger_runtime_role');
BEGIN
  IF runtime_role = CURRENT_USER THEN
    RAISE EXCEPTION 'runtime writer must not be the migration owner';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_roles
     WHERE rolname = runtime_role
       AND rolcanlogin = FALSE
       AND rolsuper = FALSE
       AND rolcreatedb = FALSE
       AND rolcreaterole = FALSE
       AND rolinherit = FALSE
       AND rolreplication = FALSE
       AND rolbypassrls = FALSE
       AND rolconfig IS NULL
  ) THEN
    RAISE EXCEPTION 'runtime writer must be an existing unprivileged role';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
      JOIN pg_catalog.pg_roles AS member
        ON member.oid = membership.member
     WHERE member.rolname = runtime_role
  ) THEN
    RAISE EXCEPTION 'runtime writer must not inherit or assume another role';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      JOIN pg_catalog.pg_roles AS owner
        ON owner.oid = relation.relowner
     WHERE namespace.nspname = 'financial_core'
       AND owner.rolname = runtime_role
  ) THEN
    RAISE EXCEPTION 'runtime writer must not own financial_core relations';
  END IF;
END;
$$;

BEGIN;

REVOKE ALL PRIVILEGES ON SCHEMA financial_core FROM :"ledger_runtime_role";
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA financial_core
  FROM :"ledger_runtime_role";
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA financial_core
  FROM :"ledger_runtime_role";

GRANT USAGE ON SCHEMA financial_core TO :"ledger_runtime_role";

GRANT SELECT ON TABLE
  financial_core.ledger_assets,
  financial_core.ledger_accounts,
  financial_core.posting_rule_registry,
  financial_core.ledger_journals,
  financial_core.ledger_entries,
  financial_core.ledger_idempotency_registry,
  financial_core.ledger_outbox_events,
  financial_core.ledger_journal_seals
TO :"ledger_runtime_role";

GRANT INSERT ON TABLE
  financial_core.ledger_journals,
  financial_core.ledger_entries,
  financial_core.ledger_idempotency_registry,
  financial_core.ledger_outbox_events,
  financial_core.ledger_journal_seals
TO :"ledger_runtime_role";

COMMIT;
