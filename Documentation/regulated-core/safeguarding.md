# Regulated Safeguarding Baseline — Proposed

- Status: Proposed
- Scope: future customer fiat, cryptoasset, stablecoin, card and settlement balances, including asset segregation, reconciliations, treasury boundaries and insolvency evidence
- Owners: Finance / Legal / Compliance / Treasury / Custody
- Required approvers: Legal, MLRO/Compliance, Finance, Treasury, Custody, Security, CTO and every affected product/provider owner
- Production effect: none

## Purpose

This baseline defines the control evidence required before SolidChange can hold,
control, receive, transmit, exchange, reserve, settle or represent customer
assets in a regulated product. It separates a customer-visible balance from
the proof that assets are legally segregated, technically controlled,
reconciled, recoverable and unavailable for unauthorized use.

It does not choose the final legal safeguarding model, trust/nominee account
structure, custody model, reserve policy, partner, jurisdiction, banking rail,
stablecoin issuer, asset, liability treatment, insurance claim, insolvency
waterfall or production launch. Those remain blocked by the decision register,
formal legal/accounting review and domain approvals.

Related controls are defined by the [decision register](decision-register.md),
[finance ledger approval pack](finance-ledger-approval-pack.md),
[migration boundary](migration-boundary.md), [audit-evidence](audit-evidence.md),
[data lifecycle](data-lifecycle.md), [third-party risk](third-party-risk.md),
[operational-resilience](operational-resilience.md),
[customer-protection](customer-protection.md),
[incident-response](incident-response.md) and
[release-authorization](release-authorization.md) baselines.

## Principles

1. Customer assets are segregated from company operating funds by legal, ledger, bank/provider and custody evidence.
2. Customer entitlement, internal ledger position, provider statement and custody proof are reconciled; none is sufficient alone.
3. Customer funds, coins or reserves cannot be used for operating expense, lending, staking, hedging, fee float or liquidity unless explicitly approved for the exact product model.
4. Asset movements require an approved instruction, authorization, ledger effect, provider/custody evidence and reconciliation path.
5. Safeguarding status is measured continuously, not only at month end.
6. Missing, stale, contradictory or inaccessible safeguarding evidence fails closed.
7. Exceptions become cases with accountable owner, severity, deadline, customer impact and remediation evidence.
8. Provider dashboards, blockchain explorers and legacy balances are claims until independently reconciled.
9. AI may summarize evidence but cannot approve, release, sweep, allocate, write off or close safeguarding exceptions.
10. Production launch is blocked until Legal, Finance, Treasury, Custody, Security and affected provider owners approve the exact scope.

## Non-goals

This document does not:

- state that any current account, wallet, provider, issuer or exchange is approved for customer asset holding;
- define a final custody, title-transfer, trust, nominee, agency, e-money, stored-value or bankruptcy-remote model;
- authorize real deposits, withdrawals, exchange, settlement, treasury movement, custody signing or customer balance migration;
- decide reserve ratio, liquidity source, hedging, staking, lending, yield, netting, pooling or rehypothecation policy;
- approve stablecoin, fiat, bank, card, blockchain, KYC/KYT, liquidity or custody providers;
- permit internal SQL balance edits, provider-console adjustments or manual wallet transfers as remediation;
- make a blockchain confirmation, bank statement, provider callback or legacy row final without reconciliation;
- replace legal, accounting, regulatory, tax, audit or insolvency advice.

## Safeguarding scope record

Every production scope requires a versioned safeguarding record:

```text
safeguarding_scope_id:
scope_version:
legal_entity:
customer_types:
jurisdictions:
products_assets_and_rails:
legal_model_reference:
account_or_wallet_structure:
ledger_account_mapping:
provider_and_custody_references:
reserve_and_liquidity_policy:
settlement_cycle:
reconciliation_policy:
shortfall_and_exception_policy:
customer_disclosure_reference:
insolvency_and_wind_down_reference:
monitoring_reference:
approved_by:
approved_at_utc:
effective_at_utc:
expires_at_utc:
status:
```

Unknown, expired, incomplete or mismatched records disable the affected journey.
An approval for one legal entity, provider, asset, rail, network, wallet, account
or settlement model does not authorize another.

## Asset classes and segregation map

