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
| Posting-rule boundary | Command обязан ссылаться на зарегистрированную пару `journal_type` + `posting_rule_version`; actor и per-asset pattern проверяются runtime и PostgreSQL registry | `posting-rules.json`, migration `0003` и rejection fixtures |
| Double entry | Каждый journal имеет 2–1000 entries и балансируется независимо по asset | JS tests и PostgreSQL rejection fixtures |
| Legal entity | Journal и все accounts/entries находятся внутри одной legal entity | Runtime validation и composite foreign keys |
| Precision | Суммы используют canonical decimal strings / PostgreSQL `NUMERIC`, scale 0–18 и limit 78 whole-plus-fraction digits с учётом сохранённых fractional zeros | JS boundary tests, SQL boundary/rejection fixtures и migration `0003` |
| Idempotency | Повтор идентичной команды возвращает исходный journal; изменённый payload отклоняется | In-memory tests и unique database registry |
| Evidence | Actor, authorization, policy, source digest, correlation, immutable outbox и acceptance seal связаны с journal; все сохранённые timestamps конечны; migration history точно совпадает с reviewed manifest, новые records принимаются только последовательно, failed migration полностью откатывает schema objects и history row, а SQL sources закреплены exact SHA-256 catalog | Posting command, migrations и smoke/timeline/finiteness/migration-source/history rejection tests |
| Read models | Account projections и trial balance полностью пересобираются из immutable entries | Deterministic snapshot tests и read-only SQL views |
| Dev recoverability | Synthetic backup сохраняет только committed state и не переносит unrelated schemas; restore сохраняет unrelated target state и exact ledger/views/policy, подтверждает canonical migration history, отклоняет structurally valid incomplete recovery и occupied target без изменений, принимает новый journal и создаёт повторно восстанавливаемый backup | `postgres-backup-restore.sh`, scope isolation, consistency/partial-state/collision/continuity/chained recovery, restored-history rejection и canonical state snapshot; это не production RPO/RTO или D-017 approval |
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

1. все migrations применяются последовательно;
2. balanced synthetic journal принимается;
3. one-entry и unbalanced journals отклоняются;
4. balanced append после acceptance seal отклоняется;
5. unregistered rule, запрещённый actor и неверный entry pattern отклоняются;
6. JS и PostgreSQL одинаково принимают 78-digit boundary и отклоняют превышение;
7. `ledger_account_projections` совпадает с immutable entries;
8. `ledger_trial_balance.difference = 0` и `balanced = true`;
9. update/delete immutable records отклоняются;
10. views работают как `security_invoker` и не дают `PUBLIC` privileges.
11. synthetic logical backup/restore возвращает то же canonical ledger state и exact database policy; production retention, encryption, RPO/RTO и restore drill остаются отдельным D-017 gate.
12. truncated backup не восстанавливается частично: `pg_restore --single-transaction` возвращает ошибку, а disposable database остаётся без `financial_core` schema.
13. backup во время незавершённой journal acceptance восстанавливает точное committed состояние до транзакции и не содержит ни одного pending acceptance artifact.
14. после exact restore restored database принимает новый complete journal, корректно обновляет projections/trial balance и не изменяет source database.
15. active restored database создаёт second-generation backup, который восстанавливает полный post-recovery state, exact database policy и canonical migration history.
16. повторный restore в occupied financial-core target отклоняется атомарно и не изменяет canonical state.
17. schema-scoped backup не переносит unrelated source schema и не изменяет unrelated state в restore target.
18. все 13 PostgreSQL timestamp constraints отклоняют `infinity` и `-infinity`, включая replica mode.
19. установленная PostgreSQL migration history точно соответствует migrations `0001`–`0011` и порядку их применения; synthetic extra record и out-of-order application отклоняются verifier.
20. новые migration records отклоняются до записи при пропуске версии, несовпадении numeric prefix или stale `applied_at`, включая replica mode.
21. SHA-256 migration source catalog отклоняет изменённый historical SQL, отсутствующий migration и лишний unreviewed migration до применения к базе.
22. каждый migration source использует один atomic `BEGIN`/`COMMIT` boundary, sequential filename и ровно одну history row, совпадающую с filename/version.
23. psql meta-commands и дополнительные transaction-control statements запрещены, чтобы migration не мог подключить unreviewed source или выйти из atomic boundary.
24. runtime writer test profile точно совпадает с reviewed least-privilege catalog: role capabilities, settings, ownership, parent-role membership, лишние grants на migration history, unreviewed relations, columns, functions, grant option или `PUBLIC` writes отклоняются verifier, а прямой forged migration-history insert получает permission denied. Это synthetic evidence, а не runtime writer provisioning.
25. failed migration полностью откатывает schema objects и history row; после injected failure canonical migration применяется чисто без ручной очистки.
26. restored и second-generation databases обязаны пройти exact migration-history verifier; synthetic unreviewed history drift отклоняется и полностью откатывается.
27. structurally valid backup без committed outbox data проходит catalog и migration-history проверки, но отклоняется canonical state snapshot как incomplete recovery.

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
