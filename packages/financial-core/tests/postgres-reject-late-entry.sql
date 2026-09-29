\set ON_ERROR_STOP on

BEGIN;

INSERT INTO financial_core.ledger_entries (
  entry_id,
  journal_id,
  sequence_number,
  account_id,
  legal_entity_id,
  asset_code,
  side,
  amount,
  created_at
) VALUES
  (
    '11000000-0000-4000-8000-000000000011',
    '70000000-0000-4000-8000-000000000007',
    3,
    '10000000-0000-4000-8000-000000000001',
    'solidchange-dev',
    'TUSDT',
    'DEBIT',
    1.00,
    '2026-09-25T10:30:01.000Z'
  ),
  (
    '12000000-0000-4000-8000-000000000012',
    '70000000-0000-4000-8000-000000000007',
    4,
    '20000000-0000-4000-8000-000000000002',
    'solidchange-dev',
    'TUSDT',
    'CREDIT',
    1.00,
    '2026-09-25T10:30:01.000Z'
  );

COMMIT;
