# Decision Register

Engineering может готовить contracts и simulators, пока решения открыты. Production provisioning, contracts, marketing claims и live execution блокируются указанными stop conditions.

| ID | Решение | Owner / approver | Статус | Безопасный default до approval | Evidence / exit condition |
|---|---|---|---|---|---|
| D-001 | Точный лицензионный scope в Кыргызстане | Legal + MLRO | Open | Только dev/sandbox; никаких заявлений о разрешённых услугах | Письменный legal memo и compliance scope |
| D-002 | Custody scope и ответственность за активы | Legal + CTO + Security | Open | Test signer, testnet и unsigned transaction contracts | Custody policy, liability model, key ownership |
| D-003 | HSM/MPC vendor и location | CTO + Security | Open | Ephemeral dev keys; production signing запрещён | Vendor due diligence, architecture review, key ceremony plan |
| D-004 | Bank для RUB/SBP | CEO + Legal + Finance | Open | Mock adapter; никакого production callback или settlement | Bank approval, contract, sandbox, reconciliation format |
| D-005 | Card issuer/BIN sponsor | CEO + Legal | Open | Card UI только как prototype | Signed issuer scope, API/sandbox, dispute and settlement model |
| D-006 | Card geography и Russia/CIS scope | Legal + issuer | Open | Не обещать географию и доступность | Written issuer/legal approval |
| D-007 | Liquidity: external, treasury или hybrid | CFO + CTO + Risk | Open | Quote simulator; no hedge/order placement | Liquidity ADR, exposure limits, settlement/reconciliation model |
| D-008 | Primary cloud/data location | CTO + Legal + SRE | Open | Dev synthetic data only | DPA, data residency approval, topology and DR review |
| D-009 | Financial core DB | CTO + Financial Core Lead | Proposed | PostgreSQL for new append-only ledger; legacy MariaDB remains isolated | ADR approval, benchmark, HA/backup/restore proof |
| D-010 | KGS в V1 | Product + bank + Compliance | Open | KGS excluded from executable scope | Bank support, limits, accounting and customer disclosure |
| D-011 | Ranex/KYT integration method | MLRO + Security | Open | Provider-neutral interface and signed simulator | Contract, API/security review, outage policy |
| D-012 | AI boundary in regulated actions | MLRO + Security | Accepted | Human-in-the-loop; AI cannot approve, block or close cases | Capability tests and operator approval evidence |
| D-013 | React Native или native mobile | CTO + Product + Security | Proposed | React Native spike; native modules for device-security boundaries | ADR, security spike, release ownership |
| D-014 | Exact V1 limits and countries | Product + Compliance + Risk | Open | Deny-by-default; no production transaction limits configured | Approved product/risk matrix |
| D-015 | Git/deployment topology and HA tier | CTO + SRE + Security | Proposed | Existing protected CI for dev-only components | Environment topology, recovery and access review |
| D-016 | Staff SSO and VPN/ZTNA | CTO + Security | Open | Synthetic/local IdP only; no production operator access | IdP contract, FIDO2/step-up policy, JML lifecycle |
| D-017 | Backup retention and restore targets | SRE + Security + Compliance | Open | No production data storage | Approved RPO/RTO, retention schedule, restore drill |
| D-018 | Protected runner strategy | SRE + Security | Proposed | No long-lived production credentials in CI | OIDC credentials, isolated runners, signed artifacts |

## Decision record template

```text
Decision ID:
Question:
Options considered:
Chosen option:
Reason:
Regulatory impact:
Security impact:
Financial/accounting impact:
Data residency impact:
Owner:
Approvers:
Decision date:
Review date:
Evidence links:
Rollback/revisit trigger:
```

## Approval rule

`Proposed` не означает `Accepted`. Решение становится обязательным только после письменного approval владельцев, ссылки на evidence и обновления статуса в этом register. Если deadline пропущен, зависимый production scope остаётся выключенным.
