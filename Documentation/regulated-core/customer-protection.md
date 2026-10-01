# Regulated Customer Protection Baseline — Proposed

- Status: Proposed
- Scope: future customer onboarding, disclosures, quotes, transactions, restrictions, support, complaints and remediation
- Owners: Product / Legal / Compliance / Customer Operations
- Required approvers: Legal, MLRO/Compliance, Product, Finance, Security and every affected domain owner
- Production effect: none

## Purpose

This baseline defines the evidence required to show that a customer receives
accurate information, meaningful choice, fair treatment, human review and
traceable remediation throughout a regulated product journey.

It does not approve a product, jurisdiction, customer type, asset, rail, fee,
exchange rate, limit, provider, complaint deadline, refund rule, marketing
claim or production launch. Those remain blocked by the decision register,
formal Legal/MLRO review and the affected domain approvals.

Related controls are defined by the [product/risk matrix](product-risk-matrix.md),
[data lifecycle](data-lifecycle.md), [access-control](access-control.md),
[third-party risk](third-party-risk.md), [operational-resilience](operational-resilience.md),
[AI-governance](ai-governance.md), [incident-response](incident-response.md),
[audit-evidence](audit-evidence.md) and
[release-authorization](release-authorization.md) baselines. Customer asset
segregation, entitlement and shortfall controls are defined by the
[safeguarding](safeguarding.md) baseline.

## Principles

1. A customer sees material terms before committing, not only after execution.
2. Product availability, price, fee, timing and risk claims are supported by current approved evidence.
3. Consent is specific, versioned and separable from mandatory legal or security processing.
4. Missing, stale or contradictory eligibility, price or disclosure state fails closed.
5. Customer-visible status is derived from reconciled system evidence, not optimistic UI state.
6. A restriction or adverse outcome has accountable human authority, reason evidence and an approved review path.
7. Support access cannot become an authentication bypass or an unlogged financial command path.
8. Complaints, disputes, errors and remediation are preserved as cases with deadlines and ownership.
9. Accessibility, language and vulnerability needs are part of the control design.
10. AI may assist an authorized human but cannot issue a final customer-impacting decision or communication.

## Non-goals

This document does not:

- provide legal advice or define statutory customer rights;
- infer whether a cryptoasset, exchange, custody, payment or card service is licensed;
- authorize onboarding, trading, deposits, withdrawals, cards or customer money movement;
- choose exact fees, spreads, rates, limits, settlement times or service levels;
- define final complaint, refund, chargeback, compensation or liability rules;
- permit misleading availability, guaranteed-return, instant-settlement or asset-safety claims;
- allow support staff, providers, scripts or AI to override financial, compliance or custody controls;
- make a provider response or legacy record authoritative without reconciliation.

## Customer journey control record

Every production journey requires a versioned control record:

```text
journey_id:
journey_version:
customer_types:
jurisdictions:
products_assets_and_rails:
eligibility_policy_reference:
required_disclosures:
price_fee_and_quote_policy:
limit_policy_reference:
consent_and_acknowledgement:
expected_status_model:
support_and_escalation_path:
complaint_and_review_path:
error_and_remediation_policy:
accessibility_and_languages:
data_and_processor_references:
monitoring_reference:
approved_by:
approved_at_utc:
effective_at_utc:
expires_at_utc:
status:
```

Unknown, expired, incomplete or mismatched records disable the journey. A
generic approval cannot cover another customer type, jurisdiction, asset,
network, provider or materially different interface.

## Disclosures and informed action

Material disclosures must be:

- presented before the action they govern;
- written for the approved customer type, language, jurisdiction and product;
- versioned and bound to the exact journey and effective period;
- distinguishable from advertising, optional consent and operational notices;
- available in a durable form where Legal requires it;
- consistent across application, website, support, provider and confirmation records;
- re-presented when a material term changes and fresh acknowledgement is required;
- tested for comprehension and accessibility rather than only legal completeness.

At minimum, the approved disclosure set considers:

