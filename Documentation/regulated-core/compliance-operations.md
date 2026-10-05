# Regulated Compliance Operations Baseline — Proposed

- Status: Proposed
- Scope: future customer due diligence, sanctions/PEP screening, KYT, transaction monitoring, case management, reporting assessments and compliance operations
- Owners: MLRO / Compliance / Legal / Risk Operations
- Required approvers: Legal, MLRO/Compliance, Product, Finance, Security, CTO and every affected provider or operations owner
- Production effect: none

## Purpose

This baseline defines the control evidence required before SolidChange can
onboard customers, screen activity, monitor transactions, restrict activity,
escalate cases or assess regulatory reporting duties in a regulated product.
It makes compliance operations auditable, human-controlled and fail-closed
without authorizing any customer, jurisdiction, provider, threshold or launch.

It does not provide legal advice, choose a licensing perimeter, select a
KYC/KYT provider, define statutory thresholds, approve Travel Rule scope,
authorize customer onboarding, permit production screening, close AML cases or
replace MLRO judgment. Those remain blocked by the decision register, formal
Legal/MLRO review and affected domain approvals.

Related controls are defined by the [decision register](decision-register.md),
[product/risk matrix](product-risk-matrix.md),
[data lifecycle](data-lifecycle.md), [access-control](access-control.md),
[third-party risk](third-party-risk.md),
[AI-governance](ai-governance.md),
[customer-protection](customer-protection.md),
[safeguarding](safeguarding.md),
[incident-response](incident-response.md),
[audit-evidence](audit-evidence.md) and
[release-authorization](release-authorization.md) baselines.

## Principles

1. Compliance policy is explicit, versioned and approved before execution.
2. Unknown, stale, failed or contradictory compliance evidence denies or holds the affected action.
3. Customer due diligence, sanctions, PEP, adverse media, KYT and transaction monitoring evidence are linked, not substituted for one another.
4. Provider scores, dashboards and callbacks are inputs; internal policy decisions remain owned by SolidChange.
5. Compliance cases have accountable human owners, deadlines, evidence and independent review where required.
6. Customer-impacting restrictions use approved reason categories and notice paths.
7. Regulatory reporting assessments are preserved even when the outcome is “not reportable.”
8. AI may summarize or prioritize evidence but cannot approve, reject, restrict, release, report or close a case.
9. Monitoring thresholds can be changed only through approved release and policy evidence.
10. Production launch is blocked until Legal, MLRO/Compliance, Product, Security and affected operations owners approve the exact scope.

## Non-goals

This document does not:

- decide whether any current or future product is legally allowed;
- define final KYC tiers, transaction limits, sanctions lists, PEP rules,
  source-of-funds requirements, KYT risk weights or Travel Rule thresholds;
- approve a Ranex, KYC, KYT, screening, case-management or reporting provider;
- authorize automated onboarding, account closure, asset freeze, withdrawal
  release, regulatory report filing or customer communication;
- permit silent manual ledger, balance, provider or custody changes as
  compliance remediation;
- make legacy rows, provider dashboards or AI summaries authoritative;
- weaken privacy, data minimization, access-control or customer-protection
  requirements.

## Compliance scope record

Every production compliance scope requires a versioned record:

```text
compliance_scope_id:
scope_version:
legal_entity:
jurisdictions:
customer_types:
products_assets_and_rails:
licensing_and_policy_reference:
kyc_kyb_policy_reference:
sanctions_pep_policy_reference:
kyt_and_transaction_monitoring_policy:
case_management_policy:
travel_rule_policy:
reporting_assessment_policy:
customer_notice_and_review_policy:
provider_references:
data_and_retention_references:
monitoring_reference:
approved_by:
approved_at_utc:
effective_at_utc:
expires_at_utc:
status:
```

Unknown, expired, incomplete or mismatched records disable the affected
customer journey or financial operation. Approval for one customer type,
jurisdiction, product, asset, chain, rail, provider or legal entity does not
authorize another.

## Customer due diligence

The approved customer due-diligence model defines:

```text
customer_type:
jurisdiction:
risk_tier:
identity_evidence:
address_or_residency_evidence:
beneficial_owner_evidence:
source_of_funds_or_wealth_evidence:
screening_requirements:
refresh_cycle:
allowed_products_and_limits:
manual_review_triggers:
restricted_or_prohibited_states:
```

Required behavior:

- onboarding cannot complete from incomplete, expired or provider-only evidence;
- customer, document, beneficial-owner and representative identities are
  distinguished;
- high-risk or unsupported jurisdictions, customer types, assets and rails are
  denied or held by approved policy;
- a refresh requirement blocks expansion or high-risk activity when overdue;
- manual override requires a named authorized reviewer, reason and evidence;
- CDD evidence is retained and minimized under the approved lifecycle policy.

