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
| [Threat model](threat-model.md) | Trust zones, abuse cases, controls, residual requirements и production stop conditions |
| [Incident response](incident-response.md) | Severity, human authority, evidence preservation, recovery and notification dependencies |
| [Release authorization](release-authorization.md) | Immutable artifacts, evidence bundles, human approvals, enablement and rollback gates |
| [Audit evidence](audit-evidence.md) | Actor, authorization, append-only integrity, access/export, retention and recovery gates |
| [Data lifecycle](data-lifecycle.md) | Retention policy, legal hold, correction, disposal, processors and recovery gates |
| [Access control](access-control.md) | Identity lifecycle, authentication, authorization, privileged access, service identities and review gates |
| [Third-party risk](third-party-risk.md) | Vendor criticality, diligence, approval, monitoring, incident, concentration and exit gates |
| [Operational resilience](operational-resilience.md) | Business-service impact, degraded operation, capacity, continuity, recovery and exercise gates |
| [AI governance](ai-governance.md) | Capability inventory, human control, data/tool boundaries, evaluation, release and withdrawal gates |
| [Customer protection](customer-protection.md) | Disclosures, quotes, status, restrictions, support, complaints, remediation and customer-harm gates |
| [Safeguarding](safeguarding.md) | Customer asset segregation, entitlement, reconciliation, treasury, custody and shortfall gates |
| [Compliance operations](compliance-operations.md) | CDD, sanctions/PEP, KYT, monitoring, cases, reporting assessment and compliance stop conditions |
| [Own HSM custody program](hsm-custody-program.md) | Self-operated HSM custody plan: wallet tiers, in-HSM policy, ceremonies, backup, independent assurance and delivery phases |
| [Phase 0 evidence index](phase-0-evidence-index.md) | Exit gate, approvals и проверяемые доказательства |
| [Finance ledger approval pack](finance-ledger-approval-pack.md) | Chart, posting rules, trial balance и sign-off gate перед Session D |

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

## Текущий engineering gate

Canonical API/event contracts и dev-only ledger foundation уже подготовлены. Следующий dependency gate — письменный Finance/CTO/Security review [Finance ledger approval pack](finance-ledger-approval-pack.md).

До approval разрешены только foundation hardening, deterministic projections, trial-balance evidence и synthetic tests. Holds, reversals, fees и reconciliation начинаются в Session D; provider commands и financial execution остаются запрещены.
