# SolidChange Financial Core — Ledger Foundation

This package implements Session C of the regulated-core roadmap: a dev-only, dependency-free reference posting boundary plus an initial PostgreSQL schema for append-only double-entry journals.

## Status and authority

- Runtime boundary: `dev-dry-run`.
- Financial execution: disabled.
- Production assets, balances, providers and customer data: absent.
- Chart of accounts status: draft pending Finance, CTO and Security approval.
- PostgreSQL remains the proposed target under D-009; this migration is not production database approval.
- Accepted test journals establish no legal, accounting or settlement finality.

Only the ledger posting boundary may accept journals. Controllers, provider callbacks, operators and agents must submit a complete posting command; they cannot update balances or ledger rows directly. AI actors are not accepted by the posting command.

## Artifacts

| Artifact | Purpose |
|---|---|
| `chart-of-accounts.json` | Versioned draft account definitions and safe scope flags |
| `posting-rules.json` | Versioned synthetic-only posting rule registry |
| `schemas/posting-command.schema.json` | Strict command envelope for a proposed journal |
| `src/ledger.mjs` | In-memory posting boundary, trial balance and deterministic projection rebuild |
| `src/amount.mjs` | Exact decimal-string to minor-unit conversion |
| `migrations/0001_ledger_foundation.sql` | Initial PostgreSQL schema and database invariants |
| `migrations/0002_ledger_verification_views.sql` | Security-invoker account projection and trial-balance views |
| `migrations/0003_ledger_acceptance_seal.sql` | Journal sealing, database posting-rule binding and precision alignment |
| `migrations/0004_ledger_truncate_guard.sql` | Owner-level truncation denial for append-only financial tables |
| `migrations/0005_ledger_trigger_replication_guard.sql` | Immutability triggers enforced in every PostgreSQL replication mode |
| `migrations/0006_ledger_invariant_replication_guard.sql` | Insert and acceptance invariant triggers enforced in every replication mode |
| `migrations/0007_ledger_replica_reference_guard.sql` | Critical foreign-key references mirrored by always-enabled user triggers |
| `migrations/0008_ledger_acceptance_artifact_guard.sql` | Journal acceptance timestamp binding for idempotency and outbox artifacts |
| `migrations/0009_ledger_acceptance_timeline_guard.sql` | Journal and entry timestamps bound to the immutable acceptance timeline |
| `migrations/0010_ledger_finite_timestamp_guard.sql` | Finite-time constraints for every persisted PostgreSQL timestamp |
| `migrations/0011_ledger_migration_sequence_guard.sql` | Always-enabled sequential migration insert guard |
| `tests/command-digest-vector.json` | Canonical command consumed by JavaScript and PostgreSQL digest evidence |
| `tests/ledger.test.mjs` | Posting, boundary, idempotency and precision tests |
| `tests/postgres-smoke.sql` | Accepted balanced-journal migration test |
| `tests/postgres-migration-source-catalog.sh` | Exact SQL migration file-name and SHA-256 catalog with negative drift evidence |
| `tests/postgres-migration-source-policy.sh` | Sequential file, atomic transaction and canonical history-row policy |
| `tests/postgres-migration-history.sh` | Exact migration manifest, chronology, insert guard, failed-transaction rollback and rejected drift evidence |
| `tests/postgres-chart-of-accounts.sh` | Exact JSON-to-PostgreSQL account-definition round-trip |
| `tests/postgres-posting-rule-registry.sh` | Exact JSON-to-PostgreSQL posting-rule registry comparison |
| `tests/postgres-concurrency.sh` | Overlapping acceptance and late-entry race regression |
| `tests/postgres-owner-truncate-guard.sh` | Migration-owner truncation denial regression |
| `tests/postgres-immutability-catalog.sh` | Exact installed immutability-trigger policy comparison |
| `tests/postgres-trigger-function-catalog.sh` | Exact installed trigger-function policy and source-hash comparison |
| `tests/postgres-constraint-catalog.sh` | Exact installed constraint/index policy and replica-mode rejection evidence |
| `tests/postgres-relation-catalog.sh` | Exact installed table/view/column policy and replica-mode NOT NULL evidence |
| `tests/postgres-access-control-catalog.sh` | Exact ownership/ACL policy and rejected privilege-drift evidence |
| `tests/postgres-invariant-trigger-catalog.sh` | Exact invariant-trigger policy and replica-mode rejection evidence |
| `tests/postgres-replica-reference-integrity.sh` | Replica-mode critical reference-integrity rejection evidence |
| `tests/postgres-acceptance-artifact-integrity.sh` | Normal and replica-mode rejection of mismatched acceptance timestamps |
| `tests/postgres-finite-timestamps.sh` | Replica-mode rejection of PostgreSQL positive and negative infinity timestamps |
| `tests/postgres-state-snapshot.sql` | Canonical financial-core tables and verification-view state snapshot |
| `tests/postgres-backup-consistency.sql` | Uncommitted balanced journal fixture held open during a logical backup |
| `tests/postgres-backup-continuity.sql` | Post-restore journal acceptance and read-model continuity fixture |
| `tests/postgres-backup-restore.sh` | Synthetic snapshot, scoped isolation, corruption, atomic restore, canonical migration-history attestation, occupied-target rejection, continuity and chained-recovery regression |
| `tests/runtime-writer-grants.sql` | Test-only least-privilege profile for a future non-owner posting role |
| `tests/postgres-runtime-privileges.sh` | Runtime-role acceptance and denied-mutation regression |
| `tests/postgres-runtime-privilege-catalog.sql` | Effective runtime-role and `PUBLIC` grants across financial-core objects |
| `scripts/verify-postgres-runtime-privilege-catalog.mjs` | Exact reviewed runtime writer privilege profile |
| `tests/postgres-reject-incomplete.sql` | Database rejection test for a one-entry journal |
| `tests/postgres-reject-unbalanced.sql` | Database rejection test for an unbalanced journal |
| `tests/postgres-reject-late-entry.sql` | Database rejection test for post-acceptance entry insertion |
| `tests/postgres-reject-rule-*.sql` | Database posting-rule, actor and entry-pattern rejection tests |
| `tests/postgres-precision-*.sql` | JavaScript/PostgreSQL 78-digit boundary evidence |
| `tests/postgres-reject-nonfinite.sql` | Database rejection evidence for non-finite numeric values |

