# Backoffice frontend audit — wave 71

- Status: Proposed

Adversarial review of the operator presentation layer in `backoffice/src/app/`
and its view-model boundary in `backoffice/src/data/`. This is the same pass
the miniapp frontend received in wave 40 (`miniapp-app-audit-wave40.md`), now
applied to the backoffice screens that grew through waves 56–70 (customers,
KYC/AML/support/audit views, and the subject-360 panel with dossier, timeline,
and balances). Every finding was reproduced as a failing test first, then fixed
in the same change set.

## Defects

1. **`aria-current` bound to row position, not selection** — on all four
   live screens (`OperatorSubjectsView`, `OperatorQueueScreen`,
   `OperatorAmlQueueScreen`, `OperatorTicketQueueScreen`) the predicate was
   `index === 0`, so the first visible row announced itself as current
   regardless of which member was actually selected. Rebound to the selection
   predicate (`row.subjectId === active?.subjectId`, `item.queueId ===
   active?.queueId`).

2. **Dead queue button** — the dashboard priority-queues table rendered an
   inert `button` element inside the queue cell with no `onClick` or submit role: an
   affordance that did nothing and misled keyboard navigation. Removed; the
   cell renders plain text.

3. **Missing empty states** — six tables (dashboard queues, operator
   subjects, provider evidence, the pending approvals table, audit events,
   and report
   tables) had no `colspan` empty row, so an empty feed rendered as a silent
   blank that read as "loading" rather than "no data". Added a `tr`/`td`
   `colSpan` row carrying the shared `empty` state and `common.noMatches`,
   sized to the column count (`Math.max(1, columns.length)` on the generic report
   table). `QueueChart` now returns `null` on an empty queue list instead of
   emitting a degenerate `path` element with negative coordinates.

4. **Silent gap on denied member reads** — the KYC, AML, and ticket queue
   panels treated `detail === null` (adapter rejection) as `null` in the JSX,
   painting nothing where a denied upstream member should produce an explicit
   denied state. All three panels now render the
   `preview-error` alert (`role="alert"`, localized `…detailFailed` copy) when
   the detail read fails, with
   matching `LiveStatus` announcements while loading.

5. **Subject panel falls back to nothing on filter-empty** —
   `OperatorSubjectsView` used `?? null` for the selected row where its
   sibling screens use `?? rows[0] ?? null`; tightening a filter past the
   current selection silently blanked the panel. Aligned to the sibling
   fallback.

6. **Degraded audit feed lacked the shared banner** — `OperatorAuditFeed`
   masked the missing upstream with a bare `Status` warning chip but no
   `DegradedNotice`, and its `actorRole` cell rendered the empty string the
   demo mapper supplies for absent fields. Now shows the same
   `audit.degradedTitle`/`audit.degradedNote` banner as the other degraded
   sections, masks the missing role with an em dash, and renders timestamps
   through the locale `date`/`time` helpers instead of the raw `at` string.

7. **Audit chain chip hardcoded success** — the integrity chip rendered
   `data-tone="success"` and `t("audit.verifiedChain")` unconditionally; a
   `chain.verified === false` chain still claimed "verified". Bound to
   `chain.verified === true ? "success" : "danger"` and the
   `audit.invalid` copy.

8. **Truthy checks on unsigned health flags** — four sites compared
   `health.oidcConfigured`, `health.devLoginEnabled`, and their negated pair
   as truthy booleans, so any non-empty server value (including a hostile
   string) enabled the affordance. All four now compare `=== true`.

9. **Hardcoded Russian error in the data layer** — `client.ts` built the
   `device_not_approved` message as a Russian literal, the only Cyrillic
   string outside the locale catalogs. `ApiError` now carries an optional
   `deviceDigest` field populated from the wire detail; `switchDevRole`
   interpolates it through the localized `access.deviceNotApproved` key, and
   the generic `ApiError` message is locale-neutral.

10. **KYC dossier degraded to "no dossier" on malformed data** —
    `operator.ts` parsed `item.kyc` with `?? null`, mapping a malformed
    (non-null, non-conforming) block to the same "subject has no dossier"
    state as a literal `null`. Restored fail-closed parity with the subject
    detail read: `parseSubjectKyc` returning `undefined` now fails the whole
    detail rather than inventing an empty dossier.

