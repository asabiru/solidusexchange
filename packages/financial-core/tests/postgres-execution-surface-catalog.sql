WITH trigger_rows AS (
  SELECT jsonb_build_object(
    'table_name', relation.relname,
    'trigger_name', trigger.tgname,
    'function_schema', function_namespace.nspname,
    'function_name', trigger_function.proname
  ) AS value
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
    AND trigger.tgisinternal = FALSE
),
rule_rows AS (
  SELECT jsonb_build_object(
    'relation_name', relation.relname,
    'rule_name', rewrite_rule.rulename,
    'event', CASE rewrite_rule.ev_type
      WHEN '1' THEN 'SELECT'
      WHEN '2' THEN 'UPDATE'
      WHEN '3' THEN 'INSERT'
      WHEN '4' THEN 'DELETE'
      ELSE rewrite_rule.ev_type::TEXT
    END,
    'instead', rewrite_rule.is_instead,
    'enabled', rewrite_rule.ev_enabled
  ) AS value
  FROM pg_catalog.pg_rewrite AS rewrite_rule
  JOIN pg_catalog.pg_class AS relation
    ON relation.oid = rewrite_rule.ev_class
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'financial_core'
),
relation_row_types AS (
  SELECT catalog_type.oid
  FROM pg_catalog.pg_type AS catalog_type
  JOIN pg_catalog.pg_class AS relation
    ON relation.oid = catalog_type.typrelid
  WHERE catalog_type.typtype = 'c'
    AND relation.relkind IN ('r', 'v')
    AND relation.reltype = catalog_type.oid
),
shadow_object_rows AS (
  SELECT 'type' AS object_type, catalog_type.typname AS object_name
  FROM pg_catalog.pg_type AS catalog_type
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = catalog_type.typnamespace
  WHERE namespace.nspname = 'financial_core'
    AND catalog_type.oid NOT IN (SELECT oid FROM relation_row_types)
    AND NOT (
      catalog_type.typcategory = 'A'
      AND catalog_type.typelem IN (SELECT oid FROM relation_row_types)
      AND catalog_type.oid = (
        SELECT element_type.typarray
        FROM pg_catalog.pg_type AS element_type
        WHERE element_type.oid = catalog_type.typelem
      )
    )
  UNION ALL
  SELECT 'operator', catalog_operator.oprname
  FROM pg_catalog.pg_operator AS catalog_operator
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = catalog_operator.oprnamespace
  WHERE namespace.nspname = 'financial_core'
  UNION ALL
  SELECT 'operator_class', operator_class.opcname
  FROM pg_catalog.pg_opclass AS operator_class
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = operator_class.opcnamespace
  WHERE namespace.nspname = 'financial_core'
  UNION ALL
  SELECT 'operator_family', operator_family.opfname
  FROM pg_catalog.pg_opfamily AS operator_family
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = operator_family.opfnamespace
  WHERE namespace.nspname = 'financial_core'
  UNION ALL
  SELECT 'collation', catalog_collation.collname
  FROM pg_catalog.pg_collation AS catalog_collation
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = catalog_collation.collnamespace
  WHERE namespace.nspname = 'financial_core'
  UNION ALL
  SELECT 'conversion', catalog_conversion.conname
  FROM pg_catalog.pg_conversion AS catalog_conversion
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = catalog_conversion.connamespace
  WHERE namespace.nspname = 'financial_core'
  UNION ALL
  SELECT 'text_search_configuration', search_configuration.cfgname
  FROM pg_catalog.pg_ts_config AS search_configuration
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = search_configuration.cfgnamespace
  WHERE namespace.nspname = 'financial_core'
  UNION ALL
  SELECT 'text_search_dictionary', search_dictionary.dictname
  FROM pg_catalog.pg_ts_dict AS search_dictionary
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = search_dictionary.dictnamespace
  WHERE namespace.nspname = 'financial_core'
  UNION ALL
  SELECT 'text_search_parser', search_parser.prsname
  FROM pg_catalog.pg_ts_parser AS search_parser
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = search_parser.prsnamespace
  WHERE namespace.nspname = 'financial_core'
  UNION ALL
  SELECT 'text_search_template', search_template.tmplname
  FROM pg_catalog.pg_ts_template AS search_template
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = search_template.tmplnamespace
  WHERE namespace.nspname = 'financial_core'
)
SELECT jsonb_build_object(
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
    '[]'::JSONB
  ),
  'rules', COALESCE(
    (
      SELECT jsonb_agg(
        rule_rows.value
        ORDER BY
          rule_rows.value ->> 'relation_name' COLLATE "C",
          rule_rows.value ->> 'rule_name' COLLATE "C"
      )
      FROM rule_rows
    ),
    '[]'::JSONB
  ),
  'shadow_objects', COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'object_type', shadow_object_rows.object_type,
          'object_name', shadow_object_rows.object_name
        )
        ORDER BY
          shadow_object_rows.object_type COLLATE "C",
          shadow_object_rows.object_name COLLATE "C"
      )
      FROM shadow_object_rows
    ),
    '[]'::JSONB
  )
)::TEXT;
