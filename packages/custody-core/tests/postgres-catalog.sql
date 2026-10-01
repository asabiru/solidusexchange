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
      '[]'::jsonb
    )
  ) AS value
  FROM pg_catalog.pg_namespace AS namespace
  WHERE namespace.nspname = 'custody_core'
),
relation_rows AS (
  SELECT jsonb_build_object(
    'relation_name', relation.relname,
    'relation_type', CASE relation.relkind
      WHEN 'r' THEN 'table'
      WHEN 'p' THEN 'partitioned_table'
      WHEN 'v' THEN 'view'
      WHEN 'm' THEN 'materialized_view'
      WHEN 'S' THEN 'sequence'
      WHEN 'f' THEN 'foreign_table'
      ELSE relation.relkind::text
    END,
    'persistence', CASE relation.relpersistence
      WHEN 'p' THEN 'permanent'
      WHEN 't' THEN 'temporary'
      WHEN 'u' THEN 'unlogged'
      ELSE relation.relpersistence::text
    END,
    'access_method', access_method.amname,
    'owner_is_current_user',
      pg_catalog.pg_get_userbyid(relation.relowner) = CURRENT_USER,
    'row_security', relation.relrowsecurity,
    'force_row_security', relation.relforcerowsecurity,
    'replica_identity', CASE relation.relreplident
      WHEN 'd' THEN 'default'
      WHEN 'f' THEN 'full'
      WHEN 'i' THEN 'index'
      WHEN 'n' THEN 'nothing'
      ELSE relation.relreplident::text
    END,
    'options', COALESCE(
      (
        SELECT jsonb_agg(option ORDER BY option COLLATE "C")
        FROM pg_catalog.unnest(relation.reloptions) AS option
      ),
      '[]'::jsonb
    ),
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
      '[]'::jsonb
    )
  ) AS value
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  LEFT JOIN pg_catalog.pg_am AS access_method
    ON access_method.oid = relation.relam
  WHERE namespace.nspname = 'custody_core'
    AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
),
column_rows AS (
  SELECT jsonb_build_object(
    'relation_name', relation.relname,
    'position', attribute.attnum,
    'column_name', attribute.attname,
    'data_type', pg_catalog.format_type(
      attribute.atttypid,
      attribute.atttypmod
    ),
    'not_null', attribute.attnotnull,
    'has_default', attribute.atthasdef,
    'default_sha256', CASE
      WHEN attribute_default.oid IS NOT NULL THEN pg_catalog.encode(
        pg_catalog.sha256(
          pg_catalog.convert_to(
            pg_catalog.pg_get_expr(
              attribute_default.adbin,
              attribute_default.adrelid,
              FALSE
            ),
            'UTF8'
          )
        ),
        'hex'
      )
      ELSE NULL
    END,
    'identity', CASE attribute.attidentity
      WHEN 'a' THEN 'always'
      WHEN 'd' THEN 'by_default'
      ELSE 'none'
    END,
    'generated', CASE attribute.attgenerated
      WHEN 's' THEN 'stored'
      ELSE 'none'
    END,
    'collation', CASE
      WHEN attribute.attcollation = 0 THEN NULL
      ELSE pg_catalog.format(
        '%I.%I',
        collation_namespace.nspname,
        catalog_collation.collname
      )
    END,
    'dimensions', attribute.attndims,
    'storage', CASE attribute.attstorage
      WHEN 'e' THEN 'external'
      WHEN 'm' THEN 'main'
      WHEN 'p' THEN 'plain'
      WHEN 'x' THEN 'extended'
      ELSE attribute.attstorage::text
    END,
    'compression', CASE attribute.attcompression
      WHEN 'l' THEN 'lz4'
      WHEN 'p' THEN 'pglz'
      ELSE 'default'
    END,
    'statistics_target', attribute.attstattarget,
    'local', attribute.attislocal,
    'inheritance_count', attribute.attinhcount,
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
      '[]'::jsonb
    )
  ) AS value
  FROM pg_catalog.pg_attribute AS attribute
  JOIN pg_catalog.pg_class AS relation
    ON relation.oid = attribute.attrelid
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  LEFT JOIN pg_catalog.pg_attrdef AS attribute_default
    ON attribute_default.adrelid = attribute.attrelid
   AND attribute_default.adnum = attribute.attnum
  LEFT JOIN pg_catalog.pg_collation AS catalog_collation
    ON catalog_collation.oid = attribute.attcollation
  LEFT JOIN pg_catalog.pg_namespace AS collation_namespace
    ON collation_namespace.oid = catalog_collation.collnamespace
  WHERE namespace.nspname = 'custody_core'
    AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
),
constraint_rows AS (
  SELECT jsonb_build_object(
    'relation_name', relation.relname,
    'constraint_name', constraint_record.conname,
    'constraint_type', CASE constraint_record.contype
      WHEN 'c' THEN 'check'
      WHEN 'p' THEN 'primary_key'
      WHEN 'u' THEN 'unique'
      ELSE constraint_record.contype::text
    END,
    'deferrable', constraint_record.condeferrable,
    'initially_deferred', constraint_record.condeferred,
    'validated', constraint_record.convalidated,
    'no_inherit', constraint_record.connoinherit,
    'index_unique', constraint_index.indisunique,
    'index_immediate', constraint_index.indimmediate,
    'index_valid', constraint_index.indisvalid,
    'index_ready', constraint_index.indisready,
    'index_live', constraint_index.indislive,
    'definition_sha256', pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(
          pg_catalog.pg_get_constraintdef(constraint_record.oid, FALSE),
          'UTF8'
        )
      ),
      'hex'
    )
  ) AS value
  FROM pg_catalog.pg_constraint AS constraint_record
  JOIN pg_catalog.pg_class AS relation
    ON relation.oid = constraint_record.conrelid
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  LEFT JOIN pg_catalog.pg_index AS constraint_index
    ON constraint_index.indexrelid = constraint_record.conindid
  WHERE namespace.nspname = 'custody_core'
),
index_rows AS (
  SELECT jsonb_build_object(
    'table_name', relation.relname,
    'index_name', index_relation.relname,
    'unique', index_record.indisunique,
    'immediate', index_record.indimmediate,
    'valid', index_record.indisvalid,
    'ready', index_record.indisready,
    'live', index_record.indislive,
    'clustered', index_record.indisclustered,
    'replica_identity', index_record.indisreplident,
    'nulls_not_distinct', index_record.indnullsnotdistinct,
    'definition_sha256', pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(
          pg_catalog.pg_get_indexdef(index_relation.oid),
          'UTF8'
        )
      ),
      'hex'
    )
  ) AS value
  FROM pg_catalog.pg_index AS index_record
  JOIN pg_catalog.pg_class AS relation
    ON relation.oid = index_record.indrelid
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  JOIN pg_catalog.pg_class AS index_relation
    ON index_relation.oid = index_record.indexrelid
  WHERE namespace.nspname = 'custody_core'
),
trigger_rows AS (
  SELECT jsonb_build_object(
    'table_name', relation.relname,
    'trigger_name', trigger_record.tgname,
    'enabled', trigger_record.tgenabled,
    'row_level', (trigger_record.tgtype::integer & 1) <> 0,
    'before', (trigger_record.tgtype::integer & 2) <> 0,
    'events', to_jsonb(array_remove(ARRAY[
      CASE WHEN (trigger_record.tgtype::integer & 4) <> 0 THEN 'INSERT' END,
      CASE WHEN (trigger_record.tgtype::integer & 8) <> 0 THEN 'DELETE' END,
      CASE WHEN (trigger_record.tgtype::integer & 16) <> 0 THEN 'UPDATE' END,
      CASE WHEN (trigger_record.tgtype::integer & 32) <> 0 THEN 'TRUNCATE' END
    ], NULL)),
    'function_schema', function_namespace.nspname,
    'function_name', trigger_function.proname,
    'definition_sha256', pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(
          pg_catalog.pg_get_triggerdef(trigger_record.oid, FALSE),
          'UTF8'
        )
      ),
      'hex'
    )
  ) AS value
  FROM pg_catalog.pg_trigger AS trigger_record
  JOIN pg_catalog.pg_class AS relation
    ON relation.oid = trigger_record.tgrelid
  JOIN pg_catalog.pg_namespace AS relation_namespace
    ON relation_namespace.oid = relation.relnamespace
  JOIN pg_catalog.pg_proc AS trigger_function
    ON trigger_function.oid = trigger_record.tgfoid
  JOIN pg_catalog.pg_namespace AS function_namespace
    ON function_namespace.oid = trigger_function.pronamespace
  WHERE relation_namespace.nspname = 'custody_core'
    AND trigger_record.tgisinternal = FALSE
),
function_rows AS (
  SELECT jsonb_build_object(
    'function_name', procedure.proname,
    'identity_arguments',
      pg_catalog.pg_get_function_identity_arguments(procedure.oid),
    'language', language.lanname,
    'return_type', pg_catalog.pg_get_function_result(procedure.oid),
    'owner_is_current_user',
      pg_catalog.pg_get_userbyid(procedure.proowner) = CURRENT_USER,
    'security_definer', procedure.prosecdef,
    'leakproof', procedure.proleakproof,
    'strict', procedure.proisstrict,
    'volatility', CASE procedure.provolatile
      WHEN 'i' THEN 'immutable'
      WHEN 's' THEN 'stable'
      WHEN 'v' THEN 'volatile'
    END,
    'parallel', CASE procedure.proparallel
      WHEN 's' THEN 'safe'
      WHEN 'r' THEN 'restricted'
      WHEN 'u' THEN 'unsafe'
    END,
    'config', COALESCE(to_jsonb(procedure.proconfig), '[]'::jsonb),
    'source_sha256', pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(procedure.prosrc, 'UTF8')
      ),
      'hex'
    ),
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
      '[]'::jsonb
    )
  ) AS value
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = procedure.pronamespace
  JOIN pg_catalog.pg_language AS language
    ON language.oid = procedure.prolang
  WHERE namespace.nspname = 'custody_core'
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
      ELSE default_acl.defaclobjtype::text
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
      '[]'::jsonb
    )
  ) AS value
  FROM pg_catalog.pg_default_acl AS default_acl
  LEFT JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = default_acl.defaclnamespace
  WHERE default_acl.defaclrole =
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = CURRENT_USER)
    AND (
      default_acl.defaclnamespace = 0
      OR namespace.nspname = 'custody_core'
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
    '[]'::jsonb
  ),
  'relations', COALESCE(
    (
      SELECT jsonb_agg(
        relation_rows.value
        ORDER BY relation_rows.value ->> 'relation_name' COLLATE "C"
      )
      FROM relation_rows
    ),
    '[]'::jsonb
  ),
  'columns', COALESCE(
    (
      SELECT jsonb_agg(
        column_rows.value
        ORDER BY
          column_rows.value ->> 'relation_name' COLLATE "C",
          (column_rows.value ->> 'position')::integer
      )
      FROM column_rows
    ),
    '[]'::jsonb
  ),
  'constraints', COALESCE(
    (
      SELECT jsonb_agg(
        constraint_rows.value
        ORDER BY
          constraint_rows.value ->> 'relation_name' COLLATE "C",
          constraint_rows.value ->> 'constraint_name' COLLATE "C"
      )
      FROM constraint_rows
    ),
    '[]'::jsonb
  ),
  'indexes', COALESCE(
    (
      SELECT jsonb_agg(
        index_rows.value
        ORDER BY
          index_rows.value ->> 'table_name' COLLATE "C",
          index_rows.value ->> 'index_name' COLLATE "C"
      )
      FROM index_rows
    ),
    '[]'::jsonb
  ),
  'triggers', COALESCE(
    (
      SELECT jsonb_agg(
        trigger_rows.value
        ORDER BY
          trigger_rows.value ->> 'table_name' COLLATE "C",
          trigger_rows.value ->> 'trigger_name' COLLATE "C"
      )
      FROM trigger_rows
    ),
    '[]'::jsonb
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
    '[]'::jsonb
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
    '[]'::jsonb
  )
)::text;
