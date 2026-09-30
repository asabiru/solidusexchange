WITH relation_rows AS (
  SELECT jsonb_build_object(
    'relation_name', relation.relname,
    'relation_type', CASE relation.relkind
      WHEN 'r' THEN 'table'
      WHEN 'v' THEN 'view'
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
    AND relation.relkind IN ('r', 'v')
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
    AND relation.relkind IN ('r', 'v')
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
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
  )
)::TEXT;
