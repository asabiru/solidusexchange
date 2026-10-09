# E2E Harness Audit — Wave 43 — Proposed

- Status: Proposed
- Scope: `packages/e2e-dev` test harness — `tests/stack.mjs` helpers, `dev-stack.test.mjs`, `boundaries.test.mjs`, `resilience.test.mjs` (including the in-process customer-api stub it builds), `load.test.mjs`, plus the dev-server entry points they drive (`backoffice/src/server/index.ts`, miniapp/customer-api entries)
- Production effect: none

## Scope reviewed

- `tests/stack.mjs` — `startService` ready-pattern/timeout, `runToExit` signal capture, `verifyEnvelope` Ed25519 pinning, `listen`/`closeServer`/`freePort`, `cookieOf`/`readJson`.
- `tests/dev-stack.test.mjs` — the customer journey (KYC submit → poll → verified), upstream-pinned view checks, negative paths, the operator journey, and the money-route absence sweep.
- `tests/boundaries.test.mjs` — per-service refusal pins for `NODE_ENV=production` and non-loopback hosts, each paired with a control start.
- `tests/resilience.test.mjs` — the in-process loopback stub standing in for customer-api: `validBody` route arms, the 14 malformed `modes`, unreachable-server cases, provider-simulator scenarios, Postgres audit-store unreachables.
- `tests/load.test.mjs` — the 600-request bounded burst over 12 request kinds, per-kind status tolerances, the audit-consistency check, RSS/runtime budgets.
- `backoffice/src/server/index.ts` — the startup-error reporting path that the boundary pins assert on.

Hunt list applied: always-pass assertions (optional-field skips, `.some()`/`.every()` on empty arrays, swallowed try/catch, `toBeDefined` on scaffolding), poll/retry loops that succeed on timeout, status/tolerance mixups (5xx acceptance, 200+503 mixes hiding 100%-failure, threshold rounding), harness drift (fallback/default handlers, stubs returning success for any input, fixture state leaking), journey shortcuts that bypass the real gate, and `validBody` bodies matching multiple routes or none.

## Defects found and fixed

### 1. Backoffice startup catch-all masked the real refusal reason (`backoffice/src/server/index.ts`)

`main().catch` printed `Backoffice BFF refused to start because audit storage is not ready` for *any* startup failure — including the `NODE_ENV=production` and non-loopback-host refusals thrown by `loadServerConfig` before audit storage was ever reached. The boundary test's loose `/refused to start/` pattern then matched the misleading message, so a backoffice that refused for the *wrong* reason (e.g. a config check silently dropped) still passed the suite.

Fix: the catch now prints the thrown error's message (`Backoffice BFF refused to start: [reason]`), and `boundaries.test.mjs` pins each exact refusal: `Backoffice BFF is dev-only and refuses NODE_ENV=production` and `BACKOFFICE_BFF_HOST must be a loopback address`.

Mutation: run `NODE_ENV=production` against the old entry → stderr claims audit storage is not ready (wrong reason, old pattern passes). Same run against the tightened pattern fails — demonstrated above; the fixed entry prints the real reason and the pinned patterns pass.

### 2. Stub `validBody` catch-all answered success for any path (`resilience.test.mjs`)

The upstream stub's `validBody` ended in `return { capabilities: [...], commands_enabled: false }` — every unmatched URL (typo'd route, an endpoint added to the BFF but not the contract) received a valid capabilities body instead of an error, so harness drift between BFF and upstream contract was invisible. The stub also answered non-GET requests, which the real router rejects.

Fix: `/capabilities` is an explicit arm; unmatched paths return `undefined` → stub answers 404 like the real router; non-GET methods 404. The suite also self-checks the stub directly (unknown path → 404, POST → 404) inside `connects through the stub`.

Mutation: script drives old dispatch vs new dispatch — `GET /api/v1/customer/typoed-path` returns 200 on the old stub, 404 on the new; `POST /api/v1/customer/session` returns 200 on old, 404 on new. New expectations fail on the old stub, pass on the branch stub.

### 3. Stub session `expires_at` emitted a state the real server never produces (`resilience.test.mjs`)

The stub returned a fixed `expires_at: "2026-10-06T00:00:00Z"` — already in the past — for every session. The real customer-api echoes the presented token's expiry; the fixture therefore answered with a session the real server can never emit, hiding any reliance of the BFF on expiry freshness.

Fix: `expiresAtOf(request)` derives the ISO expiry from the presented token's third segment, matching the real server's echo behavior (mutation script shows old fixture returning a past timestamp while the branch echoes the minted expiry).

### 4. The apiAccess capability list asserted only `Array.isArray` (`dev-stack.test.mjs`)

The profile test passed for *any* capability array — an upstream that over-issued read capabilities to unverified subjects would stay unnoticed.

Fix: pin the exact five never-denied reads in `CAPABILITY_POLICY` order (`customer.session.read`, `customer.capabilities.read`, `customer.kyc.read`, `customer.profile.read`, `customer.support.read`).

