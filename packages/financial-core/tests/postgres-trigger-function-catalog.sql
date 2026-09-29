SELECT COALESCE(
  jsonb_agg(
    jsonb_build_object(
      'function_schema', namespace.nspname,
      'function_name', procedure.proname,
      'identity_arguments', pg_catalog.pg_get_function_identity_arguments(procedure.oid),
      'language', language.lanname,
      'return_type', pg_catalog.pg_get_function_result(procedure.oid),
      'security_definer', procedure.prosecdef,
      'leakproof', procedure.proleakproof,
      'strict', procedure.proisstrict,
      'volatility', CASE procedure.provolatile
        WHEN 'i' THEN 'immutable'
        WHEN 's' THEN 'stable'
        WHEN 'v' THEN 'volatile'
      END,
      'parallel', CASE procedure.proparallel
        WHEN 's' THEN 'safe'
        WHEN 'r' THEN 'restricted'
        WHEN 'u' THEN 'unsafe'
      END,
      'config', COALESCE(to_jsonb(procedure.proconfig), '[]'::JSONB),
      'non_owner_execute', EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(
          COALESCE(
            procedure.proacl,
            pg_catalog.acldefault('f', procedure.proowner)
          )
        ) AS function_acl
        WHERE function_acl.privilege_type = 'EXECUTE'
          AND function_acl.grantee <> procedure.proowner
      ),
      'public_execute', pg_catalog.has_function_privilege(
        'public',
        procedure.oid,
        'EXECUTE'
      ),
      'source_sha256', pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(procedure.prosrc, 'UTF8')),
        'hex'
      )
    )
    ORDER BY procedure.proname COLLATE "C"
  ),
  '[]'::JSONB
)::TEXT
FROM pg_catalog.pg_proc AS procedure
JOIN pg_catalog.pg_namespace AS namespace
  ON namespace.oid = procedure.pronamespace
JOIN pg_catalog.pg_language AS language
  ON language.oid = procedure.prolang
WHERE namespace.nspname = 'financial_core'
  AND procedure.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype;
