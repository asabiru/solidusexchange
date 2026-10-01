WITH migration_history AS (
  SELECT
    migration.version,
    migration.migration_name,
    migration.applied_at,
    lag(migration.applied_at) OVER (ORDER BY migration.version) AS previous_applied_at
  FROM custody_core.schema_migrations AS migration
)
SELECT jsonb_build_object(
  'history',
  COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'version', migration.version,
        'migration_name', migration.migration_name
      )
      ORDER BY migration.version
    ),
    '[]'::jsonb
  ),
  'applied_in_version_order',
  COALESCE(
    bool_and(
      migration.previous_applied_at IS NULL
      OR migration.applied_at > migration.previous_applied_at
    ),
    TRUE
  )
)::text
FROM migration_history AS migration;