Mutation: flipping `customer.wallets.read` to `requiresVerifiedKyc: false` in `packages/customer-api/src/capabilities.mjs` — old assertion passes (verified run: the profile test stayed green under the mutation), new `deepEqual` fails with `+ 'customer.wallets.read'`.

### 5. `statusKeys` conditional pushes skipped asserting keys (`dev-stack.test.mjs`)

`if (upstreamView.submitted_at !== undefined) statusKeys.push("submittedAt")` adapted the expected key set to whatever upstream emitted — an upstream view that dropped `submitted_at` would silently stop asserting it. The synthetic directory is fully deterministic per subject, so the conditional only added slack.

Fix: pinned the exact key list (`["canSubmit", "mode", "provider", "sessionKyc", "state", "submittedAt"]`) for this subject's deterministic `rejected` application (submitted_at present, no review_deadline).

### 6. Load-burst tolerances hid 100%-failure and never-create paths (`load.test.mjs`)

- Upstream-backed kinds (`kyc-status`, `profile`, `support`, `deposits`, `withdrawals`) required `200+503 == 50` and `503 > 0` — a path returning *all* 503s (customer-api completely down for that route) passed.
- `report` tolerated any 200+503 mix with `>= 1` success — 49 of 50 report reads could fail and the test still passed.
- `kyc-submit` tolerated `200+202 == 50` — a submit path that never created (all idempotent 200s) passed.

Fix: each upstream-backed kind now also requires `200 > 0` (some real upstream answer), `report` pins exactly `{200: 50}` against the in-memory audit store, and `kyc-submit` requires `202 >= 25` (first submission per distinct telegram subject must create).

Mutation: synthetic result set — every upstream-backed read 503, every submit 200, 49/50 report reads 503 — old assertions pass (masked), new assertions fail (caught).

## Verified clean

- `tests/stack.mjs`: `startService` rejects on missing ready-pattern (15 s deadline), kills with SIGKILL on timeout, and `runToExit` distinguishes exit code vs signal — a hung or crashed child cannot pass as a clean exit. `verifyEnvelope` fails on unknown key ids rather than trusting the first key.
- Poll/retry loops assert the condition, not the last snapshot: the KYC journey pins `deepEqual(seen, ["kyc-gated", "verified"])` so a timeout leaves `seen` short and fails; the screening poll asserts `status === "medium"` after the loop; `advanceUntil` calls `assert.fail` when the view never settles; `upstreamReleased` asserts `last.closed === true`.
- `.some()`/`.every()` uses run on proven non-empty arrays (the notifications owner/foreign checks first pin the lists' contents and unread counts).
- Journey gates are real: dev-session promotion goes through the signature-verified simulator callback path (`poll /bff/session` until verified); the operator journey verifies every envelope signature against the live keyset; no test short-circuits a gate by constructing a session object directly.
- Negative paths assert specific bodies (`{ error: "capability_denied" }`, `{ error: "kyc_required" }`, 400/401/403 statuses) — not merely "some 4xx".
- The `reports`-vs-audit consistency check compares `status.length` delta against successful reads, and the in-memory store path pins exact counts — audit state cannot drift beneath the API surface.
- `documentedStatuses` in `load.test.mjs` excludes 500, so an undocumented 5xx anywhere in the burst fails regardless of per-kind tolerances.

## Observations (recorded, not defects in this slice)

- The BFF `access()` check validates session shape (exact keys, subject match, `actor_type === "customer"`) but does not re-check `expires_at` freshness — the upstream is the authority on session validity; the stale-expiry fixture (defect 3) was the only place this gap could hide, and it is now fixed.
- The load burst's `503 > 0` expectations for upstream-backed kinds assume the customer-api rate limit saturates under the burst — they now additionally require `200 > 0`, so both directions of the mix are pinned.
- `validBody` still returns the same canned shapes for `/session`+`/capabilities`+8 collection arms (including `/quotes` after the main merge); a future upstream path the BFF learns to call must add an explicit arm — that is now enforced by the 404 default (fail closed on drift rather than silently succeeding). Upstream paths the BFF does not call (e.g. `/exchange-orders`) stay 404 by design.

## Test changes

- `tests/boundaries.test.mjs`: backoffice production/exposed patterns pin the exact refusal reasons (paired with the `index.ts` error-reporting fix).
- `tests/dev-stack.test.mjs`: the apiAccess capability list pinned to the exact five entries; `/bff/kyc/status` key set pinned exactly instead of conditional pushes.
- `tests/resilience.test.mjs`: stub answers 404 for unmatched paths and non-GET methods; `/capabilities` is an explicit arm; `expires_at` echoes the presented token; in-suite stub self-check for unknown path/method; audit-storage stderr pin updated to the new refusal format.
- `tests/load.test.mjs`: `200 > 0` required on every upstream-backed kind; `report` pinned to `{200: 50}`; `kyc-submit` requires `>= 25` creates.
- `backoffice/src/server/index.ts`: startup failures report the thrown reason instead of a fixed audit-storage message.
- Verification-integrity baseline recomputed for the four touched test files (minLines raised: dev-stack 604→608, load 386→391, resilience 965→990; boundaries 108 unchanged; case counts unchanged — all changes strengthen assertions inside existing cases, no new cases added).