11. **Duplicate-vulnerable React keys** — report-table headers, rows, and
    cells were keyed on raw server text (`key={textOf(column)}`, etc.), so two
    identical labels produced duplicate keys and React reconciliation drift.
    All such keys now carry the index suffix (`${textOf(column)}:${columnIndex}`
    and the same pattern on row/cell/hypothesis/risk-factor/blocker lists).

12. **Live-status gaps** — the four queue-item panels and the subject detail
    panel performed lazy `getOperatorQueueItem`/`getOperatorSubject` reads
    with no `aria-live` announcement, unlike every demo screen. Added
    `LiveStatus` bound to the loading predicate in each panel.

## Verified clean

- **Adapter boundary** — `src/data/*.ts` parsers reject malformed members
  (exact keys, enum membership, canonical decimals/ISO dates, bounded arrays)
  and return `undefined` rather than a corrupted row; the queue-item detail
  parser was already fail-closed for every other member and now covers the
  nullable `kyc` dossier too (defect 10).
- **i18n completeness** — every rendered string goes through `t()`; the AST
  scanner (`uiStringViolations`) confirms no Cyrillic or English literal in
  `src/app` sources after the `device_not_approved` fix (defect 9). All three
  catalogs (ru/en/ky) carry the six new keys with consistent `{digest}` and
  other placeholders.
- **Degrade parity** — the degraded provider/investigation/AML sections
  already render the shared `DegradedNotice` banner and mark demo rows; the
  audit feed now joins them (defect 6). Recovery re-fetches on the next
  poll/remount.
- **Detail-panel binding** — the subject-360 panel binds the lazy read to the
  `subjectId` in a `useEffect` dependency; the `alive` flag drops stale
  responses for previously-selected rows. Queue panels use the same pattern.
- **Role-gated UI** — capability-gated buttons hide uniformly; no render path
  leaks a 403-prone affordance ahead of the check.
- **NaN/undefined leaks** — no `NaN` or literal `undefined` reachable in
  rendered output; the empty-chart path no longer emits negative coordinates.

## Observations

- The `kyc.detailFailed`/`aml.detailFailed`/`support.detailFailed` copy is
  deliberately terse — the panels sit behind the deny-by-default boundary and
  a denied member read is an audit event, not an operator error.
- `access.deviceNotApproved` keeps the operator-facing fingerprint only; the
  localized copy lives in the catalogs so the data layer stays locale-free.
- Report-table keys use index-suffixed text rather than a stable id because
  the wire shape carries no row id; the index keeps reconciliation stable
  within one render.
- The audit-feed `actorRole` mask uses a literal em dash because the field is
  genuinely absent on degraded rows — rendering `textOf` alone would still
  paint an empty cell for `""`.

## Test additions

- `a11y.test.ts` — `aria-current` binds to the selection predicate (not
  `index === 0`); every rendered `button` is operable; queue panels surface
  the `role="alert"` denied state; `LiveStatus` appears in each lazy-read
  panel; `colspan` empty rows appear in every `tbody` except the exempt
  `OperatorSubjectPanel`; the audit chip and `DegradedNotice` regressions;
  unsigned health flags only enable affordances on literal `true`.
- `app-render.test.ts` — serialized markup asserts `colSpan="N"` empty rows,
  no chart `path`/negative coordinates on empty queues, the audit chip
  rejects a failed `verified` chain, the degraded feed masks absent upstream
  fields and shows the shared banner, and hostile health flags expose no
  affordances.
- `server-fields.test.ts` — source pins forbid raw-text `key={...}` shapes on
  server data, the `detail === null ? null` silent-gap pattern, truthy health
  comparisons, and any Cyrillic in `src/data/client.ts`.
- `operator.test.ts` — the queue-item detail parser fails closed on seven
  malformed `kyc` dossier shapes instead of degrading to "no dossier".
- `i18n.test.ts` — the report-table source pin follows the new
  index-suffixed key shape.
