# Regulated Core Threat Model — Proposed

- Status: Proposed
- Scope: contract-only and `dev-dry-run` regulated-core foundation
- Owners: Security / Architecture
- Required approvers: CTO, Security, Financial Core, Compliance
- Production effect: none

## Purpose

This model defines the security boundaries that must hold while SolidChange is separated from the legacy Laravel application. It covers the canonical API contracts, backoffice BFF, financial core, custody orchestrator, migration boundary, provider-adapter boundary and their expected evidence flows.

The repository currently contains synthetic contracts and control evidence. It does not contain an approved production identity plane, provider execution plane, signer gateway, HSM/MPC integration or customer-money runtime. A control marked as planned remains a stop condition, not an accepted risk.

## Security objectives

1. Only authenticated and authorized actors can request a regulated operation.
2. No customer, operator, callback, background job or legacy process can mutate financial truth outside the ledger posting boundary.
3. No process outside the custody signer boundary can obtain signing material or authorize broadcast.
4. Provider responses and callbacks are evidence inputs, never independent settlement authority.
5. Every accepted command is bound to actor, policy, request, idempotency, correlation, approval and audit evidence.
6. Restricted and customer data stays within its approved purpose, location and retention boundary.
7. Recovery preserves exact committed state and never silently rolls the platform back to an incomplete or stale financial position.
8. Missing configuration, evidence, approval or dependency fails closed.

## Assets

| Asset | Security requirement |
|---|---|
| Private keys, mnemonic and signing shares | Must exist only inside the approved HSM/MPC boundary; never Git, CI, chat, logs or general databases |
| Ledger journals, entries and acceptance seals | Append-only, balanced, idempotent, reconstructable and independently reconcilable |
| Custody intents and approval evidence | Immutable, reference-only, policy-bound, time-bound and non-executable outside custody |
| Operator identity, sessions and role mapping | Phishing-resistant production authentication, server-side authorization, short sessions and auditable lifecycle |
| Customer identity, KYC/KYT and bank data | Purpose-limited, encrypted, least-privilege and retained only under approved policy |
| Provider, bank and blockchain evidence | Authenticated, replay-resistant, provenance-bound and reconciled before financial finality |
| Audit events and evidence exports | Append-only, chained, access-controlled and recoverable |
| Migration extracts and mappings | Read-only, checksummed, provenance-bound, minimized and reconciled |
| CI/CD and release evidence | Immutable dependencies, least privilege, protected execution and explicit release approval |

## Trust zones

```text
Untrusted networks and clients
  |
  +-- Customer client --> Customer API / identity
  |
  +-- Operator browser --> Backoffice BFF --> policy / approval / audit
  |
  +-- Provider callbacks --> Callback ingress / adapter verification
                               |
                               v
                       Regulated use cases
                        |       |       |
                        v       v       v
                     Risk    Financial  Custody
                              core      orchestrator
                               |             |
                               v             v
                           PostgreSQL   Signer gateway
                                             |
                                             v
                                           HSM/MPC

Legacy Laravel --> read-only migration / compatibility boundary

CI/CD --> build and evidence only; no signing material or unrestricted
         production identity
```

### Boundary rules

- Customer and operator credentials are not interchangeable.
- The operator browser has no direct database, provider, ledger or signer access.
- The backoffice BFF may expose signed read evidence and non-executable previews only until command-plane approval.
- Legacy Laravel is never a trusted writer to regulated-core ledger or custody tables.
- Provider adapters translate authenticated provider evidence into typed domain input; they do not post balances.
- Financial core owns monetary truth. Workflow records and callbacks do not.
- Custody orchestrator receives opaque destination references, not general-application raw addresses.
- Signer and HSM/MPC zones are absent from the current implementation and therefore cannot be treated as partially enabled.
- CI validates and packages code. It must not hold production private keys, long-lived provider credentials or authority to bypass release gates.

## Threat actors

| Actor | Relevant capability |
|---|---|
| External attacker | Sends malformed requests, steals browser state, replays callbacks, probes public endpoints and dependencies |
| Malicious or compromised customer | Replays commands, changes payloads, abuses limits or attempts identity/account takeover |
| Malicious or compromised operator | Searches restricted records, abuses approval capability, exports evidence or attempts direct execution |
| Compromised provider or callback channel | Sends duplicate, forged, reordered or contradictory status updates |
| Compromised legacy component | Attempts to write regulated state or inject unsafe migration data |
| Compromised workload or dependency | Reads secrets, changes artifacts, forges evidence or calls adjacent trust zones |
| Privileged insider | Misuses database, CI, cloud, signer or recovery access |
| Operational error | Deploys stale configuration, restores stale data, weakens policy or executes an unreviewed migration |

