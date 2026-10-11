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

`tests/postgres-stack.sh` is a separate, opt-in arm that keeps `npm test`
docker-free: it brings up the pinned `postgres:16.10-alpine3.22` service
from `tests/postgres-stack.compose.yaml`, applies the customer-api and
matching-core migrations (same `run_psql` conventions as the package-level
`postgres-*.sh` harnesses), then runs `tests/postgres-stack-contract.mjs` —
rate-limit buckets continuing across a customer-api restart (with the
memory backend's reset as the contrast), and matching-journal durability
proven across independent `tests/postgres-journal-helper.mjs` processes via
`replayMatchingJournalStore` (the engine has no stack daemon of its own —
it runs embedded in customer-api request handlers). It always ends with
`docker compose down -v`, prints a loud notice and exits cleanly when
docker is unavailable, and runs in CI after the docker-free suite.

Nothing here moves money, calls third parties or uses real credentials or PII.

```sh
npm ci
npm ci --prefix ../../miniapp
npm ci --prefix ../../backoffice
npm test

# Postgres persistence arm (needs a docker daemon; skips loudly without one)
npm ci --prefix ../../packages/customer-api
npm ci --prefix ../../packages/matching-core
bash tests/postgres-stack.sh
```
