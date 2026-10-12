# Mini App frontend audit — wave 73

- Status: Proposed

Adversarial review of the customer presentation layer in `miniapp/src/app/`:
`App.tsx`, the shared sheet infrastructure in `sheets.tsx`, the wave-71/72
sheets (`QuotesSheet`, `TradesSheet`, `OrdersSheet`, `MoneyFlowSheet`,
`ChecksSheet`, `MarketsSheet`, `SupportSheet`), the `api.ts` client glue and
the i18n layer. This is the same pass the backoffice presentation layer
received in `backoffice-frontend-audit-wave71.md` (PR #335), applied to the
miniapp sheets that grew at the same pace without a layer-wide audit. Every
finding was reproduced as a failing test first, then fixed in the same
change set.

## Defects

1. **`format.decimal` threw on untrusted input and trusted hostile scales**
   — `decimal` called `formatDecimal` directly, so a malformed string crashed
   the render path (unlike `money`/`amount`/`rate`, which degrade to "—"), and
   server-supplied `fractionDigits` (e.g. `market.priceScale`) reached
   `formatDecimal` unbounded — a hostile or non-integer value threw or produced
   absurd padding. `decimal` now renders "—" for non-string/malformed input and
   bounds `fractionDigits` to a safe integer in `[0, 30]`.

2. **Quotes timing-state badge frozen at mount** — `nowMs = Date.now()` ran
   once per render, so the indicative/issued/expired badge never ticked while
   the sheet stayed open. Replaced with a `useState`+`setInterval` tick
   (1 s, cleaned up on unmount) so the badge stays live.

3. **Silent history truncation on every collection sheet** — the
   `moneyHistoryLimit`/`servedRowsLimit` slice dropped rows invisibly; the
   collections also rendered unbounded payloads. All served-view adapters now
   return `{ rows, total }` (`total` = pre-truncation count), cap rows at the
   shared `servedRowsLimit = 50`, and the sheets render a keyed
   `common.truncated` note when `total > rows.length`. Applies to
   quotes/trades/orders/checks/markets/support history and the existing
   deposits/withdrawals adapters (`MoneyHistory` gained `total`).

4. **Fail-open row rendering across all served collections** — quotes,
   trades, orders, checks, markets/depth, sessions, notifications and support
   requests rendered `arrayOf` slices of server payloads with no contract
   validation: a drifted status/asset/decimal/id reached the DOM raw. New
   fail-closed adapters (`quotesHistory`, `tradesHistory`, `ordersHistory`,
   `checksViewOf`/`checkViewOf`/`checkPreviewOf`, `marketsViewOf`/
   `marketDepthOf`, `sessionsViewOf`, `notificationsViewOf`,
   `supportRequestsViewOf`, `operationDetailOf`) enforce exact keys, the
   contract id patterns (`qte_`/`ord_`/`trd_`/`chk_`/`sup_`/`ntf_`/`sess_`),
   pair/scales coherence against `contractQuotePair`, enum membership through
   the same guarded lookups the renderers use, and `isDecimalString` grammar
   at the declared asset/price scale. A rejected view maps to the sheet's
   existing `loadFailed` banner — never to fabricated rows.

5. **OperationSheet spun forever on non-Error rejections** — the catch
   handler set `failed` only for `ApiError | Error` instances, so a
   promise rejected with a plain value (e.g. `"boom"`) left the sheet on the
   loading note indefinitely. Now `setFailed(true)` unconditionally, plus
   `role="alert"` on the failure text, and the member read validates through
   `operationDetailOf` with an `adapted.id !== id` binding check.

6. **Member-read cross-record echo possible on detail views** —
   `CheckDetail` and `MarketDepth` rendered whatever the member read returned
   without binding it to the requested reference/instrument, and the checks
   open-by-link path trusted `api.check` unvalidated. Both detail panels now
   fail closed to their `notFound` copy when the adapted member is missing or
   names a different record.

7. **Untrusted server flags rendered on truthiness** —
   `launch.health?.devLogin`, `view?.canSubmit`, `preview.kycRequired` and
   `preview.insufficientBalance` rendered on JS truthiness, so a hostile
   `"yes"`/`1` value activated the affordance/notice. All gate on
   `=== true` now.

8. **Prototype-key lookup for the launch error map** — `rejectionMessages[code]`
   resolved `?error=constructor`-style codes through the prototype chain and
   returned a function where a `MessageKey` was expected. Replaced with the
   existing `messageKeyFor` `Object.hasOwn` guard (the other call site already
   used it).

9. **a11y gaps on error states** — `SupportList`'s load failure rendered a
   `form-error` without `role="alert"` (sibling sheets all announce), the
   `OperationSheet` failure text lacked `role="alert"`, and a foreign address
   screening status rendered a silent blank instead of the declared
   `unavailable` badge (`screeningBadgeOf(status) ?? screeningBadgeOf("unavailable")`).

10. **Support form wiped all field errors on any edit** —
    `clear(field)` returned `{}` whenever the edited field had an error,
    clearing unrelated field errors too. It now deletes only the edited
    field's key.

11. **Collision-prone React keys on server rows** — markets and depth-level
    rows keyed by `market.instrument`/`level.price` alone; duplicate server
    values could collide keys. Now index-suffixed like every other list
    (`${instrument}:${index}`, `${price}:${index}`).

## Verified clean

- **Locale parity** — all 595 message keys present in ru/en/ky; no raw-key
  rendering on any path.
- **Badge/status maps** — every renderer resolves server status/side/kind
  through `Object.hasOwn` member guards (`checkStatusBadge`,
  `orderStatusBadge`, `tradeSideBadge`, `screeningBadgeOf`,
  `activityKindKeyOf`, `supportStatusOf`, …) with the designed raw-text
  fallback; no `record[key]` indexing on untrusted values remains.
- **money-flow adapters** — `depositHistory`/`withdrawalHistory` already
  enforced exact keys, id patterns, enum membership and decimal grammar.
- **List states** — loading/empty/failed are distinguishable on every list;
  the depth table keeps a `colSpan` empty row.
- **Focus management** — sheet open/close restores focus via `sheetOpener`
  (`!active.closest("dialog")` guard), detail transitions refocus the
  heading, and the sessions confirm dialog manages focus to the cancel
  button and status region.
- **Navigation state** — `aria-current`/`aria-pressed` are bound to the
  selection predicate, never to row index.
- **api.ts** — canonical JSON envelope, `ApiError` on non-2xx, bounded
  payload paths with percent-encoded members.
- **BigInt guards** — `formattedBps`/bps rendering paths check
  `Number.isSafeInteger` before `BigInt` conversion.
- **ISO/epoch rendering** — `format.dateTime`/`epochMs` mask `NaN` dates as
  "—" in every locale.

## Observations

- **Notification drafts keep the designed raw-text fallback** —
  `notificationsViewOf` deliberately does not assert `template`: future
  template kinds render `draft.text` verbatim by design (forward-compatible
  degrade), while id/channel/locale/mode/delivered/read stay strict.
- **Sessions adapter enforces `sess_` handles** — stricter than the contract
  type (`string`); the dev server only ever emits `sess_` ids, so this is a
  narrowing, noted for the contract-side audit.
- **`priceScale` bounded to `quotePriceScale` (8)** — markets validators cap
  renderer-facing scale at the contract's declared price scale; a foreign
  value drops the member, not just the digit count.
- **Activity feed keeps `arrayOf` for the local `ActivityItem` union** —
  support-form activity items are already a discriminated union validated
  upstream of the sheet; no per-member re-validation was added (minimal
  change rule).

## Test additions

- `format.test.ts` (new, registered in `package.json`/`tsconfig.test.json`/
  `verification-integrity-baseline.json`): `decimal` renders "—" for
  malformed/non-string input, bounds `fractionDigits`, keeps exact formatting
  for valid decimals/money/legs.
- `quotes-sheet.test.ts`/`trades-sheet.test.ts`/`orders-sheet.test.ts`:
  adapter describe blocks (valid fixture + ~20 corrupt cases each: extra
  keys, wrong id prefixes, foreign pairs/sides/statuses, scale violations,
  non-integer bps, non-epoch timestamps, `execution`/`posting` drift),
  truncation-bound + `total` reporting, live timing badge assertion.
- `checks-badges.test.ts`: `checksViewOf`/`checkViewOf`/`checkPreviewOf`
  fixtures + corrupt cases (CHK- vs `chk_` id confusion, `executable: true`,
  hostile flag types), routed-source assertions, served bound.
- `markets-depth.test.ts`: `marketsViewOf`/`marketDepthOf` adapters
  (pair/scale coherence, priceScale bound, level grammar, depthLevels),
  index keys, member-read binding, served bound.
- `server-fields.test.ts`: `operationDetailOf`, `sessionsViewOf`,
  `notificationsViewOf`, `supportRequestsViewOf` valid + corrupt fixtures;
  consumer pins updated to the adapter idiom.
- `money-flow-sheet.test.ts`: `total` on history + `common.truncated` note.
- `a11y.test.ts`: alert role on `support.loadFailed`, `=== true` flag pins
  (`devLogin`, `canSubmit`), `screeningBadgeOf("unavailable")` fallback,
  `messageKeyFor` pin, non-Error rejection pin, per-field error clearing.
