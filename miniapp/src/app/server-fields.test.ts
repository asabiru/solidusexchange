import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { assetMetaOf } from "../shared/assets.js";
import { createFormatter } from "./format.js";
import { locales, type MessageKey, translate } from "./i18n.js";
import {
  activityKindKeyOf,
  activitySourceKeyOf,
  arrayOf,
  kycActivityOf,
  kycDecisionStepOf,
  kycOutcomeOf,
  kycStateOf,
  operationStatusOf,
  screeningBadgeOf,
  screeningNetworkKeyOf,
  sessionClientKeyOf,
  supportCategoryKeyOf,
  supportStatusOf,
  timelineStepState
} from "./server-fields.js";

const foreign = [
  "",
  "COMPLETED",
  "completed ",
  " pending",
  "hasOwnProperty",
  "toString",
  "valueOf",
  "watch",
  "__proto__",
  "constructor",
  "prototype",
  "then",
  "0",
  "-1"
] as const;

function source(name: string): string {
  return readFileSync(new URL(`../../src/${name}`, import.meta.url), "utf8");
}

describe("server fields: operation status", () => {
  it("maps every declared status to label, tone and icon", () => {
    assert.deepEqual(operationStatusOf("completed"), { label: "status.completed", tone: "success", icon: "check" });
    assert.deepEqual(operationStatusOf("in-review"), { label: "status.inReview", tone: "warning", icon: "clock" });
    assert.deepEqual(operationStatusOf("needs-action"), { label: "status.needsAction", tone: "risk", icon: "alert" });
    assert.deepEqual(operationStatusOf("failed"), { label: "status.failed", tone: "risk", icon: "close" });
  });

  it("fails closed on foreign, malformed or prototype-member statuses", () => {
    for (const status of foreign) {
      assert.equal(operationStatusOf(status), undefined, status);
    }
  });
});

describe("server fields: address screening", () => {
  it("maps every declared screening status to its exact badge", () => {
    assert.deepEqual(screeningBadgeOf("pending"), { label: "screening.pendingLabel", tone: "muted", detail: "screening.pendingDetail" });
    assert.deepEqual(screeningBadgeOf("low"), { label: "screening.lowLabel", tone: "success", detail: "screening.lowDetail" });
    assert.deepEqual(screeningBadgeOf("medium"), { label: "screening.mediumLabel", tone: "warning", detail: "screening.mediumDetail" });
    assert.deepEqual(screeningBadgeOf("high"), { label: "screening.highLabel", tone: "risk", detail: "screening.highDetail" });
    assert.deepEqual(screeningBadgeOf("severe"), { label: "screening.severeLabel", tone: "risk", detail: "screening.severeDetail" });
    assert.deepEqual(screeningBadgeOf("unavailable"), { label: "screening.unavailableLabel", tone: "muted", detail: "screening.unavailableDetail" });
    assert.deepEqual(screeningBadgeOf("timed_out"), { label: "screening.timedOutLabel", tone: "muted", detail: "screening.timedOutDetail" });
  });

  it("maps declared screening networks and fails closed on foreign values", () => {
    assert.equal(screeningNetworkKeyOf("TON_TESTNET"), "network.TON_TESTNET");
    assert.equal(screeningNetworkKeyOf("TRON_TESTNET"), "network.TRON_TESTNET");
    for (const network of foreign) {
      assert.equal(screeningBadgeOf(network), undefined, network);
      assert.equal(screeningNetworkKeyOf(network), undefined, network);
    }
  });
});

