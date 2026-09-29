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
| `tests/command-digest-vector.json` | Canonical command consumed by JavaScript and PostgreSQL digest evidence |
| `tests/ledger.test.mjs` | Posting, boundary, idempotency and precision tests |
| `tests/postgres-smoke.sql` | Accepted balanced-journal migration test |
| `tests/postgres-chart-of-accounts.sh` | Exact JSON-to-PostgreSQL account-definition round-trip |
| `tests/postgres-posting-rule-registry.sh` | Exact JSON-to-PostgreSQL posting-rule registry comparison |
| `tests/postgres-concurrency.sh` | Overlapping acceptance and late-entry race regression |
| `tests/postgres-owner-truncate-guard.sh` | Migration-owner truncation denial regression |
| `tests/postgres-immutability-catalog.sh` | Exact installed immutability-trigger policy comparison |
| `tests/runtime-writer-grants.sql` | Test-only least-privilege profile for a future non-owner posting role |
| `tests/postgres-runtime-privileges.sh` | Runtime-role acceptance and denied-mutation regression |
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

The posting service, not its caller, stamps `accepted_at`. Migration `0003` refuses to auto-seal pre-existing journals because their original command-to-entry binding cannot be reconstructed safely. An entry statement that overlaps creation of its parent journal waits for the foreign key and fails closed because that statement cannot adopt the concurrently committed parent. Any entry statement started after acceptance sees the seal and is rejected by the append trigger. The migrations grant no runtime writer. The test-only grant profile proves that a non-owner role can accept a complete journal without receiving mutation, truncation, configuration or DDL powers; it is not deployment provisioning and is not applied by migrations. A future environment-specific role may receive an independently reviewed profile only after D-009, threat-model and deployment approvals. Outbox payloads contain only the journal ID and command digest; delivery state is represented by append-only delivery attempts rather than mutation of the event.

## Local verification

```bash
npm ci
npm audit --audit-level=moderate
npm run verify
```

PostgreSQL verification uses only synthetic data:

```bash
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
bash tests/postgres-runtime-privileges.sh
```

The concurrency regression begins a balanced late-entry statement while the parent journal acceptance transaction is still open. That statement must fail its foreign key after waiting for acceptance, and a fresh post-acceptance statement must fail against the committed seal. The final journal must retain only its original entries and one seal. The `postgres-reject-*` fixtures must exit non-zero because completeness, sealing, precision and posting-rule constraints reject them.

The chart regression loads every canonical definition through the real PostgreSQL constraints, exports all persisted policy fields in deterministic C-collation order and rolls the transaction back. Strict equality proves schema compatibility without provisioning chart configuration in migrations or changing runtime state.

The owner truncation regression exercises every append-only configuration and ledger table with the migration owner. Each `TRUNCATE ... CASCADE` must fail through a statement-level trigger, proving that accidental bulk deletion is blocked independently of the future runtime role's denied grants.

The immutability catalog regression reads the installed PostgreSQL trigger metadata and requires an exact match for all 22 mutation guards. It fails when a protected table, trigger event, row/statement level, always-enabled state or `reject_mutation` function binding differs from the expected policy. It also proves representative `UPDATE`, `DELETE` and `TRUNCATE` statements fail after switching the test session to replica mode.

The posting-rule registry regression exports every policy field from PostgreSQL in deterministic C-collation order and requires deep equality with the flattened canonical JSON registry. A missing, extra or changed SQL rule fails CI rather than silently diverging from the JavaScript boundary.

The runtime privilege regression creates an ephemeral `NOLOGIN`, `NOINHERIT`, non-owner role in the synthetic test database. It proves the exact posting transaction can commit with the proposed grants while direct configuration writes, `UPDATE`, `DELETE`, `TRUNCATE` and trigger-disabling DDL fail before reaching application code.

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
