# Finance Ledger Approval Pack

Этот пакет фиксирует evidence для review ledger foundation перед Session D. Он не является бухгалтерским заключением, production approval или разрешением на загрузку customer balances.

## Текущий статус

- Review state: `PENDING`.
- Chart version: `1`, status `draft`.
- Posting-rule registry version: `1`, status `draft`.
- Runtime boundary: `dev-dry-run`.
- Production financial execution: disabled.
- D-009 Financial Core DB: `Proposed`.
- Production assets, customer data, providers, custody и runtime writer: отсутствуют.

До письменного approval Finance, CTO и Security Session D не включает holds, reversals, fees, reconciliation или opening balances.

## Что требуется утвердить

| Область | Проверяемое решение | Evidence |
|---|---|---|
| Chart of accounts | Классы, normal side, owner scope и обязательные категории подходят как foundation | `packages/financial-core/chart-of-accounts.json` |
| Posting-rule boundary | Command обязан ссылаться на зарегистрированную пару `journal_type` + `posting_rule_version`; текущий registry содержит только synthetic test rule | `packages/financial-core/posting-rules.json` |
| Double entry | Каждый journal имеет 2–1000 entries и балансируется независимо по asset | JS tests и PostgreSQL rejection fixtures |
| Legal entity | Journal и все accounts/entries находятся внутри одной legal entity | Runtime validation и composite foreign keys |
| Precision | Суммы используют canonical decimal strings / PostgreSQL `NUMERIC`, scale 0–18 и limit 78 digits | Amount tests, schema constraints и triggers |
| Idempotency | Повтор идентичной команды возвращает исходный journal; изменённый payload отклоняется | In-memory tests и unique database registry |
| Evidence | Actor, authorization, policy, source digest, correlation и immutable outbox связаны с journal | Posting command, migration и smoke test |
| Read models | Account projections и trial balance полностью пересобираются из immutable entries | Deterministic snapshot tests и read-only SQL views |
| Database direction | PostgreSQL остаётся только proposed default | D-009, ADR-0002 и migrations |

## Ограничение posting rules

Текущий registry намеренно содержит только `SYNTHETIC_PROVIDER_POSITION`:

```text
per asset:
  DEBIT  TREASURY_ASSET
  CREDIT PROVIDER_PAYABLE_LIABILITY
actor:
  SERVICE
scope:
  synthetic-test-only
```

Это правило проверяет механизм version binding и entry pattern. Оно не определяет production accounting для deposits, withdrawals, exchange, fees, reversals, holds, reconciliation или migration opening positions.

## Проверяемые evidence commands

```bash
cd packages/financial-core
npm ci
npm audit --audit-level=moderate
npm run verify
```

PostgreSQL evidence должно дополнительно подтвердить:

1. обе migrations применяются последовательно;
2. balanced synthetic journal принимается;
3. one-entry и unbalanced journals отклоняются;
4. `ledger_account_projections` совпадает с immutable entries;
5. `ledger_trial_balance.difference = 0` и `balanced = true`;
6. update/delete immutable records отклоняются;
7. views работают как `security_invoker` и не дают `PUBLIC` privileges.

## Approval effect

Письменный approval этого пакета разрешает начать только dev-only Session D contracts, migrations и synthetic tests для:

- explicit holds/reservations;
- reversal и correcting journals;
- fee/spread posting rules;
- reconciliation matches, breaks и suspense review.

Approval не разрешает:

- production assets или balances;
- legacy balance import;
- customer/operator money-moving APIs;
- provider, bank, blockchain или custody execution;
- HSM/MPC signing;
- runtime writer provisioning;
- production launch.

Каждая из этих границ требует отдельного decision/evidence gate.

## Sign-off record

Approval должен ссылаться на immutable commit SHA и содержать:

```text
Finance approver:
Decision: APPROVE / REJECT
Commit SHA:
Chart version:
Posting-rule registry version:
Conditions or exclusions:
Decision timestamp:
Evidence link:

CTO approver:
Decision: APPROVE / REJECT
Commit SHA:
Decision timestamp:
Evidence link:

Security approver:
Decision: APPROVE / REJECT
Commit SHA:
Decision timestamp:
Evidence link:
```

Chat approval без commit SHA и evidence link не меняет `PENDING` на `APPROVED`.

## NO-GO

Session D остаётся заблокирован, если:

- любой approver не дал письменный approval;
- review относится к другому commit;
- chart или posting-rule registry изменились после approval;
- test evidence не воспроизводится;
- D-009 трактуется как production database approval;
- предлагается включить production execution в рамках этого gate.
