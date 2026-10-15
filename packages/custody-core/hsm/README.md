# HSM Custody — Draft Interfaces

Dev-only reference artifacts for the "Engineering work possible now" list in
[hsm-custody-program.md](../../../Documentation/regulated-core/hsm-custody-program.md).
Nothing here holds keys, signs, broadcasts or touches a network.

## Status

- Unapproved draft; D-002 and D-003 remain `Open`.
- Production signing, key material and mainnet: absent by construction.
- These artifacts document and executable-test the *evaluation contract* a real
  HSM policy module must satisfy; cryptographic quorum verification and
  real chain decoding are explicitly deferred to the assurance plan.

## Signer interface contract

The three-way seam (orchestrator → signer gateway → in-HSM policy module):

```text
Custody orchestrator (unsigned-intent.mjs, exists)
  └─► verified intent envelope ── intent_digest binds command+policy+approvals

Signer gateway (reference: src/signer-gateway.mjs transport + src/hsm-policy.mjs boundary)
  transport: signing_request envelope = { request_id, custody_policy_version,
    hsm_policy_version, tier, network, intent_digest, policy_digest,
    wire_payload, wire_digest, created_at, expires_at, request_digest,
    runtime_boundary, key_material_present: false, signature_attached: false }
    — hash-bound end to end: request_digest covers every field, wire_digest
    pins the payload bytes, expiry ≤ intent expiry, versions must equal the
    live custody/HSM policies.
  request:  { intent, transaction: { raw_payload: <hex> } }
  response: { decision: "approved" | "rejected",
              reason: null | <stable reason code>,
              tier, signing_mode, intent_digest,
              checks: { quorum, allowlist, limits, velocity,
                        transaction_match, expiry, replay, time_delay },
              transaction?: <canonical decoded shape>,
              evidence_digest }
  decision envelope (signer-gateway.mjs): { decision, reason, tier,
    signing_mode, intent_digest, request_digest, wire_digest,
    hsm_policy_version, evidence_digest, runtime_boundary }
  invariants: no keys in or out; every rejection names exactly which arm
  refused; an approval mutates only counters/nonce/consumed-digest state.
```

`evaluate` consumes an already-verified `unsigned_intent_ready` envelope and a
hex-encoded synthetic wire transaction. The check order is fail-closed:
frozen → ceremony-only tier → digest present → replay → expiry → tier time
delay → structural quorum (count, exact roles, distinct subjects, digest
binding re-derived via `computeIntentDigest`) → destination allowlist →
per-transaction limit → daily velocity counter → independent decode →
intent↔transaction field equality → tx-expiry ≤ intent expiry → sequence
strictly advancing per `(tier, network)` → then counters commit.

### Rejection reason codes (stable, auditable)

`tier_frozen`, `tier_requires_ceremony`, `intent_missing`, `intent_replayed`,
`intent_expired`, `tier_time_delay`, `quorum_missing`, `quorum_not_bound`,
`quorum_roles_missing`, `quorum_subjects_overlap`,
`destination_not_allowlisted`, `asset_not_in_tier`,
`per_transaction_limit_exceeded`, `daily_velocity_limit_exceeded`,
`transaction_decode_failed:*`, `transaction_intent_mismatch`,
`transaction_outlives_intent`, `sequence_not_advancing`

## Files

| File | Purpose |
|---|---|
| `hsm-policy-draft.json` | Tier policies (hot/warm/cold), limits, velocity, allowlist, quorum, freeze semantics |
| `../src/hsm-policy.mjs` | Reference policy-module engine + freeze/unfreeze quorum |
| `../src/signer-gateway.mjs` | Orchestrator→gateway→HSM transport: hash-bound `signing_request`/`signing_decision` envelopes, gateway verification, dispatch |
| `../tests/signer-gateway.test.mjs` | Gateway contract evidence: prepare/verify/dispatch, tamper rejection, propagation |
| `../src/tx-decoders.mjs` | Independent TON/TRON synthetic wire decoders (co-verifier stand-in) |
| `../src/watcher.mjs` | Testnet watcher prototype: intent-matched outflows reconcile, unexplained outflows open a critical incident and freeze the network |
| `../tests/hsm-custody.test.mjs` | Synthetic evidence for every check arm |
| `ceremonies.md` | Draft ceremony scripts (C-01..C-08), recovery/rotation/destruction runbooks and the key-inventory register template |

## Draft findings worth recording

- **Warm delay vs intent TTL:** the warm tier's `time_delay_seconds` must stay
  under `custody-policy.json`'s `maximum_intent_ttl_seconds` (300) or warm
  signing is unreachable. The draft sets warm delay to 120 s; production
  numbers belong to the open tier-limits decision.
- **Cold tier is ceremony-only** in the reference engine — `evaluate` always
  returns `tier_requires_ceremony`; cold signing has no automatic path by
  design.
- The replay set and sequence counters are per-engine-instance; the durable
  production store is the HSM's internal counters, per the program.

## Promotion path

1. Record D-002/D-003 and the assurance-plan sign-offs.
2. Replace the structural quorum check with in-boundary signature
   verification on approver hardware keys.
3. Replace the synthetic wire decoders with real TON cell / TRON protobuf
   decoding; the canonical comparison shape stays the contract.
4. Source the watcher from company-operated TON/TRON nodes plus an
   independent provider, per the monitoring section.