## Foundation invariants

1. A journal contains at least two immutable entries.
2. Debits equal credits independently for every asset in the journal.
3. Every account and entry belongs to one legal-entity boundary.
4. Monetary command values are canonical decimal strings; JavaScript numbers are not accepted.
5. Asset scales are explicit and limited to 18 decimals; finite entry precision is limited to 78 whole-plus-fraction digits, including retained fractional zeros.
6. An idempotency key can replay only an identical command.
7. The accepted journal stores actor, authorization, policy, posting-rule, correlation and evidence references.
8. Journal acceptance, idempotency registration, immutable outbox creation and sealing form one database transaction.
9. Balance views are derived projections; no mutable balance column exists.
10. Update, delete and owner-level truncate operations on financial-core records fail closed in every PostgreSQL replication mode.
11. A committed acceptance seal prevents later entries from being appended, including an entry transaction that overlaps journal acceptance.
12. JavaScript and PostgreSQL both enforce the registered `journal_type` + `posting_rule_version`, allowed actor and exact per-asset entry pattern.
13. Projection snapshots and trial balance are deterministically rebuilt from immutable entries.
14. A future posting role must be a non-owner with explicit `SELECT`/`INSERT` grants only; `UPDATE`, `DELETE`, `TRUNCATE`, configuration writes and DDL remain denied.
15. Every PostgreSQL posting-rule row must exactly match the canonical `posting-rules.json` policy fields.
16. Every canonical chart definition must satisfy the PostgreSQL schema and survive an exact, deterministic round-trip.
17. User-defined account, amount, seal and journal-completeness safeguards fail closed in every PostgreSQL replication mode.
18. Account, asset, posting-rule, journal, ledger-account and outbox references remain fail closed when replica mode suppresses PostgreSQL's internal foreign-key triggers.
19. The installed check, uniqueness, primary-key, foreign-key and standalone unique-index catalog must exactly match the reviewed policy; checks and uniqueness remain active in replica mode.
20. The installed table, verification-view and column catalog must exactly match the reviewed logged-storage, type, nullability, default and view-definition policy; NOT NULL remains active in replica mode.
21. The financial-core schema, relations and functions remain migration-owner controlled with no `PUBLIC`, non-owner or column-specific grants and no migration-owner default-ACL overrides.
22. The idempotency record and immutable outbox event must use the journal's service-stamped `accepted_at`, including in PostgreSQL replica mode.
23. The journal `created_at` and every entry `created_at` must equal that same `accepted_at`, including in PostgreSQL replica mode.
24. A synthetic logical backup must restore every financial-core table, verification view, reviewed database policy and canonical migration-history chronology to an exact state in a disposable database.
25. A truncated logical backup must fail restoration atomically and leave no partial `financial_core` schema in its disposable database.
26. A logical backup taken while a complete journal is still uncommitted must restore the exact prior committed state, without any partial acceptance artifacts.
27. After exact restore verification, the restored database must accept a new complete journal and advance projections and trial balance without mutating the source database.
28. An active restored database must produce a second-generation logical backup that restores the complete post-recovery state and reviewed database policy exactly.
29. Reapplying a logical backup to an occupied financial-core target must fail atomically without changing its canonical state.
30. A financial-core logical backup must neither copy unrelated source schemas nor alter unrelated state already present in the restore target.
31. Every persisted financial-core timestamp must be finite; PostgreSQL positive and negative infinity are rejected even in replica mode.
32. Installed migration versions and names must exactly match the reviewed canonical manifest and their `applied_at` chronology must follow version order; missing, renamed, out-of-order or extra history fails verification.
33. New migration-history rows must be the next sequential version, encode that version in `migration_name`, and have a later finite `applied_at`; the guard remains active in replica mode.
34. Every reviewed SQL migration source file must retain its exact canonical name and SHA-256 digest; changed, missing or extra migration files fail before database application.
35. Migration source filenames must form a contiguous sequence from `0001`; every file must use one outer `BEGIN`/`COMMIT` transaction and record exactly one history row matching its filename and numeric version.
36. Migration sources must not contain psql meta-commands or additional transaction-control statements that could escape the reviewed atomic boundary.

