# Data Classification and Processing Register — Draft

Lifecycle controls, approval boundaries and production stop conditions are defined in the proposed [regulated data lifecycle baseline](data-lifecycle.md). This register does not set retention periods or authorize processing.

## Classification

| Class | Examples | Minimum handling |
|---|---|---|
| Restricted | Private keys, mnemonic, signing material, provider secrets, MFA seeds | Dedicated secrets/HSM boundary; never logs, Git, chat or general database |
| Highly confidential | KYC documents, biometrics, sanctions results, bank/account details, exact wallet ownership | Encryption, least privilege, purpose limitation, immutable access audit |
| Confidential | Customer contacts, address, device/session data, transaction history, cases | Encryption, RBAC, retention and export controls |
| Internal | Runbooks, non-public architecture, synthetic test data | Authenticated staff access |
| Public | Approved marketing content, public rates and documentation | Integrity and publishing approval |

## Processing inventory

| Data/process | Source | Target processor/system | Purpose | Owner | Retention/status |
|---|---|---|---|---|---|
| Customer identity | Legacy users / customer app | Identity service | Authentication and customer profile | Product + Security | Open |
| KYC evidence | Customer / KYC provider | Evidence store / customer risk | Verification and regulatory evidence | MLRO + Privacy | Open |
| KYT/AML alerts | Chain/provider/rules | AML cases | Risk review | MLRO | Open |
| Financial journals | Regulated use cases | Ledger | Accounting truth | Finance | Define legal retention |
| Wallet ownership | Custody/indexer | Wallet registry | Deposit/withdrawal control | Custody + Security | Open |
| Bank/payment records | Bank/provider | Settlement/reconciliation | Fiat settlement | Finance | Open |
| Operator activity | Backoffice BFF | Audit store | Accountability and incident evidence | Security | Open |
| Notification data | Platform | Email/SMS/push providers | Transactional communication | Product + Privacy | Open |
| Support data | Customer/operator | Case/support system | Customer service and disputes | Operations | Open |

## Required controls

- Data minimization and purpose binding.
- Field-level access for KYC, bank and custody data.
- Encryption in transit and at rest with managed key ownership.
- Immutable access and export audit.
- Processor/subprocessor and data-location register.
- Retention, legal hold, correction and deletion workflows.
- Non-production masking; no raw production clone for development.
- Evidence digest and provenance for imported records.

## Open privacy decisions

1. Legal basis for each processing purpose.
2. Approved storage and processing countries.
3. KYC document and biometric retention.
4. AML/audit retention and legal hold.
5. Customer access, correction and deletion handling.
6. Processor contracts and cross-border transfer mechanisms.
7. Incident notification responsibilities and time limits.
