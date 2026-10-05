\if :{?custody_runtime_role}
\else
\echo 'custody_runtime_role is required'
SELECT 1 / 0;
\endif

WITH runtime_role AS (
  SELECT
    role.oid,
    role.rolsuper,
    role.rolinherit,
    role.rolcreaterole,
    role.rolcreatedb,
    role.rolcanlogin,
    role.rolreplication,
    role.rolconnlimit,
    role.rolbypassrls,
    role.rolconfig
  FROM pg_catalog.pg_roles AS role
  WHERE role.rolname = :'custody_runtime_role'
),
grantees (oid, label) AS (
  SELECT runtime_role.oid, 'runtime' FROM runtime_role
  UNION ALL
  SELECT 0::OID, 'public'
),
database_grants AS (
  SELECT
    'database' AS object_type,
    'current_database' AS object_name,
    NULL::TEXT AS column_name,
    acl.grantee,
    acl.privilege_type,
    acl.is_grantable
  FROM pg_catalog.pg_database AS database
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(
      database.datacl,
      pg_catalog.acldefault('d', database.datdba)
    )
  ) AS acl
  WHERE database.datname = current_database()
),
schema_grants AS (
  SELECT
    'schema' AS object_type,
    namespace.nspname::TEXT AS object_name,
    NULL::TEXT AS column_name,
    acl.grantee,
    acl.privilege_type,
    acl.is_grantable
  FROM pg_catalog.pg_namespace AS namespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(
      namespace.nspacl,
      pg_catalog.acldefault('n', namespace.nspowner)
    )
  ) AS acl
  WHERE namespace.nspname = 'custody_core'
),
relation_grants AS (
  SELECT
    CASE relation.relkind
      WHEN 'r' THEN 'table'
      WHEN 'p' THEN 'table'
      WHEN 'v' THEN 'view'
      WHEN 'm' THEN 'materialized_view'
      WHEN 'S' THEN 'sequence'
      WHEN 'f' THEN 'foreign_table'
      ELSE relation.relkind::TEXT
    END AS object_type,
    relation.relname::TEXT AS object_name,
    NULL::TEXT AS column_name,
    acl.grantee,
    acl.privilege_type,
    acl.is_grantable
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(
      relation.relacl,
      pg_catalog.acldefault(
        CASE WHEN relation.relkind = 'S' THEN 's' ELSE 'r' END::"char",
        relation.relowner
      )
    )
  ) AS acl
  WHERE namespace.nspname = 'custody_core'
    AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
),
column_grants AS (
  SELECT
    'column' AS object_type,
    relation.relname::TEXT AS object_name,
    attribute.attname::TEXT AS column_name,
    acl.grantee,
    acl.privilege_type,
    acl.is_grantable
  FROM pg_catalog.pg_attribute AS attribute
  JOIN pg_catalog.pg_class AS relation
    ON relation.oid = attribute.attrelid
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
  WHERE namespace.nspname = 'custody_core'
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
),
function_grants AS (
  SELECT
    'function' AS object_type,
    procedure.proname::TEXT || '('
      || pg_catalog.pg_get_function_identity_arguments(procedure.oid)
      || ')' AS object_name,
    NULL::TEXT AS column_name,
    acl.grantee,
    acl.privilege_type,
    acl.is_grantable
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = procedure.pronamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(
      procedure.proacl,
      pg_catalog.acldefault('f', procedure.proowner)
    )
  ) AS acl
  WHERE namespace.nspname = 'custody_core'
),
type_grants AS (
  SELECT
    'type' AS object_type,
    type.typname::TEXT AS object_name,
    NULL::TEXT AS column_name,
    acl.grantee,
    acl.privilege_type,
    acl.is_grantable
  FROM pg_catalog.pg_type AS type
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = type.typnamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(type.typacl) AS acl
  WHERE namespace.nspname = 'custody_core'
),
all_grants AS (
  SELECT * FROM database_grants
  UNION ALL
  SELECT * FROM schema_grants
  UNION ALL
  SELECT * FROM relation_grants
  UNION ALL
  SELECT * FROM column_grants
  UNION ALL
  SELECT * FROM function_grants
  UNION ALL
  SELECT * FROM type_grants
),
effective_grants AS (
  SELECT
    all_grants.object_type,
    all_grants.object_name,
    all_grants.column_name,
    grantees.label AS grantee,
    all_grants.privilege_type AS privilege,
    all_grants.is_grantable AS grantable
  FROM all_grants
  JOIN grantees
    ON grantees.oid = all_grants.grantee
),
default_privileges AS (
  SELECT
    CASE
      WHEN default_acl.defaclnamespace = 0 THEN 'global'
      ELSE namespace.nspname::TEXT
    END AS scope,
    default_acl.defaclobjtype::TEXT AS object_type,
    pg_catalog.pg_get_userbyid(default_acl.defaclrole) =
      :'custody_runtime_role' AS defined_by_runtime,
    grantees.label AS grantee,
    acl.privilege_type AS privilege,
    acl.is_grantable AS grantable
  FROM pg_catalog.pg_default_acl AS default_acl
  LEFT JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = default_acl.defaclnamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(default_acl.defaclacl) AS acl
  JOIN grantees
    ON grantees.oid = acl.grantee
  WHERE default_acl.defaclnamespace = 0
     OR namespace.nspname = 'custody_core'
),
runtime_memberships AS (
  SELECT
    granted_role.rolname::TEXT AS role_name,
    membership.admin_option,
    membership.inherit_option,
    membership.set_option
  FROM pg_catalog.pg_auth_members AS membership
  JOIN runtime_role
    ON runtime_role.oid = membership.member
  JOIN pg_catalog.pg_roles AS granted_role
    ON granted_role.oid = membership.roleid
),
runtime_ownership AS (
  SELECT
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_database AS database
      JOIN runtime_role
        ON runtime_role.oid = database.datdba
      WHERE database.datname = current_database()
    ) AS database,
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_namespace AS namespace
      JOIN runtime_role
        ON runtime_role.oid = namespace.nspowner
      WHERE namespace.nspname = 'custody_core'
    ) OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      JOIN runtime_role
        ON runtime_role.oid = relation.relowner
      WHERE namespace.nspname = 'custody_core'
    ) OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      JOIN runtime_role
        ON runtime_role.oid = procedure.proowner
      WHERE namespace.nspname = 'custody_core'
    ) OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_type AS type
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = type.typnamespace
      JOIN runtime_role
        ON runtime_role.oid = type.typowner
      WHERE namespace.nspname = 'custody_core'
    ) AS custody_objects
)
SELECT jsonb_build_object(
  'runtime_role', COALESCE(
    (
      SELECT jsonb_build_object(
        'exists', TRUE,
        'superuser', runtime_role.rolsuper,
        'inherit', runtime_role.rolinherit,
        'create_role', runtime_role.rolcreaterole,
        'create_database', runtime_role.rolcreatedb,
        'can_login', runtime_role.rolcanlogin,
        'replication', runtime_role.rolreplication,
        'connection_limit', runtime_role.rolconnlimit,
        'bypass_row_security', runtime_role.rolbypassrls,
        'configuration', COALESCE(to_jsonb(runtime_role.rolconfig), '[]'::JSONB),
        'database_configuration', COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'database', COALESCE(database.datname::TEXT, setting.setdatabase::TEXT),
                'setting', configuration.setting
              )
              ORDER BY
                COALESCE(database.datname::TEXT, setting.setdatabase::TEXT) COLLATE "C",
                configuration.ordinality
            )
            FROM pg_catalog.pg_db_role_setting AS setting
            LEFT JOIN pg_catalog.pg_database AS database
              ON database.oid = setting.setdatabase
            CROSS JOIN LATERAL unnest(setting.setconfig)
              WITH ORDINALITY AS configuration(setting, ordinality)
            WHERE setting.setrole = runtime_role.oid
              AND setting.setdatabase <> 0
          ),
          '[]'::JSONB
        ),
        'memberships', COALESCE(
          (
            SELECT jsonb_agg(
              to_jsonb(runtime_memberships)
              ORDER BY runtime_memberships.role_name COLLATE "C"
            )
            FROM runtime_memberships
          ),
          '[]'::JSONB
        ),
        'owns_database', runtime_ownership.database,
        'owns_custody_objects', runtime_ownership.custody_objects
      )
      FROM runtime_role
      CROSS JOIN runtime_ownership
    ),
    jsonb_build_object('exists', FALSE)
  ),
  'grants', COALESCE(
    (
      SELECT jsonb_agg(
        to_jsonb(effective_grants)
        ORDER BY
          effective_grants.object_type COLLATE "C",
          effective_grants.object_name COLLATE "C",
          effective_grants.column_name COLLATE "C" NULLS FIRST,
          effective_grants.grantee COLLATE "C",
          effective_grants.privilege COLLATE "C",
          effective_grants.grantable
      )
      FROM effective_grants
    ),
    '[]'::JSONB
  ),
  'default_privileges', COALESCE(
    (
      SELECT jsonb_agg(
        to_jsonb(default_privileges)
        ORDER BY
          default_privileges.scope COLLATE "C",
          default_privileges.object_type COLLATE "C",
          default_privileges.grantee COLLATE "C",
          default_privileges.privilege COLLATE "C"
      )
      FROM default_privileges
    ),
    '[]'::JSONB
  )
)::TEXT;