## Threat register

| ID | Threat and abuse path | Current controls and evidence | Residual requirement / stop condition |
|---|---|---|---|
| TM-01 | A client bypasses authentication or crosses customer/operator namespaces | Canonical bearer schemes, exact operation security, separate origins and BFF sessions, deny-by-default capabilities | Approved production identity architecture, token lifecycle, rate limits and penetration test |
| TM-02 | An attacker replays or mutates a command | Canonical request IDs, reserved idempotency contract, immutable digests in financial/custody evidence | Command endpoints remain absent until durable idempotency, expiry and conflict semantics are approved |
| TM-03 | Browser state is stolen or fixed across an OIDC flow | Authorization Code + PKCE, state/nonce, browser-bound transaction cookie, strict session cookie, exact callback origin | Production IdP, phishing-resistant MFA, JML process and D-016 approval |
| TM-04 | A forged, ambiguous or ineligible JWK authorizes an operator session | RS256 allowlist, `kid`, signature and claim checks, issuer/audience/authorized-party/time validation, signing-key use validation | Approved IdP/JWKS rotation, duplicate-key policy, outage behavior and independent security review |
| TM-05 | An operator exceeds assigned capability or self-approves | Server-side role mapping, explicit capabilities, synthetic maker-checker previews and step-up evidence | Durable independent approver identity, segregation-of-duties policy and production MFA |
| TM-06 | A callback or provider response changes a customer balance directly | ADR-0001/0002 prohibit direct balance writes; ledger is the only financial truth | Authenticated callback ingress, replay store, reconciliation and provider-specific approval |
| TM-07 | Duplicate, reordered or contradictory provider events create multiple effects | Domain-event identity/causation contracts and proposed outbox/inbox idempotency | Durable inbox, ordering policy, dispute handling and reconciliation tests per provider |
| TM-08 | A process writes an unbalanced or mutable financial position | Append-only double-entry migrations, acceptance seal, exact posting-rule binding, immutable timestamps and privilege evidence | Finance/CTO/Security approval of the ledger pack before Session D |
| TM-09 | A privileged database identity changes ledger history | Exact ownership/ACL catalogs, unprivileged synthetic runtime role, denied update/delete/truncate and forged-history probes | Approved production roles, credential lifecycle, database audit and break-glass control |
| TM-10 | A recovery uses a corrupt, partial or stale archive | Atomic disposable restores, canonical state snapshots, catalog/history verification, occupied-target and chained-recovery regressions | D-017 RPO/RTO, encrypted backup, retention, restore authorization and independent drills |
| TM-11 | Legacy records or balances are copied without provenance or reconciliation | Read-only migration boundary, checksums, explicit mappings, classification and signed opening-journal requirement | Approved migration environment, Finance reconciliation and cutover go/no-go |
| TM-12 | A migration or restore overwrites newer money movement | Exclusive-writer rollback rule; dual-write money movement prohibited | Cutover runbook, freeze evidence and compensating-operation procedure |
| TM-13 | Raw wallet addresses or signing data escape custody | Reference-only unsigned testnet intent; prohibited fields; signing and broadcast disabled | D-002/D-003, signer gateway design, HSM/MPC review and key ceremony |
| TM-14 | A replayed or altered custody approval authorizes a different withdrawal | Intent, policy and approval digests; maker-checker identities; idempotent outbox evidence | Production approval service, trusted timestamps, durable step-up and signer-side replay protection |
| TM-15 | Custody event is mistaken for settlement or broadcast finality | Custody events have no execution authority and cannot mutate ledger balances | Chain observation, confirmation policy and reconciliation before finality |
| TM-16 | Restricted data leaks through API errors, examples, logs or exports | Canonical client-safe errors, prohibited PII/secret fields, synthetic examples, capability-gated signed exports | Production logging/redaction standard, DLP, field-level authorization and privacy approval |
| TM-17 | A dependency or CI action changes after review | External actions pinned to immutable SHAs, Docker digests, read-only workflow permissions and non-persistent checkout credentials | Protected runners, artifact signing/provenance, dependency review and D-018 approval |
| TM-18 | A compromised CI job reaches production or signing systems | Current workflows hold no production signing material or live provider authority | Workload identity, environment protection, isolated runners and explicit release approval |
| TM-19 | Configuration drift silently weakens boundaries | Exact contract, database catalog, role profile and workflow-policy checks; partial configuration fails startup | Central configuration ownership, signed releases, drift monitoring and rollback evidence |
| TM-20 | Audit evidence is edited, truncated or served from an unverified state | Chained audit events, append-only PostgreSQL evidence, verified snapshots and signed read envelopes | Durable key custody, independent storage/retention and access/export monitoring |
| TM-21 | Service outage causes permissive fallback or duplicate execution | Current regulated commands and providers are disabled; database/configuration checks fail startup | Explicit timeout/retry/circuit policies, queued-command semantics and chaos/recovery tests |
| TM-22 | An AI agent approves or executes a regulated action | D-012 requires human-in-the-loop; current agents and backoffice previews have no execution authority | Capability tests, immutable human approval and monitoring for every production command path |

