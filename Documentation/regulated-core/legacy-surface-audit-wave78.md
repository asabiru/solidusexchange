# Legacy surface audit — wave 78

- Status: Proposed
- Production effect: none

Wave 78 audits the last region no wave has touched: the legacy Laravel application that still sits at the repository root — `app/`, `routes/`, `config/`, `database/`, `resources/`, the root PHP `tests/`, `SQL/`, `deployment/`, `assets/`, `bootstrap/`, `storage/`, plus the root files `index.php`, `firebase-messaging-sw.js`, `artisan`, `composer.json`, `composer.lock`, `phpunit.xml`, `vite.config.js`, `.htaccess`, `.env.example`, `package-lock.json`. `Documentation/regulated-core/legacy-inventory.md` inventoried this surface at `365a653`; this audit re-verifies the boundary, sweeps the tree for committed credentials, recounts the pinned numbers, and lands the boundary guard that the wave-76 checker observation left open. Legacy files are not rewritten — migration choices stay with the user — so every finding below is a report item, gathered at `4325fdd`.

## Boundary verified

- **No new-core file references the legacy tree.** A path-shape sweep across `packages/`, `miniapp/`, `backoffice/`, `.github/` found zero references to root-level legacy directories (`app/`, `routes/`, `config/`, `database/`, `resources/`, `SQL/`, `deployment/`, `assets/`, `bootstrap/`, `storage/`, `vendor/`, the root `tests/`) and zero references to legacy artifact names (`artisan`, `composer.json`, `composer.lock`, `phpunit.xml`, `index.php`, `firebase-messaging-sw.js`, `install.sql`, `vendor/autoload`, `.htaccess`). The single exception is intentional: `.github/workflows/deploy.yml` copies `deployment/*` to the host over SCP and runs `deploy.sh` — and it is `workflow_dispatch`-only, so it can never run on push or pull_request and CI never touches it.
- **Nothing serves or executes the PHP entry points.** `packages/e2e-dev/tests/stack.mjs` launches exactly three processes — `packages/customer-api/src/server.mjs`, `miniapp/.server-dist/server/index.js`, `backoffice/.server-dist/server/index.js` — joined from `repoRoot`. No dev-stack or e2e path loads `index.php`, `firebase-messaging-sw.js`, or any PHP file, and no CI workflow invokes `php`, `composer`, `artisan`, or `phpunit`; the root `composer.json`, `composer.lock` and `phpunit.xml` are inert under Node-only tooling.
- **The two `vite.config.js` files are independent.** The root config is the Laravel Vite plugin pointed at `resources/sass/app.scss` and `resources/js/app.js` — dead without a `resources` build step, which nothing runs. The miniapp and backoffice builds use their own configs inside their directories.
- **The root `package-lock.json` is a stale leftover** — a standalone `email-marketing` lockfile against vite ^4 with no matching root `package.json` — inert; see Observations.
- **Root PHP test files are unreachable but still pinned.** `phpunit.xml` names `tests/Unit` and `tests/Feature`; nothing executes them, and the integrity checker already holds the six PHP test files inside `baseline.testFiles`, so an edited PHP test fails CI even though the suite never runs.

## Secrets findings (redacted)

Values are not reproduced; each entry is file:line plus the credential's shape.

1. `SQL/install.sql:57` — the `admins` seed row embeds a bcrypt password hash (`$2a$` prefix) and a base32 TOTP seed for Google Authenticator.
2. `SQL/install.sql:143`, `:146`, `:166-167` — `basic_controls` seed rows declare `currency_layer_access_key` and `coin_market_cap_app_key`, with the corresponding 32-hex and UUID-shaped literal values at :167.
3. `SQL/install.sql:847` — a `manual_sms_configs` seed embeds `api_key`/`api_secret` literals inside `form_data` JSON (Nexmo-shaped).
4. `app/Services/Gateway/konnect/Payment.php:44` and `:76` — when the gateway row lacks `parameters->api_key`, the driver falls back to the same hardcoded `id:secret` literal in both call sites.
5. `app/Services/Gateway/cashonexHosted/Payment.php:16-17` — `idempotency_key` and `salt` fall back to hardcoded literals; the salt is a 64-hex string.
6. `app/Http/Controllers/Admin/Auth/LoginController.php:159-162` — under `config('demo.IS_DEMO')` the post-login path rewrites the first user row to `demouser` / `bcrypt('demouser')` and clears its two-factor fields. `config/demo.php` reads `env('IS_DEMO', false)`, so the path is dormant by default — but the fallback itself is a credential-shaped defect in a dev-only tree.
- Checked and clean: `.env.example` (variable names only), `firebase-messaging-sw.js` (placeholder strings), `deployment/*.sh` (hosts and material arrive from CI-level inputs, nothing embedded), `phpunit.xml`, `assets/admin/js/google.com_recaptcha_api.js` (a stock Google bundle — the embedded origin-trial token is a public browser token, not a credential), and every `env()` default under `config/` (all benign — empty strings, `false`, loopback URLs).