The JavaScript test and PostgreSQL smoke journal consume the same canonical command vector. Structural verification recomputes its SHA-256 digest before either runtime uses it.

The current posting-rule registry contains one `synthetic-test-only` rule. It is evidence for version binding and pattern enforcement, not approved production accounting.

## PostgreSQL transaction contract

The future posting service must use one transaction:

1. lock or create the idempotency decision;
2. insert one journal;
3. insert all entries;
4. insert the matching idempotency record;
5. insert the immutable internal outbox event;
6. insert the acceptance seal with the command digest and final entry count;
7. commit after deferred database invariants pass.

The posting service, not its caller, stamps `accepted_at`. Migration `0003` refuses to auto-seal pre-existing journals because their original command-to-entry binding cannot be reconstructed safely. An entry statement that overlaps creation of its parent journal waits for the foreign key and fails closed because that statement cannot adopt the concurrently committed parent. Any entry statement started after acceptance sees the seal and is rejected by the append trigger. The migrations grant no runtime writer. The test-only grant profile proves that a non-owner role can accept a complete journal without receiving mutation, truncation, configuration or DDL powers; it is not deployment provisioning and is not applied by migrations. A future environment-specific role may receive an independently reviewed profile only after D-009, threat-model and deployment approvals. Outbox payloads contain only the journal ID and command digest; delivery state is represented by append-only delivery attempts rather than mutation of the event. The journal `created_at`, every entry `created_at`, idempotency `first_seen_at`, outbox `created_at` and acceptance seal `sealed_at` must all equal the journal `accepted_at`, so one committed acceptance cannot contain conflicting audit timestamps. Every timestamp column additionally rejects PostgreSQL `infinity` and `-infinity`, preventing non-finite audit or configuration time from satisfying equality-based controls.

## Local verification

```bash
npm ci
npm audit --audit-level=moderate
npm run verify
```

PostgreSQL verification uses only synthetic data:

