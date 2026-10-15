# Session D Draft — Holds, Reversals, Fees, Reconciliation

Dev-only, unapproved draft of the Session D scope named in
[finance-ledger-approval-pack.md](../../Documentation/regulated-core/finance-ledger-approval-pack.md):
explicit holds/reservations, reversal/correcting journals, fee/spread posting
rules and reconciliation suspense handling.

## Status

- **Unapproved.** The Finance/CTO/Security sign-off record in the approval pack
  remains `PENDING`. Nothing here is production accounting.
- The canonical artifacts are untouched: `chart-of-accounts.json` and
  `posting-rules.json` stay at `registry_version`/`chart_version` 1, `draft`,
  with `holds_in_scope`, `reversals_in_scope` and `reconciliation_in_scope`
  `false`, exactly as the foundation boundary enforces.
- This draft is a *separate pair of artifacts* (`chart-draft.json`,
  `posting-rules-draft.json`) plus a semantic module (`src/session-d.mjs`) and
  synthetic tests (`tests/session-d.test.mjs`). It exists so the reviewable
  semantics are executable before approval, not to bypass the gate.
- No SQL migration is added: the pinned migration source catalog
  (`check-foundation.mjs`, `postgres-migration-source-catalog.sh`) is part of
  the approval evidence and may not drift. Session D journals ride the existing
  journal/entry tables because they are new `journal_type`s, not new columns.

## Draft scope

### Holds / reservations

Two journal types move the customer obligation between settled and held
classification; no asset leg moves — a hold is a reclassification of what is
owed, not a movement of assets.

| Journal type | Debit | Credit | Semantic |
|---|---|---|---|
| `SYNTHETIC_HOLD_CREATE` | `CUSTOMER_SETTLED_LIABILITY` | `CUSTOMER_HELD_LIABILITY` | Reserve a customer balance under a named reservation reference |
| `SYNTHETIC_HOLD_RELEASE` | `CUSTOMER_HELD_LIABILITY` | `CUSTOMER_SETTLED_LIABILITY` | Return the reservation to settled status |

`createHold` requires the draft's single-asset two-leg shape and registers the
reservation by `source.reference`. `releaseHold` must carry the creation
journal as `causation_id`, the same `source.reference`, and mirror the held
account pair, asset and amount exactly — partial releases are rejected in the
draft. A reservation id can never be reused.

The draft chart adds one definition: `CUSTOMER_HELD_LIABILITY` (customer /
LIABILITY / credit-normal / `owner_scope: required`).

### Reversal / correcting journals

`reverseJournal` posts a correcting journal bound to the accepted original by
`causation_id` and by `source.type = "journal_reversal"` +
`source.reference = original journal_id`. The draft registers one reversal
rule — `SYNTHETIC_PROVIDER_POSITION_REVERSAL` — mirroring the foundation's
provider-position pattern with flipped sides.

The module enforces:

- the original journal must be accepted and not already reversed;
- the command journal type must be the registered reversal arm for the
  original's `journal_type` (a reversal has no reversal arm — corrections of
  corrections post a fresh journal, not a re-reversal);
- every entry mirrors exactly one original entry: same account, asset and
  amount, flipped side — net projections return to zero.

### Fee / spread posting rules

| Journal type | Debit | Credit | Semantic |
|---|---|---|---|
| `SYNTHETIC_FEE_CHARGE` | `CUSTOMER_SETTLED_LIABILITY` | `FEE_REVENUE` | Charge a fee against the settled obligation |
| `SYNTHETIC_SPREAD_RECOGNITION` | `TREASURY_ASSET` | `FEE_REVENUE` | Recognize exchange spread captured in treasury |

Both are `SERVICE`-actor rules; operator-initiated fee journals are rejected by
the same posting-rule boundary that guards the foundation registry.

`SYNTHETIC_CUSTOMER_CREDIT` (`PROVIDER_RECEIVABLE_ASSET` debit /
`CUSTOMER_SETTLED_LIABILITY` credit) seeds funded customer positions in
synthetic tests so holds and charges operate on realistic balances.

### Reconciliation: match, break, suspense

`reconcileAccount` compares a projected normal balance against an external
statement expectation and returns the signed difference — `matched` when the
difference is zero. Breaks park into suspense, review resolves them:

| Journal type | Debit | Credit | Semantic |
|---|---|---|---|
| `SYNTHETIC_SUSPENSE_PARK_IN` | `SUSPENSE_ASSET` | `CUSTOMER_SETTLED_LIABILITY` | Unexplained inbound position parked |
| `SYNTHETIC_SUSPENSE_CLEAR_IN` | `TREASURY_ASSET` | `SUSPENSE_ASSET` | Reviewed inbound resolved into treasury |
| `SYNTHETIC_SUSPENSE_PARK_OUT` | `CUSTOMER_SETTLED_LIABILITY` | `SUSPENSE_LIABILITY` | Unexplained outbound position parked |
| `SYNTHETIC_SUSPENSE_CLEAR_OUT` | `SUSPENSE_LIABILITY` | `TREASURY_ASSET` | Reviewed outbound resolved to confirmed outflow |

`parkSuspense` requires `source.type = "reconciliation_break"` and parks each
break reference once. `clearSuspense` must cite the open park journal via
`causation_id`, use the direction-matched clear type, and reuse the parked
suspense account, asset and amount. Double-park, double-clear and
direction/type mismatches fail closed.

## Fail-closed layering

Every draft journal still flows through the unchanged posting boundary:
exact-key envelopes, per-asset double-entry balance, registered
`journal_type`+`posting_rule_version` binding, actor whitelists, per-asset
entry-pattern match, legal-entity isolation, idempotency, precision and
timestamp bounds. The semantic layer adds only *stricter* rules (bindings,
lifecycle state, mirror requirements) — it cannot widen what the foundation
accepts.

## Promotion path on approval

1. Record the sign-off in the approval pack (chart/registry versions + commit
   SHA).
2. Promote: `chart_version` 2 with the new definition and scope flags `true`;
   posting-rule registry version 2 containing these rules.
3. Extend the migration catalog through the reviewed migration process (new
   SQL only through sequential `00NN` files re-pinned by SHA catalog).
4. Re-target `src/session-d.mjs` at the canonical artifacts and delete the
   draft pair.
