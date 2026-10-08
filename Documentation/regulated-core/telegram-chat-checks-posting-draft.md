# Telegram Checks — Proposed Posting and Reconciliation Draft

- Status: Proposed
- Production effect: none

## Purpose

This draft records the proposed ledger chart addition, posting rules and
reconciliation model for the in-chat Telegram checks described in
[telegram-chat-checks.md](telegram-chat-checks.md). It is material for Finance
review only: nothing here is added to `packages/financial-core`, no account or
posting rule is created, and no check moves funds. Every entry below requires
written Finance review together with the open product and compliance questions
in the parent plan before any code exists.

Conventions mirror `packages/financial-core/chart-of-accounts.json` and
`posting-rules.json` (both `draft`, `dev-dry-run`, execution disabled).

## Proposed chart addition

One new liability account definition, in the same shape as existing entries:

| Field | Proposed value | Notes for Finance |
|---|---|---|
| code | `CHECKS_OUTSTANDING_LIABILITY` | Follows the existing `*_LIABILITY` naming pattern |
| category | `customer` | Same category as `CUSTOMER_SETTLED_LIABILITY`; the obligation is to customers |
| account_class | `LIABILITY` | Funds held for unclaimed checks are owed to customers |
| normal_side | `CREDIT` | Liability increases on credit, matching `CUSTOMER_SETTLED_LIABILITY` |
| owner_scope | `required` | Proposed owner: the check reference, so each open check maps to exactly one owner partition; see open question Q1 |
| purpose | Outstanding amount reserved by one unclaimed in-chat check for one asset | Mirrors existing purpose phrasing |

## Proposed posting rules

Each transition in the check lifecycle maps to one balanced journal. Amounts
are exact decimal strings in the asset scale; every journal is idempotent,
keyed by check ID plus command ID so Telegram retries and double taps cannot
post twice.

| Journal type (proposed) | Debit | Credit | Trigger |
|---|---|---|---|
| `CHECK_CREATE` | `CUSTOMER_SETTLED_LIABILITY` (sender) | `CHECKS_OUTSTANDING_LIABILITY` (check) | Sender confirms the check after step-up; amount leaves the sender's available balance |
| `CHECK_CREATE_FEE` | `CUSTOMER_SETTLED_LIABILITY` (sender) | `FEE_REVENUE` | Optional fee leg in the same journal as `CHECK_CREATE`; zero-fee configs omit the leg |
| `CHECK_CLAIM` | `CHECKS_OUTSTANDING_LIABILITY` (check) | `CUSTOMER_SETTLED_LIABILITY` (recipient) | Verified recipient claims; personal checks only while bearer and multi-claim stay excluded |
| `CHECK_CANCEL` | `CHECKS_OUTSTANDING_LIABILITY` (check) | `CUSTOMER_SETTLED_LIABILITY` (sender) | Sender cancels an unclaimed check; full outstanding amount returns |
| `CHECK_EXPIRY` | `CHECKS_OUTSTANDING_LIABILITY` (check) | `CUSTOMER_SETTLED_LIABILITY` (sender) | Check passes its expiry unclaimed; full outstanding amount returns |

Notes for Finance review:

- No treasury, custody or provider leg exists in any check journal: checks are
  internal transfers between two customer liabilities, so platform assets never
  move. This keeps the feature inside the existing segregation model.
- Every journal balances per asset; a claim or cancel journal touches exactly
  one check owner partition, so a partial claim leaves a recorded remainder —
  partial claims are out of V1 scope, which keeps each partition single-use.
- `CHECK_CREATE_FEE` posts into `FEE_REVENUE` only under a posting rule with an
  explicit fee parameter; until a fee policy exists the proposed default is no
  fee leg.
- Proposed actor allowance: the checks service identity only, never a customer
  or operator actor directly, matching how `allowed_actor_types` is used in the
  current registry.

## Reconciliation model

`CHECKS_OUTSTANDING_LIABILITY` must equal the sum of open check amounts at all
times. Proposed daily (at minimum) reconciliation, before any production
enablement:

```sql
SELECT asset,
       SUM(CASE WHEN state IN ('CREATED', 'AWAITING_RECIPIENT_KYC')
                THEN amount ELSE 0 END) AS open_check_amount
FROM checks
GROUP BY asset;
```

compared against the ledger projection:

```sql
SELECT asset, SUM(balance) AS outstanding_balance
FROM ledger_account_projection
WHERE definition_code = 'CHECKS_OUTSTANDING_LIABILITY'
GROUP BY asset;
```

- Any mismatch freezes check creation until a human resolves the difference,
  matching the stop condition in the parent plan.
- A partition-level variant (per check owner) isolates which check drifted:
  each open check has exactly one partition equal to its amount, and each
  claimed, cancelled or expired check leaves its partition at zero.
- Reconciliation evidence goes to the audit record: run timestamp, compared
  totals, difference, and the resolving incident or correction reference.

## Open questions for Finance

| ID | Question | Current proposal |
|---|---|---|
| Q1 | Owner of `CHECKS_OUTSTANDING_LIABILITY`: per check or per sender | Per check (1:1 reconciliation); per-sender hides individual checks |
| Q2 | Whether create/cancel may charge a fee and under which rule | No fee in V1 unless a separate limit and fee policy exists |
| Q3 | Journal-type naming against the existing `*_POSITION`-style registry | `CHECK_*` names above; final names follow the registry review |
| Q4 | Whether expiry uses the same journal type as cancel or a distinct one | Distinct `CHECK_EXPIRY`, so returns caused by time are auditable apart from sender action |

## Relationship to existing gates

- This draft changes no chart or registry file and requests no status change;
  it is a review input for the Finance track recorded in the parent plan.
- Execution stays impossible until the parent plan's own gates clear; this
  document alone does not satisfy them.
