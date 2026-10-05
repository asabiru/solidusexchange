# Own HSM Custody Program Plan — Proposed

- Status: Proposed
- Scope: self-operated hardware security module (HSM) custody for future customer and company cryptoassets on TON and TRON, covering architecture, people, ceremonies, facilities, monitoring, recovery, independent assurance and delivery phases
- Owners: CTO / Security / Custody / Treasury
- Required approvers: Legal, MLRO/Compliance, Security, CTO, Finance, Treasury and Custody
- Production effect: none

## Purpose

The business owner asked for a self-operated HSM custody model instead of a
third-party MPC custody provider, with security as the overriding priority and
no pressure to shorten the timeline. This plan describes what must be true
before any customer asset is controlled by keys held in company HSMs.

It does not purchase or provision HSMs, generate or import keys, enable signing
or broadcast, connect mainnet, take custody of customer assets or change D-002
or D-003. D-003 remains `Open` until CTO and Security record a decision with the
evidence listed below. Until then the custody core stays testnet-only with no
execution authority, as defined by
[ADR-0003](adr/0003-isolate-custody-signing-boundary.md).

Related controls are defined by the [decision register](decision-register.md),
[threat model](threat-model.md), [safeguarding](safeguarding.md),
[access-control](access-control.md), [audit-evidence](audit-evidence.md),
[incident-response](incident-response.md),
[operational-resilience](operational-resilience.md),
[third-party risk](third-party-risk.md),
[release-authorization](release-authorization.md) and
[vendor scorecards](vendor-scorecards.md).

## Security objectives

1. No single person, process, host, site or vendor can move customer assets.
2. Private keys never exist in plaintext outside a certified HSM boundary, including during generation, backup, recovery and destruction.
3. Transaction policy is enforced inside the HSM boundary, so a fully compromised application host, administrator account or CI pipeline still cannot obtain a signature for a transaction the human quorum did not consent to.
4. The signer verifies what it signs: the raw transaction is decoded inside the trust boundary and must match the exact intent the quorum reviewed.
5. Loss of any one device, site, custodian or vendor does not lose assets and does not stop recovery beyond the agreed recovery objective.
6. Every key operation produces tamper-evident evidence that an independent auditor can verify.
7. Missing, stale, contradictory or unverifiable evidence fails closed.

## Chains and cryptography

| Chain | Assets in scope | Signature scheme | Notes that drive HSM selection |
|---|---|---|---|
| TON | TON, USDT (jetton) | Ed25519 | Wallet contract version, jetton transfer messages, sequence numbers and expiry must be decoded by the policy module |
| TRON | USDT (TRC-20) | ECDSA over secp256k1 | Signature over the transaction ID (SHA-256 of raw data); native account permissions allow on-chain multi-signature thresholds |

Requirements:

- The HSM must generate, store and use Ed25519 and secp256k1 keys inside the certified boundary with keys marked non-exportable.
- ECDSA signatures must use deterministic nonces (RFC 6979) or an HSM-certified random source, and must be normalized to low-S.
- Vendor support for both curves, for hierarchical derivation and for these algorithms inside the validated mode must be proven in the proof of concept, not taken from marketing material.
- Keys are never reused across chains, curves, wallet tiers or environments.

## HSM selection criteria

Mandatory gates (any failure disqualifies a candidate):

- FIPS 140-3 Level 3 validated module, or Common Criteria EAL4+ against EN 419221-5; the certificate must cover the exact hardware and firmware version that will be deployed.
- Ability to run custom policy code inside the secure boundary (for example vendor firmware extension or secure-execution SDKs), so that quorum, limits, allowlists and transaction decoding are enforced by the HSM itself.
- M-of-N quorum for every administrative and key-management operation using separate physical tokens or smart cards.
- Non-exportable keys, wrapped backup to identical certified devices only, tamper detection with zeroization, and a cryptographically protected, exportable audit log.
- High-availability clustering across two sites without exposing key material.
- Documented secure supply chain: tamper-evident packaging, serial verification and direct vendor shipment.
- Export-control and delivery feasibility for Kyrgyzstan, regional support and firmware security advisories with defined response times.

