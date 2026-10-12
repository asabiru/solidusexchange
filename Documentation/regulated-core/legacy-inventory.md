# Legacy Removal Record

- Status: Proposed
- Production effect: none

The legacy SolidChange Laravel application inventoried at `365a653cc9676af5cabdef725f09937f19a0200a` was removed from the repository in the wave-79 change. The user directed the removal; nothing from the legacy tree was carried into the new core.

## What was removed

- Application directories: `app/`, `bootstrap/`, `config/`, `database/`, `resources/`, `routes/`, `SQL/`, `storage/`, `tests/`, `assets/`, `deployment/` (`vendor/` was never tracked).
- Root files: `artisan`, `composer.json`, `composer.lock`, `phpunit.xml`, `index.php`, `firebase-messaging-sw.js`, `vite.config.js`, `.htaccess`, `.env.example`, `package-lock.json`, `.editorconfig`, `.gitattributes` (`php.local.ini` was absent).
- The legacy deployment workflow `.github/workflows/deploy.yml`.
- Root-level legacy documentation: `Documentation/safe-deploy.md`, `bybit-exchange-engine.md`, `cryptocloud-setup.md`, `sumsub-local-setup.md`, `exchange-treasury-foundation.md`, `index.html`.

## Where the record of it lives

Historical audits remain the description of what the application was:

- `legacy-surface-audit-wave78.md` — boundary verification, committed-credential findings (its file:line references now point to deleted blobs), route and data inventory recounts.
- `provider-docs-audit-wave78.md` — provider and setup documentation audit.
- `docs-drift-audit-wave78.md` — documentation drift audit.
- `customer-api-leftovers-audit-wave78.md` — the last leftover sweep before removal.
- `github-checkers-audit-wave75.md` — repository checker history, including the deploy.yml manual-dispatch rationale.

## Standing rules after removal

- The `365a653` inventory pin is now a historical record, not a live baseline; no wave needs to re-verify its numbers against the tree.
- `.github/scripts/check-verification-integrity.mjs` fails CI if any removed legacy entry reappears; the tripwire is an existence check, not a content scan.
- Wave-78 credential findings are resolved by deletion — the material no longer exists in the repository; rotation advice for any value ever reused outside local demos still stands.