describe("server fields: sessions and activity", () => {
  it("maps declared session clients and activity sources", () => {
    assert.equal(sessionClientKeyOf("telegram"), "activity.sourceTelegram");
    assert.equal(sessionClientKeyOf("dev-login"), "activity.sourceDev");
    assert.equal(activitySourceKeyOf("telegram"), "activity.sourceTelegram");
    assert.equal(activitySourceKeyOf("dev-synthetic"), "activity.sourceDev");
    for (const value of foreign) {
      assert.equal(sessionClientKeyOf(value), undefined, value);
      assert.equal(activitySourceKeyOf(value), undefined, value);
    }
  });

  it("maps every declared activity kind and fails closed on foreign kinds", () => {
    assert.equal(activityKindKeyOf("session_login"), "activity.login");
    assert.equal(activityKindKeyOf("session_revoked"), "activity.sessionRevokedOne");
    assert.equal(activityKindKeyOf("kyc_submitted"), "activity.kycSubmitted");
    assert.equal(activityKindKeyOf("kyc_in_review"), "activity.kycInReview");
    assert.equal(activityKindKeyOf("kyc_approved"), "activity.kycApproved");
    assert.equal(activityKindKeyOf("kyc_rejected"), "activity.kycRejected");
    assert.equal(activityKindKeyOf("kyc_needs_more_data"), "activity.kycNeedsMoreData");
    assert.equal(activityKindKeyOf("kyc_timed_out"), "activity.kycTimedOut");
    assert.equal(activityKindKeyOf("kyc_unavailable"), "activity.kycUnavailable");
    assert.equal(activityKindKeyOf("quote_previewed"), "activity.filterQuote");
    assert.equal(activityKindKeyOf("address_screened"), "activity.filterScreening");
    assert.equal(activityKindKeyOf("support_requested"), "common.support");
    for (const kind of foreign) {
      assert.equal(activityKindKeyOf(kind), undefined, kind);
    }
  });

  it("maps kyc activity kinds to their exact texts", () => {
    assert.deepEqual(kycActivityOf("kyc_submitted"), { title: "activity.kycSubmitted", tone: "warning", icon: "id-card" });
    assert.deepEqual(kycActivityOf("kyc_in_review"), { title: "activity.kycInReview", tone: "warning", icon: "clock" });
    assert.deepEqual(kycActivityOf("kyc_approved"), { title: "activity.kycApproved", tone: "success", icon: "shield-check" });
    assert.deepEqual(kycActivityOf("kyc_rejected"), { title: "activity.kycRejected", tone: "risk", icon: "close" });
    assert.deepEqual(kycActivityOf("kyc_needs_more_data"), { title: "activity.kycNeedsMoreData", tone: "risk", icon: "alert" });
    assert.deepEqual(kycActivityOf("kyc_timed_out"), { title: "activity.kycTimedOut", tone: "risk", icon: "clock" });
    assert.deepEqual(kycActivityOf("kyc_unavailable"), { title: "activity.kycUnavailable", tone: "risk", icon: "alert" });
    for (const kind of foreign) {
      assert.equal(kycActivityOf(kind), undefined, kind);
    }
    // A non-kyc activity kind resolves through activityKindKeyOf, not the kyc map.
    assert.equal(kycActivityOf("session_login"), undefined);
  });
});

describe("server fields: support", () => {
  it("maps every declared support status to its exact badge", () => {
    assert.deepEqual(supportStatusOf("received"), { label: "support.statusReceived", tone: "muted" });
    assert.deepEqual(supportStatusOf("in_review"), { label: "support.statusInReview", tone: "warning" });
    assert.deepEqual(supportStatusOf("answered"), { label: "support.statusAnswered", tone: "success" });
    assert.deepEqual(supportStatusOf("closed"), { label: "support.statusClosed", tone: "muted" });
    for (const status of foreign) {
      assert.equal(supportStatusOf(status), undefined, status);
    }
  });

  it("maps declared support categories and fails closed on foreign values", () => {
    assert.equal(supportCategoryKeyOf("question"), "support.categoryQuestion");
    assert.equal(supportCategoryKeyOf("operation_problem"), "support.categoryOperation");
    assert.equal(supportCategoryKeyOf("complaint"), "support.categoryComplaint");
    assert.equal(supportCategoryKeyOf("data_request"), "support.categoryData");
    for (const category of foreign) {
      assert.equal(supportCategoryKeyOf(category), undefined, category);
    }
  });
});

