# In-Chat Crypto Checks in Telegram — Proposed

- Status: Proposed
- Scope: customer-to-customer crypto checks that a SOLID customer creates and sends from any Telegram chat through the bot inline mode (`@bot amount`), and that the recipient claims inside the chat or the Mini App
- Owners: Product / CTO / Compliance
- Required approvers: Legal, MLRO/Compliance, Finance, Security, CTO and Product
- Production effect: none

## Purpose

The business owner asked to add in-chat checks similar to existing Telegram
crypto wallets: the sender types the bot name in any dialog, chooses an amount,
and sends a ready check; the recipient sees it in the chat and claims it with
one tap. The goal is fast payments between people (returning a debt, sending a
gift, splitting a bill) without leaving the conversation.

This plan records the product flow, the financial, compliance and security
controls, and the delivery phases. It does not enable money movement, create
ledger postings, change D-001, D-014 or D-019, or connect a production bot.
D-019 stays `Open` until Legal and MLRO record a decision with the evidence
listed below. Until then checks exist only as dev-only synthetic contracts and
simulators with no execution path.

Related controls are defined by the [decision register](decision-register.md),
[product/risk matrix](product-risk-matrix.md),
[compliance operations](compliance-operations.md),
[customer protection](customer-protection.md),
[safeguarding](safeguarding.md), [threat model](threat-model.md),
[access-control](access-control.md), [audit-evidence](audit-evidence.md) and
[data lifecycle](data-lifecycle.md).

## Customer flow

1. The sender types `@bot 25 USDT` (optionally with a comment) in any Telegram chat.
2. The bot answers the inline query with a preview card: amount, asset, fee, expiry and the recipient rule. No money is reserved yet.
3. When the sender picks the card, the bot asks for confirmation in the bot or Mini App with step-up (Telegram session plus SOLID PIN or biometric). Only after that confirmation is the amount moved from the sender's available balance to the outstanding-checks account.
4. The chat receives a message with the check and a single `Claim` button that opens the Mini App through a deep link carrying an opaque claim reference.
5. The recipient opens the Mini App, signs in, passes KYC if needed and claims. The amount is credited to the recipient's SOLID balance inside the ledger; there is no on-chain transfer.
6. Unclaimed checks expire (proposed default 72 hours) and the amount returns to the sender. The sender can cancel an unclaimed check at any time.

Proposed check types:

| Type | Who can claim | Risk | V1 proposal |
|---|---|---|---|
| Personal | Only the Telegram user the sender picked, verified against the server-side Telegram identity at claim time | Lower | Default |
| Bearer | First verified customer who opens the link | High: anyone who sees the message can claim; AML bearer-instrument risk | Excluded until MLRO review |
| Multi-claim (giveaway) | First N verified customers, fixed share each | High: structuring and bonus-abuse risk | Out of V1 |

## Financial model

- Checks are internal transfers between SOLID customers recorded in the immutable double-entry ledger. No on-chain transaction, HSM signature or custody movement is needed for create, claim, cancel or expiry.
- Proposed posting rules for Finance review:
  - create: `customer_available(sender)` → `checks_outstanding` (amount) and `customer_available(sender)` → `fee_revenue` (fee, if any);
  - claim: `checks_outstanding` → `customer_available(recipient)`;
  - cancel or expiry: `checks_outstanding` → `customer_available(sender)`.
- `checks_outstanding` is a customer liability account. Its balance must equal the sum of open checks and is reconciled at least daily.
- Amounts are exact decimal strings in the asset scale; no floating point anywhere in the path.
- Every state change is idempotent, keyed by check ID and command ID, so Telegram retries or double taps cannot claim or refund twice.
- New accounts and posting rules need Finance review and a deliberate chart-of-accounts change; until then they do not exist in `packages/financial-core`.

## Compliance controls

- Both sender and recipient must be KYC-verified SOLID customers before any amount moves. An unverified recipient sees the check, but claiming waits for KYC; expiry still returns the funds to the sender.
- Sanctions and PEP screening of both parties at create and claim time.
- Limits per check, per day and per month for creating and claiming, by verification tier, under D-014. Missing limits mean the feature is off, never unlimited.
- Transaction monitoring rules for checks: many small checks to one recipient, circular sending, rapid create-claim-withdraw chains, new accounts receiving many checks, and claims from unusual locations or devices.
- Travel Rule or equivalent originator/beneficiary data is kept for every check, because both parties are known customers.
- Checks cannot be bought with cards or claimed directly to an external address in V1.
- Provider and AI output is advisory only; AI has no authority to create, release, refund or block a check.

