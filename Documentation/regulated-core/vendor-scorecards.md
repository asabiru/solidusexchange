# Vendor RFP and Scorecards — Draft

No vendor in this document is approved. Repository adapter presence is not selection evidence.

Scorecards are evidence inputs to the proposed
[third-party risk baseline](third-party-risk.md). A completed scorecard does not
authorize a contract, credential, data transfer or production integration.

## Universal mandatory gates

| Gate | Evidence |
|---|---|
| Legal eligibility and geography | Contractual service scope and legal review |
| Security | Independent assurance, architecture, vulnerability and incident process |
| Data protection | DPA, subprocessors, storage/processing locations, deletion/export |
| Authentication | Strong operator access, scoped API credentials, rotation and audit |
| Availability | SLA, maintenance, status history, support escalation |
| Integration safety | Sandbox, idempotency, signed callbacks, replay handling |
| Reconciliation | Statements/reports, stable IDs, correction and dispute semantics |
| Business continuity | Exit/export plan, outage mode, recovery obligations |
| Commercial | Transparent fees, reserves, limits, termination |

## Weighted score template

| Category | Weight |
|---|---:|
| Legal/compliance fit | 20 |
| Security and access control | 20 |
| Operational resilience | 15 |
| API/callback quality | 15 |
| Reconciliation and reporting | 15 |
| Data governance | 10 |
| Commercial/exit terms | 5 |

Any mandatory-gate failure is disqualifying regardless of weighted score.

## Domain-specific questions

### HSM/MPC/custody

- Supported algorithms/chains and deterministic signing.
- Key generation, quorum, backup, recovery and destruction ceremonies.
- Exportability and vendor lock-in.
- Transaction policy engine and independent approval.
- Attestation, audit logs and emergency stop.

### Bank/RUB/SBP

- Written permission for business model and customer flows.
- Virtual account/reference model and beneficiary data.
- Callback signatures, statement formats and finality.
- Returns, reversals, disputes and frozen funds.
- Settlement timing, reserves and limits.

### KYC/KYT

- Kyrgyzstan document/biometric support and liveness.
- Sanctions/PEP/adverse media coverage and update frequency.
- Explainability, evidence export and manual review.
- False-positive operations and outage behavior.
- Webhook authenticity and event replay.

### Liquidity

- Supported assets/networks, quote TTL and execution model.
- Pre-funding, counterparty exposure and withdrawal controls.
- Order/trade/fee reports and settlement finality.
- Slippage, partial fill, cancellation and outage semantics.

### Card issuer/BIN sponsor

- Approved countries, customer types and card programs.
- KYC/KYB responsibility and decision rights.
- Authorization, clearing, settlement, chargeback and dispute APIs.
- PCI scope, tokenization and card-data boundaries.
- Program shutdown and customer fund protection.

### Cloud/data platform

- Approved region and data residency.
- Private networking, IAM, KMS/HSM and workload identity.
- Database HA, backup immutability and restore testing.
- Audit log export and security monitoring.
- Contractual exit and bulk data export.

## Selection record

Each scorecard must record reviewers, date, evidence links, unresolved exceptions, expiry/review date and final accountable approver.
