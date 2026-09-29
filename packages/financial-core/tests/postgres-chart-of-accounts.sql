BEGIN;

WITH chart AS (
  SELECT :'chart_json'::JSONB AS document
)
INSERT INTO financial_core.account_definitions (
  chart_version,
  definition_code,
  category,
  account_class,
  normal_side,
  owner_scope,
  purpose
)
SELECT
  (chart.document ->> 'chart_version')::INTEGER,
  definition.code,
  definition.category,
  definition.account_class,
  definition.normal_side,
  definition.owner_scope,
  definition.purpose
FROM chart
CROSS JOIN LATERAL jsonb_to_recordset(
  chart.document -> 'account_definitions'
) AS definition (
  code TEXT,
  category TEXT,
  account_class TEXT,
  normal_side TEXT,
  owner_scope TEXT,
  purpose TEXT
);

SELECT COALESCE(
  jsonb_agg(
    jsonb_build_object(
      'chart_version', chart_version,
      'definition_code', definition_code,
      'category', category,
      'account_class', account_class,
      'normal_side', normal_side,
      'owner_scope', owner_scope,
      'purpose', purpose
    )
    ORDER BY definition_code COLLATE "C"
  ),
  '[]'::JSONB
)::TEXT
FROM financial_core.account_definitions;

ROLLBACK;