For each in-scope asset and rail, the approved design maps:

```text
asset_code:
asset_type: fiat | cryptoasset | stablecoin | card | receivable | payable
customer_entitlement_source:
internal_ledger_accounts:
external_account_or_wallet:
legal_title_or_control_model:
provider_or_custodian:
permitted_movements:
prohibited_movements:
statement_or_proof_source:
reconciliation_frequency:
shortfall_escalation:
customer_disclosure:
```

Required behavior:

- company operating cash and customer asset accounts are separate by default;
- fees, spreads and company revenue move only after approved recognition criteria;
- settlement receivables and payables are distinguished from held customer assets;
- omnibus pooling, sub-ledgering, address reuse or virtual accounts require explicit Legal/Finance approval;
- unsupported assets, chains, banks, issuers or networks cannot be treated as temporarily acceptable;
- any asset whose legal status, control, issuer solvency or redemption mechanics are unresolved remains disabled.

## Customer entitlement and ledger evidence

Customer entitlement must be reconstructable from immutable events and balanced
ledger entries. A balance displayed to a customer is not the source of truth.

Each customer-affecting asset movement records:

```text
instruction_or_case_id:
customer_reference:
asset_and_amount:
legal_entity:
ledger_journal_reference:
posting_rule_version:
quote_or_fee_reference:
provider_or_custody_reference:
authorization_reference:
reconciliation_bucket:
customer_visible_status:
created_at_utc:
```

The ledger design must show:

- customer liability, treasury asset, provider receivable/payable, fee revenue and suspense accounts separately;
- normal side, owner scope and permitted posting rules for every account class;
- no direct update path to balance projections;
- exact decimal and asset precision rules;
- idempotency and duplicate prevention;
- reversal and compensating-entry mechanics;
- opening balances and migration journals bound to independent reconciliation;
- trial balance by asset, legal entity and safeguarding scope.

A customer entitlement cannot be created or reduced by a support note, provider
callback, blockchain observation, UI status change, cache entry or analytics job.

## External accounts, wallets and providers

Every external holder or movement path has an approved operating profile:

```text
provider_reference:
service_scope:
account_or_wallet_identifier:
legal_owner_or_controller:
authorized_signers_or_operators:
permitted_assets_and_rails:
statement_format_and_frequency:
instruction_authentication:
dual_control_requirements:
cutoff_and_settlement_times:
fee_and_charge_treatment:
outage_and_exit_procedure:
data_and_evidence_export:
```

Controls:

- provider admin consoles cannot be the only place where customer asset movements are authorized or evidenced;
- API keys, bank users, wallet policies and custody operators are role-bound, reviewed and segregated;
- provider callbacks enter reconciliation queues and do not directly create final ledger truth;
- statement, balance and transaction exports are retained independently from the provider dashboard;
- provider outage, suspension, insolvency, sanctions, chain halt or account freeze has an owner and customer-impact path;
- exit plans include unresolved customer cases, pending movements and historical evidence export.

## Fiat safeguarding

Fiat safeguarding evidence considers:

- customer money account designation and legal protections;
- bank, payment institution, issuer or sponsor contracts;
- account naming, beneficiary, pooling and sub-account structure;
- settlement account versus safeguarding account boundaries;
- payment-in-transit and failed/returned payment treatment;
- bank charges, FX, card scheme and processor fees;
- cut-off times, bank holidays and stale pending states;
- chargeback, refund, reversal and dispute flows;
- sanctions, fraud and account-freeze dependencies;
- bank statement, confirmation and balance export controls.

Operating cash must not be netted against customer liabilities. A receivable from
a bank, acquirer, card issuer or payment processor is not equivalent to protected
customer money unless Legal/Finance approve that treatment for the exact scope.

## Cryptoasset and custody safeguarding

Cryptoasset safeguarding evidence considers:

- legal title, beneficial ownership and custody responsibility;
- wallet architecture, address policy and asset/network allowlist;
- HSM/MPC/signer boundary and key ceremony evidence;
- dual control, policy approvals and signer authorization;
- deposit address generation and ownership proof;
- confirmation, reorg, replay and unsupported-token policy;
- hot/warm/cold wallet liquidity and sweep rules;
- mainnet, testnet and chain-id separation;
- transaction intent, unsigned payload, signature, broadcast and settlement evidence;
- recovery seed, shard, backup and disaster-recovery controls.

