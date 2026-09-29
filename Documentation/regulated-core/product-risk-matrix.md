# Product and Risk Matrix — Draft

Этот документ фиксирует engineering assumptions, а не коммерчески или юридически утверждённый продукт. Любая строка со статусом `Open` остаётся неисполняемой.

## Customer and geography

| Dimension | Proposed V1 | Status | Safe fallback |
|---|---|---|---|
| Customer type | Verified individuals | Open pending D-001/D-014 | No production onboarding |
| KYB/legal entities | Case model and prototype only | Open | No business accounts |
| Primary jurisdiction | Kyrgyzstan | Open pending legal memo | Dev/sandbox only |
| Other countries | Explicit allowlist only | Open | Deny all |
| Russia/CIS card availability | Issuer-dependent | Open | Do not advertise or issue |
| Sanctioned/high-risk jurisdictions | Compliance policy required | Open | Deny and create review case |

## Assets and rails

| Product/rail | Proposed scope | Status | Execution gate |
|---|---|---|---|
| TON | Wallet/deposit/withdrawal contracts on testnet | Proposed | Custody, KYT, limits, reconciliation |
| USDT on TON | Testnet contracts | Proposed | Same plus token contract allowlist |
| TRON | Wallet/deposit/withdrawal contracts on testnet | Proposed | Node/indexer, custody, KYT |
| USDT TRC20 | Testnet contracts | Proposed | Token contract allowlist and fee policy |
| RUB via Kyrgyz bank/SBP | Provider-neutral adapter and simulator | Open | D-004 written bank approval |
| KGS | Excluded until decision | Open | D-010 approval |
| Cards | UI/contracts only | Open | D-005/D-006 issuer approval |
| Other chains/tokens | Out of V1 | Open | Separate risk and custody review |

## Operation classes

| Operation | Default risk class | Required controls | AI authority |
|---|---|---|---|
| Registration/login | Medium | Rate limits, device/session controls, MFA policy | Assist only |
| KYC submission | High | Provider signature, evidence retention, case review | Extract/summarize |
| Deposit detection | High | Chain/provider confirmation and idempotency | No settlement authority |
| Exchange quote | Medium | TTL, price source, fee disclosure | No execution authority |
| Exchange execution | Critical | Limits, AML/KYT, hold, approval, ledger, reconciliation | Prohibited |
| Withdrawal | Critical | Step-up, address/risk controls, maker-checker, custody policy | Prohibited |
| Card issuance/action | Critical | Issuer policy, step-up, approval and evidence | Prohibited |
| AML case closure | Critical | MLRO-controlled decision | Prohibited |
| Customer block/freeze | Critical | Human approval and appeal/evidence policy | Prohibited |

## Limits

Exact per-transaction, daily, monthly, velocity and cumulative limits are intentionally unset pending D-014. Implementation must reject missing production limit profiles rather than interpreting them as unlimited.

Required limit dimensions:

- customer verification tier;
- asset/network;
- operation type;
- country/residency;
- funding source and beneficiary risk;
- daily/monthly/cumulative volume;
- failed/reversed attempts;
- device/account velocity;
- manual exception expiry.

## Out of scope until separately approved

- Anonymous or unverified financial operations.
- Margin, leverage, lending, staking and derivatives.
- Privacy coins and unapproved token contracts.
- Autonomous AI approval or customer restriction.
- Cross-chain bridge custody.
- Production omnibus treasury automation.
- Any geography or payment rail absent from an explicit allowlist.
