# Resilience e2e arm — adversarial audit (wave 72)

- Status: Proposed

Mutation-coverage audit of `packages/e2e-dev/tests/resilience.test.mjs` — the
degrade / restart / failure-injection arm — following the wave-70 arms audit
(verifyEnvelope + chain arms) and the wave-71 OIDC-arm audit. Method: per
finding, a product/harness mutation was applied to the built `.server-dist`
servers and the arm was shown to stay green; the arm fix lands in this change;
every product mutation was reverted (dist rebuilt) before the final green run.
Final state: 24 tests, all green (~120 s).

## Defects found and fixed

1. **Unreachable describe never exercised a verified session.**
   `assertUnavailable` took only a gated cookie, so the entire
   "unreachable is not denied" contract for verified sessions was unpinned:
   a client mutation mapping connection failure to the denied branch answered
   every upstream-coupled surface in place (gated fixture / emptied lists)
   and the arm stayed green. Repro'd — verified `/bff/wallet` returned the
   zeroed in-place view instead of `wallet_unavailable`.
   **Fix:** `assertUnavailable` now logs in both session levels and walks the
   full route table — all `*_unavailable` shapes for verified, the never-denied
   surfaces for both levels, the member reads, the upstream-coupled POST
   (`/bff/notifications/read`), the verified previews, and the exact local
   contract for in-process surfaces (health, session, local POSTs, gated
   previews). Applied in all three unreachable tests (never-started,
   drop-on-connect, SIGKILL mid-session).

