import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { checkStatuses } from "../shared/checks.js";
import { checkDirectionKey, checkStatusBadge } from "./checks-badges.js";
import { checkPreviewOf, checksViewOf, checkViewOf } from "./checks-view.js";
import { servedRowsLimit } from "./served-views.js";
import type { CheckPreview, CheckView } from "../shared/api.js";
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

  it("routes the collection, member read and preview through the served-view adapters", () => {
    assert.ok(sheetSource.includes("checksViewOf(view)"));
    assert.ok(sheetSource.includes("checkViewOf(value)"));
    assert.ok(sheetSource.includes("adapted.reference !== reference"));
    assert.ok(sheetSource.includes("checkPreviewOf(value)"));
    // Denied/hostile flags stay literal: only a real true renders the notice.
    assert.ok(sheetSource.includes("preview.kycRequired === true"));
    assert.ok(sheetSource.includes("preview.insufficientBalance === true"));
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

const checkRow: CheckView = {
  reference: "chk_7f3a9c1e5d2b4f8a0e6c1d3b",
  mode: "test",
  direction: "sent",
  status: "created",
  asset: "USDT",
  amount: "120.500000",
  fee: "0.500000",
  total: "121.000000",
  claimRule: "personal",
  comment: "demo",
  timeline: [{ status: "created", at: 1_775_000_000_000 }],
  createdAt: 1_775_000_000_000,
  expiresAt: 1_775_003_600_000,
  executable: false,
  executionUnavailableReason: "dev_test_version"
};

const checksView = { mode: "test", checks: [checkRow] } as const;

const preview: CheckPreview = {
  id: "CHK-A1B2C3D4E5F6",
  mode: "test",
  asset: "USDT",
  amount: "120.500000",
  fee: "0.500000",
  feeAsset: "USDT",
  feeBps: 41,
  total: "121.000000",
  claimRule: "personal",
  issuedAt: 1_775_000_000_000,
  expiresAt: 1_775_003_600_000,
  ttlSeconds: 3600,
  serverTime: 1_775_000_000_000,
  insufficientBalance: false,
  kycRequired: false,
  executable: false,
  executionUnavailableReason: "dev_test_version"
};

describe("checks served-view adapters", () => {
  it("adapts a valid checks collection, member view and preview", () => {
    const list = checksViewOf(checksView);
    assert.equal(list?.rows.length, 1);
    assert.equal(list?.total, 1);
    assert.equal(checkViewOf(checkRow)?.reference, checkRow.reference);
    const withoutComment = { ...checkRow } as Record<string, unknown>;
    delete withoutComment.comment;
    assert.equal(checkViewOf(withoutComment)?.reference, checkRow.reference);
    assert.equal(checkPreviewOf(preview)?.id, preview.id);
  });

  it("fails closed on malformed checks views and rows (exact keys)", () => {
    const rowCorrupts = [
      { ...checkRow, extra: 1 },
      { ...checkRow, reference: "CHK-A1B2C3D4E5F6" },
      { ...checkRow, direction: "refund" },
      { ...checkRow, status: "redeemed" },
      { ...checkRow, asset: "BTC" },
      { ...checkRow, amount: "120.5000000" },
      { ...checkRow, claimRule: "anyone" },
      { ...checkRow, comment: 42 },
      { ...checkRow, timeline: "nope" },
      { ...checkRow, timeline: [{ ...checkRow.timeline[0], status: "redeemed" }] },
      { ...checkRow, createdAt: "2026-10-10" },
      { ...checkRow, executable: true },
      { ...checkRow, executionUnavailableReason: "policy" }
    ];
    for (const row of rowCorrupts) {
      assert.equal(checkViewOf(row), undefined, JSON.stringify(row).slice(0, 120));
    }
    for (const corrupt of [
      { ...checksView, extra: true },
      { mode: "test" },
      { ...checksView, mode: "live" },
      { ...checksView, checks: "nope" },
      { ...checksView, checks: [null] },
      ...rowCorrupts.map((row) => ({ ...checksView, checks: [row] }))
    ]) {
      assert.equal(checksViewOf(corrupt), undefined, JSON.stringify(corrupt).slice(0, 120));
    }
  });

  it("fails closed on malformed previews, including hostile executable and flags", () => {
    for (const corrupt of [
      { ...preview, extra: true },
      { ...preview, id: "chk_7f3a9c1e5d2b4f8a0e6c1d3b" },
      { ...preview, id: "CHK-lowercasef6e5" },
      { ...preview, mode: "live" },
      { ...preview, asset: "BTC" },
      { ...preview, amount: "abc" },
      { ...preview, feeBps: "41" },
      { ...preview, claimRule: "anyone" },
      { ...preview, issuedAt: "2026-10-10" },
      { ...preview, ttlSeconds: Number.NaN },
      { ...preview, insufficientBalance: "yes" },
      { ...preview, kycRequired: 1 },
      { ...preview, executable: "yes" },
      { ...preview, executable: true },
      { ...preview, executionUnavailableReason: "policy" }
    ]) {
      assert.equal(checkPreviewOf(corrupt), undefined, JSON.stringify(corrupt).slice(0, 120));
    }
  });

  it("bounds the rendered collection to the shared served limit", () => {
    const many = Array.from({ length: servedRowsLimit + 10 }, (_, index) => ({
      ...checkRow,
      reference: `chk_${String(index).padStart(24, "0")}`
    }));
    const list = checksViewOf({ mode: "test", checks: many });
    assert.equal(list?.rows.length, servedRowsLimit);
    assert.equal(list?.total, servedRowsLimit + 10);
  });
});
