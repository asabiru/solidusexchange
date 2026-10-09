# SOLID Customer API (dev-only runtime)

First runtime for the canonical customer contract in
[`packages/api-contracts/openapi.yaml`](../api-contracts/openapi.yaml). It is a
dependency-free Node ESM `node:http` server for local development only.

## Status

- Runtime boundary: `contract-only`; `financial_commands_enabled: false`;
  `production_providers_enabled: false`.
- Served operations, `GET` only:
  - `GET /api/v1/meta` (`getApiMetadata`, public, still requires `X-Request-Id`);
  - `GET /api/v1/customer/session` (`getCustomerSession`);
  - `GET /api/v1/customer/capabilities` (`getCustomerCapabilities`);
  - `GET /api/v1/customer/wallets` (`getCustomerWallets`): a frozen deterministic
    synthetic wallet list per subject (RUB/TON/USDT, decimal-string balances in
    asset scale); KYC-gated — only a `verified` KYC status receives `200`, other
    customers get `403 CAPABILITY_DENIED`.
  - `GET /api/v1/customer/notifications` (`getCustomerNotifications`): a frozen
    deterministic synthetic test-mode notification feed per subject
    (`ntf_*` ids, ISO `created_at`, `delivery: "disabled"`, `mode: "test"`);
    KYC-gated exactly like the wallets read — `403 CAPABILITY_DENIED` without a
    `verified` KYC status.
  - `GET /api/v1/customer/kyc` (`getCustomerKyc`): a frozen deterministic
    synthetic KYC status view per subject (`kyc_*` application ids, ISO
    `submitted_at`/`updated_at`, optional simulator `reason_codes` and
    `requested_items`, `mode: "test"`, `provider: "simulator"`). **Not**
    KYC-gated: it is the onboarding surface itself, so every authenticated
    customer can read their own status — gating it on `verified` would
    deadlock onboarding, and the miniapp likewise serves `/bff/kyc/status` to
    kyc-gated sessions. The derived application `status` is always coherent
    with the session-level `session_kyc` the capability gate evaluated.
  - `GET /api/v1/customer/profile` (`getCustomerProfile`): a frozen
    deterministic synthetic profile per subject (`SC-DEV-*` customer
    reference, `Customer <hex>` display name, `en`/`ky`/`ru` locale, ISO
    `registered_at`, `mode: "test"`). Synthetic identity fields only — never
    real PII. **Not** KYC-gated: like the KYC status read it carries the
    subject's own identity surface, and the miniapp likewise serves
    `/bff/profile` to every authenticated session, kyc-gated included
    (degrading `apiAccess` in place rather than refusing).
  - `GET /api/v1/customer/support` (`getCustomerSupport`): a frozen
    deterministic synthetic support-ticket list per subject (`tck_*` ids,
    `question`/`operation_problem`/`complaint`/`data_request` categories
    mirroring the miniapp support surface, `received`/`in_review`/`answered`/
    `closed` statuses with a coherent ISO `timeline`, `complaint_acknowledged`,
    ISO `created_at`/`expires_at`, `mode: "test"`, `delivery: "disabled"`).
    **Not** KYC-gated: tickets are the subject's own service-requests surface
    and the miniapp likewise serves `/bff/support/requests` to every
    authenticated session, kyc-gated included — support notifications
    (`support_received`/`complaint_received`) appear in unverified flows too.
  - `GET /api/v1/customer/deposits` (`getCustomerDeposits`): a frozen
    deterministic synthetic deposit list per subject (`dep_*` ids, `asset`
    `RUB`/`method` `sbp`, `expected_amount`/`received_total`/`reversed_total`
    decimal strings, `payment_reference`, `status` enum mirroring the bank
    simulator's payment states, ISO `created_at`/`updated_at`,
    `posting: "none"`, `mode: "test"`). KYC-gated exactly like the wallets
    and notifications reads — deposits are an asset/activity collection, not
    an onboarding or identity surface — `403 CAPABILITY_DENIED` without a
    `verified` KYC status. The read is observational only: `deposits.create`
    stays an unserved, denied financial capability.
  - `GET /api/v1/customer/withdrawals` (`getCustomerWithdrawals`): a frozen
    deterministic synthetic withdrawal list per subject (`wdr_*` ids,
    custody-allowlisted `asset`/`network` testnet pairs, `status` enum
    mirroring the custody withdrawal-intent lifecycle incl. maker-checker
    steps and the sealed `unsigned_intent_ready` state, `amount`/`fee_amount`
    decimal strings, `destination_reference`, two `wdl_*` out-legs for the
    principal and the fee, ISO `created_at`/`updated_at`/`expires_at`,
    `posting: "none"`, `mode: "test"`). KYC-gated exactly like the deposits,
    wallets and notifications reads — withdrawals are an asset/activity
    collection, not an onboarding or identity surface — `403
    CAPABILITY_DENIED` without a `verified` KYC status. The read is
    observational only: `withdrawals.create` stays an unserved, denied
    financial capability.
- Operator paths, other namespaces, other methods and every non-exact path
  (trailing slash, case variants, encoded characters, dot segments, query
  strings, absolute-form, `*`, `CONNECT`) return `404` with the error envelope
  from `schemas/error.schema.json`.
- No money-moving endpoint, command, provider, chain, KYC/KYT vendor, IdP, KMS,
  HSM/MPC or outbound network call exists in this package.

