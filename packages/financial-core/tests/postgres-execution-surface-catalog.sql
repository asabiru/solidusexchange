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
),
-- Objects created after initdb (oid >= FirstNormalObjectId) that change how
-- unqualified casts, functions and operators in trigger bodies resolve.
database_shadow_object_rows AS (
  SELECT
    'cast' AS object_type,
    pg_catalog.format_type(catalog_cast.castsource, NULL)
      || ' AS '
      || pg_catalog.format_type(catalog_cast.casttarget, NULL) AS object_name
  FROM pg_catalog.pg_cast AS catalog_cast
  WHERE catalog_cast.oid >= 16384
  UNION ALL
  SELECT
    'pg_catalog_routine',
    catalog_procedure.proname
      || '('
      || pg_catalog.pg_get_function_identity_arguments(catalog_procedure.oid)
      || ')'
  FROM pg_catalog.pg_proc AS catalog_procedure
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = catalog_procedure.pronamespace
  WHERE namespace.nspname = 'pg_catalog'
    AND catalog_procedure.oid >= 16384
  UNION ALL
  SELECT
    'pg_catalog_operator',
    catalog_operator.oprname
      || '('
      || pg_catalog.format_type(catalog_operator.oprleft, NULL)
      || ', '
      || pg_catalog.format_type(catalog_operator.oprright, NULL)
      || ')'
  FROM pg_catalog.pg_operator AS catalog_operator
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = catalog_operator.oprnamespace
  WHERE namespace.nspname = 'pg_catalog'
    AND catalog_operator.oid >= 16384
),
-- Pins initdb-created casts, pg_catalog routines and operators, so replacing
-- a built-in in place (same OID) or editing its catalog row also fails.
builtin_catalog_rows AS (
  SELECT
    'routine:' || catalog_procedure.oid::TEXT AS row_key,
    pg_catalog.concat_ws(
      '|',
      catalog_procedure.proname,
      catalog_procedure.prokind,
      catalog_procedure.prolang,
      catalog_procedure.prosecdef,
      catalog_procedure.proleakproof,
      catalog_procedure.proisstrict,
      catalog_procedure.proretset,
      catalog_procedure.provolatile,
      catalog_procedure.proparallel,
      catalog_procedure.prorettype,
      catalog_procedure.proargtypes::TEXT,
      catalog_procedure.proallargtypes::TEXT,
      catalog_procedure.proconfig::TEXT,
      catalog_procedure.prosrc,
      catalog_procedure.probin,
      catalog_procedure.prosupport::OID,
      catalog_procedure.prorows,
      catalog_procedure.procost,
      catalog_procedure.proowner
    ) AS row_value
  FROM pg_catalog.pg_proc AS catalog_procedure
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = catalog_procedure.pronamespace
  WHERE namespace.nspname = 'pg_catalog'
  UNION ALL
  SELECT
    'cast:' || catalog_cast.oid::TEXT,
    pg_catalog.concat_ws(
      '|',
      catalog_cast.castsource,
      catalog_cast.casttarget,
      catalog_cast.castfunc,
      catalog_cast.castcontext,
      catalog_cast.castmethod
    )
  FROM pg_catalog.pg_cast AS catalog_cast
  UNION ALL
  SELECT
    'operator:' || catalog_operator.oid::TEXT,
    pg_catalog.concat_ws(
      '|',
      catalog_operator.oprname,
      catalog_operator.oprkind,
      catalog_operator.oprleft,
      catalog_operator.oprright,
      catalog_operator.oprresult,
      catalog_operator.oprcode::OID,
      catalog_operator.oprowner
    )
  FROM pg_catalog.pg_operator AS catalog_operator
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = catalog_operator.oprnamespace
  WHERE namespace.nspname = 'pg_catalog'
)
SELECT jsonb_build_object(
  'builtin_catalog', (
    SELECT jsonb_build_object(
      'rows', pg_catalog.count(*),
      'sha256', pg_catalog.encode(
        pg_catalog.sha256(
          pg_catalog.convert_to(
            pg_catalog.string_agg(
              builtin_catalog_rows.row_key || '=' || builtin_catalog_rows.row_value,
              E'\n'
              ORDER BY builtin_catalog_rows.row_key COLLATE "C"
            ),
            'UTF8'
          )
        ),
        'hex'
      )
    )
    FROM builtin_catalog_rows
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
  'database_shadow_objects', COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'object_type', database_shadow_object_rows.object_type,
          'object_name', database_shadow_object_rows.object_name
        )
        ORDER BY
          database_shadow_object_rows.object_type COLLATE "C",
          database_shadow_object_rows.object_name COLLATE "C"
      )
      FROM database_shadow_object_rows
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