describe("server fields: kyc", () => {
  it("maps every declared kyc state to its exact outcome", () => {
    assert.deepEqual(kycOutcomeOf("not_started"), { title: "kyc.notStartedTitle", detail: "kyc.notStartedDetail" });
    assert.deepEqual(kycOutcomeOf("submitted"), { title: "kyc.submittedTitle", detail: "kyc.submittedDetail" });
    assert.deepEqual(kycOutcomeOf("in_review"), { title: "kyc.inReviewTitle", detail: "kyc.inReviewDetail" });
    assert.deepEqual(kycOutcomeOf("approved"), { title: "kyc.approvedTitle", detail: "kyc.approvedDetail" });
    assert.deepEqual(kycOutcomeOf("rejected"), { title: "kyc.rejectedTitle", detail: "kyc.rejectedDetail" });
    assert.deepEqual(kycOutcomeOf("needs_more_data"), { title: "kyc.needsMoreDataTitle", detail: "kyc.needsMoreDataDetail" });
    assert.deepEqual(kycOutcomeOf("timed_out"), { title: "kyc.timedOutTitle", detail: "kyc.timedOutDetail" });
    assert.deepEqual(kycOutcomeOf("unavailable"), { title: "kyc.unavailableTitle", detail: "kyc.unavailableDetail" });
  });

  it("normalizes foreign kyc states to the unavailable outcome", () => {
    for (const state of foreign) {
      assert.deepEqual(kycOutcomeOf(state), kycOutcomeOf("unavailable"), state);
      assert.equal(kycStateOf(state), "unavailable", state);
    }
    assert.equal(kycStateOf("approved"), "approved");
  });

  it("resolves decision steps only for terminal kyc states", () => {
    assert.deepEqual(kycDecisionStepOf("approved"), { title: "kyc.stepApprovedTitle", detail: "kyc.stepApprovedDetail", state: "done" });
    assert.deepEqual(kycDecisionStepOf("rejected"), { title: "kyc.stepRejectedTitle", detail: "kyc.stepRejectedDetail", state: "blocked" });
    assert.deepEqual(kycDecisionStepOf("needs_more_data"), { title: "kyc.stepNeedsMoreDataTitle", detail: "kyc.stepNeedsMoreDataDetail", state: "blocked" });
    assert.deepEqual(kycDecisionStepOf("timed_out"), { title: "kyc.stepTimedOutTitle", detail: "kyc.stepTimedOutDetail", state: "blocked" });
    for (const state of ["not_started", "submitted", "in_review", "unavailable", ...foreign]) {
      assert.equal(kycDecisionStepOf(state), undefined, state);
    }
  });

  it("maps timeline step states and fails closed to pending", () => {
    assert.equal(timelineStepState("done"), "done");
    assert.equal(timelineStepState("current"), "current");
    assert.equal(timelineStepState("pending"), "pending");
    assert.equal(timelineStepState("blocked"), "blocked");
    for (const state of foreign) {
      assert.equal(timelineStepState(state), "pending", state);
    }
  });
});

describe("server fields: assets and lists", () => {
  it("resolves declared asset codes only", () => {
    assert.deepEqual(assetMetaOf("RUB"), {
      code: "RUB",
      name: "\u0420\u043e\u0441\u0441\u0438\u0439\u0441\u043a\u0438\u0439 \u0440\u0443\u0431\u043b\u044c",
      symbol: "\u20bd",
      scale: 2,
      displayScale: 2,
      network: "\u0424\u0438\u0430\u0442\u043d\u044b\u0439 \u0441\u0447\u0451\u0442"
    });
    assert.equal(assetMetaOf("USDT")?.scale, 6);
    assert.equal(assetMetaOf("TON")?.scale, 9);
    for (const code of foreign) {
      assert.equal(assetMetaOf(code), undefined, code);
    }
  });

  it("keeps arrays and degrades every non-array payload to an empty list", () => {
    const list = [{ id: "a" }];
    assert.equal(arrayOf(list), list);
    assert.deepEqual(arrayOf<unknown>(undefined), []);
    assert.deepEqual(arrayOf<unknown>(null), []);
    assert.deepEqual(arrayOf<unknown>({}), []);
    assert.deepEqual(arrayOf<unknown>("items"), []);
    assert.deepEqual(arrayOf<unknown>(4), []);
    assert.deepEqual(arrayOf<unknown>({ length: 2 }), []);
  });
});

