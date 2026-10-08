# Ledger and Custody Core Audit — Wave 33 — Proposed

- Status: Proposed
- Scope: `packages/financial-core` (in-memory double-entry ledger, decimal amount math, chart-of-accounts.json, posting-rules.json) and `packages/custody-core` (unsigned withdrawal-intent state machine, custody events, projection registry, outbox migration) on main
- Production effect: none

## Scope reviewed

- `packages/financial-core/src/ledger.mjs`, `src/amount.mjs`, `chart-of-accounts.json`, `posting-rules.json`, `schemas/posting-command.schema.json`, the SQL outbox/append-only migration set
- `packages/custody-core/src/unsigned-intent.mjs`, `src/custody-event.mjs`, `custody-policy.json`, `migrations/0001_custody_projection_outbox.sql`

Hunt list applied: fail-open state transitions, missing status or transition validation, replay or idempotency gaps, float or imprecise money math, prototype-pollution lookups, unbounded growth, digest/hash handling mistakes, rule-validation bypasses (scope or actor type not enforced), amounts as bare numbers instead of decimal strings, missing negative-path tests.

## Defects found and fixed

1. Maker and checker are required to be different operators, each citing distinct evidence. `assertApprovals` deduplicated the required `approval_id`, `subject_reference` and `role` values, but never enforced that the step-up grant is required to be unique per entry — nor that the `evidence_digest` is required to be unique. No grant may back both legs: one shared grant is missing from the uniqueness set and could otherwise stand in for the maker and the checker alike, so the second entry was backed by evidence that was not its own. `assertApprovals` now rejects the reuse.
2. Custody commands allowed amounts wider than the downstream ledger precision bound. `assertCommand` capped fraction digits by the asset's `maximum_scale` but placed no bound on the integer part, so an intent carrying a 79+-digit `amount` validated even though the ledger's `parseAmount` (and the `NUMERIC(78-scale, scale)` money columns) could never hold it. The command now rejects totals above 78 digits before the positivity check.
3. Custody reference fields permitted a bare prefix with an empty suffix and lengths up to 128, while the outbox `CHECK` constraints require a non-empty suffix and a total length of at most 127 characters. A command such as `withdrawal_id: "withdrawal_"` or a 128-character `custody_intent_id` passed JS validation and could only fail later inside `record_custody_projection`. `assertReference` now requires a non-empty suffix and the 127-character bound; the two inline reference checks in `custody-event.mjs` (the `operator_` actor subject and the payload's required `approval_id`) enforce the same contract.
4. Financial-core `validateAccounts` misreported a missing or malformed required `owner_reference` as `LEDGER_VALIDATION_FAILED` while every sibling owner-scope violation (`forbidden`, `optional` malformed, duplicate identity) reports `LEDGER_CONFIGURATION_INVALID`. The `required` branch used the generic `assertString` helper, which hard-codes the command-flavored code; a broken account configuration was therefore classified as a malformed request. The `required` branch now rejects with `LEDGER_CONFIGURATION_INVALID`.

## Verified clean

- Ledger posting: all inputs snapshotted as plain data before validation; per-asset `BigInt` totals must net to zero; each asset's sorted `definition_code|side` multiset must equal the registered `entry_pattern`; unique `entry_id`s; idempotency keyed on `legal_entity_id|idempotency_key` replays the stored journal on an identical digest and conflicts on a different one; `journal_id` uniqueness is enforced independently of the idempotency key.
- Ledger configuration: chart pinned to version 1 / draft / dev-dry-run with every execution and scope flag false and the eight required categories; posting rules pinned to `synthetic-test-only` scope, `allowed_actor_types` restricted to `{MIGRATION_JOB, OPERATOR, SERVICE}` and non-empty, unique `journal_type|posting_rule_version`, unique leg signatures, every leg definition checked against the validated chart.
- Amount math: canonical decimal strings only (`0` or no leading zeros, optional fraction), scale an integer 0–18, whole+fraction digits ≤ 78, `BigInt` minor units strictly positive; all totals are `BigInt`, no floats anywhere on money paths.
- Custody intent state machine: `prepare` emits exactly `unsigned_intent_ready` with every capability flag false; `verify` re-checks the sealed command digest, the policy digest, the required `approval_evidence_digest` and the canonical required `approval_id` ordering before use; intent timing window, per-entry TTL and expiry are enforced.
- Custody events: `WithdrawalApproved` must be UUIDv7 with matching aggregate/correlation, `causation_id` different from both its own `event_id` and the prepared event's, `approver_count` and `evidence_digest` pinned to the intent evidence; the registry rejects duplicate `event_id`/`causation_id`/`withdrawal_id`/`custody_intent_id` and idempotency-key reuse with a different request digest.
- Custody outbox SQL: 15 `CHECK` constraints pin `unsigned_intent_ready` plus false capability flags, UUIDv7, timeline and payload identities; `record_custody_projection` is `SECURITY DEFINER` with a fixed `search_path`, `SELECT … FOR UPDATE` idempotent replay, and unique-violation conflict mapping; append-only and owner-truncate triggers verified.

## Observations (recorded, not defects in this slice)

- `source.type` on a posting command is an informational identifier only; the dev boundary is enforced by the posting-rule registry (scope, allowed actors, entry pattern), not by the source label. A posting can label itself `live-provider` yet remains a synthetic in-memory journal. If the label is ever consumed downstream it should be enumerated; for now it is recorded here.
- `assertCommand`'s `expiresAt > createdAt` check is unreachable given the earlier `createdAt <= now < expiresAt` assertions, and the required `approved_at < expires_at` window plus the per-entry TTL bound are unreachable under the shipped TTLs (entry TTL 900s > maximum intent TTL 300s). These are belt-and-suspenders for future policies, kept intentionally.
- `computeIntentDigest` validates only command key shape and the policy-version match by design; full command validation happens inside `prepare`/`verify`.

## Test additions

- `packages/custody-core/tests/unsigned-intent-hardening.test.mjs` (15 cases): the step-up grant is required to be unique and the evidence digest is required to be unique, precision-limit and bare/oversized reference rejections, amount and timing negative paths, duplicate identity/role rejections, non-approval decisions, malformed digests, canonical-ordering enforcement, actor/classification pinning and registry replay conflicts.
- `packages/financial-core/tests/ledger-hardening.test.mjs` (11 cases): non-canonical and non-string amounts, zero/over-precision entry amounts, duplicate entry IDs, balanced-but-unregistered leg patterns, malformed actor/source/identity fields, unknown-account projections, broken clock, chart structural violations, posting-rule registry violations, and owner-scope misclassification regression.
