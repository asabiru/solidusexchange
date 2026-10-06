# SolidChange provider simulators (dev-only)

Deterministic, synthetic stand-ins for external partners that are not chosen
yet. Each domain has a provider-neutral adapter contract, a seeded
scenario-driven simulator, signed callbacks and a strict verifier.

| Domain | Contract | Simulator | Gating decision |
| --- | --- | --- | --- |
| KYC (generic; legacy platform used Sumsub, no provider selected) | `KycProviderAdapter` in `src/kyc.mjs` | `createKycSimulator` | KYC provider selection (not yet in the decision register) |
| KYT | `KytProviderAdapter` in `src/kyt.mjs` | `createKytSimulator` | D-011 (Ranex/KYT integration method), `Open` |
| RUB bank / SBP | `BankPaymentAdapter` in `src/bank.mjs` | `createBankSimulator` | D-004 (bank for RUB/SBP), `Open` |
| Liquidity quotes | `LiquidityQuoteAdapter` in `src/quotes.mjs` | `createQuoteSimulator` | D-007 (liquidity model), `Open` |

## Dev-only boundary

- Runtime environment is always `dev-simulator`; there is no production mode,
  feature flag or configuration that connects a real provider.
- No network I/O: sources import only `node:crypto` and sibling modules (no
  `fetch`, HTTP, sockets, DNS). `npm run check` enforces this, plus no ambient
  clock/randomness, timers, env/credentials or floating-point money.
- No money movement and no execution authority:
  - quotes are `status: "indicative"`, `execution: "not_supported"`;
    `assessQuote` always returns `executable: false`; there is no accept,
    order, hedge or settle function;
  - the bank simulator only produces synthetic payment-intent and callback
    records with `posting: "none"`; nothing posts to a ledger, settles, pays
    out or refunds;
  - KYC/KYT outputs are evidence for human-owned policy, not decisions.
- Synthetic, non-PII data only: subject references must match
  `^sim-[a-z0-9-]{1,60}$`; unknown request members are refused.
- Signing keys are generated per run (`generateSimulatorKey`) and never derived
  from the seed or persisted. These are not custody keys; nothing here signs or
  broadcasts chain transactions. Networks are testnet only.
- Money is always a decimal string with a fixed per-asset scale: RUB 2,
  USDT 6, TON 9 (prices: 8). JavaScript numbers are rejected for amounts.

These limits follow `Documentation/regulated-core/README.md` (stop condition 4:
no money-moving endpoint without idempotency, policy decision, immutable audit,
ledger effect and reconciliation path).

## Scenarios

Scenarios are chosen per synthetic subject (`scenarios: { "sim-…": name }`) or
with `defaultScenario`; an unmapped subject fails with
`scenario_not_configured`. Time comes from `createSimulatedClock()`.

- KYC: `approve`, `reject`, `needs_more_data`, `pending_timeout`,
  `provider_outage`, `duplicate_callback`, `out_of_order_callback`,
  `late_callback`.
- KYT: `low`, `medium`, `high`, `severe`, `sanctions_hit`, `pending_timeout`,
  `provider_outage`, `duplicate_callback`, `out_of_order_callback`,
  `late_callback`. Results are bound to asset, network, direction, address,
  tx reference and amount (`binding_digest`).
- Bank/SBP: `payment_found`, `payment_not_found`, `partial_payment`,
  `duplicate_payment`, `reversed_payment`, `provider_outage`,
  `duplicate_callback`, `out_of_order_callback`, `late_callback`.
- Quotes (per pair): `fresh_quote`, `expired_quote`, `stale_price`,
  `provider_outage`, with configurable TTL (`ttlSeconds`), spread
  (`spreadBps`, half applied per side) and fee (`feeBps`, in the quote asset,
  rounded up). Buy amounts round up, sell amounts round down.
  A request fixes exactly one amount: `base_amount`, or for `side: "buy"`
  only a `quote_amount` spend budget. With a budget the quote is for the
  largest base amount whose `total_quote_amount` (fee included) fits it;
  the record carries `amount_mode` (`base` | `quote`) and
  `requested_quote_amount` (`null` in base mode), and the verifier rechecks
  that the base amount is maximal (schema `solidchange.sim.quote.v2`).

Every create call is idempotent: the same `idempotency_key` with the same
request returns the stored response, a different request fails with
`idempotency_conflict`. Outages throw `ProviderError` with
`code: "provider_unavailable"` and `retryable: true`.

Same seed + same key + same calls produce byte-identical records, nonces and
signatures (Ed25519 is deterministic). A new key changes only signatures.

## Signed callbacks

Headers: `x-sim-key-id`, `x-sim-timestamp` (epoch seconds),
`x-sim-nonce` (32 lowercase hex), `x-sim-signature: v1=<base64url>`.
Algorithms: Ed25519 (default) or HMAC-SHA256. The signature covers:

```text
solidchange-sim-callback-v1\n<domain>\n<key id>\n<timestamp>\n<nonce>\n<sha256 hex of body>
```

The body is canonical JSON (UTF-8 without BOM, sorted keys, no whitespace,
`JSON.stringify` escapes, NFC strings, safe integers only, depth ≤ 16).

`createCallbackVerifier` (and the per-domain `create*CallbackVerifier`) is
fail-closed and returns `{ ok: false, reason }` for: non-byte bodies, bodies
over 16 KiB, malformed or duplicate (case-insensitive) headers, missing
headers, malformed key id / timestamp / nonce, non-canonical signature
encodings (padding, standard base64, case, whitespace, wrong length), stale
(>300 s) or future (>60 s) timestamps, unknown key id, wrong key or tampered
input, invalid UTF-8, BOM, invalid JSON, duplicate keys (also after escape
decoding), lone surrogates, excessive nesting, any non-canonical spelling,
domain/environment mismatch, schema violations, replayed nonces and a full
nonce store.

`create*CallbackInbox` is the consumer side for verified events: duplicates
have no effect, conflicting re-use of an event id, invalid transitions and
events after the subject deadline are held for review, events ahead of a gap
are buffered and applied in sequence order, older events are ignored.

## How a real adapter plugs in

1. A real adapter lives in a separate, separately reviewed package and
   implements exactly the operations in `ADAPTER_OPERATIONS`; it must pass
   `assertProviderAdapter(kind, adapter)`, which also refuses any
   execution/money-moving operation names.
2. Its callbacks are translated into the same domain payload schemas and are
   accepted only through the shared verifier rules above, with keys held
   outside the repository.
3. Replacement is gated by the decision ids above reaching an approved state
   with Legal/Compliance/Finance/Security sign-off; until then only the
   simulator is used. Bank callbacks additionally need the ledger,
   reconciliation and audit path required by stop condition 4 before any
   posting can exist.

## Run

```bash
npm ci
npm run verify   # check + lint + typecheck + test + build
```

Individual scripts: `npm run check`, `npm run lint`, `npm run typecheck`,
`npm test`, `npm run build` (emits `.d.mts` declarations to `dist/`).
