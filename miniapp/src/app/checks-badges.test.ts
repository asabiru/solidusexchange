import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { checkStatuses } from "../shared/checks.js";
import { checkDirectionKey, checkStatusBadge } from "./checks-badges.js";
import { locales, translate } from "./i18n.js";

const sheetSource = readFileSync(new URL("../../src/app/ChecksSheet.tsx", import.meta.url), "utf8");

describe("checks badges", () => {
  it("maps every declared check status to its exact badge", () => {
    assert.equal(checkStatuses.length, 5);
    assert.deepEqual(checkStatusBadge("created"), { label: "checks.statusCreated", tone: "warning" });
    assert.deepEqual(checkStatusBadge("awaiting_recipient_kyc"), { label: "checks.statusAwaitingKyc", tone: "warning" });
    assert.deepEqual(checkStatusBadge("claimed"), { label: "checks.statusClaimed", tone: "success" });
    assert.deepEqual(checkStatusBadge("cancelled"), { label: "checks.statusCancelled", tone: "muted" });
    assert.deepEqual(checkStatusBadge("expired"), { label: "checks.statusExpired", tone: "muted" });
  });

  it("maps only declared directions to message keys", () => {
    assert.equal(checkDirectionKey("sent"), "checks.sent");
    assert.equal(checkDirectionKey("received"), "checks.received");
  });

  it("fails closed on foreign, malformed or prototype-member statuses", () => {
    const foreign = [
      "",
      "CLAIMED",
      "created ",
      " created",
      "awaiting_confirmation",
      "refunded",
      "hasOwnProperty",
      "toString",
      "valueOf",
      "watch",
      "__proto__",
      "constructor",
      "prototype"
    ];
    for (const status of foreign) {
      assert.equal(checkStatusBadge(status), undefined, status);
    }
  });

  it("fails closed on foreign, malformed or prototype-member directions", () => {
    const foreign = ["", "SENT", "sent ", "incoming", "outgoing", "hasOwnProperty", "__proto__", "constructor"];
    for (const direction of foreign) {
      assert.equal(checkDirectionKey(direction), undefined, direction);
    }
  });

  it("resolves every badge label and direction key in every locale", () => {
    for (const status of checkStatuses) {
      const badge = checkStatusBadge(status);
      assert.ok(badge, status);
      for (const locale of locales) {
        assert.notEqual(translate(locale, badge.label), badge.label, `${locale}:${badge.label}`);
      }
    }
    for (const direction of ["sent", "received"]) {
      const key = checkDirectionKey(direction);
      assert.ok(key, direction);
      for (const locale of locales) {
        assert.notEqual(translate(locale, key), key, `${locale}:${key}`);
      }
    }
  });

  it("keeps ChecksSheet on guarded lookups for server-driven status and direction", () => {
    assert.doesNotMatch(sheetSource, /statusBadges\s*\[/);
    assert.doesNotMatch(sheetSource, /directionKeys\s*\[/);
    assert.ok(sheetSource.includes("checkStatusBadge("));
    assert.ok(sheetSource.includes("checkDirectionKey("));
    assert.ok(sheetSource.includes("badge?.tone"));
    assert.ok(sheetSource.includes("check.status}"));
    assert.ok(sheetSource.includes("check.direction}"));
  });
});
