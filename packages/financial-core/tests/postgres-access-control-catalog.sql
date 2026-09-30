WITH schema_rows AS (
  SELECT jsonb_build_object(
    'schema_name', namespace.nspname,
    'owner_is_current_user',
      pg_catalog.pg_get_userbyid(namespace.nspowner) = CURRENT_USER,
    'acl', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'grantee', CASE
              WHEN acl.grantee = 0 THEN 'public'
              WHEN acl.grantee = namespace.nspowner THEN 'owner'
              ELSE 'non_owner'
            END,
            'grantor', CASE
              WHEN acl.grantor = namespace.nspowner THEN 'owner'
              ELSE 'non_owner'
            END,
            'privilege', acl.privilege_type,
            'grantable', acl.is_grantable
          )
          ORDER BY
            acl.privilege_type COLLATE "C",
            acl.grantee,
            acl.grantor,
            acl.is_grantable
        )
        FROM pg_catalog.aclexplode(
          COALESCE(
            namespace.nspacl,
            pg_catalog.acldefault('n', namespace.nspowner)
          )
        ) AS acl
      ),
      '[]'::JSONB
    )
  ) AS value
  FROM pg_catalog.pg_namespace AS namespace
  WHERE namespace.nspname = 'financial_core'
),
relation_rows AS (
  SELECT jsonb_build_object(
    'relation_name', relation.relname,
    'relation_type', CASE relation.relkind
      WHEN 'r' THEN 'table'
      WHEN 'v' THEN 'view'
      ELSE relation.relkind::TEXT
    END,
    'owner_is_current_user',
      pg_catalog.pg_get_userbyid(relation.relowner) = CURRENT_USER,
    'acl', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'grantee', CASE
              WHEN acl.grantee = 0 THEN 'public'
              WHEN acl.grantee = relation.relowner THEN 'owner'
              ELSE 'non_owner'
            END,
            'grantor', CASE
              WHEN acl.grantor = relation.relowner THEN 'owner'
              ELSE 'non_owner'
            END,
            'privilege', acl.privilege_type,
            'grantable', acl.is_grantable
          )
          ORDER BY
            acl.privilege_type COLLATE "C",
            acl.grantee,
            acl.grantor,
            acl.is_grantable
        )
        FROM pg_catalog.aclexplode(
          COALESCE(
            relation.relacl,
            pg_catalog.acldefault('r', relation.relowner)
          )
        ) AS acl
      ),
      '[]'::JSONB
    )
  ) AS value
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'financial_core'
    AND relation.relkind IN ('r', 'v')
),
function_rows AS (
  SELECT jsonb_build_object(
    'function_name', procedure.proname,
    'identity_arguments',
      pg_catalog.pg_get_function_identity_arguments(procedure.oid),
    'owner_is_current_user',
      pg_catalog.pg_get_userbyid(procedure.proowner) = CURRENT_USER,
    'acl', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'grantee', CASE
              WHEN acl.grantee = 0 THEN 'public'
              WHEN acl.grantee = procedure.proowner THEN 'owner'
              ELSE 'non_owner'
            END,
            'grantor', CASE
              WHEN acl.grantor = procedure.proowner THEN 'owner'
              ELSE 'non_owner'
            END,
            'privilege', acl.privilege_type,
            'grantable', acl.is_grantable
          )
          ORDER BY
            acl.privilege_type COLLATE "C",
            acl.grantee,
            acl.grantor,
            acl.is_grantable
        )
        FROM pg_catalog.aclexplode(
          COALESCE(
            procedure.proacl,
            pg_catalog.acldefault('f', procedure.proowner)
          )
        ) AS acl
      ),
      '[]'::JSONB
    )
  ) AS value
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'financial_core'
),
column_rows AS (
  SELECT jsonb_build_object(
    'relation_name', relation.relname,
    'column_name', attribute.attname,
    'acl', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'grantee', CASE
              WHEN acl.grantee = 0 THEN 'public'
              WHEN acl.grantee = relation.relowner THEN 'owner'
              ELSE 'non_owner'
            END,
            'grantor', CASE
              WHEN acl.grantor = relation.relowner THEN 'owner'
              ELSE 'non_owner'
            END,
            'privilege', acl.privilege_type,
            'grantable', acl.is_grantable
          )
          ORDER BY
            acl.privilege_type COLLATE "C",
            acl.grantee,
            acl.grantor,
            acl.is_grantable
        )
        FROM pg_catalog.aclexplode(attribute.attacl) AS acl
      ),
      '[]'::JSONB
    )
  ) AS value
  FROM pg_catalog.pg_attribute AS attribute
  JOIN pg_catalog.pg_class AS relation
    ON relation.oid = attribute.attrelid
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'financial_core'
    AND relation.relkind IN ('r', 'v')
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
),
default_acl_rows AS (
  SELECT jsonb_build_object(
    'scope', CASE
      WHEN default_acl.defaclnamespace = 0 THEN 'global'
      ELSE namespace.nspname
    END,
    'object_type', CASE default_acl.defaclobjtype
      WHEN 'f' THEN 'function'
      WHEN 'r' THEN 'table'
      WHEN 'S' THEN 'sequence'
      WHEN 'T' THEN 'type'
      ELSE default_acl.defaclobjtype::TEXT
    END,
    'acl', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'grantee', CASE
              WHEN acl.grantee = 0 THEN 'public'
              WHEN acl.grantee = default_acl.defaclrole THEN 'owner'
              ELSE 'non_owner'
            END,
            'grantor', CASE
              WHEN acl.grantor = default_acl.defaclrole THEN 'owner'
              ELSE 'non_owner'
            END,
            'privilege', acl.privilege_type,
            'grantable', acl.is_grantable
          )
          ORDER BY
            acl.privilege_type COLLATE "C",
            acl.grantee,
            acl.grantor,
            acl.is_grantable
        )
        FROM pg_catalog.aclexplode(default_acl.defaclacl) AS acl
      ),
      '[]'::JSONB
    )
  ) AS value
  FROM pg_catalog.pg_default_acl AS default_acl
  LEFT JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = default_acl.defaclnamespace
  WHERE default_acl.defaclrole =
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = CURRENT_USER)
    AND (
      default_acl.defaclnamespace = 0
      OR namespace.nspname = 'financial_core'
    )
)
SELECT jsonb_build_object(
  'schemas', COALESCE(
    (
      SELECT jsonb_agg(
        schema_rows.value
        ORDER BY schema_rows.value ->> 'schema_name' COLLATE "C"
      )
      FROM schema_rows
    ),
    '[]'::JSONB
  ),
  'relations', COALESCE(
    (
      SELECT jsonb_agg(
        relation_rows.value
        ORDER BY relation_rows.value ->> 'relation_name' COLLATE "C"
      )
      FROM relation_rows
    ),
    '[]'::JSONB
  ),
  'functions', COALESCE(
    (
      SELECT jsonb_agg(
        function_rows.value
        ORDER BY
          function_rows.value ->> 'function_name' COLLATE "C",
          function_rows.value ->> 'identity_arguments' COLLATE "C"
      )
      FROM function_rows
    ),
    '[]'::JSONB
  ),
  'columns', COALESCE(
    (
      SELECT jsonb_agg(
        column_rows.value
        ORDER BY
          column_rows.value ->> 'relation_name' COLLATE "C",
          column_rows.value ->> 'column_name' COLLATE "C"
      )
      FROM column_rows
    ),
    '[]'::JSONB
  ),
  'default_privileges', COALESCE(
    (
      SELECT jsonb_agg(
        default_acl_rows.value
        ORDER BY
          default_acl_rows.value ->> 'scope' COLLATE "C",
          default_acl_rows.value ->> 'object_type' COLLATE "C"
      )
      FROM default_acl_rows
    ),
    '[]'::JSONB
  )
)::TEXT;
