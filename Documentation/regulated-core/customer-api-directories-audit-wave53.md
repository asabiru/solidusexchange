# Customer-API Served-Read Directories Audit — Wave 53 — Proposed

- Status: Proposed
- Scope: `packages/customer-api/src/` served-read directories — `wallets.mjs`, `notifications.mjs`, `kyc.mjs`, `profile.mjs`, `support.mjs`, `auth-sessions.mjs`, `users.mjs`, `deposits.mjs`, `withdrawals.mjs`, `quotes.mjs`, `exchange-orders.mjs`, `payments.mjs`, `cards.mjs`, `checks.mjs`, `activity.mjs`, `operations.mjs`, `deposit-addresses.mjs`, `address-screenings.mjs` and `operator.mjs` — audited as a class against each other and against the declared bodies in `packages/api-contracts/openapi.yaml`. Gate application, error envelopes and routing were reviewed in `app.mjs`/`capabilities.mjs`/`contract.mjs`; per-directory audits had previously covered only auth and config machinery.
- Production effect: none

Hunt list applied: gate asymmetries (verified-only state leaking to unverified callers through partial views, counts or error text), `viewFor`/`validXView` asymmetries (emitted keys unchecked by the validator, or validator rules the generator can never satisfy), status-vocabulary drift between sibling lifecycles, determinism breaks (clock/env/locale/sort/insertion order instead of subject-derived digests, floating-point money), frozen-view leaks, lifecycle invariants enforced by the builder but not the validator, subject isolation through shared module state, id-family collisions across directories, error-shape drift.

## Method

Every directory's emitted views were enumerated for 80+ subjects (plus all three `session_kyc` states and the operator surface). Each view was then mutated leaf-by-leaf with contract- and lifecycle-violating values — foreign enum members, flipped constants, reversed ordering, incoherent status/field pairs, missing coverage — and the runtime validator's accept/reject verdict recorded. A mutation the validator accepted is a drift hole: a directory could serve a body that breaks the contract or its own lifecycle and still pass `validXView`.

## Defects found and fixed

1. **Unbounded per-subject memoization in every directory (high).** All 19 `createSynthetic*Directory` factories kept a grow-only `Map` keyed by subject (and session state for kyc/operator). Authenticated callers could mint distinct `syn_cust_*` subjects — up to 128-char pattern space — growing resident views without bound, a memory-exhaustion surface on a public read path. The memo also defeats subject isolation in principle. Removed the cache in every directory: views are pure functions of the subject, so each call now rebuilds a fresh, still deterministic, still frozen view. `tests/cross-directory-audit.test.mjs` asserts non-identity plus content equality across repeated calls for all 17 customer directories and pins the class.

2. **`validNotificationsView` admitted contract-foreign values (high).** It checked only key sets and primitive types: `channel`, `locale`, `mode`, `delivered` — all `const` in the contract — accepted any value, the template enum, the `^ntf_[0-9a-f]{24}$` id pattern, the 1–128 char text bound and ISO `created_at` were unenforced, and the derived `unread` counter was not recounted against `read` flags. A directory drifting to `delivered: true` or a non-`telegram-draft` channel would have served silently. All constants, the enum, the pattern, the bounds, per-id uniqueness and the `unread` recount are now enforced.

3. **`validKycStatusView` admitted session/status-incoherent views (medium).** The session's KYC state determines the reachable application status (`verified` ⇒ `approved`; `pending` ⇒ inside the review window; `unverified` ⇒ never submitted/approved), `can_submit` must mirror the resubmittable set, and each optional field exists exactly when its status demands it (application id and `submitted_at` for real applications, `review_deadline` in review, `reason_codes` when rejected, `requested_items` on `needs_more_data`). None of this was checked: an `unverified` session could be reported `approved`, and `approved` with no application record passed. All coherence and correlation rules are now enforced.

4. **`validWalletsView` admitted a wrong wallet set (medium).** The directory's domain is the fixed asset table (RUB/TON/USDT at scales 2/9/6); the validator accepted foreign or duplicated asset codes, missing or extra wallets and amounts off the asset's declared scale. Exact-table coverage and per-asset scale are now enforced.