Candidate families to evaluate (none is selected): Thales Luna, Entrust nShield, Utimaco, Securosys Primus and Marvell LiquidSecurity. Each must pass the gates above in a hands-on proof of concept and a [vendor scorecard](vendor-scorecards.md) evaluation.

Proposed device count: two online HSMs per data-center site for hot and warm tiers (four total), two offline HSMs for cold storage in separate vaults, backup devices, and one non-production lab HSM for development and ceremony rehearsal.

## Wallet tiers

| Tier | Target share of customer assets | Location | Signing mode | Key controls |
|---|---|---|---|---|
| Hot | 2–5% (Treasury to set) | Online HSM cluster, two sites | Automatic within per-transaction, per-customer and daily limits after KYT and policy checks | Limits and velocity counters enforced inside the HSM; refill only by human quorum from warm |
| Warm | 5–15% | Isolated online HSM, separate partition | Human quorum (minimum 2 of 3) with time delay | Destination allowlist, larger limits, refill hot tier only |
| Cold | 80–90% or more | Offline, air-gapped HSMs in two vaults | Scheduled ceremony with 3 of 5 custodians | On-chain multi-signature where the chain supports it, keys split across separate HSMs and sites, 24–72 hour notice |

Customer and company assets use separate wallets and keys, consistent with the [safeguarding](safeguarding.md) baseline.

## Signing architecture

This extends the three trust zones of
[ADR-0003](adr/0003-isolate-custody-signing-boundary.md):

1. **Custody orchestrator** (exists, dev-only): validates intent, policy version, asset/network allowlist, validity window and maker-checker evidence.
2. **Signer gateway**: separate network segment and identity, mutual TLS with HSM-held certificates, takes only an intent digest plus quorum evidence, has no internet access and holds no keys.
3. **HSM policy module** (runs inside the HSM): before producing any signature it verifies
   - quorum signatures from approvers' personal hardware keys over the exact intent digest;
   - role separation (maker, checker and policy administrator are distinct people);
   - limits and velocity counters stored inside the HSM;
   - destination allowlist contained in a policy carrying quorum signatures;
   - independent decoding of the raw transaction: chain, network, asset, amount, destination, fee cap, sequence number and expiry must equal the intent;
   - expiry, nonce and replay protection.
4. **Independent co-verifier**: a second implementation, written by a different person in a different language, re-decodes the resulting transaction and its signature and compares it with the intent before broadcast; any mismatch halts the tier.
5. **Broadcaster**: holds no keys, submits only verified transactions through company-operated TON and TRON nodes, and cross-checks with an independent node provider.

Policy changes (limits, allowlists, quorum members) require a separate quorum of policy administrators, a mandatory time delay and an audit event. Transaction approvers cannot change policy.

## Key hierarchy and addresses

- Separate root keys per chain, tier and environment; production roots are created only in a witnessed ceremony.
- TRON deposit addresses: hierarchical derivation inside the HSM if the device supports it, otherwise pre-generated address pools created in a ceremony.
- TON deposit addresses: hardened-only Ed25519 derivation inside the HSM, or a single wallet with per-customer payment references; the choice is made after the proof of concept.
- Sweeps from deposit addresses to the hot tier follow the same policy path as withdrawals.
- A key inventory register records key identifier, purpose, chain, tier, HSM serial, ceremony identifier and custodians, and never contains key material.

## Roles and people

| Role | Minimum count | Responsibility |
|---|---|---|
| Key custodian | 5 for cold, 3 for warm | Holds one smart card or token share; attends ceremonies |
| HSM security officer | 3 | Device administration under M-of-N quorum |
| Transaction maker / checker | 2 + 2 | Create and independently review withdrawal intents |
| Policy administrator | 3 | Change limits and allowlists under separate quorum |
| Ceremony master | 1 + deputy | Runs the ceremony script, holds no key share |
| Independent witness / auditor | 2 | Observes and attests ceremonies |

Rules:

- No person holds two roles inside the same quorum, and no custodian administers the signing infrastructure.
- Background screening, written confidentiality and custody responsibility agreements, and training before receiving any share.
- Custodians holding a threshold of shares do not travel together; a duress signal and succession plan exist for every role.
- A leaver's shares and tokens are revoked and the affected keys re-shared or rotated within a fixed deadline.
- AI agents, CI pipelines and service accounts never hold any custody role, share, token or quorum vote.

