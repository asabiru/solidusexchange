# Provider Docs Audit — Wave 78 — Proposed

- Status: Proposed
- Scope: the six root-level documents under `Documentation/` outside `regulated-core/` — `bybit-exchange-engine.md`, `cryptocloud-setup.md`, `exchange-treasury-foundation.md`, `safe-deploy.md`, `sumsub-local-setup.md`, `index.html`. These name real providers (Bybit, CryptoCloud, Sumsub, Crypto APIs) and a real deployment path — the highest-risk prose in a dev-only/synthetic repository. The wave-78 drift audit covered `regulated-core/` only and the wave-78 legacy-surface audit covered the code, not the prose; this audit covers the prose.
- Production effect: none

Method: extracted every checkable claim — env names, routes, admin paths, service and model names, table/column names, artisan commands, workflow facts, file paths and URLs — and verified each against the current tree (`config/`, `routes/`, `app/`, `database/migrations/`, `resources/`, `deployment/`, `.github/workflows/`, `.env.example`). Classification: `verified` / `stale` (was true, code moved) / `wrong` (never matched) / `risk` (accurate to code, conflicts with the dev-only posture). Stale/wrong prose was fixed in place, keeping each document's own style and language (four are Russian, one English). Credential-shaped literals are reported file:line only; no values are reproduced.

## Claims checked

### bybit-exchange-engine.md

- **Verified.** Every env name exists in `config/exchange_engine.php` and `.env.example:157-181`. The failure path is real: `ExchangeAutomationService.php:37` only processes exchanges at `status = 2`, and `:160`/`:294` persist failures to `exchange_requests.hedge_error` (column added by `database/migrations/2026_03_13_010000`). The `floating` re-quote before hedge is real (`ExchangeAutomationService.php:69-70` → `refreshFloatingExchange`); payout via the active automatic `CryptoMethod` matches `ExchangePayoutService::resolvePayoutMethod`.
- **Stale — fixed.** The setup block omitted `EXCHANGE_ENGINE_FALLBACK_TO_INTERNAL_ON_QUOTE_ERROR` (present in `config/exchange_engine.php:12` and `.env.example:160`); added in the doc's own order.
- **Risk.** The doc instructs `BYBIT_TESTNET=false` plus live `BYBIT_API_KEY`/`BYBIT_API_SECRET` — real mainnet order placement — with no dev gate. D-007 (external liquidity) is `Open`; its interim state is "Quote simulator; no hedge/order placement". A legacy-status note was added at the top of the doc.

### cryptocloud-setup.md

- **Verified.** All five method parameters exist (`Service.php:144-165`: `api_key`, `shop_id`, `secret_key`, `payout_api_key`, `currency_map`). The webhook path is real: `routes/api.php:23` `deposit/webhook/{code}/{type?}` covers `crypto_cloud`. "POSTBACK is verified with SECRET KEY" is accurate: `app/Library/CryptoCloud.php:58-65` JWT-decodes the postback with the secret (HS256). The TON exclusion is exact: `STATIC_WALLET_UNSUPPORTED_CODES = ['TON','USDT_TON']` (`Service.php:57-60`) rejects static wallets on TON.
- **Risk.** The doc walks through creating a real CryptoCloud project and pasting live keys into the admin panel — no dev gate. Legacy-status note added.

### exchange-treasury-foundation.md

