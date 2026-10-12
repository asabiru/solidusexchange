WITH relation_rows AS (
  SELECT jsonb_build_object(
    'relation_name', relation.relname,
    'relation_type', CASE relation.relkind
      WHEN 'r' THEN 'table'
      WHEN 'p' THEN 'partitioned_table'
      WHEN 'v' THEN 'view'
      WHEN 'm' THEN 'materialized_view'
      WHEN 'S' THEN 'sequence'
      WHEN 'f' THEN 'foreign_table'
      ELSE relation.relkind::TEXT
    END,
    'persistence', CASE relation.relpersistence
      WHEN 'p' THEN 'permanent'
      WHEN 't' THEN 'temporary'
      WHEN 'u' THEN 'unlogged'
      ELSE relation.relpersistence::TEXT
    END,
    'access_method', access_method.amname,
    'row_security', relation.relrowsecurity,
    'force_row_security', relation.relforcerowsecurity,
    'replica_identity', CASE relation.relreplident
      WHEN 'd' THEN 'default'
      WHEN 'f' THEN 'full'
      WHEN 'i' THEN 'index'
      WHEN 'n' THEN 'nothing'
      ELSE relation.relreplident::TEXT
    END,
    'options', COALESCE(
      (
        SELECT jsonb_agg(option ORDER BY option COLLATE "C")
        FROM pg_catalog.unnest(relation.reloptions) AS option
      ),
      '[]'::JSONB
    ),
    'view_definition_sha256', CASE
      WHEN relation.relkind = 'v' THEN pg_catalog.encode(
        pg_catalog.sha256(
          pg_catalog.convert_to(
            pg_catalog.pg_get_viewdef(relation.oid, FALSE),
            'UTF8'
          )
        ),
        'hex'
      )
      ELSE NULL
    END
  ) AS value
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  LEFT JOIN pg_catalog.pg_am AS access_method
    ON access_method.oid = relation.relam
  WHERE namespace.nspname = 'financial_core'
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
      ELSE attribute.attstorage::TEXT
    END,
    'compression', CASE attribute.attcompression
      WHEN 'l' THEN 'lz4'
      WHEN 'p' THEN 'pglz'
      ELSE 'default'
    END,
    'statistics_target', attribute.attstattarget,
    'local', attribute.attislocal,
    'inheritance_count', attribute.attinhcount
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
  WHERE namespace.nspname = 'financial_core'
    AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
),
policy_rows AS (
  SELECT jsonb_build_object(
    'relation_name', relation.relname,
    'policy_name', policy.polname,
    'command', policy.polcmd::TEXT,
    'permissive', policy.polpermissive,
    'roles', to_jsonb(ARRAY(
      SELECT pg_catalog.pg_get_userbyid(role_oid)
      FROM pg_catalog.unnest(policy.polroles) AS role_oid
      ORDER BY pg_catalog.pg_get_userbyid(role_oid) COLLATE "C"
    )),
    'qual_sha256', pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(
          COALESCE(
            pg_catalog.pg_get_expr(policy.polqual, policy.polrelid, FALSE),
            ''
          ),
          'UTF8'
        )
      ),
      'hex'
    ),
    'with_check_sha256', pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(
          COALESCE(
            pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid, FALSE),
            ''
          ),
          'UTF8'
        )
      ),
      'hex'
    )
  ) AS value
  FROM pg_catalog.pg_policy AS policy
  JOIN pg_catalog.pg_class AS relation
    ON relation.oid = policy.polrelid
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'financial_core'
),
publication_rows AS (
  SELECT jsonb_build_object(
    'publication_name', publication.pubname,
    'all_tables', publication.puballtables,
    'insert', publication.pubinsert,
    'update', publication.pubupdate,
    'delete', publication.pubdelete,
    'truncate', publication.pubtruncate,
    'tables', COALESCE(
      (
        SELECT jsonb_agg(financial_relation.relname ORDER BY financial_relation.relname COLLATE "C")
        FROM pg_catalog.pg_publication_rel AS publication_relation
        JOIN pg_catalog.pg_class AS financial_relation
          ON financial_relation.oid = publication_relation.prrelid
        JOIN pg_catalog.pg_namespace AS financial_namespace
          ON financial_namespace.oid = financial_relation.relnamespace
        WHERE publication_relation.prpubid = publication.oid
          AND financial_namespace.nspname = 'financial_core'
      ),
      '[]'::JSONB
    )
  ) AS value
  FROM pg_catalog.pg_publication AS publication
  WHERE publication.puballtables
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_publication_rel AS publication_relation
       JOIN pg_catalog.pg_class AS financial_relation
         ON financial_relation.oid = publication_relation.prrelid
       JOIN pg_catalog.pg_namespace AS financial_namespace
         ON financial_namespace.oid = financial_relation.relnamespace
       WHERE publication_relation.prpubid = publication.oid
         AND financial_namespace.nspname = 'financial_core'
     )
),
statistics_rows AS (
  SELECT jsonb_build_object(
    'statistics_name', statistics.stxname,
    'owner_is_current_user',
      pg_catalog.pg_get_userbyid(statistics.stxowner) = CURRENT_USER,
    'definition_sha256', pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(
          pg_catalog.pg_get_statisticsobjdef(statistics.oid),
          'UTF8'
        )
      ),
      'hex'
    )
  ) AS value
  FROM pg_catalog.pg_statistic_ext AS statistics
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = statistics.stxnamespace
  WHERE namespace.nspname = 'financial_core'
),
event_trigger_rows AS (
  SELECT jsonb_build_object(
    'event_trigger_name', event_trigger.evtname,
    'enabled', event_trigger.evtenabled,
    'event', event_trigger.evtevent,
    'function_schema', function_namespace.nspname,
    'function_name', event_function.proname,
    'tags', COALESCE(to_jsonb(event_trigger.evttags), '[]'::JSONB)
  ) AS value
  FROM pg_catalog.pg_event_trigger AS event_trigger
  JOIN pg_catalog.pg_proc AS event_function
    ON event_function.oid = event_trigger.evtfoid
  JOIN pg_catalog.pg_namespace AS function_namespace
    ON function_namespace.oid = event_function.pronamespace
)
SELECT jsonb_build_object(
  'relations',
  COALESCE(
    (
      SELECT jsonb_agg(
        relation_rows.value
        ORDER BY relation_rows.value ->> 'relation_name' COLLATE "C"
      )
      FROM relation_rows
    ),
    '[]'::JSONB
  ),
  'columns',
  COALESCE(
    (
      SELECT jsonb_agg(
        column_rows.value
        ORDER BY
          column_rows.value ->> 'relation_name' COLLATE "C",
          (column_rows.value ->> 'position')::INTEGER
      )
      FROM column_rows
    ),
    '[]'::JSONB
  ),
  'policies',
  COALESCE(
    (
      SELECT jsonb_agg(
        policy_rows.value
        ORDER BY
          policy_rows.value ->> 'relation_name' COLLATE "C",
          policy_rows.value ->> 'policy_name' COLLATE "C"
      )
      FROM policy_rows
    ),
    '[]'::JSONB
  ),
  'publications',
  COALESCE(
    (
      SELECT jsonb_agg(
        publication_rows.value
        ORDER BY publication_rows.value ->> 'publication_name' COLLATE "C"
      )
      FROM publication_rows
    ),
    '[]'::JSONB
  ),
  'statistics',
  COALESCE(
    (
      SELECT jsonb_agg(
        statistics_rows.value
        ORDER BY statistics_rows.value ->> 'statistics_name' COLLATE "C"
      )
      FROM statistics_rows
    ),
    '[]'::JSONB
  ),
  'event_triggers',
  COALESCE(
    (
      SELECT jsonb_agg(
        event_trigger_rows.value
        ORDER BY event_trigger_rows.value ->> 'event_trigger_name' COLLATE "C"
      )
      FROM event_trigger_rows
    ),
    '[]'::JSONB
  )
)::TEXT;