```bash
bash tests/postgres-migration-source-catalog.sh
bash tests/postgres-migration-source-policy.sh

docker run --rm --name solidchange-ledger-test \
  -e POSTGRES_USER=ledger_test \
  -e POSTGRES_PASSWORD=ledger_test \
  -e POSTGRES_DB=ledger_test \
  -d -p 55432:5432 \
  postgres:16.10-alpine3.22@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297

for migration in migrations/*.sql; do
  docker exec -i solidchange-ledger-test \
    psql -U ledger_test -d ledger_test -v ON_ERROR_STOP=1 \
    < "$migration"
done

PGHOST=127.0.0.1 \
PGPORT=55432 \
PGUSER=ledger_test \
PGDATABASE=ledger_test \
PGPASSWORD=ledger_test \
PSQL_DOCKER_IMAGE=postgres:16.10-alpine3.22@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297 \
bash tests/postgres-migration-history.sh

PGHOST=127.0.0.1 \
PGPORT=55432 \
PGUSER=ledger_test \
PGDATABASE=ledger_test \
PGPASSWORD=ledger_test \
PSQL_DOCKER_IMAGE=postgres:16.10-alpine3.22@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297 \
bash tests/postgres-owner-truncate-guard.sh

PGHOST=127.0.0.1 \
PGPORT=55432 \
PGUSER=ledger_test \
PGDATABASE=ledger_test \
PGPASSWORD=ledger_test \
PSQL_DOCKER_IMAGE=postgres:16.10-alpine3.22@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297 \
bash tests/postgres-immutability-catalog.sh

PGHOST=127.0.0.1 \
PGPORT=55432 \
PGUSER=ledger_test \
PGDATABASE=ledger_test \
PGPASSWORD=ledger_test \
PSQL_DOCKER_IMAGE=postgres:16.10-alpine3.22@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297 \
bash tests/postgres-trigger-function-catalog.sh

PGHOST=127.0.0.1 \
PGPORT=55432 \
PGUSER=ledger_test \
PGDATABASE=ledger_test \
PGPASSWORD=ledger_test \
PSQL_DOCKER_IMAGE=postgres:16.10-alpine3.22@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297 \
bash tests/postgres-chart-of-accounts.sh

docker exec -i solidchange-ledger-test \
  psql -U ledger_test -d ledger_test -v ON_ERROR_STOP=1 \
  -v "command_vector_json=$(tr -d '\n' < tests/command-digest-vector.json)" \
  < tests/postgres-smoke.sql

PGHOST=127.0.0.1 \
PGPORT=55432 \
PGUSER=ledger_test \
PGDATABASE=ledger_test \
PGPASSWORD=ledger_test \
PSQL_DOCKER_IMAGE=postgres:16.10-alpine3.22@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297 \
bash tests/postgres-constraint-catalog.sh

PGHOST=127.0.0.1 \
PGPORT=55432 \
PGUSER=ledger_test \
PGDATABASE=ledger_test \
PGPASSWORD=ledger_test \
PSQL_DOCKER_IMAGE=postgres:16.10-alpine3.22@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297 \
bash tests/postgres-relation-catalog.sh

PGHOST=127.0.0.1 \
PGPORT=55432 \
PGUSER=ledger_test \
PGDATABASE=ledger_test \
PGPASSWORD=ledger_test \
PSQL_DOCKER_IMAGE=postgres:16.10-alpine3.22@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297 \
bash tests/postgres-access-control-catalog.sh

PGHOST=127.0.0.1 \
PGPORT=55432 \
PGUSER=ledger_test \
PGDATABASE=ledger_test \
PGPASSWORD=ledger_test \
PSQL_DOCKER_IMAGE=postgres:16.10-alpine3.22@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297 \
bash tests/postgres-invariant-trigger-catalog.sh

PGHOST=127.0.0.1 \
PGPORT=55432 \
PGUSER=ledger_test \
PGDATABASE=ledger_test \
PGPASSWORD=ledger_test \
PSQL_DOCKER_IMAGE=postgres:16.10-alpine3.22@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297 \
bash tests/postgres-replica-reference-integrity.sh

PGHOST=127.0.0.1 \
PGPORT=55432 \
PGUSER=ledger_test \
PGDATABASE=ledger_test \
PGPASSWORD=ledger_test \
PSQL_DOCKER_IMAGE=postgres:16.10-alpine3.22@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297 \
bash tests/postgres-acceptance-artifact-integrity.sh

PGHOST=127.0.0.1 \
PGPORT=55432 \
PGUSER=ledger_test \
PGDATABASE=ledger_test \
PGPASSWORD=ledger_test \
PSQL_DOCKER_IMAGE=postgres:16.10-alpine3.22@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297 \
bash tests/postgres-finite-timestamps.sh

PGHOST=127.0.0.1 \
PGPORT=55432 \
PGUSER=ledger_test \
PGDATABASE=ledger_test \
PGPASSWORD=ledger_test \
PSQL_DOCKER_IMAGE=postgres:16.10-alpine3.22@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297 \
bash tests/postgres-posting-rule-registry.sh

PGHOST=127.0.0.1 \
PGPORT=55432 \
PGUSER=ledger_test \
PGDATABASE=ledger_test \
PGPASSWORD=ledger_test \
PSQL_DOCKER_IMAGE=postgres:16.10-alpine3.22@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297 \
bash tests/postgres-concurrency.sh

PGHOST=127.0.0.1 \
PGPORT=55432 \
PGUSER=ledger_test \
PGDATABASE=ledger_test \
PGPASSWORD=ledger_test \
PSQL_DOCKER_IMAGE=postgres:16.10-alpine3.22@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297 \
bash tests/postgres-backup-restore.sh

PGHOST=127.0.0.1 \
PGPORT=55432 \
PGUSER=ledger_test \
PGDATABASE=ledger_test \
PGPASSWORD=ledger_test \
PSQL_DOCKER_IMAGE=postgres:16.10-alpine3.22@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297 \
bash tests/postgres-runtime-privileges.sh
```

