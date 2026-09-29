# Legacy SolidChange Inventory

## Метод и ограничения

Инвентаризация выполнена статически по commit `365a653cc9676af5cabdef725f09937f19a0200a`. Production database, provider dashboards и реальные credentials не просматривались. Количества ниже описывают repository surface, а не подтверждённые production records.

## Технологический baseline

| Контур | Наблюдение | Migration implication |
|---|---|---|
| Application | Laravel 10 / PHP 8.1 | Legacy остаётся отдельным bounded context |
| Primary schema | MariaDB dump `SQL/install.sql` + 75 Laravel migrations | Dump и migrations расходятся; schema source of truth требуется восстановить |
| Operator UI | Legacy Blade admin + отдельный React backoffice | Legacy admin нельзя расширять как regulated command plane |
| New backoffice | React/BFF, signed read-only APIs, deny-by-default RBAC | Использовать как operator shell, не как financial core |
| Audit | Backoffice append-only hash chain, PostgreSQL adapter | Сохранить; связать с будущими commands и ledger journals |

## HTTP surface

В route files найдено 444 `Route::` expressions, включая groups/controllers, и 398 direct HTTP declarations. Runtime `route:list` не выполнен в текущей среде из-за отсутствия PHP CLI, поэтому цифры являются static inventory.

| Route file | `Route::` expressions | Основная поверхность |
|---|---:|---|
| `routes/api.php` | 4 | Authenticated user lookup; deposit, withdrawal and Sumsub webhooks |
| `routes/user-module.php` | 54 | Quotes, exchange/buy/sell requests, processing, status and history |
| `routes/web.php` | 76 | Customer auth/profile/KYC, deposits and content |
| `routes/admin.php` | 226 | Admin identity, users, KYC, payment configuration, support and settings |
| `routes/admin-module.php` | 84 | Currency, exchange, wallet, payout and fiat gateway operations |

### High-risk route findings

- `deposit/webhook/{code}/{type?}` uses `Route::any` and dispatches dynamically by provider code.
- Withdrawal webhook currently returns `ok` without a settlement workflow.
- Legacy admin exposes HTTP-triggered `optimize:clear`, `queue:work` and `schedule:run` routes outside the authenticated admin group.
- Admin routes permit user impersonation, bulk user deletion, credential changes, KYC decisions and exchange/payout state changes.
- `user/balance-update/{id}` is declared but the referenced controller method is absent in the inspected controller.
- Several financial transitions use `Route::any`; canonical commands must require explicit HTTP methods and contracts.

Эти findings не доказывают exploitability. Они определяют migration and isolation priority; production security assessment выполняется отдельно.

## Data inventory

### Identity and PII

- `users`, `admins`, `user_logins`, password reset and personal access token tables.
- Customer names, contacts, address, country, timezone, identity state and social provider identifiers.
- The base `user_kycs` table exists in `SQL/install.sql`, while later Laravel migrations only augment it.
- KYC payloads can contain provider applicant IDs, review results, documents/attributes and copied provider payloads.

### Financial-like records

- `exchange_requests`, `buy_requests`, `sell_requests`.
- `deposits`, `funds`, `payouts`, `payout_logs`, `transactions`.
- `exchange_wallets`, `exchange_payouts`.
- Currency configuration, fees, rates, limits and gateway parameters.

These tables are operational records, not a double-entry ledger:

- `BasicService::makeTransaction()` creates a single transaction row.
- Request statuses encode business progress using numeric values.
- Amounts mix `decimal`, `double` and `float`.
- Corrections/reversals and debit=credit invariants are not centrally enforced.
- Some base migrations create empty tables while `SQL/install.sql` contains the effective historical schema.

### Configuration and credentials surfaces

- `.env.example` declares database, Bybit, Sumsub, Telegram, SMS, mail, storage, OAuth and payment-related secret names.
- Provider parameters can also live in database-backed `basic_controls`, `gateways`, `crypto_methods`, `file_storages` and related configuration.
- `SQL/install.sql` includes seeded credential-like and MFA-like example values. None may be trusted or promoted; sanitize the fixture and rotate any value ever reused outside local demo environments.
- No secret value belongs in migration exports or the regulated platform repository.

## Provider inventory

| Domain | Repository adapters / references | Classification |
|---|---|---|
| Market/liquidity | Bybit client; rate fallbacks | Legacy integration; no regulated settlement proof |
| KYC | Sumsub client/webhook | Useful reference; needs replay/evidence/retention contract |
| Crypto ingress/egress | CryptoCloud, Crypto APIs, CoinPayments, manual, treasury wallet, treasury queue | Adapter candidates only; no custody approval |
| Fiat/payment | 37 gateway `Payment.php` implementations plus configurable gateways | Inventory source; most are out of proposed V1 scope |
| Messaging | Infobip, Twilio, Plivo, Vonage, Telegram, Firebase, mail providers | Notification adapters; consent and data-location review required |
| Storage | Local, S3, DigitalOcean Spaces, FTP/SFTP | Production storage decision open |

Adapter presence does not mean vendor approval, active credentials, supported geography or production readiness.

## Scheduled and asynchronous work

| Job/command | Schedule / trigger | Risk |
|---|---|---|
| Crypto rate update | Configurable dynamic interval | External-rate failure and stale pricing |
| Fiat rate update | Configurable dynamic interval | FX source and rounding policy |
| Exchange wallet watcher sync | Every 15 minutes when enabled | Provider callback registration and duplicate subscriptions |
| Exchange reservation cleanup | Every 5 minutes | Reservation/state race conditions |
| Model pruning | Daily | Retention policy may conflict with audit obligations |
| User deletion job | Synchronous dispatch from admin | PII retention and evidence deletion |
| Exchange automation | Deposit-confirmed path | Can place hedge and payout when flags/providers allow |

## Source-of-truth classification

| Legacy data | Allowed migration use | Prohibited assumption |
|---|---|---|
| Users and identity attributes | Identity mapping after validation | Existing user ID becomes canonical ID |
| KYC records | Evidence import with provenance and retention review | Status alone proves current eligibility |
| Transaction/request records | Historical reconstruction and exception queue | Rows equal balanced ledger postings |
| Wallet addresses | Ownership verification input | Address proves key custody |
| Balances or derived totals | Reconciliation candidate | Direct opening balance |
| Provider IDs/statuses | Correlation and replay analysis | Provider status proves settlement |
| Configuration | Requirements inventory | Legacy setting becomes production policy |
| Secrets/keys/tokens | Name and owner inventory only | Value migration |

## Priority gaps before financial core

1. Reconstruct authoritative schema from a clean install plus every migration.
2. Export sanitized metadata counts and checksums from an approved environment.
3. Define canonical identity mapping and PII retention/deletion policy.
4. Define provider callback verification, idempotency and reconciliation contracts.
5. Replace numeric implicit state transitions with explicit state machines.
6. Remove any dependency on direct balance mutation; balances become ledger projections.
7. Build a signed opening-journal process and discrepancy queue.
8. Quarantine legacy admin financial actions during parallel run.
