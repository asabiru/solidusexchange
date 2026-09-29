# Regulated Core — Phase 0 Pack

Этот каталог фиксирует исходную точку перехода от legacy SolidChange к регулируемой платформе. Документы не включают live-операции и не являются юридическим заключением или разрешением на production launch.

## Статус

- Baseline commit: `365a653cc9676af5cabdef725f09937f19a0200a`
- Runtime boundary: `dev-dry-run`
- Financial command execution: запрещено
- Production providers, HSM/KMS и customer money movement: не подключены
- Дата инвентаризации: 25 сентября 2026

## Артефакты

| Документ | Назначение |
|---|---|
| [Decision register](decision-register.md) | Владельцы, evidence и безопасное поведение для D-001…D-018 |
| [Legacy inventory](legacy-inventory.md) | Routes, data, providers, jobs, credentials surfaces и migration risks |
| [Migration boundary](migration-boundary.md) | Что переносится, как сверяется и что нельзя переносить напрямую |
| [ADR-0001](adr/0001-isolate-regulated-core-from-legacy.md) | Изоляция нового regulated core от legacy Laravel |
| [ADR-0002](adr/0002-ledger-is-financial-source-of-truth.md) | Append-only double-entry ledger как единственный financial truth |
| [Product/risk matrix](product-risk-matrix.md) | V1 hypotheses, exclusions и approval gates |
| [Data classification](data-classification-register.md) | Классы данных, processors и retention questions |
| [Vendor scorecards](vendor-scorecards.md) | Единые критерии bank/HSM/KYC/KYT/cloud/liquidity/issuer |
| [Phase 0 evidence index](phase-0-evidence-index.md) | Exit gate, approvals и проверяемые доказательства |

## Статусы решений

- `Accepted` — решение утверждено и может стать обязательным constraint.
- `Proposed` — engineering recommendation; требуется approval указанного owner.
- `Open` — выбор не сделан; действует только safe fallback.
- `Blocked` — нельзя продолжать зависящую production-работу.

## Общие stop conditions

1. Ни один `Open`/`Blocked` пункт не разрешает production integration по умолчанию.
2. Legacy balances, transactions и statuses не являются ledger truth.
3. Секреты, private keys, mnemonic, provider payloads и PII нельзя переносить через Git, developer laptops или SQL dump.
4. Money-moving endpoint нельзя добавлять без idempotency, policy decision, immutable audit, ledger effect и reconciliation path.
5. Любой production enablement требует отдельного go/no-go и evidence из [Phase 0 evidence index](phase-0-evidence-index.md).

## Следующий engineering slice

После review этого pack можно начинать canonical API/event contracts:

- versioned `/api/v1`;
- standard error envelope;
- `X-Request-Id`, `X-Client-Version`, `X-Platform`;
- обязательный `Idempotency-Key` для command requests;
- customer/operator namespaces;
- domain event catalog и compatibility policy.

Это не разрешает provider commands или финансовое исполнение.