## Key ceremonies

Ceremony types: HSM initialization, root key generation, backup creation, share distribution, recovery, rotation, firmware upgrade and destruction.

Every ceremony:

1. Uses a written script reviewed in advance and rehearsed on the lab HSM.
2. Takes place in a dedicated room with continuous video recording, no personal devices and an attendance log with handwritten signatures.
3. Is observed by two independent witnesses, at least one from an external audit firm for every production root ceremony.
4. Uses an air-gapped ceremony computer built from a verified reproducible image, sealed or destroyed afterwards.
5. Logs every tamper-evident bag and seal serial before and after use.
6. Records hashes of public keys, configuration and logs into the audit evidence store.
7. Aborts and restarts on any deviation from the script.

## Backup and recovery

- Backups exist only as HSM-wrapped blobs restorable to identical certified devices, protected by M-of-N smart cards.
- Backup devices and card sets are kept in at least two geographically separate vaults; no single location holds a restoring threshold.
- No plaintext seed or mnemonic exists for customer keys. If any seed is unavoidable for a chain, it is split with a threshold scheme and stored under the same location rule.
- Recovery is rehearsed quarterly on non-production keys and fully exercised once a year.
- Proposed recovery objectives (to be set in [operational resilience](operational-resilience.md)): hot tier within 4 hours, cold tier within 72 hours, with zero key loss.

## Physical security

- Two data centers with caged racks, dual-control access, biometric entry, CCTV retention of at least 90 days and visitor logs.
- Vaults for cold HSMs and smart cards with dual control and access logs.
- Tamper seals checked and logged at every access; any broken seal triggers an incident.
- Device shipments follow chain-of-custody records from vendor to rack.

## Network, host and software supply chain

- HSMs and signer gateway sit in an isolated network with no internet access and allowlisted flows only.
- Administrative access only through a dedicated jump host under dual control with phishing-resistant MFA.
- Minimal hardened operating systems, immutable images and endpoint detection on every custody host.
- The HSM policy module, signer gateway and co-verifier use reproducible builds, two-person code review, pinned dependencies, a software bill of materials and a code-signing key held in the HSM under quorum.
- No custody code release without the independent code audit described below.

## Monitoring and detection

- HSM audit logs stream to an append-only security monitoring system.
- Alerts on any policy-rejected signing attempt, administrative login, quorum change, tamper event or clock anomaly.
- An independent on-chain watcher observes every company address; any outflow that does not match a recorded intent opens a critical incident and freezes the affected tier automatically.
- Daily reconciliation of on-chain balances against the ledger, consistent with the [safeguarding](safeguarding.md) baseline.

## Incident response

Prepared playbooks, consistent with [incident response](incident-response.md):

- Suspected key compromise: freeze the tier, move remaining assets to pre-generated replacement keys in an emergency ceremony, preserve evidence and start notifications.
- Lost or stolen smart card or token: revoke, re-share and rotate within the fixed deadline.
- HSM tamper or zeroization event, firmware vulnerability, site loss, and suspected insider collusion.
- Emergency freeze can be set by any single security officer; lifting a freeze requires the full quorum.

## Independent assurance plan

| # | Assurance activity | Timing | Performed by |
|---|---|---|---|
| 1 | Architecture and threat-model review of this plan | Before any purchase | Specialized custody security firm |
| 2 | HSM vendor due diligence: certificate scope, firmware, supply chain, support | Before purchase | Security + external reviewer |
| 3 | Source code audit of HSM policy module, signer gateway, co-verifier and orchestrator | Before testnet signing, before mainnet, and for every major change | Independent auditor, two firms for the policy module |
| 4 | Penetration test: network, application, physical and social engineering | Before mainnet, then yearly | Independent tester |
| 5 | Witnessed attestation of every production root ceremony | Each ceremony | External audit firm |
| 6 | Red-team exercise including insider and collusion scenarios | Before raising limits | Independent red team |
| 7 | CryptoCurrency Security Standard (CCSS) assessment, target Level 3 | Before customer funds | Certified CCSS auditor |
| 8 | ISO/IEC 27001 certification and SOC 2 Type II for custody operations | Within 12–18 months of launch | Accredited bodies |
| 9 | Periodic attestation that customer liabilities are fully backed (proof of reserves) | Quarterly | Audit firm |
| 10 | Public bug bounty | After mainnet pilot | Bounty platform |
| 11 | Access reviews, recovery drills, policy review | Quarterly / quarterly / yearly | Security + internal audit |