## Required misuse-case tests before production

The following tests are required in addition to the existing synthetic evidence:

1. Customer credentials cannot access operator operations, and operator credentials cannot impersonate customers.
2. A replayed command with the same idempotency key and changed canonical payload is rejected.
3. Duplicate and out-of-order callbacks cannot create a second ledger effect.
4. Missing risk, limit, approval, audit, ledger or reconciliation evidence blocks execution.
5. Maker and checker identity cannot collapse through role mapping, session reuse or break-glass access.
6. A compromised backoffice browser cannot call ledger, provider or signer networks directly.
7. A stale migration extract, database restore or configuration release is detected before traffic resumes.
8. A signer request with changed destination, amount, network, policy, expiry or approval digest is rejected.
9. Provider, database, audit, identity and signer outages fail closed without losing accepted-command evidence.
10. Restricted fields cannot enter logs, traces, analytics, exports, queues or lower environments.
11. CI artifacts are reproducible, attributable and rejected if provenance or approval is missing.
12. AI-generated output cannot change eligibility, close an AML case, approve money movement or authorize signing.

## Monitoring and detection requirements

Production design must define alerts and accountable response for:

- repeated authentication, PKCE, state, nonce, signature and step-up failures;
- role-map changes, privilege drift and break-glass use;
- idempotency conflicts, callback replays and contradictory provider states;
- ledger imbalance attempts, rejected postings and reconciliation breaks;
- custody approval mismatch, replay and signer-policy rejection;
- audit-chain, migration-history, catalog and recovery-attestation failures;
- secret access, restricted-data export and unexpected data-location changes;
- workflow, dependency, artifact and deployment-policy drift;
- disabled-control or fail-open attempts in every regulated trust zone.

Alerts are evidence, not authorization. Automated response must not move money, sign transactions, close AML cases or make customer-eligibility decisions unless that exact action has separate approved policy and human oversight.

## Production stop conditions

Production execution remains prohibited while any of the following is missing:

- written decisions and evidence for D-001 through the applicable D-018 dependencies;
- approved legal scope, product/risk matrix and data-processing locations;
- Finance/CTO/Security approval of the financial model and ledger pack;
- approved production identity, MFA, staff lifecycle and network-access design;
- provider-specific authentication, callback, reconciliation and outage policy;
- custody responsibility, signer architecture, HSM/MPC vendor and key ceremony;
- production role model, secrets management, runner isolation and release provenance;
- approved backup encryption, retention, RPO/RTO and restore drill;
- independent security assessment and remediation of critical/high findings;
- incident response ownership, escalation and regulatory notification procedure.

Synthetic tests, green CI and a successful dev restore do not satisfy these conditions.

## Evidence map

| Boundary | Repository evidence |
|---|---|
| Architecture and isolation | ADR-0001, migration boundary, legacy inventory |
| Financial truth | ADR-0002, financial-core package, finance ledger approval pack |
| Custody | ADR-0003, custody-core package |
| API and event boundary | api-contracts package and compatibility policy |
| Operator boundary | backoffice package and signed audit/evidence controls |
| Data handling | data classification register |
| Supply chain | workflow policy and pinned CI/deployment actions |
| Incident readiness | incident response baseline |
| Release control | release authorization baseline |
| Decisions and approvals | decision register and Phase 0 evidence index |

## Review rule

Every new production-facing command, provider, data processor or trust-zone connection must:

1. identify affected threat IDs;
2. add or update abuse cases and controls;
3. link executable tests and operational evidence;
4. name the accountable owner and required approvers;
5. retain deny-by-default behavior until approval is immutable and traceable.

Approval of this document confirms the review baseline only. It does not approve production launch, customer data migration, provider credentials, financial execution, custody signing or broadcast.