- legal entity and service role;
- product and asset description;
- custody and key-control model;
- price source, spread, fee and third-party charge treatment;
- quote expiry and execution uncertainty;
- network, bank, card and provider dependencies;
- settlement, confirmation and reversal limitations;
- customer obligations, limits and prohibited use;
- volatility, liquidity, technology and counterparty risks;
- complaint, support and review routes;
- data use and external processors;
- circumstances that may delay, restrict, reject or require human review.

The interface cannot treat a hidden link, preselected optional consent or
continued use after an undisclosed change as sufficient evidence.

## Consent and acknowledgement

Consent and acknowledgement records contain:

```text
customer_reference:
journey_id_and_version:
document_and_term_digests:
purpose:
required_or_optional:
locale:
presented_at_utc:
acted_at_utc:
actor_and_session:
interface_release:
withdrawal_or_supersession_reference:
```

- Required terms, privacy choices and marketing consent remain separate.
- Optional consent is not bundled with access to an unrelated necessary service.
- Withdrawal is as clear as granting consent where withdrawal is applicable.
- Acknowledgement proves presentation and action; it does not prove legal
  validity, comprehension or suitability by itself.
- A changed digest, locale, journey or customer context requires a fresh policy
  evaluation rather than reuse of stale evidence.

## Quotes, rates, fees and confirmation

Before a customer can commit to an approved financial operation, the interface
must bind the confirmation to:

```text
quote_id:
customer_and_session:
operation:
give_asset_and_amount:
receive_asset_and_amount:
price_source_reference:
rate:
spread:
platform_fees:
provider_or_network_fee_treatment:
total_customer_effect:
created_at_utc:
expires_at_utc:
limit_and_policy_reference:
```

Required behavior:

1. quote and fee values use exact decimal rules and approved rounding;
2. zero, included, estimated and externally variable fees are visibly distinct;
3. expiry is enforced by the server and cannot be extended by a stale client;
4. execution cannot substitute an unapproved price, asset, network or destination;
5. any permitted variance or requote behavior is approved and shown before commitment;
6. confirmation evidence identifies the exact quote and policy accepted;
7. final records reconcile the quote, ledger, provider, settlement and customer-visible result;
8. a missing price, fee, limit or reconciliation dependency rejects the operation.

“Free,” “instant,” “guaranteed,” “best,” “final” and similar claims require
specific Legal/Product approval and objective evidence for the exact scope.

## Status, receipts and customer history

Customer-visible states map to approved domain states. The UI cannot collapse
materially different states such as:

- accepted versus submitted to a provider;
- observed versus confirmed;
- pending versus held for review;
- settled versus provisionally credited;
- failed versus reversed;
- cancelled versus expired;
- restricted versus permanently closed.

Receipts and history show the approved material facts, timestamps, amounts,
fees, asset/network, counterparty or destination representation, references and
current status. They do not expose internal risk rules, other customers, secret
identifiers or provider payloads.

A provider callback, blockchain observation or support note cannot directly
rewrite final customer history. Changes flow through authenticated,
idempotent, reconciled domain transitions with immutable evidence.

## Eligibility, restrictions and adverse outcomes

Eligibility and restriction controls are deny-by-default and bound to approved
policy. An adverse-outcome record includes:

```text
decision_reference:
customer_and_case:
affected_product_or_operation:
policy_version:
material_evidence_references:
reason_category:
decision_authority:
decided_at_utc:
customer_notice_reference:
review_or_appeal_path:
expiry_or_review_at_utc:
```

- The authorized human or deterministic policy remains identifiable.
- Notices use an approved reason category and disclose only what Legal,
  Compliance, Security and investigation integrity permit.
- Temporary restrictions have scope, review time and owner.
- A customer can reach the approved review route without using an unofficial channel.
- Reversal, release or closure cannot erase the original decision and evidence.
- A support agent, provider or AI cannot invent, hide, extend or remove a restriction.

Exact notice, appeal and disclosure obligations require Legal/MLRO approval.

## Complaints and review

Potential complaints are recognized from any approved inbound channel and
cannot be downgraded merely because the customer did not use a particular word.
A complaint case records:

