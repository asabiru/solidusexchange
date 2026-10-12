# Docs Drift Audit — Wave 78 — Proposed

- Status: Proposed
- Scope: the normative compliance pack under `Documentation/regulated-core/` — README.md, threat-model.md, decision-register.md, `adr/` (0001–0003), safeguarding.md, customer-protection.md, compliance-operations.md, data-classification-register.md, data-lifecycle.md, operational-resilience.md, release-authorization.md, migration-boundary.md, hsm-custody-program.md, access-control.md, ai-governance.md, incident-response.md, third-party-risk.md, product-risk-matrix.md, vendor-scorecards.md, audit-evidence.md, phase-0-evidence-index.md — verified against the code, contract, config and CI the claims point at. Out of scope (not audited): the finance-ledger pack, `legacy-inventory.md`, `telegram-chat-checks*.md` and the wave-audit reports in the same directory.
- Production effect: none

Method: extracted every normative claim — statements about what the code does, guarantees, invariants, mechanisms, enum values, endpoint names, limits, TTLs, file paths, checker names, migration numbers and `D-###` cross-references — skipping statements explicitly marked as roadmap/future. Each claim was checked against the current code, api-contracts spec, policy JSON, workflow files and CI checkers. Classification: `verified` / `stale` (was true, code moved) / `wrong` (never matched) / `unverifiable-by-code` (organizational or legal commitment). Counts treat each independently checkable statement as one claim.

## Claims verified (counts per document)

| Document | Extracted | Verified | Stale | Wrong | Unverifiable by code |
|---|---|---|---|---|---|
| README.md | 10 | 5 | 1 | 0 | 4 |
| decision-register.md | 14 | 4 | 0 | 0 | 10 |
| threat-model.md | 41 | 18 | 1 | 0 | 22 |
| adr/0001-isolate-regulated-core-from-legacy.md | 9 | 3 | 0 | 0 | 6 |
| adr/0002-ledger-is-financial-source-of-truth.md | 12 | 4 | 0 | 0 | 8 |
| adr/0003-isolate-custody-signing-boundary.md | 10 | 2 | 0 | 0 | 8 |
| safeguarding.md | 37 | 1 | 1 | 0 | 35 |
| customer-protection.md | 43 | 2 | 1 | 0 | 40 |
| compliance-operations.md | 46 | 1 | 0 | 0 | 45 |
| data-classification-register.md | 32 | 2 | 0 | 0 | 30 |
| data-lifecycle.md | 33 | 2 | 1 | 0 | 30 |
| operational-resilience.md | 32 | 2 | 0 | 0 | 30 |
| release-authorization.md | 44 | 3 | 1 | 0 | 40 |
| migration-boundary.md | 36 | 1 | 0 | 0 | 35 |
| hsm-custody-program.md | 42 | 2 | 0 | 0 | 40 |
| access-control.md | 37 | 2 | 0 | 0 | 35 |
| ai-governance.md | 31 | 1 | 0 | 0 | 30 |
| incident-response.md | 38 | 2 | 1 | 0 | 35 |
| third-party-risk.md | 39 | 2 | 2 | 0 | 35 |
| product-risk-matrix.md | 24 | 4 | 0 | 0 | 20 |
| vendor-scorecards.md | 15 | 0 | 0 | 0 | 15 |
| audit-evidence.md | 39 | 3 | 1 | 0 | 35 |
| phase-0-evidence-index.md | 18 | 6 | 2 | 0 | 10 |
| **Total** | **682** | **72** | **12** | **0** | **598** |

Verified spot list: the `dev-dry-run` boundary (`backoffice/src/server/config.ts` refuses other modes; `custody-policy.json` pins `runtime_boundary`), `deploy.yml` is manual-dispatch, SHA-pinned SSH steps, no financial execution (matches release-authorization's current-boundary section), the dev-synthetic draft reports catalog (`backoffice/src/server/reports.ts` has exactly `kyc-queue-daily`, `aml-kyt-alerts` and the maker-checker report with `status: "draft"`, `not_for_submission: true`, `environment: "dev-synthetic"` and `report.viewed`/`report.exported` audit actions — matches compliance-operations), OIDC PKCE `S256` + `RS256`/`kid`/claims verification in `backoffice/src/server/oidc.ts` (threat-model TM-03/TM-04), custody policy asset/network allowlist and maker-checker TTL bounds in `packages/custody-core` (hsm-custody-program current-state section), no signer client anywhere (incident-response current-state claim), workflow SHA/digest pinning enforced by `check-workflow-policy.mjs` (TM-17), the `365a653…` baseline commit exists, decision register carries D-001 through D-019 with D-012 the only row past `Proposed`/`Open` (consistent with ai-governance's D-012 dependency), and every internal `.md` link in the pack resolves.

## Corrections made

