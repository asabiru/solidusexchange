WITH relation_names (relation_name) AS (
  VALUES
    ('custody_projection_outbox'),
    ('schema_migrations')
),
state_rows (relation_name, sort_key, row_data) AS (
  SELECT
    'custody_projection_outbox',
    outbox.event_id::text,
    to_jsonb(outbox)
  FROM custody_core.custody_projection_outbox AS outbox
  UNION ALL
  SELECT
    'schema_migrations',
    lpad(migration.version::text, 10, '0'),
    to_jsonb(migration)
  FROM custody_core.schema_migrations AS migration
),
relation_rows AS (
  SELECT
    relation_name,
    jsonb_agg(row_data ORDER BY sort_key COLLATE "C") AS rows
  FROM state_rows
  GROUP BY relation_name
)
SELECT jsonb_build_object(
  'format',
  'custody-core-state-v2',
  'relations',
  jsonb_object_agg(
    names.relation_name,
    COALESCE(rows.rows, '[]'::jsonb)
    ORDER BY names.relation_name
  )
)::text
FROM relation_names AS names
LEFT JOIN relation_rows AS rows USING (relation_name);
