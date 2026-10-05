BEGIN;

ALTER TABLE custody_core.custody_projection_outbox
  ADD CONSTRAINT custody_projection_testnet_allowlist CHECK (
    (asset = 'TON' AND network = 'TON_TESTNET')
    OR (asset = 'USDT' AND network = 'TON_TESTNET')
    OR (asset = 'USDT' AND network = 'TRON_TESTNET')
  );

INSERT INTO custody_core.schema_migrations (version, migration_name)
VALUES (3, '0003_custody_enabled_asset_network');

COMMIT;
