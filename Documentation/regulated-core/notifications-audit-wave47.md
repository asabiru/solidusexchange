# Notification Delivery Audit — Wave 47 — Proposed

- Status: Proposed
- Scope: notification/delivery machinery, second pass — `packages/provider-simulators/src/callback-inbox.mjs` (verified-callback state machine: dedup registry, parked-sequence buffer, deadline expiry), the `DeliveryQueue`/`scheduleTimeline` producers, and the miniapp consumers (`kyc.ts` and `address-screening.ts` drain loops, the `notifications.ts` outbox, `server.ts` notification routes, `customer-api-client.ts` upstream parser) plus the backoffice `provider-evidence.ts` harness. Wave-31 fixes (prototype-key template lookup, unbounded sequence map) and wave-38 internals were confirmed in place.
- Production effect: none

## Scope reviewed

- Per-subject isolation: outbox `own()` filtering, `markRead` scoping, `parseNotificationIds` (at most 20 comma-separated `ntf_` ids), cross-subject reads, KYC/KYT index lookups (`applicantsByReference`, `results` binding digest).
- Ordering/replay: inbox contiguous-sequence application, `parked` buffering, the dedup `events` registry, `expire`/`late` transitions, delivery-queue drain ordering and the receive time replays are stamped with.
- Template injection: `Object.hasOwn` template guards in the outbox and the sheet copy, the upstream template allowlist (`isNotificationTemplate`), and whether any subject-controlled string reaches a template (none does — texts are fixed constants).
- Resource bounds: per-subject caps (`defaultMaxPerSubject`, `defaultMaxTotal`, `maxTrackedAssessments`, `maxScreeningSubjects`, `maxScreeningsPerSubject`, `maxNewScreeningsPerWindow`), sequence-map pruning, nonce-store bound, ≤4 KiB request bodies.
- Status semantics: `delivered`/`read` monotonicity, recomputed `unread`, contract-shaped upstream trust, attacker-settable timestamps/counts.
- Fail-open: unknown template or channel, unverifiable callbacks, `delivery:"disabled"` writing to the live outbox.

## Defects found and fixed

1. **Drained callbacks were back-dated to their scheduled time.** Both miniapp sync loops replayed `DeliveryQueue` output with `receivedAt = deliverAt`. The signature staleness window (300 s) and the inbox deadline both compare against `receivedAt`, so queue-drained deliveries could never be stale or late: a delivery consumed long after signing — or after the subject's deadline — was applied as if received on schedule. One long clock jump (hibernated dev tab, a jumped simulated clock) marked the subject verified or completed when it should have timed out instead. Fixed in `kyc.ts` and `address-screening.ts`: drained deliveries are received at drain time (`nowSeconds()`); `deliverAt` remains only the queue's scheduling key.
2. **The callback inbox had no way to retire a dead subject.** `subjects`, their `parked` buffers and the dedup `events` entries accumulated per opened subject, while both consumers already dropped their own index entries on reset/eviction — leaving orphaned inbox state that never left and grew on every reset. Fixed: `discard(subjectId)` drops the subject, its parked buffer and every dedup record it produced; `kyc.reset()` releases the discarded application, and the address-screening eviction paths (results LRU, per-subject screening cap, subject LRU) release each dropped assessment through a shared `releaseAssessment` helper.

## Verified clean

- **Per-subject isolation.** The outbox filters by caller subject on `list`/`markRead`/`unread`; read marks only ever touch the caller's own entries; a cross-subject `markRead` returns `marked:0` (pinned). KYC rejects callbacks whose `applicant_ref` does not match the reference index; KYT rejects a foreign `binding_digest`; both fail closed as `unknown_application`/`unknown_assessment` before the inbox is consulted.
- **Ordering and replay.** The inbox applies only contiguous sequences, buffers gaps, dedupes by payload digest (identical content → `duplicate`, drift → `conflict`), and routes sequence repeats to `stale`; `expire` is monotonic (`timedOut` never clears). Duplicate and out-of-order simulator timelines stay exactly-once (pinned by existing cases).
- **Template surface.** Template lookup is `Object.hasOwn` on a fixed map (wave-31 fix): `__proto__`/`constructor`/`toString` names throw `unknown notification template`; the sheet copy lookup is guarded the same way; upstream templates are allowlisted via `isNotificationTemplate`; no subject string is interpolated anywhere.
- **Bounds.** Outbox per-subject and global caps evict oldest-first; the wave-31 `sequences` map is pruned to live subjects; KYT results/subjects/screenings/nonce-store are bounded and now release what they evict; read-marks are capped at 20 ids and the client seen-set at 200.
- **Status semantics.** Draft `delivered` is hardwired `false`, `read` moves only forward, `unread` is recomputed from live entries, timestamps are server- or simulator-derived (`assertEpochSeconds` rejects NaN/fractional/negative times — wave 38), and counts come from owned state rather than request input.
- **Fail-open.** Unknown templates throw; unverifiable deliveries are rejected before the inbox (`missing_header`/`signature_mismatch`/`stale_timestamp`/`replayed_nonce`); `delivery:"disabled"` is a fixed contract literal and the outbox stores only drafts — no channel send path exists to silently mark delivered.
- **Backoffice evidence harness.** `provider-evidence.ts` replays deliveries with `now = deliverAt` deliberately — canned replay of a provider's scheduled feed for evidence generation, not a live consumer; the same replay powers its tampered-body/foreign-key/replay probes.

## Observations (recorded, not defects)

- In-memory stores still grow with resources actually created — `DeliveryQueue.pending`, `IdempotencyRegistry`, the customer-api per-subject view caches, and the live `subjects`/`events` maps for subjects consumers retain. Wave 38 recorded this as an intentional fixture-scale trade-off; the wave-47 `discard` removes the one case with no API to retire state — resources the consumer itself dropped.
- `contractNotificationsView` trusts the contract-validated upstream `unread` count rather than recomputing it — contract-shaped trust by design, with the strict parser bounding its range.

## Test additions

- `packages/provider-simulators/tests/inbox-discard-wave47.test.mjs` (+2 cases): `discard` forgets the subject, its parked buffer and its dedup records (replay → `unknown_subject`, reopen → fresh state), and leaves other subjects' dedup intact. Fails on main (`discard` did not exist).
- `miniapp/src/server/kyc.test.ts` (+1 case): a queued terminal callback consumed after the review deadline expires `timed_out` instead of applying — fails on main.
- `miniapp/src/server/address-screening.test.ts` (+1 case): a queued completion consumed outside the signature window stays `pending` — fails on main.
- Verification-integrity baseline recomputed for the new test file and the grown suites.
