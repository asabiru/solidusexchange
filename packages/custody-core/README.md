# SolidChange Custody Core

This package establishes a dev-only custody orchestration boundary for synthetic testnet withdrawal intents.

## Current status

- Runtime boundary: `dev-dry-run`.
- Execution authority: disabled.
- Production signing: disabled.
- HSM/MPC: not selected or provisioned.
- D-002 and D-003 remain `Open`.
- No private keys, mnemonic, seed, signature or raw transaction may enter this package.

This package cannot sign or broadcast transactions. It only validates and seals an unsigned intent envelope that a future separately deployed signer gateway may consume after the required human and infrastructure approvals.

## Contract

`prepareUnsignedTransactionIntent` accepts:

- a reference-only withdrawal command;
- an asset/network pair from the synthetic testnet allowlist;
- a short-lived canonical UTC validity window;
- at least two distinct human approvals;
- distinct maker and checker roles;
- step-up grant references;
- approval evidence bound to the exact SHA-256 command and policy digest.

It returns an immutable envelope with:

```json
{
  "status": "unsigned_intent_ready",
  "runtime_boundary": "dev-dry-run",
  "execution_authority": false,
  "production_signing_enabled": false,
  "key_material_present": false
}
```

Raw destination addresses are replaced by `destination_reference`; exact address ownership remains inside the future custody/signer trust zone. Missing approvals, reused human subjects, stale evidence, command or policy digest drift, mainnet assets and signing-enabled policy fail closed.

`createCustodyIntentPreparedEvent` projects a verified envelope into the canonical additive domain event contract. Aggregate, correlation and idempotency values are derived from the sealed command; causation is derived from a verified canonical `WithdrawalApproved` event, while only the new UUIDv7 event ID and timestamp are supplied by the outbox boundary. The approval event must preserve withdrawal aggregate/correlation, summarize the exact approval evidence digest and occur after the individual approvals. The custody event excludes destination references, individual approvals and all signing material.

`createCustodyProjectionRegistry` provides a synchronous dev-only replay boundary around that projection. An exact canonical replay returns the original immutable event. Reuse of an idempotency key with changed evidence, or reuse of an event, approval event, withdrawal or custody intent identity under another projection, fails closed. This in-memory evidence does not replace a future durable production outbox.

`migrations/0001_custody_projection_outbox.sql` adds PostgreSQL evidence for the same contract. The append-only outbox accepts only the exact unsigned testnet event shape, recognizes exact concurrent replays, rejects changed idempotency evidence and enforces unique event, approval-source, withdrawal and custody-intent identities. It is still a dev-only reference migration: production role provisioning, infrastructure and operational authorization are intentionally absent.

`migrations/0002_custody_migration_history.sql` adds installed migration-history evidence in `custody_core.schema_migrations`. It records the pre-history `0001` baseline and itself, rejects skipped, duplicate, misnamed or non-increasing history rows through an always-enabled sequence guard, and makes history append-only even in replica mode. Version `0001` predates the history table; its row is recorded when `0002` bootstraps history, so its `applied_at` reflects the bootstrap, not the original install.

`tests/postgres-migration-history.sh` compares the installed history with the exact canonical manifest and requires strictly increasing `applied_at` in version order. Unreviewed rows, reordered timestamps, sequence violations, replica-mode bypass and history mutation fail closed. A disposable database injects a failure after migration `0002` creates its history table, functions, triggers and both canonical history rows; transaction rollback must leave every `0002` object and history effect absent while preserving the `0001` custody outbox, after which the canonical migration must apply cleanly with the exact history and trigger set.

`tests/postgres-migration-source-catalog.sh` pins the exact ordered migration filenames and SHA-256 digests. Changed, missing or unexpected SQL migration sources fail closed before database execution.

`tests/postgres-migration-source-policy.sh` requires canonical contiguous migration versions, exactly one outer `BEGIN`/`COMMIT` transaction, no psql meta-commands and canonical history rows: `0001` records none, the `0002` history bootstrap alone creates the history table and records `0001` and `0002`, and every later migration records exactly its own filename. Non-atomic, hidden rollback, non-canonical, skipped-version, missing-bootstrap, mismatched-history or non-canonical history-write migration sources fail closed.

`tests/runtime-writer-grants.sql` defines the dev-only least-privilege writer contract. A validated unprivileged role receives only schema usage and execution of the fixed-search-path `record_custody_projection` security boundary; it cannot read or mutate the outbox directly, create schema objects or disable triggers.

`tests/postgres-runtime-privilege-catalog.sql` and `scripts/verify-postgres-runtime-privilege-catalog.mjs` require the synthetic runtime role itself to remain `NOLOGIN`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOINHERIT`, `NOREPLICATION`, `NOBYPASSRLS`, without memberships, role settings or custody/database ownership, and require every grant held by that role or `PUBLIC` across the custody-core schema, relations, columns, functions, types and default ACLs to exactly equal the reviewed contract: schema `USAGE` and `EXECUTE` on `record_custody_projection`, both without grant option. Transactional probes prove that role-capability, membership, outbox-read, column-update, function-grant-option, internal-trigger-function, type-usage, `PUBLIC` migration-history and default-table-grant drift fails verification and rolls back. This remains synthetic test evidence only; it does not provision a runtime role or authorize production custody.

`tests/postgres-catalog.sh` pins the installed schema, relation, columns, constraints, always-enabled mutation triggers, function definitions, ownership and access controls. Unexpected DDL, disabled triggers, public access, function-security drift or removed constraints fail closed.

`tests/postgres-backup-restore.sh` proves that a backup taken during an uncommitted custody projection contains the complete pre-transaction state, excludes unrelated source schemas, requires a truncated archive to fail without leaving a partial schema, and rejects a structurally valid restore whose archive silently omits custody outbox data even though its catalog and migration history remain canonical. The intact archive restores atomically into a disposable database without changing unrelated target state, reruns the exact installed-catalog and migration-history policies and compares a deterministic outbox and migration-history snapshot with the source. The restored database must then accept and exactly replay a new synthetic projection without changing the source database, and a second-generation backup of that active restore must reproduce the same state, catalog and migration history in another disposable database. A restore into a target with pre-existing custody state must fail atomically without changing that state. This is dev-only recovery evidence; it does not establish production RPO/RTO, encryption, retention, high availability or restore-drill approval.

## Verification

```bash
npm ci
npm run verify
npm audit --audit-level=moderate
bash tests/postgres-migration-source-catalog.sh
bash tests/postgres-migration-source-policy.sh
bash tests/postgres-outbox.sh
bash tests/postgres-migration-history.sh
bash tests/postgres-catalog.sh
bash tests/postgres-backup-restore.sh
bash tests/postgres-runtime-privileges.sh
```

No test or approval in this package authorizes HSM/MPC provisioning, production keys, customer withdrawals, transaction signing or broadcast.
