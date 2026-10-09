# Miniapp Client Audit — Wave 40 — Proposed

- Status: Proposed
- Scope: `miniapp/src/app/**` (screens, sheets, format/i18n/notification helpers, router, telegram bootstrap) and `miniapp/src/shared/**` (decimal, quote, assets, checks, address-screening, support) — everything under client/app that the wave-32 `ChecksSheet` audit did not cover
- Production effect: none

## Scope reviewed

- App shell, router and session bootstrap: `miniapp/src/app/App.tsx`, `miniapp/src/app/navigation.ts`, `miniapp/src/app/telegram.ts`, `miniapp/src/app/api.ts`, `miniapp/src/app/i18n.ts`, `miniapp/src/app/i18n-context.tsx`, `miniapp/src/app/notification-seen.ts`
- Formatting and rendering primitives: `miniapp/src/app/format.ts`, `miniapp/src/app/ui.tsx`, `miniapp/src/app/Icon.tsx`, `miniapp/src/app/icon-data.ts`
- Screens: `miniapp/src/app/screens/HomeScreen.tsx`, `OperationsScreen.tsx`, `ExchangeScreen.tsx`, `ProfileScreen.tsx`, `QrScreen.tsx`
- Sheets: `miniapp/src/app/sheets.tsx`, `miniapp/src/app/ChecksSheet.tsx`, `miniapp/src/app/SupportSheet.tsx`
- Shared helpers: `miniapp/src/shared/decimal.ts`, `quote.ts`, `assets.ts`, `api.ts`, `checks.ts`, `address-screening.ts`, `support.ts`

Hunt list applied: unguarded server-string dereferences (the wave-32 pattern), prototype-key lookups on server-provided strings, locale/decimal parsing that tolerates junk or produces wrong precision, exact-decimal violations, unsafe URL/navigation from server fields, localStorage key confusion, error renders leaking internal details, unguarded `.tone`/`.label`/`.icon` access, React key collisions from non-unique server ids, missing null checks on nested server payloads.

## Defects found and fixed

1. **Unguarded enum/status map indexing throughout the client (wave-32 pattern, ~30 call sites).** Server-supplied `status`/`kind`/`category`/`source`/`network`/`direction`/`client`/`state` fields were indexed into `Record` maps with no membership guard: `statusLabelKeys`/`assetNameKeys`/`assetNetworkKeys` (format.ts), `statusIcons`/`statusTones` (ui.tsx `StatusPill`), `sourceLabels`/`kycTexts`/`screeningBadges`/`screeningNetworkKeys`/`supportCategoryKeys` (OperationsScreen), `kycOutcomes`/`decisionSteps`/`sessionClientKeys`/`screeningBadges`/`screeningNetworkKeys` (sheets.tsx), `supportCategoryKeys`/`statusBadges`/`activityKindKeys` (SupportSheet), `assetNameKeys`/`assetNetworkKeys` (HomeScreen), `iconShapes` (Icon). A foreign enum value crashed render on `undefined.tone`/`.label`/`.icon` or produced `pill--undefined`/`coin--undefined` classes; prototype members (`"constructor"`, `"hasOwnProperty"`, `"toString"`) resolved to inherited values, which are truthy and bypassed `badge &&` guards. `iconShapes["toString"]` resolved a `Function`, then `.map` threw and took down the entire screen. Fixed by a new `src/app/server-fields.ts` module that exposes one `member()`/`Object.hasOwn`-guarded accessor per server enum (`operationStatusOf`, `screeningBadgeOf`, `screeningNetworkKeyOf`, `sessionClientKeyOf`, `activitySourceKeyOf`, `activityKindKeyOf`, `kycActivityOf`, `supportStatusOf`, `supportCategoryKeyOf`, `kycOutcomeOf`, `kycStateOf`, `kycDecisionStepOf`, `timelineStepState`) plus `assetMetaOf` in `shared/assets.ts`. Consumers render a muted pill plus the raw server value on foreign input instead of crashing or rendering fabricated label keys.

2. **Formatter crashed or misrendered on foreign assets and junk decimals.** `Formatter.amount`/`money`/`signedLeg`/`withUnit` dereferenced `assets[asset].scale`/`.symbol`; `rate` divided `assets[asset.base]`/`assets[asset.quote]` scales — all TypeErrors on a foreign asset code (e.g. `"BTC"`, `"constructor"`). `amountInput`/`signedLeg` let `DecimalError` surface uncaught. `dateTime`/`epochMs` rendered `"Invalid Date"` strings or `NaN` clock parts for non-finite server timestamps. Fixed: asset-dependent paths resolve through `assetMetaOf` and fail closed to `"—"` (`unreadable`), `DecimalError` is caught to `"—"`/`raw`, direction is whitelisted to `in|out`, and `epochMs` validates `Number.isFinite` and the `Date` range before formatting.

3. **Quote expiry failed open on non-finite server timings.** `isQuoteExpired` compared `now >= quote.expiresAt`: `expiresAt: NaN` returned `false`, so a garbage quote stayed "live" and the exchange CTA remained armed; `expiresAt: Infinity` never expired. `formatCountdown(NaN)` rendered `"NaN:NaN"`. Fixed: `isQuoteExpired` returns `true` when `expiresAt` is not finite; `quoteSecondsRemaining` and `formatCountdown` clamp non-finite input to `0`/`"00:00"`.

