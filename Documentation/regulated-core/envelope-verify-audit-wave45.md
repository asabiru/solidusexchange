# Envelope Verification Audit — Wave 45 — Proposed

- Status: Proposed
- Scope: the verification path consumers use to check signatures on BFF API envelopes — `backoffice/src/server/signing.ts`, `backoffice/src/data/client.ts`, `packages/e2e-dev/tests/stack.mjs`, `packages/provider-simulators/src/signing.mjs`, `packages/provider-simulators/src/canonical-json.mjs`, `packages/api-contracts`, `packages/customer-api/src/auth.mjs`, `miniapp/src/server/init-data.ts`, `backoffice/src/server/oidc.ts`
- Production effect: none

## Scope reviewed

- Server envelope machinery: `EphemeralSigningKeyProvider` and `ResponseSigner` in `backoffice/src/server/signing.ts` — the envelope wrapper behind every `/bff/api/*` data response, key rotation and the public keyset endpoints.
- Browser consumer verifier: `verifyEnvelope` in `backoffice/src/data/client.ts` — the strictest tier (the wave-39 fix).
- E2E oracle: `verifyEnvelope` in `packages/e2e-dev/tests/stack.mjs`.
- Provider callback verification: `createCallbackVerifier` in `packages/provider-simulators/src/signing.mjs` together with `packages/provider-simulators/src/canonical-json.mjs`.
- Adjacent verified-verifier surfaces checked for the same defect classes: `backoffice/src/server/oidc.ts`, `packages/customer-api/src/auth.mjs`, `miniapp/src/server/init-data.ts`, and the `packages/api-contracts` contract pins (`signature` is a prohibited field name there).

Hunt list applied: algorithm confusion (`alg` taken from untrusted headers, kid fallback to any/first key on miss), verifiers returning true on malformed input, encoding-level comparison instead of decoded bytes, field-order-dependent or duplicate-key canonicalization gaps, unchecked or NaN-tolerant `iat`/`exp`/`nbf`, mutable trust roots, and the wave-39 residual — whether the backoffice `verify()` was fully hardened or only some callers upgraded.

## Defects found and fixed

1. **Server `verify()` never reached the browser bar (wave-39 residual).** `EphemeralSigningKeyProvider.verify()` — the primitive `ResponseSigner.verify` delegates to — kept only the eight-field shape check while `backoffice/src/data/client.ts` gained the full hardening. Four concrete gaps closed:
   - **Mutation-tolerant payload canonicalization.** The payload was re-serialized with `JSON.stringify` without checking it was canonical JSON, so `Infinity`/`NaN` (serialize to `null`) and `-0` (serializes to `0`) produced the identical attested bytes: a payload mutated from `null`/`0` to `Infinity`/`NaN`/`-0` still verified true. Fixed with `isCanonicalJsonValue`: non-finite numbers, `-0`, non-plain objects, accessor members, sparse arrays and symbol members are refused before the signature is checked.
   - **Non-total contract.** `verify()` threw `TypeError` on a `null`/non-object envelope (`Object.keys`) and on a non-string `signature` (`Buffer.from`), so malformed input escaped the boolean contract instead of returning false. Fixed: the input must be a record first, and every attested field's runtime type is checked before use.
   - **Malformed attested fields verified true.** `issuedAt`, `requestId`, `resource` and `signature` were interpolated into the attested message unchecked: an envelope attested over `issuedAt: "not-a-date"`, an empty or non-string `requestId`, or a non-string `resource` verified true. Fixed: `issuedAt` must be a canonical ISO instant (it must round-trip through `toISOString`), `requestId` a non-empty string, `resource` a string, and `signature` strict canonical unpadded base64url — the previous lenient `Buffer.from` decode silently normalized whitespace, `=` padding and foreign characters back into a valid signature.
   - **Retired-key lifetime gap.** A retired key verified envelopes claiming any `issuedAt`, including instants after its retirement; the browser refuses those. Fixed: when the matched key is `retired`, `issuedAt` must parse to an instant at or before `retiredAt`.
