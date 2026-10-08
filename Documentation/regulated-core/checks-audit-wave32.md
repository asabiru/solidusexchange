# Telegram Checks Slice Audit — Wave 32 — Proposed

- Status: Proposed
- Scope: PRs #214 (backoffice checks view), #215 (miniapp checks sheet), #216 (contract + simulator) on main
- Production effect: none

## Scope reviewed

- `miniapp/src/server/checks.ts`, the checks block in `miniapp/src/server/server.ts`, `miniapp/src/app/ChecksSheet.tsx`, `miniapp/src/shared/checks.ts`
- `backoffice/src/server/checks.ts`, the checks routes in `backoffice/src/server/server.ts`, `backoffice/src/app/App.tsx` (ChecksView/CheckDetail), `backoffice/src/data/demo.ts` (`chatChecks`)
- `packages/provider-simulators/src/checks.mjs`, `packages/api-contracts/openapi.yaml` checks paths, `packages/api-contracts/scripts/check-contracts.mjs`

Hunt list applied: fail-open defaults, missing status validation, prototype-pollution lookups, unbounded in-memory growth, missing auth/capability gating, missing sec-fetch-site or x-device-id guards versus sibling routes, float or imprecise money math, claim-reference handling that stores secrets or leaks via logs or audit, ID/subject confusion, missing cache-control, i18n/a11y regressions, and tests asserting presence rather than exact behavior.

## Defect found and fixed

1. Miniapp `ChecksSheet` dereferenced server-supplied enum values through unguarded `Record` lookups. The list row and timeline evaluated `statusBadges[check.status].tone` / `.label` and `directionKeys[check.direction]` directly. A foreign status (e.g. a future `refunded` value) crashed the whole sheet render on `undefined.tone`; a prototype member (`"constructor"`, `"hasOwnProperty"`) resolved to an inherited value, which is truthy and therefore bypassed the detail view's `check && badge` guard and rendered a `pill--undefined` badge. Fixed by own-membership guards `isCheckStatus` / `isCheckDirection` in `src/shared/checks.ts`, a guarded `checkStatusBadge` / `checkDirectionKey` helper in `src/app/checks-badges.ts`, and muted-pill fallbacks that render the raw server value instead of crashing. Regression coverage in `src/app/checks-badges.test.ts` pins the exact badge map, fails closed on foreign/prototype-member values, verifies catalog coverage in every locale, and statically forbids unguarded `statusBadges[`/`directionKeys[` indexing in `ChecksSheet.tsx` going forward.

## Verified clean

- Miniapp BFF: session required, `x-device-id` rejected with 400, strict query validation (`url.search` exact for list, declared params only for preview), non-GET → 404, reference pattern gate before fixture lookup, `Cache-Control: no-store` plus the full `apiSecurityHeaders` set on every response.
- Miniapp domain: 30 bps fee in BigInt units via `toUnits`/`divideRounded`, no floats anywhere in money paths; deterministic fixture set is bounded; `effectiveCheckStatus` KYC gating matches the checks plan.
- Backoffice BFF: `checks:read` capability enforced on every checks route, `sec-fetch-site` ∈ {same-origin, none} on audit-appending GETs, `isCheckStatus` whitelist on the `?status=` filter, 404 on undecodable/unknown ids, Ed25519 response-envelope signatures verified client-side, audit event carries `resource` = `check:` + check id and the evidence digest only — no claim secrets.
- Backoffice client: envelope shape, canonical-JSON, keyset, resource-match and Ed25519 signature verification before unwrap; filter options come from `data.statuses`.
- Simulator: `claim_reference` stored as `sha256Hex` digest only — never raw, never logged, never in audit; member validation copies `{kyc_verified}` only (deny-by-default); `snapshotRequest` rejects non-plain objects, symbols and accessors; `Object.hasOwn` on null-prototype scenario copies; `IdempotencyRegistry` conflicts on digest mismatch; `validateChecksCallback` bounds sequence ≤ 1000 and forbids non-zero fees/balances.
- Contracts: `check-contracts.mjs` pins every checks operation, path, parameter and schema; rejects remote/encoded `$refs`; `CheckView.status` enum, decimal strings, `posting: const none`; `X-Device-Id` required under `/operator/` and forbidden elsewhere.

## Observations (recorded, not defects in this slice)

- `MemoryAuditStore` appends one `check.viewed` event per detail fetch with no store bound and O(n) chain re-verification per read — identical to the pre-existing reports-view audit pattern; a retention/bounding decision belongs to a separate change.
- `claimCheck` increments `failed_claim_attempts` on each identical retry of a rejected claim (idempotency registry records successes only) — each retry is genuinely a new attempt, semantically correct.
- Miniapp fixtures are shared across all sessions (`sent`/`received` directions included) — consistent with the synthetic fixture model used by quotes and activity.
- The app-wide convention of unguarded union-keyed lookups (`assetNameKeys[balance.code]`, `screeningBadges[item.status]`) is unchanged elsewhere; only the crash-capable dereferences in the checks sheet were fixed.

## Test additions

- `miniapp/src/app/checks-badges.test.ts` (6 cases): exact badge map, exact direction keys, fail-closed on foreign/malformed/prototype-member statuses and directions, per-locale catalog resolution, and a static guard asserting `ChecksSheet.tsx` uses the guarded helpers.
