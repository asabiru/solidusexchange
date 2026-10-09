# Backoffice View Surfaces Audit — Wave 39 — Proposed

- Status: Proposed
- Scope: `backoffice/src/server/subjects.ts` and the customer-360 aggregation `subjectTimeline` in `backoffice/src/data/demo.ts` (introduced by the cross-entity timeline view), the `/bff/api/kyc` view internals (`server.ts` route plus `provider-evidence.ts` feed), `demo.ts` repository bounds, the in-memory audit chain in `audit-store.ts`, and signature-envelope helper edge cases in `signing.ts` outside the wave-34 core audit. Fetch-site guard uniformity and audit-commit ordering on the new read routes were re-verified.
- Production effect: none

Hunt list applied: one customer's data appearing under another's ref, capability-checked reads leaking unauthed aggregates, unbounded in-memory timelines and stores, prototype-key confusion on refs or kinds, malformed refs becoming 500s, envelope sealing nondeterminism, missing `sec-fetch-site` guards on the new routes, and audit-commit failures leaving views partially served.

## Defects found and fixed

1. `buildSubjectTimeline` aggregated every domain unconditionally, so a role holding only `subjects:read` (support-l1) received summaries of custody withdrawals, KYC/AML cases, investigations, fraud alerts and audit events — domains its own capability set denies on the direct routes. The feed now filters entry kinds through `readableSubjectKinds`, which maps each kind to the capability that guards its own read route, so the timeline never exceeds what the caller could read directly.
2. The audit-entry join seeded the match set with the raw `ref` and compared `actor`/`resource` last segments against it. As a result, entity ids (`AML-78031`, `KYC-220184`, `INV-43018`, `FRD-61084`, `WDL-991804`), a ledger ref (`LED-221840`) and operator/service handles (`aml-08`, `fraud-04`, `finance-03`, `support-l1-12`, `payments-orchestration`, `compliance-workflow`, `fraud-monitor`) each resolved to a "subject timeline" of another customer's or operator's audit entries. Resolution now requires the ref to name a subject or customer id, the audit join only matches the subject's own resolved entity refs plus `subject:`/`customer:`-prefixed resources, and customer-actor events only; all of those refs now answer `404 subject_not_found`.
3. Two seeded audit events referenced `withdrawal:WDL-991804`, an id no entity carries (the intent id is `WDR-991804`), so the withdrawal's own audit trail joined no subject's feed. The refs were corrected, restoring the missing entries.
4. `MemoryAuditStore` grew without bound — every audited view appends one event and the full chain is re-verified per operation, so memory and per-request cost climbed for the life of the process. The store is now bounded (`maxEvents`, default 10 000) and fails closed: appends past capacity raise `AuditUnavailableError`, the route answers `503 audit_integrity_unavailable`, and the view is never served — reads at capacity keep working.
5. `EphemeralSigningKeyProvider.verify` ignored extra top-level envelope members, weaker than the browser verifier's exact eight-field rule; it also compared `keyVersion` without constraining its shape. Verification now requires exactly the eight sealed fields plus a positive safe-integer `keyVersion`, matching `client.ts`.

## Verified clean

- Fetch-site guard uniformity: every GET route that appends an audit event (checks, support, withdrawals, subjects timeline, reports) rejects `Sec-Fetch-Site` other than `same-origin`/`none` before authorization and before any append; non-appending reads (kyc, aml, investigations, fraud-alerts, the maker-checker queue, audit reads) intentionally carry no guard, matching the wave-27 convention.
- Audit-commit ordering: on every audited route the sequence is snapshot → append → serve, so a commit failure surfaces `503` and no view is partially served; non-commit failures (malformed ref, missing entity) exit earlier.
- KYC/AML view internals: `provider-evidence.ts` replays every delivery through the matching verifier before the inbox projection, probe deliveries are marked `synthetic-probe` and recorded as rejections, the feed is frozen once and memoized as a promise, and callback records carry metadata only — no raw bodies.
- Ref handling: `decodeURIComponent` failures return `404`, `isSubjectRef` rejects non-`[a-z0-9_-]{4,64}` spellings with `400`, and ref/kind matching uses `Set`/`Map` membership only — no plain-object lookup, so `__proto__`-style refs resolve to nothing.
- Envelope sealing: Ed25519 over a fixed-order canonical message is deterministic for identical inputs; `randomUUID` request ids and `issuedAt` timestamps are fresh per response by design; `verify` binds `keyId`+`keyVersion` before crypto work; keyset rotation keeps a bounded retired set.
- `demo.ts` repository surface stays read-only: collections are deep-frozen, the timeline is rebuilt per call (no cache that could grow), and `subjectTimeline` scans bounded synthetic arrays only.

## Observations (recorded, not defects in this slice)

- A subject that resolves but whose entries are all filtered by capability still returns `200` with an empty `entries` list; existence of a customer ref is not treated as secret because `customers:read` already lists every customer.
- The PostgreSQL audit backend stores `retention_until` but pruning is intentionally unimplemented; both stores report `retentionDays` as metadata.
- `subject.timeline.viewed` events land in the audit store, not the timeline's seed source, so a feed never contains entries about viewing itself.
