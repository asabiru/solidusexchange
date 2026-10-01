\if :{?ledger_runtime_role}
\else
\echo 'ledger_runtime_role is required'
SELECT 1 / 0;
\endif

WITH runtime_role AS (
  SELECT role.oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = :'ledger_runtime_role'
),
runtime_memberships AS (
  SELECT
    parent_role.rolname::TEXT AS parent_role,
    grantor_role.rolname::TEXT AS grantor,
    membership.admin_option,
    membership.inherit_option,
    membership.set_option
  FROM pg_catalog.pg_auth_members AS membership
  JOIN runtime_role
    ON runtime_role.oid = membership.member
  JOIN pg_catalog.pg_roles AS parent_role
    ON parent_role.oid = membership.roleid
  JOIN pg_catalog.pg_roles AS grantor_role
    ON grantor_role.oid = membership.grantor
),
grantees (oid, label) AS (
  SELECT runtime_role.oid, 'runtime' FROM runtime_role
  UNION ALL
  SELECT 0::OID, 'public'
),
schema_grants AS (
  SELECT
    'schema' AS object_type,
    namespace.nspname AS object_name,
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
  WHERE namespace.nspname = 'financial_core'
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
  WHERE namespace.nspname = 'financial_core'
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
  WHERE namespace.nspname = 'financial_core'
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
  WHERE namespace.nspname = 'financial_core'
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
  WHERE namespace.nspname = 'financial_core'
),
all_grants AS (
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
      :'ledger_runtime_role' AS defined_by_runtime,
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
     OR namespace.nspname = 'financial_core'
)
SELECT jsonb_build_object(
  'runtime_role_exists', EXISTS (SELECT 1 FROM runtime_role),
  'memberships', COALESCE(
    (
      SELECT jsonb_agg(
        to_jsonb(runtime_memberships)
        ORDER BY
          runtime_memberships.parent_role COLLATE "C",
          runtime_memberships.grantor COLLATE "C",
          runtime_memberships.admin_option,
          runtime_memberships.inherit_option,
          runtime_memberships.set_option
      )
      FROM runtime_memberships
    ),
    '[]'::JSONB
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