- **Verified.** `ExchangeSettlementService`, `ExchangeAmlService` exist; `WebhookController.php:67,71` resolves exchanges by `deposit_provider_ref`; all ten `exchange_requests` fields exist (`database/migrations/2026_03_17_120000`, model `$fillable`); all seven env names exist (`config/exchange_pipeline.php`, `.env.example:168-174`); `treasury_wallet`/`crypto_apis`/`treasury_queue` providers exist under `app/Services/CryptoMethod/`; admin sections `Exchange Wallets` and `Exchange Payouts` exist (`routes/admin-module.php:77-89`, sidebar entries); `app:exchange-wallet-watcher-sync` is scheduled (`app/Console/Kernel.php:43`, every fifteen minutes); the treasury_queue flow matches `ExchangePayoutService.php:41-46` + `exchangePayoutMarkSent`/`markFailed` routes.
- **Risk.** The doc instructs "боевые credentials и правильный `mainnet/testnet`" for `crypto_apis` and describes real on-chain treasury flows — open decisions (D-002 custody/signing, D-003 HSM/MPC, D-007 liquidity) are still `Open`. Legacy-status note added.
- Note: the doc predates the internal-matching routing layer (`config/exchange_pipeline.php:16-18` `EXCHANGE_INTERNAL_MATCHING_*`, April 2026); it does not claim to cover it — recorded under Observations.

### safe-deploy.md

- **Verified.** `deployment/deploy.sh` and `deployment/rollback.sh` exist and do what the doc describes (maintenance mode → clone to `releases/YYYYMMDDHHMMSS` → `shared/.env`/`shared/storage` symlinks → `composer install --no-dev` → `optimize:clear` → `migrate --force` → caches → atomic `current` flip → `up` + `queue:restart` → `KEEP_RELEASES` pruning; rollback flips `previous`). All ten `DEPLOY_*` secrets listed are consumed by `.github/workflows/deploy.yml`. The "no `public` dir" claim is true — `index.php` sits at the repository root.
- **Stale — fixed.** (a) All three file links were absolute Windows paths (`/c:/Users/stasb/Desktop/проект/...`) — broken for every reader; now repo-relative. (b) The doc referenced `.github/workflows/deploy.yml.example` and instructed "rename it when the project reaches git" — the project is in git and `deploy.yml` already exists, `workflow_dispatch`-only. (c) `deployment/sweb-deploy.sh` (shared-hosting variant, `APP_DIR` git-pull flow) existed but was unlisted — now listed. (d) The deploy-step list omitted the bootstrap artisan commands the script actually runs (`app:switch-project-to-rub`, `app:popular-crypto-bootstrap --activate`, `app:crypto-currency-update-cron`, `storage:link`) — added.
- **Posture — corrected.** "Автодеплой на `push` включать после ручной проверки" was reworded to "do not enable push deploys" — under the dev-only posture `deploy.yml` stays `workflow_dispatch`-only by design (it is the single intentional bridge to the legacy host per the legacy-surface audit).
- Legacy-status note added at the top.

### sumsub-local-setup.md

- **Verified.** Every admin field named exists in `resources/views/admin/control_panel/kyc_provider_setting.blade.php` (`sumsub_enabled`, `sumsub_app_token`, `sumsub_secret_key`, `sumsub_base_url`, `sumsub_level_name`, `sumsub_websdk_url`); both recommended URLs match the blade defaults; `/api/kyc/sumsub/webhook` is `routes/api.php:25` (`SumsubWebhookController`); the SDK-token issuance is `routes/web.php:135` `kyc/sumsub/token/{id}`; `user_kycs` and `users.identity_verify` are real (`SumsubKycService` updates both via `UserKycManager`).
- **Risk.** The doc walks through storing a live Sumsub `App Token`/`Secret Key` and pointing a real Sumsub project webhook at the deployment — no dev gate. Legacy-status note added.

### index.html