## Security controls

- Bot updates arrive only by webhook with the Telegram secret-token header verified in constant time; polling and unverified updates are rejected.
- Inline query results never move money and never contain the claim secret. The claim reference in the button is a high-entropy random value; the server stores only its hash.
- Claiming requires a verified Mini App session (`initData` HMAC) and, for personal checks, an exact match of the server-side Telegram user ID. Display names and usernames are never used for matching.
- Rate limits on inline queries, check creation and claim attempts per user, per device and per check; repeated wrong claims lock the check for review.
- Step-up for creation above a low threshold and for every cancellation that would refund to a different account.
- Check messages show only amount, asset and expiry. They never show balances, customer IDs, KYC state or the recipient's details.
- Every create, claim, cancel, expiry and failed claim writes an append-only audit event.

## Customer protection

- Clear disclosure before sending: amount, fee, expiry, who can claim, and that a forwarded bearer check can be claimed by someone else.
- A sent check can be cancelled until claimed; a claimed check cannot be reversed by the sender and goes through the complaint path.
- Statuses visible to both parties: created, waiting for recipient KYC, claimed, cancelled, expired.
- Support can see check history but cannot move funds outside the maker-checker path.
- The amount shown in a Telegram chat is visible to everyone in that chat; customers are told this before the first send.

## Data and privacy

- Telegram user IDs, chat context and check comments are personal data and follow the [data lifecycle](data-lifecycle.md) rules.
- The bot does not store chat contents beyond the inline query text needed to build the preview.
- Check comments are length-limited, screened for prohibited content and never used for compliance decisions without human review.

## Delivery phases

| Phase | Content | Exit gate |
|---|---|---|
| 0. Decision | Legal and MLRO assess whether in-chat customer-to-customer transfers and bearer checks fit the licence scope; D-019 decision; limits under D-014 | Written legal memo, AML risk assessment and D-019 record |
| 1. Dev-only simulation | API contract for checks, deterministic bot inline-query simulator, Mini App claim screen with execution disabled, draft posting rules for Finance | Contract and simulator tests in CI; no ledger postings |
| 2. Synthetic end-to-end | Dev bot against a Bot API simulator, ledger postings in a synthetic database, reconciliation of `checks_outstanding`, monitoring rules on synthetic data | e2e tests, reconciliation report, security review of the bot webhook |
| 3. Pilot | Personal checks only, low limits, invited verified customers, production bot behind a feature flag | Release authorization, incident drill and MLRO review of pilot monitoring |
| 4. Scale-up | Higher limits; bearer or multi-claim checks only after a separate MLRO review | Each change goes through release authorization |

## Engineering work possible now

Within the current dev-only boundary:

- check contract in `packages/api-contracts` (create preview, claim, cancel, status) with deny-by-default and no execution route;
- a deterministic check simulator in `packages/provider-simulators` style, with no I/O, clock or randomness;
- a dev-only inline-query handler in the Mini App BFF that answers with preview cards from the simulator and never reserves funds;
- a Mini App claim screen and backoffice check queue on synthetic data, with financial buttons disabled;
- proposed posting rules and reconciliation queries as documents for Finance review.

## Stop conditions

- No check moves real funds before D-019, D-014 and the Phase 3 exit gate.
- No bearer or multi-claim checks without a separate MLRO decision.
- No claim by an unverified, sanctioned or restricted customer.
- Any mismatch between `checks_outstanding` and open checks freezes check creation.
- Any open high or critical security finding on the bot webhook or claim path blocks the next phase.

## Open decisions

| Decision | Owner | Current state |
|---|---|---|
| D-019 in-chat customer-to-customer checks and allowed check types | Legal + MLRO + Product | Open |
| Limits, fees and expiry per verification tier (part of D-014) | Product + Compliance + Risk | Open |
| `checks_outstanding` account and posting rules | Finance + Financial Core | Open |
| Whether unverified recipients may hold a pending claim | MLRO + Legal | Open |