```text
complaint_id:
customer_reference:
received_channel:
received_at_utc:
product_and_operation_references:
category_and_severity:
acknowledgement_due_at_utc:
response_due_at_utc:
owner:
independent_reviewer:
evidence_manifest:
interim_communications:
outcome:
remediation_reference:
closed_by:
closed_at_utc:
```

The approved complaint policy defines:

- intake channels, authentication and accessibility;
- acknowledgement, update, response and escalation timeframes;
- ownership, independence and conflict management;
- evidence preservation and provider cooperation;
- links to disputes, AML cases, incidents and legal holds;
- response content and language;
- review, appeal, ombudsman or regulator routes where applicable;
- root-cause, recurrence and remediation tracking.

Closing a support ticket does not close a complaint. A provider’s conclusion,
AI summary or elapsed timer is not authority to reject or close the case.

## Errors, disputes and remediation

An error or dispute is linked to the original customer instruction, quote,
authorization, ledger effect, provider evidence and communications. The system
must distinguish at least:

- customer input error;
- unauthorized or disputed action;
- duplicate, omitted or incorrect ledger effect;
- provider or network failure;
- delayed or mismatched settlement;
- incorrect fee, rate or disclosure;
- availability or status communication failure;
- privacy, identity or support handling failure.

Remediation requires named authority, exact scope, financial and compliance
review where affected, maker-checker separation, immutable evidence and
post-action reconciliation. It uses approved reversal, compensating-entry,
refund, retry or non-financial correction mechanisms; it never rewrites
accepted ledger or audit history.

Exact liability, refund, compensation, chargeback and reporting rules remain
Legal/Finance decisions and are not inferred from this baseline.

## Support and secure communications

- Approved support channels and sender identities are published and monitored.
- Support authenticates the customer proportionately without requesting
  passwords, recovery phrases, private keys, one-time codes or remote-control access.
- Operators see only the data and actions required for their role and case.
- High-risk profile, destination, credential, withdrawal or restriction changes
  require the approved step-up and maker-checker path outside ordinary chat.
- Every material promise, instruction, evidence view and case transition is audited.
- Attachments and links are scanned, classified and isolated from privileged tools.
- Outbound messages bind to approved templates, case state and delivery evidence.
- Failed delivery, language mismatch and inaccessible format create tracked exceptions.

Support cannot make a customer “whole” through an unrecorded manual balance
edit, provider-console action, credential reset or custody transaction.

## Vulnerability, accessibility and language

The design must identify and support approved needs without creating
unnecessary sensitive profiles or discriminatory outcomes. Controls consider:

- accessible navigation, text, contrast, authentication and document formats;
- approved languages and qualified translation;
- comprehension difficulty, digital exclusion and assisted-service needs;
- coercion, scam, account-takeover and financial-abuse indicators;
- trusted or authorized representatives with verified scope;
- additional time, channel or human-review options;
- testing by representative users and assistive technologies.

Vulnerability signals are purpose-limited, access controlled and never used as
an unapproved marketing or pricing category. A request for assistance does not
silently reduce security or transfer decision authority.

## Promotions and product claims

Before publication, a promotion or customer-facing claim has:

- accountable Product owner and Legal/Compliance approval;
- exact product, audience, geography, channel and validity period;
- evidence for rates, costs, speed, availability, rewards and risk comparisons;
- balanced and prominent material conditions;
- approval of affiliates, influencers, referral and provider wording;
- withdrawal and correction capability across every channel;
- archived creative, target criteria, approval and publication evidence.

An approved promotion cannot expand executable product scope. Referral,
reward, loyalty and incentive mechanics require separate financial, AML, tax,
accounting and abuse controls before implementation.

## Data, personalization and AI

- Customer data follows the proposed data-lifecycle and access-control baselines.
- Personalization, segmentation and experimentation require approved purpose,
  fields, outcome monitoring and an ability to stop.
- Dark patterns, fabricated urgency, obstructive cancellation and hidden defaults are prohibited.
- AI output is visibly advisory to the authorized operator where it influences a case.
- AI cannot decide eligibility, restriction, complaint outcome, remediation,
  disclosure adequacy or final customer communication.
- The reviewer can inspect canonical evidence, reject the proposal and record
  an independent reason.

