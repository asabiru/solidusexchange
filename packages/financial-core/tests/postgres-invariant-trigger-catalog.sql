SELECT COALESCE(
  jsonb_agg(
    jsonb_build_object(
      'table_name', relation.relname,
      'trigger_name', trigger.tgname,
      'enabled', trigger.tgenabled,
      'row_level', (trigger.tgtype::INTEGER & 1) <> 0,
      'before', (trigger.tgtype::INTEGER & 2) <> 0,
      'events', to_jsonb(array_remove(ARRAY[
        CASE WHEN (trigger.tgtype::INTEGER & 4) <> 0 THEN 'INSERT' END,
        CASE WHEN (trigger.tgtype::INTEGER & 8) <> 0 THEN 'DELETE' END,
        CASE WHEN (trigger.tgtype::INTEGER & 16) <> 0 THEN 'UPDATE' END,
        CASE WHEN (trigger.tgtype::INTEGER & 32) <> 0 THEN 'TRUNCATE' END
      ], NULL)),
      'constraint', trigger.tgconstraint <> 0,
      'deferrable', trigger.tgdeferrable,
      'initially_deferred', trigger.tginitdeferred,
      'function_schema', function_namespace.nspname,
      'function_name', trigger_function.proname
    )
    ORDER BY
      relation.relname COLLATE "C",
      trigger.tgname COLLATE "C"
  ),
  '[]'::JSONB
)::TEXT
FROM pg_catalog.pg_trigger AS trigger
JOIN pg_catalog.pg_class AS relation
  ON relation.oid = trigger.tgrelid
JOIN pg_catalog.pg_namespace AS relation_namespace
  ON relation_namespace.oid = relation.relnamespace
JOIN pg_catalog.pg_proc AS trigger_function
  ON trigger_function.oid = trigger.tgfoid
JOIN pg_catalog.pg_namespace AS function_namespace
  ON function_namespace.oid = trigger_function.pronamespace
WHERE relation_namespace.nspname = 'financial_core'
  AND function_namespace.nspname = 'financial_core'
  AND trigger_function.proname IN (
    'assert_journal_complete',
    'reject_sealed_journal_entry',
    'validate_account',
    'validate_entry_amount'
  )
  AND trigger.tgisinternal = FALSE;
