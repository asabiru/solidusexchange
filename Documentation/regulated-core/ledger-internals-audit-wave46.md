# Ledger Internals Audit — Wave 46 — Proposed

- Status: Proposed
- Scope: `packages/financial-core` in-memory ledger internals — `src/ledger.mjs` (entry store, balance derivation, idempotency registry, projection and snapshot machinery) and `src/amount.mjs` (exact decimal conversion) — read against the persisted contract in `migrations/*.sql`, plus in-repo consumers (the package's own `node --test` suites and `scripts/check-foundation.mjs`; no other workspace package imports it).
- Production effect: none

## Scope reviewed

- Entry store: `journals`/`idempotency` maps, `snapshotPlainData` input capture, `freezeDeep`/`structuredClone` isolation of stored and returned objects.
- Balance conservation: per-asset BigInt minor-unit totals in `validateCommand`, `getProjection` normal-side application, `getTrialBalance` grouping, `rebuildProjectionSnapshot` digests.
- Reversal/adjustment surface: `reversals_in_scope` must stay `false` — no reversal machinery exists to attack; `causation_id` remains an uninterpreted UUID.
- Idempotency: `(legal_entity_id, idempotency_key)` replay vs `LEDGER_IDEMPOTENCY_CONFLICT`, `command_digest` canonicalization, retry/duplicate interplay.
- Account model: `validateAccounts` identity tuples, owner-scope rules, UUID-form identity fields, sign conventions via `NORMAL_SIDE`.
- Hash/digest machinery: `canonicalize` + `JSON.stringify` sorted-key serialization feeding `command_digest` and `snapshot_digest` — the same non-canonical-leaf class as the custody #246 finding.

## Defects found and fixed

1. **Entry IDs were unique only inside a single journal.** `validateCommand` deduplicated `entry_id` per command, so a later journal under a new `journal_id`/`idempotency_key` could reuse an already-posted `entry_id` — two live entries sharing one identity, while `ledger_entries.entry_id` is a global `PRIMARY KEY` in the persisted contract. Any future reversal/adjustment linkage by entry identity would have been ambiguous between two entries. Fixed: a ledger-wide `postedEntryIds` registry is consulted on every post; a reused entry identity fails `LEDGER_DUPLICATE_ENTRY`, and rejected postings consume no identity.
2. **UUID identity was compared as raw text, not as `uuid` values.** `UUID_PATTERN` takes either case, but map keys, dedup sets and `command_digest` serialization were raw strings, diverging from the persisted `uuid` columns that compare case-insensitively. A case-variant `journal_id` posted a second journal (the persisted side: primary-key conflict); case-variant `account_id`s coexisted at registration; within-command entry-id case twins passed the per-command dedup; an entry citing a registered account in another case failed `LEDGER_ACCOUNT_NOT_FOUND`; `getProjection` missed case variants; and a case-variant repost hashed differently, so a same-key retry surfaced `LEDGER_IDEMPOTENCY_CONFLICT` instead of replaying the original journal — the non-canonical-serialization leaf class. Fixed: `normalizeUuid` canonicalizes every `uuid`-form field (`journal_id`, `correlation_id`, `causation_id`, `entry_id`, entry `account_id`, account `account_id`, and the `getProjection` argument) to lowercase before validation, lookups and hashing, so stored form and digests match what the `uuid` type emits.

## Verified clean

- **Entry immutability.** Stored journals are `freezeDeep`-frozen and every outward path (`post`, `listJournals`) returns a `structuredClone`; mutating a returned journal cannot reach ledger state (pinned by an existing case). `snapshotPlainData` rejects proxies, getters, cycles, sparse arrays, symbol and non-enumerable members before validation, so a TOCTOU getter cannot swap values between capture and validation.
- **Balance conservation.** Totals are exact BigInt minor units from `parseAmount` (canonical decimal grammar, scale bound, 78-digit ceiling, positive-only); balance is enforced per asset and per posting-rule leg multiset; `getProjection` applies `normal_side` consistently with the mirrored `ledger_account_projections` view; no float arithmetic or rounding anywhere.
- **Idempotency.** Replays hash the full canonical command — identical commands return the stored journal, any payload drift fails `LEDGER_IDEMPOTENCY_CONFLICT`, a reused `journal_id` under a different key fails `LEDGER_DUPLICATE_JOURNAL`, and the registry key `(legal_entity_id, idempotency_key)` mirrors the persisted `UNIQUE` pair. Posting is synchronous, so no retry interleaving can double-apply.
- **Reversal surface.** `reversals_in_scope`, `holds_in_scope` and `reconciliation_in_scope` must all remain `false`; there is no reversal/adjustment entry point, so reversal-of-reversal, amount- or asset-substituted reversal and wrong-parent linkage have no machinery to exploit.
- **Invariant and snapshot checks.** `rebuildProjectionSnapshot` totals every account projection and the trial balance (no sampling), `snapshotPlainData` runs before validation, and digests cover the canonicalized object graph. `causation_id`/`correlation_id` are format-checked UUIDs carried rather than interpreted — with canonicalization they can no longer fork a journal digest by case.
- **Account model.** Sign conventions are pinned per class in both tiers; `legal_entity_id` confines entries to the journal entity; account IDs must be UUID-form (no sequential identifiers); `getProjection` resolves only registered accounts. Ownership and read authorization live in the API tier — the in-memory store has no subject concept by design.
- **Consumers.** The only in-repo consumers are this package's tests and `check-foundation.mjs`; the digest vector recomputes over the canonical command and is unchanged.

## Test additions

- `tests/ledger-identity.test.mjs` (+8 cases): cross-journal `entry_id` reuse fails `LEDGER_DUPLICATE_ENTRY`, including via a case-variant twin; rejected postings consume no entry identity; within-command entry-id case twins fail validation; a case-variant `journal_id` fails `LEDGER_DUPLICATE_JOURNAL` under another key and replays idempotently under the same key with the canonical digest; case-variant `account_id`s collide at registration; entry `account_id` and `getProjection` resolve case-insensitively and persist the canonical form. Seven of the eight cases fail on main; the consume-nothing guard pins failure-path behavior on both revisions.
- Verification-integrity baseline recomputed for the new test file.
