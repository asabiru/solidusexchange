# ADR-0002: Ledger Is the Financial Source of Truth

- Status: Proposed
- Date: 2026-09-25
- Owners: Financial Core Lead / CFO
- Required approvers: CTO, Finance, Security

## Context

Legacy transactions, requests, deposits and payouts record business events and amounts, but they do not enforce balanced postings or provide a single reconstructable financial position. Provider callbacks and workflow statuses also cannot establish accounting finality.

## Decision

The new regulated core uses an append-only double-entry ledger as the only source of financial truth.

- Every financial effect is represented by a journal with at least two entries.
- Total debits equal total credits in each asset and legal-entity boundary.
- An acceptance seal binds the immutable command digest to the final entry count.
- Balances are projections rebuilt from entries, never mutable source fields.
- Holds/reservations are modeled explicitly and do not silently change settled balances.
- Corrections use reversal and correcting journals.
- External commands and callbacks are idempotent and linked to journals.
- Provider, bank, blockchain and custody positions are reconciled to ledger control accounts.
- Migration opening positions are posted through signed journals after reconciliation.

## Non-ledger records

Orders, withdrawals, deposits, payment intents, provider events and cases remain domain records. They describe workflow and evidence, but their monetary effect exists only when linked to an accepted ledger journal.

## Posting boundary

Only the ledger posting service may persist journals and entries. Controllers, provider callbacks, operators and background jobs submit typed commands; they cannot update balances or ledger tables directly.

## Required controls

- Database transaction around journal acceptance, idempotency, outbox event and acceptance seal.
- Database rejection of every entry insert after the acceptance seal.
- Uniqueness on external operation and idempotency keys.
- Integer/minor-unit or asset-scale-safe numeric representation with one cross-runtime precision rule.
- Chart-of-accounts and posting-rule versioning, with rule, actor and entry-pattern binding enforced in the database.
- Immutable actor, correlation, policy and source evidence.
- Trial balance and projection rebuild tests.
- Reconciliation breaks and suspense accounts with accountable review.

## Consequences

Historical legacy records require reconstruction rather than copying a balance column. Provider completion cannot settle a customer position until matching, posting and reconciliation rules pass.

## Approval effect

Approval authorizes schema/contracts and test postings. It does not authorize importing production balances or executing live financial operations.