Private keys, seed phrases, shards, raw signing material and production signer
credentials never enter Git, tickets, chat, CI logs, developer machines or
general application databases. A blockchain explorer view is not custody proof
without internal address ownership, signer and ledger linkage.

## Stablecoins, reserves and issuer exposure

Stablecoin support requires approved evidence for:

- issuer, token contract, chain and redemption route;
- asset backing, reserve claims and attestation dependencies;
- depeg, freeze, blacklist, bridge and contract-upgrade risk;
- chain congestion, halt, fork and finality assumptions;
- redemption, conversion and liquidity provider path;
- customer disclosure of issuer and blockchain risks;
- accounting treatment of held tokens versus customer liability;
- emergency suspension and customer communication.

Issuer attestations, proof-of-reserves dashboards and market prices are inputs,
not proof that SolidChange can meet every customer entitlement.

## Treasury and liquidity boundary

Treasury may support liquidity and settlement only within an approved mandate:

```text
treasury_policy_id:
permitted_assets:
permitted venues/providers:
minimum reserve or liquidity thresholds:
maximum exposure:
hedging rules:
transfer approval matrix:
segregation from customer assets:
monitoring and breach handling:
```

Customer assets must not be:

- used for proprietary trading, lending, staking, rehypothecation or operating expenses;
- swept to unapproved venues, wallets or bank accounts;
- netted across legal entities or products without explicit approval;
- pledged, encumbered or used as collateral unless the legal model expressly permits it;
- moved to cover a deficit in another asset, provider, chain or customer cohort.

Liquidity operations require their own ledger, provider and reconciliation
evidence. A treasury transfer cannot be disguised as customer settlement.

## Reconciliation

Safeguarding reconciliation compares, at minimum:

```text
internal_customer_entitlements:
internal_treasury_and_suspense_accounts:
bank_or_provider_statements:
custody_wallet_balances:
pending_instructions:
unsettled_provider_positions:
fees_and_charges:
exceptions_and_cases:
```

Required properties:

1. reconciliation runs at the approved frequency and on demand after incidents;
2. each run has immutable input digests, time, actor and code/config version;
3. balances reconcile by asset, legal entity, product, provider, account/wallet and customer cohort where applicable;
4. pending, in-transit, disputed, failed and reversed items are separately aged;
5. unexplained differences create cases with severity and deadline;
6. no auto-write-off, balancing plug or hidden suspense movement closes a difference;
7. reconciled state is restorable from retained evidence;
8. materially stale statements or unavailable proofs fail closed.

Daily, intraday and real-time monitoring thresholds are policy decisions, not
engineering defaults. They remain `NO-GO` until approved.

## Shortfalls, excesses and exceptions

A safeguarding exception record includes:

```text
exception_id:
safeguarding_scope_id:
asset_and_amount:
affected_customers_or_cohort:
detected_by:
detected_at_utc:
classification:
severity:
suspected_cause:
immediate_containment:
owner:
deadline:
customer_impact_assessment:
regulatory_or_provider_notification_assessment:
remediation_plan:
closure_evidence:
```

Shortfalls, excesses, stale unmatched items, unauthorized movements and missing
statements are never treated as normal variance without approved tolerance.
Material exceptions trigger incident-response, customer-protection, Legal,
MLRO/Compliance, Finance and provider escalation as applicable.

Closure requires independent evidence that:

- customer entitlement and external asset position reconcile again;
- no customer was silently disadvantaged;
- ledger correction used approved entries;
- customer/provider/regulatory communication duties were assessed;
- root cause and recurrence controls are tracked.

## Customer withdrawals, holds and restrictions

Withdrawal availability is derived from approved entitlement, risk, liquidity,
provider, custody and reconciliation state. It is not simply a UI balance.

The system must distinguish:

- available balance;
- pending deposits or unsettled funds;
- held or restricted amount;
- reserved fees or network charges;
- failed, returned or disputed movements;
- manual review, legal hold or incident containment.

Holds and restrictions require authority, reason category, scope, review time
and customer-notice treatment under the customer-protection baseline. A hold
cannot become a hidden safeguarding fix for a shortfall.

