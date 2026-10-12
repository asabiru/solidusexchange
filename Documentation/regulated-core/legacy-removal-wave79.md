# Legacy removal — wave 79

- Status: Proposed
- Production effect: none

Wave 79 deletes the legacy Laravel application that still sat at the repository root. The user directed complete removal — the previous SolidChange project is not needed; the new core was built from scratch. Wave 78 audited this surface (`legacy-surface-audit-wave78.md`, `provider-docs-audit-wave78.md`, `docs-drift-audit-wave78.md`); this wave removes it and re-points tooling, baselines and docs at the post-removal tree.

## Removed inventory

1429 tracked paths in one change on top of `f398e0d`:

### Directories — 1410 files

| Path | Tracked files |
|---|---:|
| `app/` | 256 |
| `assets/` | 717 |
| `bootstrap/` | 2 |
| `config/` | 41 |
| `database/` | 78 |
| `deployment/` | 3 |
| `resources/` | 296 |
| `routes/` | 7 |
| `SQL/` | 1 |
| `storage/` | 3 |
| `tests/` | 6 |
| `vendor/` | 0 (never tracked) |

### Root files — 12

`artisan`, `composer.json`, `composer.lock`, `phpunit.xml`, `index.php`, `firebase-messaging-sw.js`, `vite.config.js`, `.htaccess`, `.env.example`, `package-lock.json` (stale `email-marketing` lockfile per wave 78), `.editorconfig`, `.gitattributes`. `php.local.ini` was listed for removal but absent.

### Workflow and documentation — 7

- `.github/workflows/deploy.yml` — the SCP/SSH deployment path audited in wave 78; it deployed only the legacy application.
- `Documentation/safe-deploy.md`, `bybit-exchange-engine.md`, `cryptocloud-setup.md`, `sumsub-local-setup.md`, `exchange-treasury-foundation.md`, `index.html` — each verified to document only the legacy application (wave-78 legacy banners, legacy env vars and services only).

## Tooling updates

- `.gitignore` — Laravel rules dropped (`bootstrap/cache`, `storage/*`, `vendor`, `php.local.ini`, `.phpunit.result.cache`, `public/hot`, `public/storage`, `deploy.log`, `assets/*` entries); generic rules kept (`.env*` with the `.env.example` exception, `node_modules`, `coverage`, `.idea`, `.vscode`).
- `README.md` — stock Laravel readme replaced with a minimal SOLID readme describing `packages/`, `miniapp/`, `backoffice/` and linking `Documentation/regulated-core/README.md`.
- `.github/scripts/check-verification-integrity.mjs` — the wave-78 reference-matching guard (segment/literal/traversal rules plus its exemption list) replaced by an existence tripwire; `validateLegacyRemoval(files)` runs over the same repository walk.
- `.github/scripts/check-verification-integrity.test.mjs` — the boundary test block rewritten to cover the tripwire: every removed dir and file trips it, nested look-alike names inside `packages/`, `miniapp/`, `backoffice/` and `Documentation/regulated-core/` stay legal, and one reappearing entry costs exactly one error.
- `.github/scripts/check-workflow-policy.mjs` — `MANUAL_WORKFLOWS` emptied (deploy.yml was the only member); the mechanism stays, so a future manual-only workflow needs an explicit code change — the gate, not a config edit.
- `.github/scripts/check-workflow-policy.test.mjs` — manual-workflow fixtures inverted: a `workflow_dispatch`-only workflow, including one named `deploy.yml`, is now rejected as a validation workflow.
- `verification-integrity-baseline.json` — `runSteps`/`uses` pins for `deploy.yml` removed; the six deleted root PHP `testFiles` pins removed. Only pins for deleted files moved.
- `regulated-core-status-baseline.json` — repinned `legacy-inventory.md`, rewritten as the short removal record (Status: Proposed).
- `Documentation/regulated-core/README.md` — the `legacy-inventory.md` row now points at the removal record.

## Tripwire design

- **Scope:** existence only. `LEGACY_REMOVED_DIRS` (the 12 removed root directories) fails on the first path whose root segment matches; `LEGACY_REMOVED_PATHS` (the 14 removed root files, the deleted workflow and the six deleted root docs) fails on exact path match.
- **Where:** inside the existing repository walk in `check-verification-integrity.mjs` — no new checker file, no new CI step, one error per reappearing entry.
- **No exemptions:** nothing in the new core may legitimately be named a removed legacy entry, so the rule needs no allowlist; nested files with look-alike names (`miniapp/src/app/`, `backoffice/tests/`) are untouched because only the root segment is compared.
- **Cost:** the reference-matching machinery (regexes over every file's content plus the four-entry exemption list) is gone; the walk now feeds paths to a set lookup.
- **Alternatives weighed:** keeping the content-scan rules would still block spellings like `routes/…` in new code, but the tree they bounded no longer exists — a reappearance is the only regression that matters, and existence catches it with no false-positive surface.

## Observations

- The wave-78 committed-credential findings (`SQL/install.sql` seed hashes, gateway fallback literals, the demo-mode password rewrite) are resolved by deletion — the material no longer exists in the repository. Rotation advice for any value ever reused outside local demo environments still stands.
- `release-authorization.md` describes `deploy.yml` under "Current repository boundary". The workflow no longer exists; the paragraph is now historical context for the release-control design it was contrasted with. The document is pinned release evidence and was left unchanged — this note is the recorded exception.
- Wave-78 audit docs that name deleted paths (`legacy-surface-audit-wave78.md`, `provider-docs-audit-wave78.md`, `docs-drift-audit-wave78.md`) are historical audit records and were not edited; their file:line citations point to deleted blobs by design.
- `customer-api-leftovers-audit-wave78.md` and other wave-audit reports keep working as history for the same reason.
- The tripwire cannot prevent a legacy *renamed* file (different path, same content) — it guards identity by path, not by content. Proportionate for a dev-only repo; recorded for completeness.