2. **E2E oracle skipped key-lifecycle checks.** `verifyEnvelope` in `packages/e2e-dev/tests/stack.mjs` ignored the key's `algorithm` and `status`, so an envelope attested under a non-Ed25519 or post-retirement key still verified in tests. Fixed to mirror the consumer contract: `algorithm` must be `Ed25519`, and a `retired` key only attests envelopes whose `issuedAt` is at or before `retiredAt`.

## Verified clean

- **No algorithm confusion on any tier.** The envelope format pins `signatureVersion: 1` and Ed25519 is implicit in the key material (the browser keyset validation checks `OKP`/`Ed25519` JWK members); no `alg` is taken from untrusted input anywhere. The simulator callback verifier binds the algorithm to the keyring entry server-side and enforces a strict header grammar; OIDC pins `RS256` with an exactly-one-matching-kid rule, `use`/`key_ops`/`alg` JWK checks and a 2048-bit-minimum modulus bound.
- **No kid fallback or empty-keyring pass.** Every tier requires an exact `keyId` + `version` match against a non-empty keyring; the simulator keyring throws on empty key sets and duplicate ids at construction; OIDC refuses zero and multiple kid matches.
- **Canonicalization is byte-stable on the wire.** Envelopes verify over `JSON.stringify` of the seven attested fields — parse-then-reserialize preserves member order and duplicate members collapse identically for attester and verifier, so reordering cannot bypass; the new payload check removes the only residual ambiguity (non-canonical numbers). The simulator path additionally enforces `parseCanonicalJsonBytes`: duplicate members, BOM, invalid UTF-8, lone surrogates and non-canonical number/string forms are refused outright.
- **Expiry and replay bounds hold.** Simulator callbacks enforce a 300-second staleness window plus a 60-second future tolerance through `assertEpochSeconds` (non-finite clock input fails closed), nonce replay through a bounded fail-closed `NonceStore`, and domain/environment binding; `customer-api` tokens enforce expiry plus TTL with a non-finite clock fail-closed; OIDC enforces `exp`/`iat`/`nbf` with finite `NumericDate` checks and bounded skew.
- **Trust roots are immutable at runtime.** Verification keys change only through `EphemeralSigningKeyProvider.rotate` inside the provider (bounded retention, monotonic versions); public keysets expose JWK public material only; simulator keys come from environment config or generated dev keypairs; no key can be added through any request path; `injectedSigningKeys` is dev-server-only test plumbing.
- **Consumers verify before storing.** `miniapp/src/server/kyc.ts` and `miniapp/src/server/provider-quotes.ts` verify the callback envelope before the inbox stores it, and pass the server-side clock (`nowSeconds` / `delivery.deliverAt`) — never an attacker-influenced timestamp.

## Test additions

- `backoffice/src/server/signing.test.ts` (+4 cases): mutated payloads that reserialize to the attested bytes (`Infinity`/`NaN`/`-0`) are now refused; non-record envelopes and malformed signature encodings (whitespace, `=` padding, foreign characters, non-string types) return false instead of throwing; envelopes attested over malformed metadata (`issuedAt` not a canonical instant, empty or non-string `requestId`, non-string `resource`) are refused; a retired key no longer attests an envelope claiming an issue time after its retirement. All four cases fail on main.
- `packages/e2e-dev/tests/dev-stack.test.mjs` (+1 case): a live envelope fails verification when the matching keyset entry is mutated to a non-Ed25519 algorithm or to `retired` with a `retiredAt` earlier than `issuedAt`.
- `packages/e2e-dev/tests/stack.mjs`: the e2e oracle now enforces the key `algorithm`/`status` lifecycle the consumers enforce.
- Verification-integrity baseline recomputed for the touched test files.