The concurrency regression begins a balanced late-entry statement while the parent journal acceptance transaction is still open. That statement must fail its foreign key after waiting for acceptance, and a fresh post-acceptance statement must fail against the committed seal. The final journal must retain only its original entries and one seal. The `postgres-reject-*` fixtures must exit non-zero because completeness, sealing, precision and posting-rule constraints reject them.

The chart regression loads every canonical definition through the real PostgreSQL constraints, exports all persisted policy fields in deterministic C-collation order and rolls the transaction back. Strict equality proves schema compatibility without provisioning chart configuration in migrations or changing runtime state.

The owner truncation regression exercises every append-only configuration and ledger table with the migration owner. Each `TRUNCATE ... CASCADE` must fail through a statement-level trigger, proving that accidental bulk deletion is blocked independently of the future runtime role's denied grants.

The immutability catalog regression reads the installed PostgreSQL trigger metadata and requires an exact match for all 22 mutation guards. It fails when a protected table, trigger event, row/statement level, always-enabled state or `reject_mutation` function binding differs from the expected policy. It also proves representative `UPDATE`, `DELETE` and `TRUNCATE` statements fail after switching the test session to replica mode.

The trigger-function catalog regression requires an exact match for all eight installed ledger trigger functions. It verifies each function's SHA-256 source digest, fixed search path, language, return type, execution flags and owner-only access, so replacing a guard with a weaker body, catalog configuration or execution grant fails CI.

The constraint catalog regression requires an exact match for all 96 installed table constraints and the standalone account-identity unique index, including definitions, validation and backing-index state. It also proves amount checks, entry-sequence uniqueness, idempotency uniqueness and account-identity uniqueness still reject invalid writes in replica mode.

The relation catalog regression requires an exact match for all 11 logged tables, both security-invoker verification views and all 102 exposed columns. It covers relation persistence, access method, row-security and replica-identity state; view definitions; and column order, types, nullability, defaults, identity/generated flags, collation, storage and compression. It also proves critical journal, entry and outbox `NOT NULL` requirements reject null writes in replica mode.

The access-control catalog regression requires the schema, all 13 relations and all eight trigger functions to retain migration-owner ownership and their exact owner-only ACLs. It also requires all 102 visible columns to have no column-specific grants and no global or financial-core default-ACL overrides for the migration owner. Financial-core migrations intentionally avoid role-level `ALTER DEFAULT PRIVILEGES`, which could affect future objects outside this package; every created object instead revokes `PUBLIC` access in its migration transaction. Transactional negative probes prove that schema, relation, column or function grants to `PUBLIC` change the digest and fail verification without provisioning a runtime or production role.

The invariant-trigger catalog regression requires all 11 user-defined insert and acceptance triggers to remain `ENABLE ALWAYS` with their exact timing, deferral and function bindings. It then proves invalid account ownership, excessive precision, post-seal entries and incomplete journals are rejected after switching the session to replica mode.

The replica reference-integrity regression accounts for PostgreSQL suppressing internal foreign-key triggers in replica mode. Always-enabled user triggers mirror the critical acceptance references and reject missing account definitions, assets, posting rules, journals, matching ledger accounts and outbox events. This is synthetic database evidence, not approval to configure replication or production roles.

The acceptance-artifact regression proves that journal, entry, idempotency and outbox timestamps cannot diverge from the journal acceptance timestamp in either normal or replica mode. The rejected transactions are synthetic and do not provision runtime or production roles.

The finite-timestamp regression proves all 13 PostgreSQL timestamp constraints reject `infinity` and `-infinity` while replica mode is active. Exact catalog verification makes removal or weakening of any one constraint fail CI.

