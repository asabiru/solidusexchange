WITH constraint_rows AS (
  SELECT jsonb_build_object(
    'table_name', relation.relname,
    'constraint_name', catalog_constraint.conname,
    'constraint_type', CASE catalog_constraint.contype
      WHEN 'c' THEN 'check'
      WHEN 'f' THEN 'foreign_key'
      WHEN 'p' THEN 'primary_key'
      WHEN 't' THEN 'constraint_trigger'
      WHEN 'u' THEN 'unique'
      ELSE catalog_constraint.contype::TEXT
    END,
    'deferrable', catalog_constraint.condeferrable,
    'initially_deferred', catalog_constraint.condeferred,
    'validated', catalog_constraint.convalidated,
    'no_inherit', catalog_constraint.connoinherit,
    'index_unique', constraint_index.indisunique,
    'index_immediate', constraint_index.indimmediate,
    'index_valid', constraint_index.indisvalid,
    'index_ready', constraint_index.indisready,
    'index_live', constraint_index.indislive,
    'definition_sha256', pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(
          pg_catalog.pg_get_constraintdef(catalog_constraint.oid, FALSE),
          'UTF8'
        )
      ),
      'hex'
    )
  ) AS value
  FROM pg_catalog.pg_constraint AS catalog_constraint
  JOIN pg_catalog.pg_class AS relation
    ON relation.oid = catalog_constraint.conrelid
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  LEFT JOIN pg_catalog.pg_index AS constraint_index
    ON constraint_index.indexrelid = catalog_constraint.conindid
  WHERE namespace.nspname = 'financial_core'
),
standalone_index_rows AS (
  SELECT jsonb_build_object(
    'table_name', relation.relname,
    'index_name', index_relation.relname,
    'unique', index.indisunique,
    'immediate', index.indimmediate,
    'valid', index.indisvalid,
    'ready', index.indisready,
    'live', index.indislive,
    'clustered', index.indisclustered,
    'replica_identity', index.indisreplident,
    'nulls_not_distinct', index.indnullsnotdistinct,
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
  FROM pg_catalog.pg_index AS index
  JOIN pg_catalog.pg_class AS relation
    ON relation.oid = index.indrelid
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  JOIN pg_catalog.pg_class AS index_relation
    ON index_relation.oid = index.indexrelid
  LEFT JOIN pg_catalog.pg_constraint AS backing_constraint
    ON backing_constraint.conindid = index.indexrelid
  WHERE namespace.nspname = 'financial_core'
    AND backing_constraint.oid IS NULL
)
SELECT jsonb_build_object(
  'constraints',
  COALESCE(
    (
      SELECT jsonb_agg(
        constraint_rows.value
        ORDER BY
          constraint_rows.value ->> 'table_name' COLLATE "C",
          constraint_rows.value ->> 'constraint_name' COLLATE "C"
      )
      FROM constraint_rows
    ),
    '[]'::JSONB
  ),
  'indexes',
  COALESCE(
    (
      SELECT jsonb_agg(
        standalone_index_rows.value
        ORDER BY
          standalone_index_rows.value ->> 'table_name' COLLATE "C",
          standalone_index_rows.value ->> 'index_name' COLLATE "C"
      )
      FROM standalone_index_rows
    ),
    '[]'::JSONB
  )
)::TEXT;