All twelve corrections are one drift class: whole-register dependency enumerations were written when D-018 was the latest entry; D-019 (in-chat crypto checks) landed later — the register, `telegram-chat-checks.md`, the product-risk-matrix row and the phase-0 row were updated, but the dependency ranges in ten documents were not. Every enumeration was widened to include D-019; the pinned status-baseline rows were recomputed to match the new text (11 fields, no pins lowered). No code changes — the register is the truth source and the docs drifted, not the code.

| Document | Line | Claim | Evidence | Resolution |
|---|---|---|---|---|
| README.md | 17 | artifacts table: register coverage ended at D-018 | register contains D-019 | range widened to D-001…D-019 |
| phase-0-evidence-index.md | 9 | register row: whole-register range ended at D-018 | register contains D-019 | range widened to D-001…D-019 |
| phase-0-evidence-index.md | 22 | third-party row pending-range ended at D-018 | register contains D-019 | range widened to D-001…D-019 |
| threat-model.md | 159 | stop condition: whole-register dependency range ended at D-018 | register contains D-019 | widened to D-019 |
| data-lifecycle.md | 303 | dependency gate: whole-register range ended at D-018 | register contains D-019 | widened to D-019 |
| release-authorization.md | 234 | NO-GO condition: whole-register range ended at D-018 | register contains D-019 | widened to D-019 |
| third-party-risk.md | 17 | scope disclaimer: open-items range ended at D-018 | register contains D-019 | widened to D-019 |
| third-party-risk.md | 343 | dependency gate: applicable-decisions range ended at D-018 | register contains D-019 | widened to D-019 |
| audit-evidence.md | 302 | dependency gate: applicable-decisions range ended at D-018 | register contains D-019 | widened to D-019 |
| customer-protection.md | 422 | scope-decision enumeration ended at the D-004…D-014 cluster | D-019 is an affected scope decision | D-019 appended to the enumeration |
| safeguarding.md | 412 | dependency enumeration ended at D-018 | D-019 custody-adjacent scope applies where applicable | D-019 appended to the enumeration |
| incident-response.md | 263 | dependency enumeration ended at D-018 | D-019 is platform scope | D-019 appended to the enumeration |

## Unverifiable-by-code claims (listed, not touched)

- Personnel and ownership commitments: named owners, deputies, on-call rotas, SLAs, escalation contacts (compliance-operations, incident-response, phase-0 owner cells, vendor-scorecards).
- Legal and regulatory commitments: licensing scope, disclosures, complaint/remediation policy, safeguarding legal model, retention periods and legal bases (customer-protection, safeguarding, data-classification-register, data-lifecycle, compliance-operations, third-party-risk).
- Proposed product scope: product-risk-matrix rows (jurisdictions, rails, customer types, limits), provider and asset proposals, vendor criticality tiers, the HSM asset/curve table (product-risk-matrix, third-party-risk, vendor-scorecards, hsm-custody-program, data-classification-register).
- Future-system requirements: audit-store event envelope, checkpoint key custody, evidence storage, migration mapping and rehearsals, recovery objectives, signer-boundary program items (audit-evidence, migration-boundary, hsm-custody-program, operational-resilience, incident-response).
- Process and governance requirements: review cadences, exercises, scorecard workflow, joiner/mover/leaver lifecycle, AI capability tests, release gate rules (access-control, ai-governance, compliance-operations, third-party-risk, release-authorization, operational-resilience).
- Doc-internal conventions: `Proposed`/`Drafted` semantics, default-deny markers, "not a legal conclusion or production permission" markers, per-row owner/evidence/deadline cells (README, decision-register, every baseline's disclaimer block).

## Observations

- The drift was one mechanism, not many defects: the register grew to D-019 and every document that enumerated the whole register through a range or a list went stale at once. The new `DECISION_RANGE` rule inside `check-regulated-core-status.mjs` now pins any `D-001`-anchored range (`through`, `to`, `…`, dashes) to the register's latest entry — the exact drift class found — with test coverage in `check-regulated-core-status.test.mjs`. This is the natural guard: no heavier lint was needed, and subset enumerations (e.g. customer-protection's `D-004…D-014` scope cluster) are untouched by the rule because they are not `D-001`-anchored ranges.
- No drift was found in any code-checkable mechanism claim — deploy boundary, draft-reports catalog, OIDC/PKCE/RS256 verification, ledger and custody primitives, workflow pinning, asset allowlist and the baseline commit all match the pack verbatim.
- No wrong (never-matched) claims were found; all corrections are the stale class.
- compliance-operations line 393 keeps its generic catch-all ("every affected product/provider decision"), which already covers D-019; untouched.
- `incident-response.md` keeps an infra-focused enumeration; D-019 was appended because the feature is platform scope for incident purposes.
- Pinned baseline bookkeeping: `regulated-core-status-baseline.json` fields recomputed via the checker's own `snapshotDocument` for the seven pinned edited lines (the statusLines, claims and statusTables snapshot fields) — byte-identical to the new doc text.