5. **`validDepositsView` enforced no lifecycle invariants (medium).** Per-status totals were unchecked: `awaiting_payment` could carry a positive `received_total`, `payment_received` could disagree with `expected_amount`, `payment_reversed` could report `reversed_total > received_total`, and `updated_at < created_at` passed. The full per-status rule set plus `updated_at ≥ created_at` is now enforced in integer minor units.

6. **`validWithdrawalsView` enforced no lifecycle invariants (medium).** The fixed 300 s intent TTL and the per-status last-touch rule (`draft` untouched, `expired` at expiry, `confirmed` after it, in-flight statuses strictly between) were unenforced. Both are now pinned.

7. **`validSupportTicketsView` admitted non-lifecycle timelines (medium).** The builder emits a strict prefix of the status order at fixed steps with `expires_at = created_at + TTL` and `complaint_acknowledged` mirroring the complaint category; the validator only required the last timeline status to equal the ticket status — reversed walks, arbitrary timestamps, non-TTL expiries and wrong flags passed. All four invariants are now enforced.

8. **`validActivityView` and `validOperationsView` did not enforce the claimed one-entry-per-kind bound (medium).** Both validators' comments declared "at most one synthetic entry per kind" and both builders emit each kind at most once, but only id uniqueness was checked — a second entry of the same kind passed. Kind uniqueness is now enforced in both.

9. **`validOperationView` left the timeline unbounded (low).** Steps' `at` values could post-date `created_at` or run backwards; steps are now required non-decreasing and inside the creation window.

10. **`validOperatorAdminView` echoed arbitrary capability strings (low).** `granted_capabilities` accepted any bounded string; it is now pinned to the declared `OPERATOR_CAPABILITY_POLICY` vocabulary.

11. **`validDepositAddressesView` and `validAddressScreeningsView` admitted wrong target coverage (low).** Any number of individually-valid entries passed, including duplicated (asset, network) pairs or missing targets. Exact per-target coverage is now enforced in both.

## Classes proven clean

- **Gates and envelopes.** Every `requiresVerifiedKyc` route applies the capability check before the directory call, so no partial view or count can leak; error bodies share one `errorBody` envelope (`code`, `message`, `request_id`, `details`) for 403/404/503 alike, and member reads fail closed to `null` mapped onto the pinned 404.
- **Determinism.** All views derive from `sha256(subject, salt)` under per-directory signature domains — no `Date.now`, env, locale or insertion-order dependence; two independent directory instances emit byte-identical JSON.
- **Frozen views.** Deep `Object.isFrozen` verification found no unfrozen node in any emitted view across all directories.
- **Subject isolation.** No id minted for subject A appears inside subject B's view in any directory; with the memo removed there is no retained state at all.
- **Id namespaces.** Id values collected across every directory for the same subject are disjoint — distinct prefixes plus distinct signature domains.
- **Strict validators already present.** `quotes` (full recomputation), `exchange-orders`, `payments` (provider-reference presence), `cards`, `checks`, `users` (pending ⇒ equal timestamps), `profile`, `auth-sessions` (exactly-one-current and lifecycle ordering) and `address-screenings` detail views already enforce their invariants; the new suite pins that strictness against regression.

## Tests added

`tests/cross-directory-audit.test.mjs` — 16 tests: no per-subject state retention, deep-freeze and determinism across instances, cross-subject id isolation, disjoint id namespaces, and one regression block per defect above (each fails on the pre-audit code) plus negative pins for the proven-strict validators. `tests/address-screenings.test.mjs`, `tests/deposit-addresses.test.mjs` and `tests/machinery-hardening.test.mjs` were extended for the new coverage rules; existing "deterministic frozen views" assertions moved from object identity to content equality in all 19 directory test files.

## Verification

- `node --test tests/*.test.mjs` — 334 tests pass.
- `npm run typecheck` — clean (checkJs strict).
- `npm run lint` / `npm run check` — boundary and manifest checks pass.
- The 16-test audit suite was run against the pre-change tree: the 11 regression tests fail there while the 5 clean-class pins pass.
