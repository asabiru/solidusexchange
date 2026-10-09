# Posting Rules Enforcement Audit — Wave 35 — Proposed

- Status: Proposed
- Scope: `packages/financial-core` posting-rule enforcement path on main — `src/ledger.mjs` command validation and posting flow, `posting-rules.json`, `chart-of-accounts.json`, `schemas/posting-command.schema.json`, and the mirrored `migrations/0003_ledger_acceptance_seal.sql` registry
- Production effect: none

Hunt list applied: rule `scope` enforced only at admission (never re-verified at posting), `allowed_actor_types` declared but unenforced, `entry_pattern` bypasses (off-pattern accounts, normal-side violations, owner_scope-required accounts without `owner_reference`), `posting_rule_version` fail-open or fuzzy matching, amount invariants (zero, negative, mixed-sign, non-exact balance, asset mismatch), and replay double-apply.

## Defects found and fixed

1. `validateCommand` resolved the posting rule by `journal_type|posting_rule_version` and consulted its `allowed_actor_types` and `entry_pattern`, but never re-read the resolved rule's `scope`. Scope was enforced only at registry admission inside `buildPostingRuleRegistry` — a scoped rule could in principle reach `post()` without its scope being consulted again, which is the gap the hunt item calls out. `post()` now rejects with `LEDGER_POSTING_RULE_VIOLATION` when `postingRule.scope !== "synthetic-test-only"`, so the boundary is re-verified at posting time, not just at configuration time.

## Verified clean

- `allowed_actor_types` is a real posting-time gate: `OPERATOR` and `MIGRATION_JOB` commands against the registered rule fail with `LEDGER_POSTING_RULE_VIOLATION`, and actor types outside the `{MIGRATION_JOB, OPERATOR, SERVICE}` universe fail `LEDGER_VALIDATION_FAILED` before the rule is consulted.
- `entry_pattern` is enforced per asset as an exact sorted `definition_code|side` multiset: off-pattern accounts, the same definition on both legs, extra balanced legs and swapped legs all fail with `LEDGER_POSTING_RULE_VIOLATION`. A posting line violating its definition's `normal_side` (e.g. `CREDIT` on a `TREASURY_ASSET` account under the current rule) fails through the same pattern check.
- `posting_rule_version` fails closed: unknown versions, case variants, versions registered under a different `journal_type` and unregistered journal types all resolve to `LEDGER_POSTING_RULE_NOT_FOUND`; versions are exact strings, never split or pattern-matched.
- Amount invariants: non-canonical spellings (`025`, `25.`, ` 25`, `1e6`, `+1`, `-1`, `NaN`, `Infinity`), zero (`0`, `0.000000`), over-scale fractions, non-string amounts and 79-digit totals all fail `LEDGER_AMOUNT_INVALID`; a one-minor-unit imbalance fails `LEDGER_UNBALANCED_JOURNAL`; `entry.asset_code` must equal its account's asset (`LEDGER_BOUNDARY_VIOLATION`) and cross-entity accounts fail the same way; balance is computed in `BigInt` minor units per asset.
- Idempotency/replay: an identical command replays the stored journal without double-applying (`legal_entity_id|idempotency_key` keyed on the canonical command digest); the same key with changed or reordered content fails `LEDGER_IDEMPOTENCY_CONFLICT`; a reused `journal_id` under a different key fails `LEDGER_DUPLICATE_JOURNAL`; a rejected posting consumes no idempotency key, so a corrected retry succeeds.
- Owner scope is enforced at account admission: `required` definitions without a valid `owner_reference` fail `LEDGER_CONFIGURATION_INVALID`, `optional` accounts may post ownerless, and `forbidden` rejects a set reference — postings can only reference admitted accounts.

## Observations (recorded, not defects in this slice)

- The new posting-time scope check is unreachable under the current registry: `buildPostingRuleRegistry` rejects any non-`synthetic-test-only` rule, so every resolved rule already satisfies the guard. It is kept intentionally as defense-in-depth — if admission is ever widened or a second registry path appears, `post()` still fails closed. Same category as wave33's deliberately unreachable belt-and-suspenders checks.
- `source.type` remains an informational identifier (recorded in wave33): a command labeled `live-provider` posts as a synthetic in-memory journal; the dev boundary is the posting-rule registry. `source_type` is an unenumerated identifier in the SQL layer too, so the two runtimes stay consistent.
- `normal_side` is a projection convention, not a posting constraint, in both the in-memory ledger and `assert_journal_complete`: contra-normal legs are legitimately expressible (a payable settles by debiting it). The binding constraint at posting time is the registered `entry_pattern` multiset.

## Test additions

- `packages/financial-core/tests/ledger-posting-rules.test.mjs` (10 cases): scope admission rejection plus the posting-time scope guard (the guard assertion fails on main, passes on this branch), posting-time actor-type gates, `entry_pattern` pins (off-pattern account, double-definition, extra legs, swapped legs), normal-side-violating lines failing via the pattern and a contra-normal rule still admitting postings, `owner_scope` required/optional behavior, `posting_rule_version` fail-closed paths (unknown, case-mutated, cross-type, unregistered type, version-splitting), 18 malformed/zero/negative/off-scale amount spellings plus a one-minor-unit imbalance, entry↔account asset mismatches and unregistered assets, idempotent replay without double-apply, digest conflicts on changed or reordered content, duplicate `journal_id` under a different key, and a failed posting leaving its idempotency key free.
