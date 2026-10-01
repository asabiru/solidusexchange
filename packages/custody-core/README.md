# SolidChange Custody Core

This package establishes a dev-only custody orchestration boundary for synthetic testnet withdrawal intents.

## Current status

- Runtime boundary: `dev-dry-run`.
- Execution authority: disabled.
- Production signing: disabled.
- HSM/MPC: not selected or provisioned.
- D-002 and D-003 remain `Open`.
- No private keys, mnemonic, seed, signature or raw transaction may enter this package.

This package cannot sign or broadcast transactions. It only validates and seals an unsigned intent envelope that a future separately deployed signer gateway may consume after the required human and infrastructure approvals.

## Contract

`prepareUnsignedTransactionIntent` accepts:

- a reference-only withdrawal command;
- an asset/network pair from the synthetic testnet allowlist;
- a short-lived canonical UTC validity window;
- at least two distinct human approvals;
- distinct maker and checker roles;
- step-up grant references;
- approval evidence bound to the exact SHA-256 command and policy digest.

It returns an immutable envelope with:

```json
{
  "status": "unsigned_intent_ready",
  "runtime_boundary": "dev-dry-run",
  "execution_authority": false,
  "production_signing_enabled": false,
  "key_material_present": false
}
```

Raw destination addresses are replaced by `destination_reference`; exact address ownership remains inside the future custody/signer trust zone. Missing approvals, reused human subjects, stale evidence, command or policy digest drift, mainnet assets and signing-enabled policy fail closed.

`createCustodyIntentPreparedEvent` projects a verified envelope into the canonical additive domain event contract. Aggregate, correlation and idempotency values are derived from the sealed command; causation is derived from a verified canonical `WithdrawalApproved` event, while only the new UUIDv7 event ID and timestamp are supplied by the outbox boundary. The approval event must preserve withdrawal aggregate/correlation, summarize the exact approval evidence digest and occur after the individual approvals. The custody event excludes destination references, individual approvals and all signing material.

`createCustodyProjectionRegistry` provides a synchronous dev-only replay boundary around that projection. An exact canonical replay returns the original immutable event. Reuse of an idempotency key with changed evidence, or reuse of an event, approval event, withdrawal or custody intent identity under another projection, fails closed. This in-memory evidence does not replace a future durable production outbox.

## Verification

```bash
npm ci
npm run verify
npm audit --audit-level=moderate
```

No test or approval in this package authorizes HSM/MPC provisioning, production keys, customer withdrawals, transaction signing or broadcast.
