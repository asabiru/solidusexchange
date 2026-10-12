# Brand consistency sweep — wave 79

- Status: Proposed
- Production effect: none

Wave 79 sweeps every user-visible surface in the kept tree for brand consistency: the product brand is **SOLID**, `solidchange` is a technical identifier family that must not leak into human-readable prose, and `coinectra` — the upstream vendor the legacy Laravel application derives from — must not appear at all. Scope: `miniapp/` (all locales plus literals), `backoffice/` (all locales plus literals), `packages/` served and dynamic strings, and `Documentation/regulated-core/` prose. The legacy surface (`app/`, `routes/`, `config/`, `database/`, `resources/`, `SQL/`, `deployment/`, `assets/`, `bootstrap/`, `storage/`, root `tests/`, root files, root `Documentation/*.md`) was excluded here — the sibling wave-79 change (`legacy-removal-wave79.md`) deleted it wholesale, and this branch merges on top of that deletion.

Method: repository-wide case-insensitive search for `coinectra`, `solidchange` and `SolidChange`, each hit classified as user-visible prose (defect) or technical identifier (correct). Locale catalogs are additionally pinned by the i18n suites, which assert no catalog value matches `/SolidChange/` in either app.

## coinectra removal

- **Kept tree is clean.** Zero `coinectra` occurrences existed in `miniapp/`, `backoffice/`, `packages/`, `infra/` or `.github/` — no file in the swept scope needed a change for this rule.
- **Every remaining occurrence sat inside the sibling's deletion scope** — `SQL/install.sql` (seed site title, CMS content, SEO meta, a serialized queued-mail payload, the `-- Database:` comment), `database/migrations/2026_03_13_060000_add_russian_frontend_content.php` (Russian frontend copy), `resources/views/themes/light/partials/loader.blade.php` (preloader fallback title), `.env.example` (`APP_NAME`, `DB_DATABASE`), `deployment/deploy.sh` and `deployment/rollback.sh` (`/var/www/coinectra` default), `Documentation/safe-deploy.md` (the same path in prose), and `Documentation/index.html` (the vendor meta-refresh flagged in wave 78). None was touched here; the sibling deletion removed them all.
- **`grep -ri coinectra` now returns only audit-doc mentions.** Pinned by a new rule in `check-verification-integrity.mjs`: `validateVendorBrand` flags the literal in every file except `Documentation/regulated-core/provider-docs-audit-wave78.md`, this document, and binary extensions. The scope widened to the whole surviving tree once the removal landed; a reappearing legacy entry is flagged by `validateLegacyRemoval` for the path and by this rule for the name.

## Surfaces checked

- **miniapp — all locales (en, ru, ky) plus component literals.** Every brand string already says SOLID (`home.customerId`, `activity.login`, `support.safety`, `sessions.note`, `markets/trades/orders/quotes.entryDetail`, `notifications.template.*`, `checks.note`, `qr.intro`); the `index.html` page title is `SOLID`. The i18n suite asserts no catalog value matches `/SolidChange/` and the `sessions.note` copy never matches `/SolidChange|Solidus/`.
- **backoffice — all locales (en, ru, ky) plus literals.** `app.documentTitle` reads `SOLID backoffice` / `SOLID · бэк-офис`; the `index.html` page title is `SOLID backoffice`; the i18n suite pins the same `/SolidChange/` absence on every catalog value.
- **Served and dynamic strings.** `customer-api` notification templates (`NOTIFICATION_TEXTS`) say SOLID or stay brand-neutral (`Тестовый режим. …`); support ticket topics and messages are brand-neutral; BFF payloads carry no product-name field. Simulator-emitted text carries schema ids, not brand copy.
- **Documentation/regulated-core prose.** 26 `SolidChange`/`solidchange` occurrences checked; 13 were brand statements in prose (defects, corrected below), 13 name real identifiers (verified unchanged below).

## Corrections (per file)