## Third parties

Customer protection obligations remain owned internally when a bank, issuer,
liquidity venue, KYC/KYT service, blockchain service, support vendor or other
provider performs part of the journey.

Contracts and operating evidence cover:

- approved claims, disclosures and customer handoffs;
- authentication and instruction integrity;
- status, receipt and reconciliation semantics;
- support, complaint, dispute and error cooperation;
- accessibility and language dependencies;
- incident, outage and customer-communication responsibilities;
- data location, retention, deletion and evidence export;
- exit, migration and unresolved-case continuity.

Provider dashboards and service-level reports are evidence inputs, not proof
that each customer received the correct outcome.

## Monitoring and assurance

Monitoring is segmented by approved product, journey, language, channel and
customer cohort where lawful and useful. It covers:

- failed, abandoned and repeatedly retried journeys;
- quote expiry, price/fee mismatch and execution variance;
- delayed, contradictory or stale customer statuses;
- restrictions, review time and overturned outcomes;
- support authentication failures and unauthorized-action attempts;
- complaint volumes, deadlines, outcomes, recurrence and remediation;
- accessibility, delivery and language failures;
- provider-caused errors and unresolved dependencies;
- operator overrides and AI acceptance/rejection patterns;
- promotions, referrals and unexpected customer harm.

Thresholds create review, suspension or escalation under approved policy; they
do not authorize automatic adverse decisions or hidden changes to customer
terms.

Periodic assurance samples the complete path from disclosure and instruction
through ledger/provider evidence, customer receipt, support, complaint and any
remediation. Critical findings block expansion or release.

## Audit evidence

Evidence must reconstruct:

- applicable journey, policy, disclosure and interface versions;
- authenticated customer/session and approved representative scope;
- terms presented and customer action;
- quote, fees, limits, instruction and confirmation;
- authorization, policy and human decisions;
- ledger, provider, settlement and status transitions;
- notices, support, complaint and review communications;
- errors, remediation, reconciliation and final customer-visible outcome;
- release, provider and operator identities involved.

Evidence is minimized and retained under approved lifecycle policy. It does not
copy secrets, private keys, unnecessary provider payloads or unrestricted
customer data into tickets, logs or analytics.

## Approval dependencies

Production customer journeys remain blocked until:

- D-001, D-002 and every affected D-004…D-014 scope decision is approved;
- customer types, jurisdictions, assets, rails, limits and exclusions are approved;
- disclosures, consent, fees, quotes, status semantics and receipts are approved;
- restriction, notice, review and appeal policy is approved;
- complaint, dispute, error, refund and remediation policy is approved;
- accessibility, language, vulnerability and representative-access controls are tested;
- support identity, authentication, access and escalation controls are approved;
- provider responsibilities, data flows and exit paths are approved;
- monitoring, assurance and customer-impact incident exercises are complete;
- Legal, MLRO/Compliance, Product, Finance, Security and affected domain owners approve the exact journey release.

## Production stop conditions

The journey is `NO-GO` when:

1. its customer, jurisdiction, product, asset, rail or legal scope is unknown;
2. a material term, fee, rate, risk or provider dependency is absent or stale;
3. customer commitment is not bound to the presented quote and terms;
4. execution can exceed the approved instruction, quote, fee, limit or destination;
5. customer-visible status cannot be reconciled to canonical evidence;
6. a restriction lacks authority, reason evidence, review time or approved recourse;
7. support can bypass authentication, maker-checker, ledger or custody controls;
8. complaint, dispute, error or remediation ownership and deadlines are undefined;
9. accessibility, language or vulnerability controls are untested for the scope;
10. a provider can change customer outcomes without internal reconciliation;
11. AI or an unauthorized operator can issue a final customer-impacting decision;
12. monitoring cannot identify affected customers and withdraw the journey safely;
13. a critical/high legal, compliance, financial, security or customer-harm finding is unresolved;
14. any required approval is missing, expired or bound to another journey version.

Approval of this baseline confirms only the control design. It does not approve
a product, customer, jurisdiction, fee, provider, promotion, financial
operation, customer-data processing activity or production launch.