CDD approval does not authorize every product, limit, asset, rail or customer
instruction. Product eligibility and financial execution still require the
approved product, risk, ledger, safeguarding and release controls.

## Sanctions, PEP and adverse-media screening

Screening policy records:

```text
screening_policy_id:
lists_and_sources:
matching_logic:
false_positive_handling:
pep_and_rca_scope:
adverse_media_scope:
rescreening_frequency:
change_event_triggers:
hit_severity_model:
escalation_and_approval_matrix:
customer_notice_policy:
```

Controls:

- exact list source, version, timestamp and provider response are retained;
- potential hits create cases rather than silent allow/deny outcomes;
- false-positive clearance records include reviewer, rationale, evidence and
  expiry or rescreen trigger;
- confirmed or unresolved sanctions exposure fails closed under Legal/MLRO
  policy;
- PEP/adverse-media outcomes cannot be used as unapproved discrimination,
  marketing or pricing categories;
- rescreening failures, stale lists and provider outages suspend affected
  onboarding or activity where required.

Provider match scores are not final decisions. An authorized human applies the
approved policy and records the outcome.

## KYT and transaction monitoring

The monitoring design covers customer behavior, asset movement and provider or
blockchain evidence:

```text
monitoring_rule_id:
scope:
input_sources:
typologies_or_risk_indicators:
thresholds:
lookback_window:
aggregation_keys:
exclusions:
action_on_match:
case_priority:
owner:
review_sla:
approved_by:
```

Required behavior:

1. every rule has approved scope, inputs, thresholds, owner and effective dates;
2. failed, stale or missing monitoring input holds or disables the dependent
   action rather than treating risk as zero;
3. KYT provider responses are bound to asset, chain, address, transaction and
   timestamp;
4. wallet, bank, card, customer, device, IP and behavioral signals remain
   separable evidence inputs;
5. rule suppression, threshold changes and allowlists require maker-checker
   approval and release evidence;
6. alerts cannot be deleted, overwritten or closed by replaying provider data;
7. blocking, releasing or escalating funds follows approved case authority and
   customer-protection notice rules.

Monitoring must distinguish pre-transaction, in-flight, post-transaction and
periodic review controls. A green result in one layer does not waive the others.

## Travel Rule and counterparty evidence

If the approved scope includes transfers subject to Travel Rule or equivalent
counterparty obligations, the design records:

```text
travel_rule_scope_id:
jurisdictions_and_assets:
originator_required_fields:
beneficiary_required_fields:
counterparty_vasp_policy:
message_protocol_or_provider:
data_minimization_and_retention:
screening_and_matching_policy:
failure_or_rejection_handling:
customer_notice_policy:
```

Transfers fail closed when required originator, beneficiary, counterparty,
screening, message-delivery or retention evidence is missing, stale or
contradictory. This baseline does not decide whether Travel Rule applies to any
asset, jurisdiction, amount, provider or product; Legal/MLRO approval is
required for the exact scope.

## Case management

Compliance cases include:

```text
case_id:
case_type:
customer_or_counterparty_reference:
linked_operations:
trigger_source:
policy_version:
evidence_manifest:
risk_rating:
assigned_owner:
reviewer_or_approver:
deadline:
customer_impact:
actions_taken:
decision:
decision_reason:
reporting_assessment:
notices_or_communications:
closed_by:
closed_at_utc:
```

Controls:

- cases are immutable event streams with append-only notes and evidence links;
- assignment, escalation, decision and closure require authorized human actors;
- conflicts of interest and maker-checker requirements are enforced for
  high-impact outcomes;
- customer restrictions, holds, releases and exits are linked to the exact case
  and policy version;
- closure cannot hide unresolved linked alerts, disputes, incidents,
  reconciliation exceptions or legal holds;
- missed deadlines and reopened cases are monitored as control failures.

An AI summary, provider recommendation, elapsed timer or support ticket closure
cannot close a compliance case.

## Regulatory reporting assessment

For every reportable-type trigger, the assessment records:

```text
assessment_id:
case_or_alert_reference:
legal_entity_and_jurisdiction:
trigger_category:
facts_and_evidence_manifest:
policy_and_legal_reference:
deadline:
draft_or_submission_reference:
decision:
decision_authority:
approved_at_utc:
submitted_at_utc:
post_submission_actions:
```

The system preserves both filing and non-filing decisions with rationale and
authority. It does not infer a reporting duty, deadline, form, threshold,
agency or tipping-off restriction without Legal/MLRO approval for the exact
scope.

## Customer restrictions and notices

Restrictions must be scoped, evidenced and reviewable:

```text
restriction_id:
customer_or_account:
affected_products_assets_or_operations:
case_reference:
policy_version:
reason_category:
start_at_utc:
review_due_at_utc:
authorized_by:
customer_notice_reference:
release_or_exit_conditions:
```

