# @solidchange/e2e-dev

Shell-level, browser-free smoke test of the synthetic dev stack. It starts, on
`127.0.0.1` ephemeral ports with keys generated per run:

- `packages/customer-api` dev server (subprocess, synthetic HMAC auth);
- the Mini App BFF (in-process, from `miniapp/.server-dist`), wired to that
  customer-api and to the deterministic `packages/provider-simulators`;
- the backoffice BFF (subprocess, dev mode, signed envelopes).

`tests/dev-stack.test.mjs` covers the customer KYC journey, advisory address
screening via signed KYT simulator callbacks, customer negative paths and
operator evidence/report access. `tests/boundaries.test.mjs` checks
that every server refuses `NODE_ENV=production` and non-loopback hosts.
`tests/resilience.test.mjs` injects failures: an unreachable, killed, slow or
malformed customer-api (loopback stub), provider-simulator outage/timeout/late
callback scenarios and an unreachable PostgreSQL audit store; each must fail
closed with a documented error. `tests/load.test.mjs` runs a bounded concurrent
mixed burst against in-process servers and checks rate limits, session and
storage caps, RSS growth and a 60 s runtime budget.

Nothing here moves money, calls third parties or uses real credentials or PII.

```sh
npm ci
npm ci --prefix ../../miniapp
npm ci --prefix ../../backoffice
npm test
```