2. **Member reads had no resilience coverage.**
   `/bff/markets/:instrument`, `/bff/checks/:id`, `/bff/operations/:id`,
   `/bff/address-screening/:id` each have their own degrade semantics —
   unavailable → sibling `*_unavailable`; denied/missing → local not-found or
   in-place fallback. None was exercised; mutations to silent-local fixture
   data (checks), 404-on-failure (markets), 503-on-missing (operations) and
   fixture-substitution (screening) all stayed green. Repro'd each.
   **Fix:** the stub gained a `/markets/` member arm (contract-valid depth:
   bids desc, asks asc, never crossed), and new helpers
   `marketsMemberFailsClosed`, `checkDetailFailsClosed` pin 503 + leak
   strings + the gated no-upstream-hit local answer; the screening and
   operations member asserts were already present and are now reachable
   (see #4).

3. **Screening member's 404 branch was dead code.**
   `screeningDetailFailsClosed` branched on an upstream-404 degrade no stub
   mode could produce — unreachable on every invocation. **Fix:** the helper
   now asserts strict `503 screening_unavailable`; upstream-404 semantics are
   pinned by the dedicated `not_found` mode where the member read's
   documented local fallback is the only legitimate not-found answer.

4. **Upstream-404 / 429 / 400 statuses were never injected.**
   Only `capability_denied` exercised a clean status class; a member route
   that mis-maps "missing" vs "unavailable", or a mutation collapsing all
   non-ok statuses to one branch, stayed green. Repro'd: operations member
   answered `operations_unavailable` where `not_found` is the contract.
   **Fix:** new modes `not_found` (404), `rate_limited` (429),
   `validation_failed` (400) — folded into the malformed battery plus a
   dedicated `not_found` test that pins the per-route semantics: collection
   reads fail closed (`*_unavailable` — a collection endpoint never
   legitimately 404s), member reads answer their documented fallback
   (`not_found`, never a fabricated fixture row), the checks member resolves
   through the collection read (`checks_unavailable`), the screening member
   falls to the local store, and local surfaces stay local.

5. **POST surfaces had zero coverage.**
   `/bff/notifications/read` (verified session reports the served unread
   count), the local-write POSTs (support, kyc, screening) and
   `/bff/sessions/revoke-others` were never exercised under a degrade. A
   mutation answering notifications/read with the local unread count on
   upstream failure stayed green — repro'd (`200` vs `503`).
   **Fix:** `notificationsReadFailsClosed` (verified → 503, gated → local
   200, upstream-hit pins) plus the dedicated *local writes* test — every
   local POST applies immediately with its read-back while upstream fails,
   and `upstream.length` proves none consulted upstream.

6. **Recovery pinned only four list values.**
   The recovery test proved "200 again" on a handful of reads — a BFF
   recovering into permanently-cached degraded data passed. **Fix:** the
   recovery test now snapshots `upstream.length` first and proves growth
   (fresh upstream hits), asserts `depositAddresses[0].id` (the served
   `dpa_*` value the local view can never produce), and adds the member reads
   (`/bff/operations/ope_*`, `/bff/markets/USDT%2FRUB`,
   `/bff/checks/chk_*`) — ids only the real upstream serves.

7. **The `depositAddresses` section was never asserted.**
   `walletView` carries the upstream-served deposit-address records; a
   mutation dropping the `depositAddresses` upstream call emptied the
   section silently and stayed green — repro'd (`[]` vs served array).
   **Fix:** exact `depositAddresses` deepEqual in the connects test plus the
   `deposit_addresses_denied` mode — a scoped refusal must degrade only that
   section (emptied in place) while balances and sibling reads stay live.

8. **`capability_denied` covered ~11 of 19 upstream-coupled surfaces.**
   quotes, activity, operations (list+member), screenings (list+member),
   markets member, checks member, notifications/read and the previews were
   unpinned; a mutation mapping quotes-denied → 503 stayed green — repro'd.
   **Fix:** the denied test now walks the missing surfaces and pins each
   one's documented degrade: quotes → emptied list, activity → local feed,
   operations list → `{operations:[]}` / member → `not_found`, screenings →
   local store, markets member → `not_found`, checks member → fixture renders
   / upstream ref `not_found`, notifications/read → local unread, previews →
   the zeroed gated answer (`insufficientBalance: true`, never fixture money).

9. **"Empty but live" was indistinguishable from a degrade.**
   A 200-with-emptied-list upstream was never served, so emptied-vs-fixture
   vs 503 ambiguity was untested. **Fix:** `empty_lists` mode zeroes every
   collection member; the test pins verified 200-with-`[]` on the
   upstream-owned collections (distinct from the gated fixture and from
   503), keeps the member reads live, and pins the two contract exceptions
   where an empty collection is drift: markets (every declared instrument
   must report) → `markets_unavailable`, sessions (exactly one current
   session — the caller's own) → `sessions_unavailable`.

10. **The elapsed bound was ~2.5× the client timeout.**
    `elapsed < 5_000` let a client timeout raised to 4 500 ms stay green —
    repro'd: the slow-headers race passed and status checks went soft.
    **Fix:** every per-call bound tightened to `< 3_500` (2 s timeout +
    poll slack), the two-path operations helper keeps a `< 7_000` total, and
    the stall-loop lower bound still proves the deadline actually elapsed.
    Verified red under the raised timeout.

11. **`upstreamReleased` checked only the last entry.**
    The poll asserted `upstream.at(-1).closed` — earlier stalled sockets a
    mutated client left open stayed invisible. **Fix:** the poll now waits
    for `upstream.every((entry) => entry.closed)`.

12. **The upstream header contract was never asserted.**
    The stub recorded request headers but nothing read them — dropping
    `x-platform` (or any contracted header) stayed green; repro'd.
    **Fix:** the connects test asserts every BFF-driven upstream entry
    carries `authorization: Bearer scdev1.{subject}.{10-digit-epoch}.{hmac}`,
    a v7 `x-request-id`, `x-client-version: solidchange-miniapp-bff/0.1.0`,
    `x-platform: telegram-mini-app`, no `x-device-id`, and GET only. The
    arm's own unauthenticated probes are the only entries skipped.

13. **Backoffice arm covered only the reports routes.**
    The audited member reads — `/bff/api/checks/:id`,
    `/bff/api/support/:id`, `/bff/api/withdrawals/:id`,
    `/bff/api/subjects/:ref/timeline` — each append a `*.viewed` audit event
    before the response is emitted; a mutation swallowing the append failure
    served the view with no record and stayed green — repro'd.
    **Fix:** both store-down and append-fail tests now walk every audited
    route, and pin the degrade's scope: non-appending collection reads
    (lists, and for append-fail the audit views themselves) stay 200 — the
    outage closes audited routes only, never the whole BFF.

14. **A pre-kill failure could leak the customer-api child.**
    In the killed-mid-session test the SIGKILL sat inside `try`; an early
    failing pin left the spawned process listening — observed live: the
    runner hung after the suite finished. **Fix:** `finally` issues an
    idempotent `SIGKILL` before `closeServer`.

15. **State-divergence pins were missing.**
    Nothing pinned the documented volatile memory session store on restart,
    the 1-session-per-device eviction semantics, or degraded-write
    closed-ness. **Fix:** the restart test proves the stale cookie dies
    (`401 unauthenticated` — a persisted session would fail it) and a fresh
    login serves live upstream data; the dedicated revoke-others test proves
    the evictor survives while every sibling session of the shared subject —
    including both shared suite cookies — reports `401 unauthenticated`;
    degraded writes are covered by the local-writes test (#5).

## Verified clean

- **Kill -9 / refusing / never-started** unreachable variants were already
  exercised; the arm uses the hardened `stopService`/`startServiceOnFreePort`
  lifecycle helpers from `tests/stack.mjs` (poll-based readiness, port-0
  binding, no sleeps) — no reimplemented copies found.
- **Leak pins** (`marker`, token `key`, `syn_cust_*`, per-route id prefixes)
  were already comprehensive per route; the new helpers reuse the same set
  plus route-specific ids (`dpa_`, `ntf_`, `chk_`/`SYNCHK`, `ope_`,
  depth values, `depth_levels`).
- **Stall/timeout paths** are genuinely exercised (`slow_headers` at 3 s,
  `stalled_body` never ends the body); elapsed bounds now leave real slack
  for a slow runner while still bounded — verified on the 4 500 ms mutation.
- **Degrade-in-place vs fail-closed split** is contract-exact: denied →
  in-place, everything else → `*_unavailable`, and gated sessions keep their
  own fixture — now asserted per route on both levels.
- **Stub hermetics**: unmatched paths and non-GET methods answer 404 like
  the real router (arm's own probe), never a success body — so harness drift
  fails closed instead of passing.
- The session store being memory (documented volatile) is intended dev
  behavior — pinned as such on restart rather than treated as a defect.

## Observations

- The sessions collection shares the markets contract rule: exactly one
  `current` session (the caller's own) — an empty directory is drift, so
  `empty_lists` yields `sessions_unavailable`, mirroring `markets_unavailable`
  for the all-instruments rule.
- Dev sessions share one subject across kyc levels, so `revoke-others`
  evicts the sibling gated/verified pair too. The pin therefore lives in the
  last test of the describe — inside a shared helper it poisoned the gated
  cookie mid-loop (found while fixing the arm).
- The support desk rate-limits POSTs per subject, so write pins live in the
  dedicated local-writes test — not in the per-mode loop.
- `notifications/read` takes `ids` as a comma-separated string in the JSON
  body (`{ids: "ntf_…,ntf_…"}`), not an array — an array answers 400 before
  reaching the degrade path.
- The malformed-mode bodies can't produce a legitimate member 404 (the stub
  fails the whole request), so member not-found semantics are pinned by the
  `not_found` mode rather than a helper branch.
- Suite runtime grew ~99 s → ~120 s, dominated by the two slow modes
  (`slow_headers`/`stalled_body` × ~25 upstream-coupled helpers ≈ 116 s).
  Still within the file's existing bounds; the malformed battery stays fast.

## Test additions

- New stub modes: `not_found`, `rate_limited`, `validation_failed`,
  `deposit_addresses_denied`, `empty_lists`; a `/markets/` member arm
  serving contract-valid depth for `USDT/RUB` only; stub entries now record
  `closed`, `method`, `url`, `headers`.
- New helpers: `marketsMemberFailsClosed`, `checkDetailFailsClosed`,
  `notificationsReadFailsClosed`, `previewsFailClosed`,
  `localSurfacesStayLocal`.
- New tests: scoped deposit-addresses denial; per-route not-found
  semantics; emptied-collections live view; in-memory session volatility on
  restart + live-data recovery; local writes during a degrade; subject-wide
  session eviction on revoke-others.
- Extended: connects (member reads, `depositAddresses`, upstream header
  contract), capability-denied (full route table), malformed and stall
  batteries (member/POST/preview/local pins per mode), recovery (live
  members + upstream-hit growth), unreachable describe (both session levels,
  full table), backoffice (all audited member routes + scoped degrade).

## Coverage map — route table vs exercised

Every `/bff/*` route now has degrade coverage: wallet (+depositAddresses),
deposits, withdrawals, quotes, exchange-orders, trades, markets (list +
member depth), payments, cards, checks (list + member), address-screening
(list + member + POST), activity, operations (list + member), notifications
(list + read POST), kyc (status + applications POST), sessions (list +
revoke-others), account, profile, support (list + member + POST), session,
health, plus the quote/checks previews. Backoffice: all audited routes plus
the scoped live lists.
