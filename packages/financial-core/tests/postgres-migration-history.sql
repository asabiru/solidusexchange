SELECT COALESCE(
  jsonb_agg(
    jsonb_build_object(
      'version', migration.version,
      'migration_name', migration.migration_name
    )
    ORDER BY migration.version
  ),
  '[]'::JSONB
)::TEXT
FROM financial_core.schema_migrations AS migration;