1. `Documentation/regulated-core/README.md` — "legacy SolidChange" → "legacy SOLID".
2. `Documentation/regulated-core/access-control.md` — "regulated SolidChange platform" → "regulated SOLID platform" (pinned status-section line; baseline repinned).
3. `Documentation/regulated-core/migration-boundary.md` — "Legacy SolidChange is an inventory" → "Legacy SOLID is an inventory" (a pinned status-snapshot line — baseline repinned).
4. `Documentation/regulated-core/legacy-inventory.md` — title `# Legacy SolidChange Inventory` → `# Legacy SOLID Inventory`; superseded on merge by the sibling's rewrite to `# Legacy Removal Record`, which stands (baseline carries the removal-record snapshot).
5. `Documentation/regulated-core/third-party-risk.md` — "how SolidChange must assess" → "how SOLID must assess" (a pinned status-snapshot line — baseline repinned); "SolidChange must preserve" → "SOLID must preserve".
6. `Documentation/regulated-core/threat-model.md` — "while SolidChange is separated" → "while SOLID is separated".
7. `Documentation/regulated-core/safeguarding.md` — "before SolidChange can hold" → "before SOLID can hold"; "that SolidChange can meet" → "that SOLID can meet".
8. `Documentation/regulated-core/operational-resilience.md` — "how SolidChange must identify" → "how SOLID must identify".
9. `Documentation/regulated-core/incident-response.md` — "how SolidChange must coordinate" → "how SOLID must coordinate".
10. `Documentation/regulated-core/compliance-operations.md` — "before SolidChange can" → "before SOLID can"; "owned by SolidChange" → "owned by SOLID".
11. `.github/scripts/regulated-core-status-baseline.json` — repinned the four pinned documents above so the extracted status snapshot matches the corrected prose.
12. `.github/scripts/check-verification-integrity.mjs` — added `vendorBrandScoped`/`validateVendorBrand` (the coinectra rule above), wired into the repo walk.
13. `.github/scripts/check-verification-integrity.test.mjs` — new case covering flag/exempt/reappearing-legacy/binary paths for the vendor rule.
14. `.github/scripts/verification-integrity-baseline.json` — repinned the test file's `minLines`/`minCases` (713/34) for the added case on the post-removal test surface.

## Verified-unchanged technical identifiers

- **Signature domains and token namespaces** — `solidchange-customer-api-synthetic-*`, `solidchange-miniapp-*`, `solidchange-backoffice-*`, `solidchange-operator-device:v1:*`, `solidchange-sim-*`, `solidchange-sim-seed-v1`. Pinned by envelope verification and digest tests; renaming is a protocol change, not a brand fix.
- **Schema and scheme ids** — `solidchange.sim.quote.v2`, `solidchange.sim.{kyc,kyt,bank,checks}.callback.v1`, `solidchange-sim-callback-v1`. Contract-pinned.
- **Cookie, storage and metric names** — `solidchange_ma_session`, `solidchange_bo_session`, `solidchange_bo_device`, `solidchange_*_oidc_*`, `solidchange.*.locale`, `solidchange.miniapp.notifications.seen`, `solidchange_http_requests_*`, `solidchange_{miniapp,backoffice}_*`.
- **Package names, env vars, paths** — `@solidchange/*`, `SOLIDCHANGE_DEV_*`, `/run/solidchange-dev`, `/opt/solidchange-local`, `solidchange-local` compose project, `solidchange_audit` database, `x-solidchange-*` contract boundary flags, `solidchange_e2e_dev` postgres credentials, `x-client-version: solidchange-*-bff/0.1.0`.
- **Synthetic account addresses** — `*@dev.solidchange.invalid` operator/customer emails on the dev auth path. The `.invalid` TLD marks them as dev material; they surface in the dev UI as account identifiers, not as brand copy.
- **Download artifact names** — `solidchange-draft-{id}-{digest}.csv` (reports) and `solidchange-audit-{hash}.json` (chain export). Treated as identifier filenames, pinned by `reports.test.ts`; recorded below for a possible follow-up.
- **Regulated-core doc references to those identifiers** — the remaining `solidchange` hits in `api-contracts-audit-wave49.md`, `backoffice-authz-audit-wave42.md`, `miniapp-app-audit-wave40.md`, `miniapp-server-audit-wave68.md`, `oidc-arm-audit-wave71.md`, `oidc-backoffice-audit-wave66.md`, `oidc-flow-audit-wave65.md`, `resilience-arm-audit-wave72.md`, `session-stores-audit-wave62.md`, `sim-infra-audit-wave73.md` name the real headers, cookies, keys and domains above — left verbatim.
- **`provider-docs-audit-wave78.md`** keeps its `coinectra` mention: it documents the finding itself and is one of the two exempt files the new rule allows.

## Observations

- Locale-value coverage already exists in both apps (`/SolidChange/` banned on every catalog string), so no new i18n pin was needed; the vendor rule adds the missing repo-wide literal gate for the kept tree.
- `SQL/install.sql` also embedded third-party brand names unrelated to this sweep (`KuCoin`, `Changelly`, `bugfinder.net` links) inside seed content — removed with the file by the sibling wave, recorded for the record.
- The two download filenames are the closest thing in the kept tree to vendor-adjacent user-facing text: an operator sees `solidchange-draft-*.csv` in their downloads folder. Left unchanged as identifier-style names pending a deliberate `solid-*` rename.
- The exempt set for the vendor rule is exactly two audit documents. If a future wave rewrites `provider-docs-audit-wave78.md`, the exemption — not the rule — is what to revisit.