Every open high or critical finding is a `NO-GO` for the next phase.

Reference frameworks: FIPS 140-3, EN 419221-5, NIST SP 800-57 (key management), NIST SP 800-90A/B (random number generation), ISO/IEC 27001, SOC 2 and CCSS. Applicable Kyrgyz requirements are to be determined by Legal.

## Delivery phases

| Phase | Content | Estimated duration | Exit gate |
|---|---|---|---|
| 0. Decision and design | Legal check of key location and custody licensing, D-002/D-003 decision, independent design review (assurance 1) | 1–2 months | Written decisions and review report with no open high findings |
| 1. Vendor proof of concept | 2–3 candidate vendors on lab HSMs: both curves, in-boundary policy code, clustering, backup, performance | 2–3 months | Scorecards and due diligence (assurance 2) |
| 2. Build on testnet | HSM policy module, signer gateway, co-verifier, watcher, monitoring and runbooks, testnet only | 3–4 months, partly parallel | Test evidence and first code audit (assurance 3) |
| 3. Facilities and people | Data-center racks, vaults, custodians hired and screened, training, ceremony rehearsals | 2–4 months, parallel | Rehearsal records and access evidence |
| 4. Pre-production assurance | Final code audit, penetration test, red team, CCSS assessment | 1–2 months | All high and critical findings closed |
| 5. Production ceremony and pilot | Witnessed root ceremonies, mainnet pilot with company funds and low limits | 1–2 months | Release authorization and incident drills |
| 6. Gradual scale-up | Customer funds under limits raised in steps, ISO/IEC 27001 and SOC 2 programs | Ongoing | Each limit increase goes through release authorization |

Estimated total to the first mainnet pilot: about 8–12 months, running in parallel with licensing and banking work.

Budget is an order-of-magnitude estimate only and requires vendor and auditor quotes: HSM hardware, support and spares are typically in the low to mid hundreds of thousands of US dollars for this device count, independent assurance activities 1–7 a similar range, plus facilities, vaults and dedicated staff.

## Engineering work possible now

Within the current dev-only boundary and without human custody roles:

- Signer interface contract between orchestrator, signer gateway and HSM policy module.
- Reference implementation and tests of the HSM policy rules (quorum, limits, allowlist, intent-to-transaction matching) running outside any HSM.
- Independent TON and TRON transaction decoders for the co-verifier, tested with synthetic testnet transactions.
- Testnet on-chain watcher and reconciliation prototype.
- Draft ceremony scripts, runbooks and the key inventory register template.

Testnet signing with a software HSM simulator is not started until ADR-0003 receives its required decisions; mainnet keys are never generated by engineering or agents.

## Stop conditions

- No production key generation before the Phase 4 exit gate.
- No key material, seed, share or wrapped backup in Git, CI, chat, tickets, developer laptops or agent environments.
- No HSM use for customer assets if the deployed firmware or algorithm is outside the certificate scope.
- Any ceremony deviation aborts the ceremony.
- Any open high or critical assurance finding blocks the next phase.
- Any unexplained on-chain outflow freezes the affected tier.

## Open decisions

| Decision | Owner | Current state |
|---|---|---|
| D-002 custody scope and responsibility for assets | Legal + CTO + Security | Open |
| D-003 HSM/MPC vendor and location; business owner prefers own HSM | CTO + Security | Open |
| Whether keys may be held in a foreign data center and licensing impact | Legal | Open |
| Tier shares, limits and allowlist policy | Treasury + Risk | Open |
| Custodian appointments and screening | HR + Security | Open |
| Budget for hardware, facilities and assurance | Finance + CTO | Open |