## Inventory corrections

- `git diff 365a653..HEAD` across every inventoried legacy path is empty — the tree is byte-identical since the pinned commit, so none of the inventory's numbers could have gone stale.
- Recounted anyway for the record: 444 `Route::` expressions (api.php 4, user-module.php 54, web.php 76, admin.php 226, admin-module.php 84); 398 HTTP-verb declarations (any 22, delete 13, get 208, match 14, post 124, put 17); 75 migration files under `database/migrations/`; 37 `Payment.php` gateway drivers under `app/Services/Gateway/`. All match the doc — no corrections applied.
- Spot-checks of the doc's structural claims hold: `routes/admin.php` artisan HTTP routes (`clear`, `queue-work`, `schedule-run`) are declared before — outside — the authenticated `admin` group; `routes/api.php:23-24` `any` webhook routes answer every method and `withdrawWebhookResponse` returns `response()->json('ok', 200)` unconditionally; `routes/admin.php:318` posts `user/balance-update/{id}` to a `userBalanceUpdate` method that `UsersController` does not define; `app/Console/Kernel.php` builds its cron strings dynamically from `coin_market_cap_auto_update_at` / `currency_layer_auto_update_at` and schedules the wallet-watcher sync, reservation cleanup and `model:prune` exactly as the doc's table records.

## Guard decision

A boundary rule now runs inside the existing repository walk in `.github/scripts/check-verification-integrity.mjs` — the checker already walks every tracked file; the wave-76 observation was that nothing watched references *across* the boundary. No new checker file and no new CI step were added.

- **Scope:** every file under `packages/`, `miniapp/`, `backoffice/`, `.github/` — the directories that make up the new core and its automation. Binary assets are skipped and four paths are exempted explicitly: `deploy.yml` (the deployment path itself), the checker and its test file (they quote the banned spellings), and `regulated-core-status-baseline.json` (pins `storage/retention`, unrelated to legacy `storage/`).
- **Three rules.** A `../` traversal that resolves to a legacy root entry fails. A bare repo-root legacy segment — `routes/`, `config/`, `database/`, `resources/`, `SQL/`, `deployment/`, `assets/`, `bootstrap/`, `storage/`, `vendor/`, plus `app/` outside `miniapp/` (the miniapp spells its own sources `app/…`) — fails when it starts a path. Naming a legacy artifact — `artisan`, `composer.json`/`composer.lock`, `phpunit`, `index.php`, `firebase-messaging-sw.js`, `install.sql`, `vendor/autoload`, `.htaccess`, `deploy.sh`, `laravel-*`/`LARAVEL_*` identifiers — fails.
- **Result:** zero violations on the live tree — the boundary verified above is now enforced on every future change.
- **Coverage:** a new test block in `check-verification-integrity.test.mjs` exercises traversal resolution (including `app/` and `tests/` escapes), segment anchoring (`/routes/` versus `src/routes/`), artifact literals, the miniapp `app/` allowance, and the scoping/exemption set.
- **Baseline:** only the `testFiles` pin for the edited test file moved (498/27 to 724/33); no other pinned surface changed.
- Alternatives weighed: an import-graph rule would catch more oblique reach (a base64-encoded path, say) but needs dependency parsing — disproportionate against a boundary that holds trivially today; an inventory-count pin would protect the doc but not the boundary. The path-shape rule is the lightest option that actually prevents leakage.

## Observations

- All six secrets findings live in files the new core never executes — PHP is never invoked by CI, dev-stack or e2e — so the risk is committed-material hygiene, not live exposure. They still fail the "nothing real-looking committed" bar for a dev-only tree; redaction or removal is the user's migration call, so the files are unchanged.
- `deploy.yml` stays the single intentional bridge to the legacy host. The guard exempts it explicitly; when the deploy path is retired, the exemption entry should be dropped with it.
- The stale root `package-lock.json` is inert but misleading (it names a different package); a future cleanup wave can remove it with no ripple.
- The guard enforces path *spellings*, not provenance — an obfuscated reference could evade it. Proportionate for a dev-only repo; recorded for completeness.
- The inventory's `365a653` pin remains exact; any wave that touches legacy files should re-pin it.
- The root `.htaccess` already denies web access to `.env`, `artisan`, `composer.*`, `phpunit.xml`, `vite.config.js` and the log path — the legacy tree's own edge rules cover its credential files under a stock Apache vhost.
