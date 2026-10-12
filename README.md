# SOLID

Synthetic, dev-only regulated financial core, custody orchestration and operator backoffice. Nothing here performs production execution, live provider calls or real customer money movement.

## Layout

- `packages/` — TypeScript packages: `api-contracts` (OpenAPI spec + validators), `customer-api`, `financial-core` (double-entry ledger foundation), `custody-core`, `matching-core`, `provider-simulators`, `e2e-dev` (integration test stack).
- `miniapp/` — Telegram Mini App and its BFF.
- `backoffice/` — Operator console and its BFF.
- `infra/` — Local development infrastructure.
- `.github/` — CI workflows and repository governance checkers.

## Documentation

Regulated-core architecture, decisions and compliance packs live in [Documentation/regulated-core/README.md](Documentation/regulated-core/README.md).