describe("server fields: catalog coverage", () => {
  it("resolves every reachable message key in every locale", () => {
    const keys = new Set<MessageKey>();
    const take = (key: MessageKey | undefined) => {
      assert.ok(key, "lookup must resolve");
      keys.add(key);
    };
    for (const status of ["completed", "in-review", "needs-action", "failed"]) {
      const meta = operationStatusOf(status);
      assert.ok(meta, status);
      keys.add(meta.label);
    }
    for (const status of ["pending", "low", "medium", "high", "severe", "unavailable", "timed_out"]) {
      const badge = screeningBadgeOf(status);
      assert.ok(badge, status);
      keys.add(badge.label);
      keys.add(badge.detail);
    }
    for (const network of ["TON_TESTNET", "TRON_TESTNET"]) take(screeningNetworkKeyOf(network));
    for (const client of ["telegram", "dev-login"]) take(sessionClientKeyOf(client));
    for (const value of ["telegram", "dev-synthetic"]) take(activitySourceKeyOf(value));
    for (const kind of ["session_login", "session_revoked", "kyc_submitted", "kyc_in_review", "kyc_approved", "kyc_rejected", "kyc_needs_more_data", "kyc_timed_out", "kyc_unavailable", "quote_previewed", "address_screened", "support_requested"]) {
      take(activityKindKeyOf(kind));
      const kyc = kycActivityOf(kind);
      if (kyc) keys.add(kyc.title);
    }
    for (const status of ["received", "in_review", "answered", "closed"]) {
      const badge = supportStatusOf(status);
      assert.ok(badge, status);
      keys.add(badge.label);
    }
    for (const category of ["question", "operation_problem", "complaint", "data_request"]) take(supportCategoryKeyOf(category));
    for (const state of ["not_started", "submitted", "in_review", "approved", "rejected", "needs_more_data", "timed_out", "unavailable"]) {
      const outcome = kycOutcomeOf(state);
      keys.add(outcome.title);
      keys.add(outcome.detail);
      const step = kycDecisionStepOf(state);
      if (step) {
        keys.add(step.title);
        keys.add(step.detail);
      }
    }
    for (const key of keys) {
      for (const locale of locales) {
        assert.notEqual(translate(locale, key), key, `${locale}:${key}`);
      }
    }
  });
});

describe("format: untrusted amounts and dates", () => {
  it("renders a dash instead of throwing on malformed or foreign amounts", () => {
    const format = createFormatter("en");
    assert.equal(format.amount("BTC", "1.5"), "—");
    assert.equal(format.money("constructor", "1.5"), "—\u00a0constructor");
    assert.equal(format.money("RUB", "junk"), "—\u00a0₽");
    assert.equal(format.amount("USDT", "1e6"), "—");
    assert.equal(format.amount("USDT", ""), "—");
    assert.equal(format.signedLeg({ direction: "in", asset: "USDT", amount: "junk" }), "—\u00a0USDT");
    assert.equal(format.signedLeg({ direction: "sideways", asset: "USDT", amount: "1.5" }), "—\u00a0USDT");
    assert.equal(format.signedLeg({ direction: "in", asset: "BTC", amount: "1.5" }), "—\u00a0BTC");
    assert.equal(format.rate({ base: "USDT", quote: "RUB", value: "junk" }), "1 USDT = —\u00a0₽");
    // The amount input keeps the raw server value so the field stays editable.
    assert.equal(format.amountInput("BTC", "9.9"), "9.9");
    assert.equal(format.amountInput("RUB", "junk"), "junk");
  });

  it("renders a dash instead of throwing on non-finite or unreachable epoch timestamps", () => {
    const format = createFormatter("en");
    assert.equal(format.epochMs(Number.NaN), "—");
    assert.equal(format.epochMs(Number.POSITIVE_INFINITY), "—");
    assert.equal(format.epochMs(8.64e15 + 1), "—");
    assert.notEqual(format.epochMs(1_790_000_000_000), "—");
    assert.equal(format.dateTime("not-a-date"), "—");
  });
});