Controls:

- restrictions default to the narrowest approved scope consistent with policy;
- reason categories and customer notices are approved by Legal/MLRO and
  customer-protection owners;
- release requires evidence that the case condition is resolved and any
  safeguarding, ledger, provider or incident dependency is cleared;
- permanent exit, offboarding or account closure requires separate authority;
- restrictions cannot be used to mask liquidity, safeguarding or operational
  failures.

## Provider and model boundaries

KYC/KYT/screening providers, case-management tools and analytics models require
approved third-party and model evidence:

- contractual scope, data location, subprocessors and confidentiality;
- list, model, typology and score semantics;
- explainability and evidence export sufficient for review;
- outage, degraded-mode and backlog handling;
- false-positive and false-negative monitoring;
- change notification and regression testing;
- data deletion, retention, legal hold and exit export;
- security, access, audit-log and incident obligations.

Provider scores, model outputs and dashboards are decision support only unless
the approved policy explicitly permits deterministic allow/deny behavior for
the exact low-risk scope. Critical/high risk outcomes require human authority.

## Monitoring and assurance

Compliance assurance covers:

- onboarding completion, rejection, abandonment and override rates;
- screening hit handling, false-positive aging and list freshness;
- monitoring alert volumes, backlog, SLA breaches and reopen rates;
- rule, threshold, allowlist and suppression changes;
- restricted customers, held transactions and release decisions;
- reporting assessments, deadlines, filings and non-filing rationales;
- provider outage, stale evidence and degraded-mode decisions;
- access to compliance cases, exports and privileged actions;
- AI suggestion acceptance/rejection and reviewer independence;
- customer complaints and remediation linked to compliance outcomes.

Periodic assurance samples complete paths from customer onboarding through
screening, monitoring, case decision, customer impact, regulatory assessment,
provider evidence and final closure. Critical findings block launch, expansion
or release until remediated.

## Audit evidence

Evidence must reconstruct:

- approved compliance scope and policy versions;
- customer, counterparty and operation context;
- data sources, provider responses and list/model versions;
- screening, monitoring and rule evaluations;
- human reviewer identity, authority, rationale and timestamps;
- restrictions, releases, notices and customer impact;
- reporting assessment, submission or non-submission rationale;
- provider outage, stale-data and degraded-mode decisions;
- release version, access, override and approval history.

Evidence stores contain references, digests and minimized records. They do not
copy secrets, private keys, unnecessary customer PII, unrestricted provider
payloads or privileged investigation details into tickets, logs or analytics.

## Approval dependencies

Production compliance operations remain blocked until:

- D-001, D-011, D-012, D-014 and every affected product/provider decision are approved;
- licensing perimeter, customer types, jurisdictions, assets, rails, limits and exclusions are approved;
- KYC/KYB, beneficial-owner, source-of-funds and periodic-review policies are approved;
- sanctions, PEP, adverse-media and rescreening policies are approved;
- KYT and transaction-monitoring rules, thresholds, owners and review SLAs are approved;
- Travel Rule applicability, provider, fields, protocol and failure handling are approved where applicable;
- case-management roles, maker-checker, closure and escalation controls are approved;
- reporting assessment and filing/non-filing authority is approved;
- customer notices, restrictions, appeals and complaint links are approved;
- data lifecycle, access-control, provider, incident and audit-evidence controls are operating;
- Legal, MLRO/Compliance, Product, Finance, Security, CTO and affected operations owners approve the exact release scope.

## Production stop conditions

The compliance operations scope is `NO-GO` when:

1. legal scope, customer type, jurisdiction, product, asset or rail is unknown;
2. CDD, sanctions, PEP, KYT, Travel Rule or monitoring policy is missing, expired or tied to another scope;
3. provider evidence is stale, unavailable, unauditable or cannot be exported;
4. required screening or monitoring failure can be treated as a pass;
5. a case can be assigned, decided, released, closed or deleted without authorized human evidence;
6. restrictions or releases can bypass product, ledger, custody, safeguarding or customer-protection controls;
7. rule changes, thresholds, allowlists or suppressions lack maker-checker approval;
8. reporting assessments, deadlines or rationales are not retained;
9. customer notices, complaints, reviews or remediation paths are undefined;
10. AI or an unauthorized operator can approve, block, release, report or close a compliance outcome;
11. compliance data retention, legal hold, access or deletion controls are unresolved;
12. critical/high legal, compliance, financial, security or customer-harm findings remain open;
13. any required approval is missing, expired or bound to a different version.

Approval of this baseline confirms only the proposed compliance-operations
control design. It does not authorize production onboarding, screening,
monitoring, customer restrictions, regulatory reporting, provider enablement,
financial execution, custody activity or launch.
