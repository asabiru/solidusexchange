# Custody Core Audit — Wave 69 — Proposed

- Status: Proposed
- Scope: `packages/custody-core` (`src/unsigned-intent.mjs`, `src/custody-event.mjs`, `custody-policy.json`, `migrations/0001_custody_projection_outbox.sql`) — withdrawal-intent orchestration, maker and checker evidence, command and policy digest binding, sealed unsigned envelope, replay boundary
- Production effect: none

## Scope reviewed

- Maker and checker: role separation, same-subject exclusion, quorum sizing, ordering, staleness, per-entry digest binding, consumed identity reuse
- Command and policy digest binding: canonical form, key order, nested objects, number representation, evidence bound to a different command or policy
- State machine: lifecycle, terminal immutability, rejected inputs are never persisted, concurrent consume races
- Envelope sealing: unsigned payload only, one-way seal, digest binds the full envelope, no field that could carry signing material
- Bounds and canonicalization: size caps, identity grammars, charset and length bounds, registry map bounds
- Determinism and replay: same inputs produce the same ids and envelope, replays reproduce identical digests, clock pinned to the injected clock

## Defects found and fixed

1. The projection registry tracked the set-level identity and the per-entry identity in separate maps, and prepared and source event identities in separate maps. The same identity literal was therefore consumable twice — once under each role — even though the PostgreSQL outbox consumes each identity column once. The registry now consumes set-level and per-entry identities in one namespace, and prepared and source event identities in one namespace.
2. Every registry map was unbounded; the standing "no unbounded Maps" rule did not hold for the package. `createCustodyProjectionRegistry` now takes `maxEntries` (default 10,000, a positive safe integer), enforces the bound before recording a new projection, and charges nothing for an exact replay.
3. Policy TTL parameters were pinned positive but uncapped, so an arbitrarily large integer value could disable both the evidence window and the intent window while remaining a valid policy. Both TTL ceilings now sit inside a one-day dev bound, enforced at `assertPolicy`.
4. The canonical entry ordering sorted on `localeCompare`, which follows host collation rather than a stable byte order; under a collation where underscore sorts before digits, operator output could diverge across environments. Ordering now uses a fixed codepoint comparison.

## Verified clean

- Maker cannot also act as checker: `subject_reference`, `actor_reference` and `subject_id` are distinct across the maker and checker entries, each entry binds its own `intent_digest`, and the checker entry must be `approved_at`-stamped no earlier than the maker entry — so a self-issued or self-reviewed entry cannot satisfy the required quorum.
- Expired evidence cannot count: each entry carries its own validity window checked against the injected clock, the intent's overall evidence window caps the oldest evidence timestamp, and only testnet allowlist assets with a capped TTL reach the later checks — no stale or out-of-window entry reaches the sealed envelope.
- Digest binding is injective over the restricted leaf model: `canonicalize` sorts object keys by UTF-16 codepoint and `JSON.stringify` makes the form unambiguous for the strings and integers the grammar allows; every numeric field is integer-pinned so `1`, `1.0` and `1e0` can only arrive as `1`; no free-form nested object exists in the schema to diverge.
- An evidence bundle bound to a different command or policy cannot replay: each entry's `intent_digest` must equal `computeIntentDigest(command, policy)`, digest drift on either side fails closed, and the registry consumes each evidence digest once.
- The sealed envelope carries no signing surface: `prepare` emits a fixed eleven-key literal, `verify` pins the exact key set, the restricted-field scan runs beneath that exact shape, `execution_authority` and `key_material_present` stay `false`, `signing_enabled` in policy or key-like values in command or policy all fail closed, and the boundary script pins the strings.
- Sealing is one-way: the envelope status literal is terminal in this package, `deepFreeze` seals the command, the policy and every entry reference, no unseal or amend path exists, and the registry performs every check before any write so a failed projection records nothing and a concurrent consume cannot interleave.
- Determinism and replay: identical inputs produce identical intent ids, digests and sealed envelopes; an exact canonical replay returns the original event untouched; the injected `now` is the only clock; canonical key sorting is a pure codepoint order after the `localeCompare` fix.
- Rejected input is tombstoned rather than deleted: nothing is persisted or mutably updated on failure, the registry leaves no partial record, and the outbox migration is append-only.

## Observations

- Step-up references are opaque in the dev evidence model: they must be distinct and are consumed once each, but issuance, expiry and revocation of the referenced right live outside this package and remain a future custody trust-zone concern.
- Operator uniqueness rests on `subject_reference` equality; whether two references name the same human is the upstream identity registry's domain.
- The `operator_`-namespaced event actor cannot be cross-checked to the command's `operator_ref_` identities and is only distinctness-checked with `subject_reference`.
- Extra top-level request keys are tolerated (the request digest binds them), matching the additive outbox contract; the canonical event shape itself stays exact.
- There is no reject or cancel surface in the dev model — intent flow is happy-path-only by design, so there is no tombstone-vs-delete defect to hunt.
- `computeIntentDigest` binds the digest to raw command plus policy without running command semantics; semantic equivalence beyond canonical form is out of scope for this package.
- `custody-core` has no `typecheck` script or `tsconfig` (its `verify` script is check, migrations and tests); an ad-hoc strict checkJs run reports the same implicit-any set on origin/main as on this branch, so the change adds no new type surface.
- The SQL outbox consumes each identity through its own unique column; the registry's unified namespaces are the stricter fail-closed reading of the same intent and require no migration change.

## Test additions

- `tests/unsigned-intent-wave69.test.mjs` adds eleven adversarial cases; nine fail on `origin/main` for the findings above and two are regression guards that hold on main:
  - registry capacity is enforced (`maxEntries` bound) and validated (non-integer or non-positive capacity rejected)
  - an exact replay consumes no capacity
  - member identities cannot be recited as set identities, and set identities cannot be recited as member identities
  - prepared event ids cannot be recited as source event ids, and source ids cannot be recited as prepared ids
  - policy TTL ceilings above the one-day dev bound are rejected, and inflated TTLs cannot revive stale evidence
  - canonical entry ordering no longer depends on host collation (source pin)
  - the sealed envelope still exposes no signing surface (regression guard)
- `packages/custody-core/README.md` contract paragraphs updated for the registry bound, the shared identity namespaces and the TTL ceiling.