- **Wrong/stale — flagged, not fixed.** The file is a single meta-refresh tag (`http-equiv="refresh"`) to `https://docs.bugfinder.net/coinectra` — the upstream vendor documentation site for the commercial exchange script the legacy Laravel app derives from. It is not documentation of this repository, nothing in the tree references it, and any static serving of `Documentation/` silently forwards readers to third-party commercial docs. It also confirms the upstream product identity (the `coinectra` name already appears in `deployment/deploy.sh`'s `APP_ROOT` default). No credential material. Left unchanged: removal is the user's migration call, matching the wave-78 precedent of not rewriting legacy files. Recommend deleting it or replacing it with a link to `Documentation/regulated-core/README.md`.

## Credential findings (redacted)

Values are not reproduced; each entry is file:line plus the literal's shape.

- **No real-looking credentials in the audited files.** Every credential-shaped literal is a placeholder: `bybit-exchange-engine.md:28-29` (`your_bybit_api_key`/`your_bybit_api_secret`), `cryptocloud-setup.md:20` (`your-domain.example`), `sumsub-local-setup.md:59` (`ваш-домен`), `safe-deploy.md:73` (`YOUR_ACCOUNT/YOUR_REPO`). Provider URLs named (`api-testnet.bybit.com`, `api.sumsub.com`, `static.sumsub.com`, `docs.bugfinder.net`) are public endpoints, not credentials.
- The legacy tree's real committed-material findings were already recorded by `legacy-surface-audit-wave78.md` (SQL seed rows, gateway fallbacks, demo-login rewrite) — none live in `Documentation/`.

## Posture assessment

- The five Markdown documents were last touched in mid-March 2026 — before the dev-only/synthetic boundary existed — and none carried a boundary note. They instruct configuring live provider credentials and production endpoints (Bybit mainnet, a real Sumsub project, CryptoCloud keys, `crypto_apis` боевые credentials, a production VPS with a real `shared/.env`). Under the repo's posture these describe dormant legacy capability, not the intended direction.
- None of the docs instructs committing secrets; `safe-deploy.md` explicitly forbids `.env`/keys in the repository and demands rotation of previously committed material — good guidance, kept verbatim.
- Direct tension with the decision register: D-007 `Open` ("no hedge/order placement" interim) vs. the Bybit doc's live order placement; D-002/D-003 `Open` (custody responsibility, HSM/MPC) vs. the treasury doc's real on-chain watch/payout flows; the Sumsub doc's live PII-handling provider vs. the synthetic-KYC posture. Mitigation landed: each doc now opens with a legacy-status note naming the boundary and the open decisions.
- `deploy.yml` remains `workflow_dispatch`-only — consistent with the boundary guard's "single intentional bridge" finding; the doc now says the same.

## Corrections applied

1. `bybit-exchange-engine.md` — added the legacy-status note; added missing `EXCHANGE_ENGINE_FALLBACK_TO_INTERNAL_ON_QUOTE_ERROR` to the env block.
2. `cryptocloud-setup.md` — added the legacy-status note (English, matching the doc).
3. `exchange-treasury-foundation.md` — added the legacy-status note.
4. `sumsub-local-setup.md` — added the legacy-status note.
5. `safe-deploy.md` — added the legacy-status note; replaced three broken absolute Windows links with repo-relative links; corrected `deploy.yml.example` → existing `deploy.yml`; listed `sweb-deploy.sh`; added the omitted bootstrap artisan commands and cache names to the deploy-step list; reworded the push-deploy advice to match the `workflow_dispatch`-only posture; fixed the secrets list formatting.
6. `index.html` — unchanged; flagged above for the user's removal decision.

## Observations

- `.env.example` does not list the newer `EXCHANGE_INTERNAL_MATCHING_*` routing variables (`config/exchange_pipeline.php:16-18`); the internal-matching feature postdates both the docs and the env example block. Cosmetic — defaults are in code — recorded for a future cleanup wave.
- The docs are accurate to the legacy code they describe; the drift was almost entirely posture (pre-boundary prose reading as a live setup path), not code drift. With the status notes added, the worst case is now a reader who ignores a bold notice at the top of the file.
- `index.html` is the only outright-wrong artifact: an upstream vendor redirect masquerading as repository documentation. Recommend removal.
- Root `README.md` is the stock Laravel readme — also pre-boundary prose, but outside this audit's hunt list; a future wave can sweep it together with `index.html`.
