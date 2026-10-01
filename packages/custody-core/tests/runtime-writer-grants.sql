\if :{?custody_runtime_role}
\else
\echo 'custody_runtime_role is required'
SELECT 1 / 0;
\endif

SELECT set_config(
  'custody_core.runtime_role',
  :'custody_runtime_role',
  FALSE
);

DO $$
DECLARE
  runtime_role text := current_setting('custody_core.runtime_role');
BEGIN
  IF runtime_role = CURRENT_USER THEN
    RAISE EXCEPTION 'custody runtime writer must not be the migration owner';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = runtime_role
      AND rolcanlogin = false
      AND rolsuper = false
      AND rolcreatedb = false
      AND rolcreaterole = false
      AND rolinherit = false
      AND rolreplication = false
      AND rolbypassrls = false
  ) THEN
    RAISE EXCEPTION 'custody runtime writer must be an existing unprivileged role';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS member
      ON member.oid = membership.member
    WHERE member.rolname = runtime_role
  ) THEN
    RAISE EXCEPTION 'custody runtime writer must not inherit or assume another role';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    JOIN pg_catalog.pg_roles AS owner
      ON owner.oid = relation.relowner
    WHERE namespace.nspname = 'custody_core'
      AND owner.rolname = runtime_role
  ) THEN
    RAISE EXCEPTION 'custody runtime writer must not own custody_core objects';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace AS namespace
    JOIN pg_catalog.pg_roles AS owner
      ON owner.oid = namespace.nspowner
    WHERE namespace.nspname = 'custody_core'
      AND owner.rolname = runtime_role
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    JOIN pg_catalog.pg_roles AS owner
      ON owner.oid = procedure.proowner
    WHERE namespace.nspname = 'custody_core'
      AND owner.rolname = runtime_role
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_database AS database
    JOIN pg_catalog.pg_roles AS owner
      ON owner.oid = database.datdba
    WHERE database.datname = current_database()
      AND owner.rolname = runtime_role
  ) THEN
    RAISE EXCEPTION 'custody runtime writer must not own custody_core objects';
  END IF;
END;
$$;

BEGIN;

REVOKE ALL PRIVILEGES ON SCHEMA custody_core
  FROM :"custody_runtime_role";
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA custody_core
  FROM :"custody_runtime_role";
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA custody_core
  FROM :"custody_runtime_role";

GRANT USAGE ON SCHEMA custody_core
  TO :"custody_runtime_role";
GRANT EXECUTE ON FUNCTION custody_core.record_custody_projection(jsonb, text)
  TO :"custody_runtime_role";

COMMIT;