describe("server fields: consumers stay on guarded lookups", () => {
  const isoDate = /new Date\([^)]*\)\.toISOString\(\)/;

  it("OperationsScreen indexes only through guarded accessors", () => {
    const text = source("app/screens/OperationsScreen.tsx");
    for (const pattern of [
      /sourceLabels\s*\[/,
      /kycTexts\s*\[/,
      /screeningBadges\s*\[/,
      /screeningNetworkKeys\s*\[/,
      /supportCategoryKeys\s*\[/,
      isoDate
    ]) {
      assert.doesNotMatch(text, pattern, String(pattern));
    }
    for (const call of ["activitySourceKeyOf(", "screeningBadgeOf(", "screeningNetworkKeyOf(", "supportCategoryKeyOf(", "kycActivityOf(", "arrayOf(", "format.epochMs("]) {
      assert.ok(text.includes(call), call);
    }
  });

  it("sheets.tsx indexes only through guarded accessors", () => {
    const text = source("app/sheets.tsx");
    for (const pattern of [
      /kycOutcomes\s*\[/,
      /decisionSteps\s*\[/,
      /sessionClientKeys\s*\[/,
      /screeningBadges\s*\[/,
      /screeningNetworkKeys\s*\[/,
      /assetNameKeys\s*\[/,
      /assetNetworkKeys\s*\[/,
      isoDate
    ]) {
      assert.doesNotMatch(text, pattern, String(pattern));
    }
    for (const call of ["kycOutcomeOf(", "kycStateOf(", "kycDecisionStepOf(", "screeningBadgeOf(", "screeningNetworkKeyOf(", "sessionClientKeyOf(", "timelineStepState(", "format.epochMs("]) {
      assert.ok(text.includes(call), call);
    }
    assert.match(text, /const \[primary, secondary\] = arrayOf/);
    assert.match(text, /arrayOf<[^>]+>\(detail\.timeline\)/);
  });

  it("SupportSheet indexes only through guarded accessors", () => {
    const text = source("app/SupportSheet.tsx");
    for (const pattern of [/statusBadges\s*\[/, /activityKindKeys\s*\[/, /supportCategoryKeys\s*\[/, isoDate]) {
      assert.doesNotMatch(text, pattern, String(pattern));
    }
    for (const call of ["supportStatusOf(", "supportCategoryKeyOf(", "activityKindKeyOf(", "arrayOf(", "format.epochMs("]) {
      assert.ok(text.includes(call), call);
    }
  });

  it("ui.tsx resolves status meta and coin symbols through guards", () => {
    const text = source("app/ui.tsx");
    for (const pattern of [/statusTones\s*\[/, /statusIcons\s*\[/, /statusLabelKeys\s*\[/, /assets\s*\[/]) {
      assert.doesNotMatch(text, pattern, String(pattern));
    }
    for (const call of ["operationStatusOf(", "assetMetaOf(", "meta?.tone", "primary?.direction"]) {
      assert.ok(text.includes(call), call);
    }
  });

  it("Icon renders nothing for a foreign name instead of crashing", () => {
    const text = source("app/Icon.tsx");
    assert.doesNotMatch(text, /iconShapes\[name\]\.map/);
    assert.ok(text.includes("iconShapes[name] ?? []"));
  });

  it("HomeScreen resolves asset labels through guards and guards displayName", () => {
    const text = source("app/screens/HomeScreen.tsx");
    for (const pattern of [/assetNameKeys\s*\[/, /assetNetworkKeys\s*\[/, /session\.displayName\.slice/]) {
      assert.doesNotMatch(text, pattern, String(pattern));
    }
    for (const call of ["assetNameKey(", "assetNetworkKey("]) {
      assert.ok(text.includes(call), call);
    }
    assert.ok(text.includes('session.displayName ?? "—"'));
  });

  it("ChecksSheet and App normalize server lists and epoch dates", () => {
    const checks = source("app/ChecksSheet.tsx");
    assert.doesNotMatch(checks, isoDate);
    for (const call of ["arrayOf(", "format.epochMs("]) {
      assert.ok(checks.includes(call), call);
    }
    const app = source("app/App.tsx");
    assert.match(app, /arrayOf\(wallet\.assets\)/);
    assert.match(app, /arrayOf<OperationSummary>\(operations\.operations\)/);
    assert.match(app, /arrayOf\(notifications\.notifications\)/);
  });

  it("ExchangeScreen validates spread and ttl before numeric use", () => {
    const text = source("app/screens/ExchangeScreen.tsx");
    assert.ok(text.includes("Number.isSafeInteger(quote.value.spreadBps)"));
    assert.ok(text.includes("Number.isFinite(quote.value.ttlSeconds)"));
  });

  it("ProfileScreen guards nested kyc and api-access fields", () => {
    const text = source("app/screens/ProfileScreen.tsx");
    assert.doesNotMatch(text, /profile\.kyc\.state/);
    assert.doesNotMatch(text, /profile\.kyc\.level/);
    assert.doesNotMatch(text, /profile\.displayName\.slice/);
    assert.doesNotMatch(text, /access\.granted\.map/);
    assert.ok(text.includes("arrayOf<string>(access.granted)"));
  });

  it("telegram.ts validates the live colorScheme value", () => {
    const text = source("app/telegram.ts");
    assert.ok(text.includes('webApp.colorScheme === "light" || webApp.colorScheme === "dark"'));
  });
});