4. **Non-array server lists crashed renders.** `Array.prototype.map`/`find`/`filter` were called on server payload fields that the client never validated as arrays: `view.items`/`wallet.assets`/`operations.operations`/`notifications.notifications` (App loader), `view.checks`/`check.timeline` (ChecksSheet), `request.timeline`/`view.items`/`activity` list (SupportSheet), `detail.legs`/`detail.timeline`/`profile.fees`/`profile.security`/`profile.kyc.steps`/`view.sessions`/`view.notifications` (sheets.tsx), the `CustomerApiAccess` capability array (`apiAccessDetail`, ProfileScreen). A malformed payload produced a full-screen TypeError. Fixed by an `arrayOf(value)` normalizer (returns `[]` for non-arrays) applied at the load boundary in `App.tsx` and at each component consumer.

5. **Missing null checks on nested server payloads.** `profile.kyc.state`/`profile.kyc.level` (ProfileScreen) and `session.displayName`/`profile.displayName` `.slice(0,1)` (HomeScreen/ProfileScreen) crashed when the nested object was absent; `OperationSheet` destructured `detail.legs[0]`/`[1]` unconditionally; `NotificationSheet` read `view.notifications`. Fixed with optional-chaining plus `"—"` fallbacks and an `arrayOf`-normalized `legs` destructure with an explicit load-failed panel when `primary` is absent.

6. **React key collisions from non-unique server ids.** List rows used raw server strings as keys — `item.id` (operations/activity/support/activity-select options), `check.reference`, `entry.status` (check timeline), `session.handle`, `draft.id`, `step.detail`, `balance.code`, `operation.id`. Duplicate values collapse rows and corrupt reconciliation. Fixed by suffixing the row index (`${id}:${index}`) at every site.

7. **Untrusted numeric fields rendered/computed without validation.** `ExchangeScreen` used `quote.ttlSeconds` as a progress denominator and `quote.spreadBps` as a formatted integer with no `Number.isFinite`/`Number.isSafeInteger` check — a fractional/NaN `ttlSeconds` produced `NaN%` progress and a NaN countdown; a non-integer `spreadBps` rendered raw. Fixed with finite/integer guards plus `"—"` fallbacks.

8. **`webApp.colorScheme` applied to theme without whitelisting.** A foreign string (any non-`"light"`/`"dark"` value from the Telegram client) was passed straight into the theme handler. Fixed: the listener only forwards the two declared values.

## Verified clean

- Exact-decimal math: all money paths operate on BigInt/`Decimal`/`toUnits`/`formatDecimal` strings; no float arithmetic on amounts anywhere in `shared/decimal.ts`, `shared/quote.ts`, or `app/format.ts`.
- Decimal parsing rejects junk: `formatDecimal`/`normalizeAmountInput` enforce the canonical decimal grammar and throw `DecimalError` on non-conforming input; locale separators follow `decimalSeparators` and never accept mixed/thousands ambiguity.
- No server-derived URLs or navigation: `navigation.ts` routes on local `SheetRequest`/`Tab` unions only; no `window.open`/`location`/anchor links built from server fields; no `dangerouslySetInnerHTML` anywhere.
- localStorage keys are fixed-prefix (`solidchange.notification-seen`, theme/locale keys); `notification-seen.ts` sanitizes stored ids through `Set` membership and caps the set — no key confusion or injection.
- Error renders go through `messageKeyFor` catalogs that map known server error codes to message keys and fall back to a generic key — internal detail strings never reach the DOM.
- KYC flow: `KycSheet`/`kycSteps` normalize foreign states to `unavailable` before timeline resolution; unknown step kinds never reach `decisionSteps`.
- i18n: `translate` falls back to `String(key)`, so fallbacks render raw server strings or `"—"`, never fabricated `MessageKey`s; locale coverage is pinned by catalog tests in both locales.

## Test additions

- `miniapp/src/app/server-fields.test.ts` (new, 28 cases): pins every accessor map exactly, fails closed on foreign and prototype-member values (`__proto__`, `constructor`, `prototype`, `hasOwnProperty`, `toString`, `valueOf`, `watch`, `then`, `"0"`, `"-1"`, case/space variants), verifies per-locale catalog coverage via `take()`/`assert.ok` (no `!`), asserts `format.amount`/`money`/`signedLeg`/`rate`/`amountInput`/`epochMs`/`dateTime` fail closed on foreign assets, junk decimals and non-finite timestamps, and statically greps every consumer file to forbid unguarded `map[field]` indexing and `new Date(x).toISOString()` epoch misuse going forward.
- `miniapp/src/shared/quote.test.ts` (+1 case): pins `isQuoteExpired`/`quoteSecondsRemaining`/`formatCountdown` fail-closed behavior on `NaN`/`Infinity` server timings.
- `miniapp/package.json` `test` script and `miniapp/tsconfig.test.json` `include` updated to compile and run the new suite; verification-integrity baseline recomputed for touched files.