The migration source catalog pins the exact file name and SHA-256 digest of every reviewed SQL migration from `0001` through `0011`. Canonical verification runs before database application, while disposable copies prove that changing a historical file, removing a migration or adding an unreviewed SQL file fails closed.

The migration source policy independently requires contiguous numeric filenames, one outer transaction boundary and one canonical `schema_migrations` row per file. It also rejects psql meta-commands and additional transaction-control statements that could execute unreviewed input or escape the atomic boundary. Disposable copies prove that a missing `BEGIN`, hidden `ROLLBACK`, psql include, history-row mismatch, duplicate history row and skipped source version all fail before database application.

The migration-history regression requires the installed version/name rows to exactly match migrations `0001` through `0011` and their `applied_at` chronology to follow version order. A transactional synthetic extra row must make the verifier fail, after which rollback and a second canonical verification prove the database history remains unchanged. A disposable database injects a failure after migration `0002` creates both verification views and records its history row; connection rollback must leave neither views nor history behind, and the canonical migration must then apply cleanly. A separate disposable database applies migrations `0003` and `0002` in reverse order before completing the manifest; the exact names remain present, but chronology verification must fail closed. Migration `0011` additionally rejects skipped versions, mismatched numeric name prefixes and stale application timestamps at insert time, including replica mode.

The posting-rule registry regression exports every policy field from PostgreSQL in deterministic C-collation order and requires deep equality with the flattened canonical JSON registry. A missing, extra or changed SQL rule fails CI rather than silently diverging from the JavaScript boundary.

The runtime privilege regression creates an ephemeral `NOLOGIN`, `NOINHERIT`, non-owner role in the synthetic test database. It proves the exact posting transaction can commit with the proposed grants while direct configuration writes, forged migration-history rows, `UPDATE`, `DELETE`, `TRUNCATE` and trigger-disabling DDL fail before reaching application code. After the test-only profile is applied, every effective grant held by the role or `PUBLIC` on the financial-core schema, relations, columns, functions, types and default ACLs must exactly equal the reviewed profile: schema `USAGE`, `SELECT` on three configuration tables and `SELECT`/`INSERT` on the five acceptance tables, all without grant option. Transactional probes prove that an extra migration-history insert grant, an unreviewed relation read, a column-level `UPDATE`, a grant option, a function `EXECUTE` grant or a `PUBLIC` configuration write fail verification and roll back. The profile remains synthetic evidence, not runtime writer provisioning.

The logical backup/restore regression dumps only the synthetic `financial_core` schema. A source-only sentinel schema must be excluded from the archive, while different unrelated state already present in the restore target must survive both the successful restore and a rejected retry unchanged. The regression first holds a complete balanced journal uncommitted while `pg_dump` takes its snapshot; restoring that archive must reproduce the exact canonical state from before the transaction and contain none of the pending acceptance artifacts. It then truncates a copy of a post-commit archive and requires `pg_restore --single-transaction` to reject it without leaving a partial schema. Finally, it restores the intact archive into a separate disposable database, reruns the exact trigger, function, constraint, relation, access-control and migration-history policies, rejects synthetic unreviewed restored history without persisting it, and requires every base table and both verification views to match the source byte-for-byte after JSON normalization. Reapplying the same archive to that occupied target must fail atomically and leave its canonical state unchanged. Only after exact parity is preserved, the restored database accepts a new synthetic journal; account projections and trial balance must advance correctly while the source database remains unchanged. That active restored state is backed up again and restored into a second disposable database, where the full canonical state, migration history and reviewed catalog policy must match exactly. This is dev-only recoverability evidence; it does not satisfy production RPO/RTO, retention, encryption, HA or D-017 restore-drill approval.

## Finance approval gate

The review checklist and sign-off template are in `Documentation/regulated-core/finance-ledger-approval-pack.md`. Approval must reference the immutable commit under review. Until Finance, CTO and Security approve that evidence, Session D remains blocked and this package stays synthetic/dev-only.

## Explicit exclusions

Session C does not implement:

- holds or available-balance reservations;
- reversals, correcting journals or adjustments;
- fees/spread posting workflows;
- reconciliation matching, breaks or Finance reports;
- opening-balance migration;
- runtime API handlers;
- live provider, custody, bank, exchange or withdrawal execution.

Those capabilities begin in Session D only after Finance, CTO and Security approve the chart, posting rules and test evidence at the same immutable commit.