## Authentication

Authentication goes through a `TokenVerifier` interface
(`{ kind, verify(token) -> principal | null }`) so a reviewed IdP adapter can
replace it later. The default verifier is **deny-all**: every protected request
returns `401 AUTHENTICATION_REQUIRED`.

A synthetic HMAC-SHA256 dev verifier is enabled only when all of these hold:

- `CUSTOMER_API_DEV_AUTH=synthetic`;
- `CUSTOMER_API_DEV_TOKEN_KEY` is 64 lowercase hex characters (local random value, never a real secret);
- `NODE_ENV` is not `production` (compared case-insensitively after trimming whitespace);
- the bind host is loopback (`127.0.0.1` or `::1`; anything else refuses to start).

Synthetic tokens carry a `syn_cust_` subject and a short expiry (max 1 hour).
Only `customer` principals are accepted.

## Capabilities

Deny-by-default. `customer.session.read`, `customer.capabilities.read`,
`customer.kyc.read`, `customer.profile.read` and `customer.support.read` are
always granted — the KYC status, profile and support tickets reads must stay
reachable for unverified customers or they could never see their own
onboarding, identity and service-requests state;
`customer.wallets.read`, `customer.notifications.read`,
`customer.deposits.read` and `customer.withdrawals.read`
are granted only to a `verified` KYC status so they can serve the synthetic
wallet, notification, deposit and withdrawal collection reads.
`commands_enabled` is always `false`. Every financial capability (deposits,
withdrawals, quotes, exchange orders, payments, cards) is KYC-gated and denied
with internal reason codes such as `FINANCIAL_COMMANDS_DISABLED`,
`KYC_VERIFICATION_REQUIRED`, `DECISION_D_001_OPEN`, `DECISION_D_014_OPEN`. Even
a synthetic `verified` KYC status grants nothing financial. `CapabilitiesView` has no field for reasons,
so they are not exposed to clients; tests check that every referenced decision
exists in `Documentation/regulated-core/decision-register.md` and is still `Open`.

## Request rules

- Customer operations require exactly one each of `Authorization: Bearer <token>`,
  `X-Request-Id` (lowercase UUIDv7), `X-Client-Version` (1-64 chars) and
  `X-Platform` (`android` | `ios` | `web`).
- `X-Device-Id` is rejected on customer and metadata operations.
- Duplicate, missing or malformed headers, request bodies and body headers return
  `400 VALIDATION_FAILED`; malformed HTTP is answered with the same envelope.
- `X-Request-Id` is echoed only when valid; otherwise a fresh UUIDv7 is generated.
- A fixed-window rate limit returns `429 RATE_LIMITED` with `Retry-After`. All
  IPv4 loopback sources (`127.0.0.0/8`) share one bucket, so rotating the local
  source address does not reset the limit.
- Unexpected failures return a generic `500 INTERNAL_ERROR` without internals.

## Dev observability

- `CUSTOMER_API_LOG=json` writes one JSON line per completed request to stdout:
  `{ ts, service, method, route, status, duration_ms, request_id }`. `route` is
  a contract path, `/metrics` or `unmatched`; `request_id` is a server-generated
  random hex value, never the client `X-Request-Id`. No headers, tokens, query
  strings, subjects or peer addresses are logged.
- `CUSTOMER_API_METRICS=loopback` serves Prometheus text at `GET /metrics` to
  loopback peers only (no `Origin`, proxy or cross-site headers); non-GET is
  `405`. It is outside the customer contract and `404` when the flag is unset.
- Both default to `off`; any other value fails startup.

## Run

```bash
cd packages/customer-api
npm ci                                     # dev-only tooling: typescript, @types/node
npm run lint                               # node --check on every .mjs file + boundary check
npm run typecheck                          # tsc --noEmit, checkJs + strict over src/ and scripts/
npm test                                   # boundary check + conformance suite
npm run dev                                # deny-all auth on 127.0.0.1:8790

export CUSTOMER_API_DEV_AUTH=synthetic
export CUSTOMER_API_DEV_TOKEN_KEY="$(openssl rand -hex 32)"
npm run dev &
TOKEN="$(npm run --silent mint-dev-token -- --subject syn_cust_00000001 --ttl 900)"
curl -s http://127.0.0.1:8790/api/v1/customer/capabilities \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Request-Id: 018f3f8a-6a36-7bd8-86e0-b59cd575d55a" \
  -H "X-Client-Version: 0.1.0" -H "X-Platform: web"
```

Other settings: `CUSTOMER_API_HOST` (loopback only), `CUSTOMER_API_PORT`,
`CUSTOMER_API_RATE_LIMIT_PER_MINUTE`.

## No build step

The package is plain Node ESM (`.mjs`) and runs directly from `src/`, so there
is no `build` script and nothing to compile or bundle. Types are JSDoc
annotations checked by `npm run typecheck` (`tsconfig.json`, `noEmit`). The
only devDependencies are the exact `typescript` and `@types/node` versions
pinned by `scripts/check-boundary.mjs`; runtime dependencies stay forbidden.

## Conformance tests

`tests/contract-validator.mjs` is a small dependency-free validator for the
JSON Schema subset used by the contract. It fails closed on unknown keywords,
types, formats and references. Every response the tests produce is checked
against the OpenAPI response for that operation and status (headers, media
type, body, closed objects, `request_id` echo rules).
