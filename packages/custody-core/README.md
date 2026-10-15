# SOLID Custody Core

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
- a short-lived canonical UTC validity window (policy TTL ceilings cannot exceed one day);
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

Raw destination addresses are replaced by `destination_reference`; exact address ownership remains inside the future custody/signer trust zone. Missing approvals, reused human subjects, stale evidence, command or policy digest drift, a checker approval that predates its maker approval, mainnet assets and signing-enabled policy fail closed. Every entry point first snapshots its inputs into fresh plain data and validates and projects only that snapshot; proxies, accessor (getter) properties, symbol keys, sparse arrays, cycles, non-plain prototypes and leaves that JSON cannot represent faithfully (undefined, NaN, infinities, symbols, bigint) are rejected, so a value cannot pass the testnet allowlist and then change to a mainnet network or unapproved asset when the intent or event is built. The command correlation id is a UUIDv7 to match the outbox evidence CHECK.

`createCustodyIntentPreparedEvent` projects a verified envelope into the canonical additive domain event contract. Aggregate, correlation and idempotency values are derived from the sealed command; causation is derived from a verified canonical `WithdrawalApproved` event, while only the new UUIDv7 event ID and timestamp are supplied by the outbox boundary. The approval event must preserve withdrawal aggregate/correlation, summarize the exact approval evidence digest and occur after the individual approvals, and its causation may not name the prepared event itself. The custody event excludes destination references, individual approvals and all signing material.

`createCustodyProjectionRegistry` provides a synchronous dev-only replay boundary around that projection. An exact canonical replay returns the original immutable event. Reuse of an idempotency key with changed evidence, or reuse of an event, approval event, withdrawal, custody intent, approval-set, per-approval, step-up grant or approval evidence digest identity under another projection, fails closed. Prepared and approval event identities share one consumed namespace, as do approval-set and per-approval identities. The registry holds at most `maxEntries` projections (default 10,000) and replays consume no capacity. This in-memory evidence does not replace a future durable production outbox.

`migrations/0001_custody_projection_outbox.sql` adds PostgreSQL evidence for the same contract. The append-only outbox accepts only the exact unsigned testnet event shape, recognizes exact concurrent replays, rejects changed idempotency evidence and enforces unique event, approval-source, withdrawal and custody-intent identities. It is still a dev-only reference migration: production role provisioning, infrastructure and operational authorization are intentionally absent.

`migrations/0002_custody_migration_history.sql` adds installed migration-history evidence in `custody_core.schema_migrations`. It records the pre-history `0001` baseline and itself, rejects skipped, duplicate, misnamed or non-increasing history rows through an always-enabled sequence guard, and makes history append-only even in replica mode. Version `0001` predates the history table; its row is recorded when `0002` bootstraps history, so its `applied_at` reflects the bootstrap, not the original install.

`migrations/0003_custody_enabled_asset_network.sql` adds `custody_projection_testnet_allowlist`, which restricts stored projections to the exact asset/network pairs in `custody-policy.json` (`TON`/`TON_TESTNET`, `USDT`/`TON_TESTNET`, `USDT`/`TRON_TESTNET`). The `0001` format checks alone accepted any uppercase asset with any `*_TESTNET` network, so the runtime writer could record disabled or mismatched pairs such as `BTC`/`BITCOIN_TESTNET`, `TON`/`TRON_TESTNET` or `USDT`/`MAINNET_TESTNET`. `scripts/check-boundary.mjs` requires the constraint to list exactly the policy pairs; enabling a new testnet pair needs a reviewed policy change and a new migration.

`tests/postgres-migration-history.sh` compares the installed history with the exact canonical manifest and requires strictly increasing `applied_at` in version order. Unreviewed rows, reordered timestamps, sequence violations, replica-mode bypass and history mutation fail closed. A disposable database injects a failure after migration `0002` creates its history table, functions, triggers and both canonical history rows; transaction rollback must leave every `0002` object and history effect absent while preserving the `0001` custody outbox, after which the canonical migration must apply cleanly with the exact history and trigger set.

`tests/postgres-migration-source-catalog.sh` pins the exact ordered migration filenames and SHA-256 digests. Changed, missing or unexpected SQL migration sources fail closed before database execution.

`tests/postgres-migration-source-policy.sh` requires canonical contiguous migration versions, exactly one outer `BEGIN`/`COMMIT` transaction, no psql meta-commands and canonical history rows: `0001` records none, the `0002` history bootstrap alone creates the history table and records `0001` and `0002`, and every later migration records exactly its own filename. Non-atomic, hidden rollback, non-canonical, skipped-version, missing-bootstrap, mismatched-history or non-canonical history-write migration sources fail closed.

