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
| `tests/ledger.test.mjs` | Posting, boundary, idempotency and precision tests |
| `tests/postgres-smoke.sql` | Accepted balanced-journal migration test |
| `tests/postgres-reject-incomplete.sql` | Database rejection test for a one-entry journal |
| `tests/postgres-reject-unbalanced.sql` | Database rejection test for an unbalanced journal |

## Foundation invariants

1. A journal contains at least two immutable entries.
2. Debits equal credits independently for every asset in the journal.
3. Every account and entry belongs to one legal-entity boundary.
4. Monetary command values are canonical decimal strings; JavaScript numbers are not accepted.
5. Asset scales are explicit and limited to 18 decimals; precision is limited to 78 digits.
6. An idempotency key can replay only an identical command.
7. The accepted journal stores actor, authorization, policy, posting-rule, correlation and evidence references.
8. Journal acceptance, idempotency registration and immutable outbox creation form one database transaction.
9. Balance views are derived projections; no mutable balance column exists.
10. Update and delete operations on financial-core records fail closed.
11. A posting command must match a registered `journal_type` + `posting_rule_version` and exact per-asset entry pattern.
12. Projection snapshots and trial balance are deterministically rebuilt from immutable entries.

The current posting-rule registry contains one `synthetic-test-only` rule. It is evidence for version binding and pattern enforcement, not approved production accounting.

## PostgreSQL transaction contract

The future posting service must use one transaction:

1. lock or create the idempotency decision;
2. insert one journal;
3. insert all entries;
4. insert the matching idempotency record;
5. insert the immutable internal outbox event;
6. commit after deferred database invariants pass.

The posting service, not its caller, stamps `accepted_at`. The migration grants no runtime writer. A future environment-specific role must receive the minimum explicit permissions only after D-009, threat-model and deployment approvals. Outbox payloads contain only the journal ID and command digest; delivery state is represented by append-only delivery attempts rather than mutation of the event.

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

docker exec -i solidchange-ledger-test \
  psql -U ledger_test -d ledger_test -v ON_ERROR_STOP=1 \
  < tests/postgres-smoke.sql
```

The `postgres-reject-*` fixtures must exit non-zero because deferred completeness and balance constraints reject them.

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

Those capabilities begin in Session D only after Finance approves the chart, posting rules and test evidence.