## Wind-down and insolvency evidence

Before production, the approved design must define how customer assets and
records remain identifiable during wind-down, provider failure, platform
insolvency or key-person loss.

Evidence considers:

- customer entitlement export and statement generation;
- legal entity and account/wallet ownership evidence;
- provider and custody access continuity;
- independent reconciled position at suspension time;
- communication, claims and complaint handling;
- privileged-access and break-glass procedure;
- immutable audit, ledger and custody evidence access;
- data retention, legal hold and deletion freeze behavior;
- third-party cooperation and exit rights.

This baseline does not decide an insolvency waterfall or customer priority.
Those are Legal/Finance decisions.

## Monitoring and assurance

Monitoring covers:

- entitlement versus external asset coverage;
- reconciliation freshness and exception aging;
- provider statement availability and drift;
- custody wallet movement and signer policy events;
- bank, card, payment and blockchain settlement delays;
- liquidity and reserve threshold breaches;
- unsupported or unexpected asset movements;
- operator, provider and treasury overrides;
- stale customer-visible statuses;
- incident, complaint and remediation linkage.

Assurance samples complete paths from customer instruction through ledger,
provider/custody evidence, reconciliation, customer receipt and any exception.
Critical findings block launch, expansion or feature enablement.

## Audit evidence

Evidence must reconstruct:

- approved safeguarding scope and legal model;
- customer entitlement and ledger source;
- account, wallet, provider and custody control;
- authorization and segregation of duties;
- every movement, fee, reversal, correction and settlement;
- reconciliation inputs, outputs, exceptions and closure;
- customer notices, complaints and remediation;
- provider statements and evidence exports;
- incident, shortfall, wind-down and recovery decisions.

Evidence stores contain references, digests and minimized records. They do not
copy production secrets, private keys, signing material, unnecessary customer
PII or unrestricted provider payloads.

## Approval dependencies

Production safeguarding remains blocked until:

- D-001, D-002, D-003, D-004, D-005, D-007, D-008, D-009, D-010, D-014, D-015, D-017 and D-018 are approved where applicable;
- legal model, customer entitlement, insolvency and disclosure treatment are approved;
- bank/payment/card/provider/custody contracts and evidence exports are approved;
- chart of accounts, posting rules, opening balances and reconciliation policy are Finance-approved;
- treasury, reserve, liquidity and exposure policies are approved;
- custody, HSM/MPC, signer and key-recovery controls are approved;
- migration and opening-balance evidence is independently reconciled;
- shortfall, exception, wind-down and customer-remediation playbooks are tested;
- monitoring thresholds, alerting, ownership and independent assurance are operating;
- Legal, MLRO/Compliance, Finance, Treasury, Custody, Security, CTO and affected provider/product owners approve the exact release scope.

## Production stop conditions

The safeguarding scope is `NO-GO` when:

1. legal ownership, custody responsibility or customer entitlement is unresolved;
2. account, wallet, provider or asset scope is missing, expired or bound to another product;
3. customer and company assets are not segregated by approved legal and accounting evidence;
4. customer liabilities cannot be reconciled to external assets by asset and legal entity;
5. provider statements, wallet proofs or bank confirmations are unavailable or stale;
6. fees, revenue, receivables, payables or settlement suspense can be confused with protected customer assets;
7. treasury can move, pledge, lend, stake, hedge or use customer assets outside an approved mandate;
8. custody signing, key recovery or wallet control lacks approved dual control and evidence;
9. opening balances or legacy positions are imported without independent reconciliation;
10. unexplained differences can be written off or hidden through manual SQL, provider consoles or support tools;
11. withdrawal availability can exceed approved entitlement, liquidity or reconciliation state;
12. shortfall, excess, dispute, incident or complaint ownership and deadlines are undefined;
13. wind-down, insolvency or provider-exit evidence is missing for the scope;
14. AI or an unauthorized operator can approve, release, allocate or close safeguarding exceptions;
15. any required approval is missing, expired or tied to a different version.

Approval of this baseline confirms only the proposed safeguarding control
design. It does not authorize customer asset holding, production bank/payment
or custody integrations, real deposits or withdrawals, customer-balance
migration, treasury operations, custody signing, provider enablement or launch.
