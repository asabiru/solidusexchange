# Migration Boundary

## Principle

Legacy SolidChange is an inventory and migration source. The regulated core becomes source of truth only after signed migration journals, independent reconciliation and explicit cutover approval.

## Context boundary

| Legacy context | Target context | Migration mode |
|---|---|---|
| Customer/admin identity | Identity and access | Mapped IDs; credentials are reset or federated, not copied blindly |
| KYC records and provider payloads | Customer risk / evidence | Provenance-preserving import after legal retention review |
| Exchange/buy/sell requests | Orders and historical activity | Immutable history plus exception classification |
| Transactions, deposits and payouts | Double-entry ledger and settlement | Reconstructed postings; never direct balance writes |
| Wallet addresses and provider refs | Custody/wallet registry | Ownership and chain verification required |
| Gateway/provider configuration | Provider adapters | Contract and vendor review; no credential migration |
| Notifications/content | Communications | Template review, localization and consent mapping |

## Required migration pipeline

1. Freeze a versioned legacy schema definition.
2. Produce read-only extracts in an approved environment.
3. Record source snapshot ID, table counts, checksums and extraction time.
4. Normalize identities and create explicit legacy-to-canonical mappings.
5. Classify every financial record as settled, pending, cancelled, disputed or unresolved.
6. Reconstruct expected customer, treasury and provider positions.
7. Reconcile against blockchain, bank/provider statements and custody evidence.
8. Create target ledger accounts.
9. Post opening balances through a balanced, signed migration journal.
10. Route every discrepancy to a case; do not use balancing plugs without Finance approval.
11. Run parallel read-only comparison for the approved observation window.
12. Freeze legacy money movement, reconcile again and obtain go/no-go.
13. Switch approved traffic gradually; preserve legacy read-only according to retention policy.

## Mapping contract

Every imported record must carry:

- `migration_run_id`;
- source system and table;
- source primary key;
- canonical entity ID;
- source snapshot timestamp;
- payload digest;
- transformation version;
- classification/result;
- actor or automated job identity;
- linked case for rejection or discrepancy.

## Financial acceptance

- Every journal is balanced: total debit equals total credit.
- Each source record is imported exactly once or explicitly rejected.
- Duplicate extraction/import produces the same result.
- Opening balances reconcile by customer, asset, legal entity, provider and custody location.
- Pending deposits/withdrawals and open orders have an explicit disposition.
- Corrections use reversal/correction journals; no target balance column is updated directly.
- Finance signs the reconciliation pack independently from the engineer who ran migration.

## Identity and KYC acceptance

- 100% of in-scope customers are mapped or explicitly rejected.
- Email/phone conflicts and duplicate identities are resolved through cases.
- Password hashes and MFA seeds are not assumed portable.
- KYC evidence retains provider provenance, decision time and policy version.
- Eligibility is recalculated against current policy before enabling financial operations.
- PII import and retention are approved by Legal/Compliance.

## Custody acceptance

- Address ownership is proven independently.
- On-chain balances and pending transactions reconcile at an approved block height.
- Private keys and mnemonic are never transferred through application exports.
- Any key migration follows an approved key ceremony with dual control.
- Unknown ownership, unsupported network or balance mismatch blocks cutover.

## Explicitly prohibited

- Copying production `.env` or provider credentials.
- Committing SQL dumps containing customer data or secret-like values.
- Sending private keys, mnemonic or raw PII through chat, email or SFTP.
- Updating target balances through SQL.
- Treating provider callback status as final settlement without reconciliation.
- Enabling live withdrawals/exchange during migration rehearsal.
- Deleting legacy evidence before retention approval and restore verification.

## Rollback boundary

Rollback is permitted only while one system is the exclusive writer for an asset flow. Dual-write money movement is not allowed. After target execution starts, rollback must use controlled compensating operations and reconciliation rather than database restoration over newer financial events.