`tests/runtime-writer-grants.sql` defines the dev-only least-privilege writer contract. A validated unprivileged role receives only schema usage and execution of the fixed-search-path `record_custody_projection` security boundary; it cannot read or mutate the outbox directly, create schema objects, create temporary objects or disable triggers.

`tests/postgres-runtime-privilege-catalog.sql` and `scripts/verify-postgres-runtime-privilege-catalog.mjs` require the synthetic runtime role itself to remain `NOLOGIN`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOINHERIT`, `NOREPLICATION`, `NOBYPASSRLS`, without memberships, role-wide or per-database (`ALTER ROLE ... IN DATABASE ... SET`) session defaults or custody/database ownership, and require every grant held by that role or `PUBLIC` across the current database and the custody-core schema, relations, columns, functions, types and default ACLs to exactly equal the reviewed contract: database `CONNECT` through `PUBLIC` only, schema `USAGE` and `EXECUTE` on `record_custody_projection`, all without grant option. The profile revokes the default `PUBLIC` database `TEMPORARY` privilege because PostgreSQL resolves unqualified type names in the caller's session temporary schema first, even inside the fixed-search-path `SECURITY DEFINER` function; a writer able to create `pg_temp.timestamptz` as a `date` domain could otherwise silently replace the function's timestamp casts. Transactional probes prove that role-capability, membership, outbox-read, column-update, function-grant-option, internal-trigger-function, type-usage, `PUBLIC` migration-history, default-table-grant and database `TEMPORARY`/`CREATE` drift fails verification and rolls back, and the runtime role's temporary type creation is denied. Because PostgreSQL lets an ordinary role persist its own per-database defaults, the catalog pins `pg_db_role_setting`, the grant script refuses a role carrying any setting, and probes prove a runtime-planted `search_path`, `TimeZone` or `DateStyle` default fails verification. This remains synthetic test evidence only; it does not provision a runtime role or authorize production custody.

`tests/postgres-catalog.sh` pins the installed schema, relation, columns, constraints, exact always-enabled mutation-trigger definitions, function definitions, ownership and access controls. Unexpected DDL, disabled or predicate-weakened triggers, public access, function-security drift or removed constraints fail closed through transactional probes that roll back to the canonical catalog.

`tests/postgres-execution-surface-catalog.sh` closes what the per-object catalog leaves out. It requires exactly the five reviewed triggers on custody tables, whichever schema their function lives in, allows no rewrite rules (custody has no views), and requires the `custody_core` schema to contain no types other than table row types and their arrays, and no operators, operator classes or families, collations, conversions or text-search objects. `validate_migration_sequence` runs with `search_path = custody_core, pg_catalog`, so such objects would shadow built-ins: a `custody_core.=` integer operator let it accept out-of-sequence history and a `custody_core.timestamptz` domain let it accept backdated history, while `CREATE RULE ... DO INSTEAD NOTHING` silently discarded migration-history inserts or masked the outbox append-only trigger, and the existing catalogs still passed. Transactional probes prove each drift fails while unrelated objects outside the schema still pass. Casts and `pg_catalog` routines are database-wide, so the catalog also requires that no cast and no `pg_catalog` function or operator was created after `initdb` (OID at or above 16384). The `custody_core` function set is already pinned by the per-object catalog, but a `CREATE CAST (text AS integer)` whose function returned the next version for `0099` let `validate_migration_sequence` accept a forged `(3, '0099_forged_history')` row while every catalog still passed, because the trigger's `substring(...)::integer` resolves through `pg_cast`. Probes cover function, `WITH INOUT` and `WITHOUT FUNCTION` casts and `pg_catalog` routine and operator additions. Initdb-created objects are pinned too: a SHA-256 digest over every `pg_catalog` function and operator row and every cast row must match the pinned PostgreSQL 16.10 image, so editing a built-in in place (for example pointing the integer `<>` operator at a function that always returns false, which let the same forged row through while the execution-surface catalog still passed) also fails. A PostgreSQL image upgrade must re-pin this digest.

`tests/postgres-backup-restore.sh` proves that a backup taken during an uncommitted custody projection contains the complete pre-transaction state, excludes unrelated source schemas, requires a truncated archive to fail without leaving a partial schema, and rejects a structurally valid restore whose archive silently omits custody outbox data even though its catalog and migration history remain canonical. The intact archive restores atomically into a disposable database without changing unrelated target state, reruns the exact installed-catalog and migration-history policies—including exact trigger-definition hashes that reject hidden `WHEN` predicates—and compares a deterministic outbox and migration-history snapshot with the source. The restored database must then accept and exactly replay a new synthetic projection without changing the source database. After that recovery point advances, restoring the still-valid first-generation archive must be detected as stale by the same exact state attestation even though its catalog and migration history remain canonical, while a second-generation backup must reproduce the active state in another disposable database. A restore into a target with pre-existing custody state must fail atomically without changing that state. This is dev-only recovery evidence; it does not establish production RPO/RTO, encryption, retention, high availability or restore-drill approval.

## HSM draft artifacts

`hsm/hsm-policy-draft.json`, `src/hsm-policy.mjs`, `src/tx-decoders.mjs` and `src/watcher.mjs` carry the unapproved draft of the own-HSM program's "engineering work possible now": the HSM-side evaluation contract (quorum structure, per-tier limits and velocity, destination allowlist, intent-to-transaction matching, replay/freeze), independent TON/TRON synthetic wire decoders and a testnet watcher prototype whose unexplained outflows open critical incidents and freeze the network. `tests/hsm-custody.test.mjs` exercises every check arm with synthetic data. See `hsm/README.md` for the contract and promotion path; D-002/D-003 stay `Open`.

`src/wire/` holds the real-format decoders — the co-verifier's second implementation, deliberately independent of `tx-decoders.mjs` (which only reads the dev stack's canonical-JSON wires). `src/wire/protobuf.mjs` is a minimal protobuf reader (varint/fixed/length-delimited, bounded, no groups); `src/wire/tron.mjs` decodes a serialized `protocol.Transaction` — native `TransferContract` (type 1) and `TriggerSmartContract` carrying TRC-20 `transfer(address,uint256)` calldata (type 31, ABI selector `a9059cbb`, 0x41-prefixed 21-byte addresses in 32-byte words, `call_value` must be zero). `src/wire/boc.mjs` is a single-root canonical BoC parser (no CRC inside the boundary, no exotic cells, forward-only refs, bounded depth/size); `src/wire/ton.mjs` decodes the unsigned wallet-v4 input message — `ext_in_msg_info$10` → body → first outbound `int_msg_info$0` — and TEP-74 `0xf8a7ea5` jetton bodies. Raw addresses never surface: callers supply `resolveDestination`/`resolveContractAsset`/`resolveJettonWallet` resolvers that gate every decoded address to the custody registry, and unmapped or malformed wires fail closed. `tests/real-wire-decoders.test.mjs` builds fixtures through its own protobuf encoder and BoC writer — encode→decode round-trips across two independent implementations plus tamper/malformation rejection.

`src/co-verifier.mjs` is the comparison seam between the two decoder families: `verifyWireAgainstCanonical({network, rawPayload, canonical, resolvers})` decodes the real wire and compares every canonical field — chain, network, asset, amount, destination_reference, expiry, sequence — against the shape the policy module trusted, returning a frozen evidence record (`evidence_digest` over both shapes) or failing with a `coverifier_*` reason. It performs no policy mutation, signing or broadcast. Shared fixture encoders live in `tests/fixtures/wire-encode.mjs` so the decoder tests and the co-verifier tests build the same wires through a second implementation.

`src/signer-gateway.mjs` is the transport contract between the orchestrator, the signer gateway and the HSM policy module. `prepareSigningRequest` builds a hash-bound `signing_request` envelope from a verified unsigned intent plus the unsigned synthetic wire payload (request digest covers every field, wire digest pins the exact bytes). `verifySigningRequestEnvelope` is the gateway-side check: exact key shape, digest chain, testnet pinning, request expiry bounded by the intent's own expiry and live policy-version matching. `dispatchSigningRequest` hands `{intent, transaction:{raw_payload}}` to the module's `evaluate` and returns a request-bound `signing_decision` — rejections propagate verbatim, and every violation fails closed. `tests/signer-gateway.test.mjs` exercises the full flow. No signature, key material or production wire ever crosses this contract.

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
bash tests/postgres-execution-surface-catalog.sh
bash tests/postgres-backup-restore.sh
bash tests/postgres-runtime-privileges.sh
```

No test or approval in this package authorizes HSM/MPC provisioning, production keys, customer withdrawals, transaction signing or broadcast.
