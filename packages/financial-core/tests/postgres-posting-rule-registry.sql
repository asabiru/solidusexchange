SELECT COALESCE(
  jsonb_agg(
    jsonb_build_object(
      'registry_version', registry_version,
      'status', status,
      'runtime_boundary', runtime_boundary,
      'production_execution_enabled', production_execution_enabled,
      'journal_type', journal_type,
      'posting_rule_version', posting_rule_version,
      'scope', scope,
      'allowed_actor_types', to_jsonb(allowed_actor_types),
      'entry_pattern', entry_pattern,
      'purpose', purpose
    )
    ORDER BY
      journal_type COLLATE "C",
      posting_rule_version COLLATE "C"
  ),
  '[]'::JSONB
)::TEXT
FROM financial_core.posting_rule_registry;
