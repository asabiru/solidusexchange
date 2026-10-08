import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { checkReferencePattern, checkStatuses, effectiveCheckStatus } from "../shared/checks.js";
import { CheckError, checkFeeBps, createCheckBook, defaultCheckTtlSeconds } from "./checks.js";

const now = 1_790_000_000_000;
const book = () => createCheckBook({ clock: () => now });
const context = { nowMs: now, kycRequired: false };

describe("check book: preview", () => {
  it("returns a deterministic, non-executable preview with exact decimals", async () => {
    const preview = book().preview({ asset: "USDT", amount: "25" }, context);
    assert.match(preview.id, /^CHK-[0-9A-F]{12}$/);
    assert.equal(preview.mode, "test");
    assert.equal(preview.asset, "USDT");
    assert.equal(preview.amount, "25.000000");
    assert.equal(preview.feeAsset, "USDT");
    assert.equal(preview.feeBps, checkFeeBps);
    assert.equal(preview.claimRule, "personal");
    assert.equal(preview.issuedAt, now);
    assert.equal(preview.expiresAt, now + defaultCheckTtlSeconds * 1_000);
    assert.equal(preview.ttlSeconds, defaultCheckTtlSeconds);
    assert.equal(preview.serverTime, now);
    assert.equal(preview.executable, false);
    assert.equal(preview.executionUnavailableReason, "dev_test_version");
    assert.equal(preview.kycRequired, false);
    assert.equal(preview.insufficientBalance, false);
    assert.deepEqual(book().preview({ asset: "USDT", amount: "25" }, context), preview);
  });

  it("computes fee and total exactly without floats", () => {
    const preview = book().preview({ asset: "USDT", amount: "25" }, context);
    assert.equal(preview.fee, "0.075000");
    assert.equal(preview.total, "25.075000");
    const ton = book().preview({ asset: "TON", amount: "4" }, context);
    assert.equal(ton.fee, "0.012000000");
    assert.equal(ton.total, "4.012000000");
  });

  it("rejects bad assets and malformed, zero or over-scaled amounts", () => {
    assert.throws(() => book().preview({ asset: "BTC", amount: "1" }, context), (error: unknown) => error instanceof CheckError && error.code === "invalid_asset");
    for (const amount of ["", "abc", "1e3", "-5", "0", "0.00", "1.0000000", "1,000"]) {
      assert.throws(() => book().preview({ asset: "USDT", amount }, context), (error: unknown) => error instanceof CheckError && error.code === "invalid_amount", amount);
    }
  });

  it("flags insufficient balance including the fee and passes through the KYC flag", () => {
    const tight = book().preview({ asset: "USDT", amount: "25" }, { ...context, available: "25.05" });
    assert.equal(tight.insufficientBalance, true);
    const enough = book().preview({ asset: "USDT", amount: "25" }, { ...context, available: "25.075", kycRequired: true });
    assert.equal(enough.insufficientBalance, false);
    assert.equal(enough.kycRequired, true);
  });
});

describe("check book: fixtures", () => {
  it("serves frozen synthetic fixtures covering every status", () => {
    const list = book().list("verified");
    assert.equal(list.mode, "test");
    assert.equal(list.checks.length, checkStatuses.length);
    assert.ok(Object.isFrozen(list.checks));
    assert.ok(list.checks.every((check) => Object.isFrozen(check) && Object.isFrozen(check.timeline)));
    assert.deepEqual(new Set(list.checks.map((check) => check.status)), new Set(["created", "claimed", "cancelled", "expired"]));
    const gated = book().list("kyc-gated");
    assert.deepEqual(new Set(gated.checks.map((check) => check.status)), new Set(checkStatuses));
    for (const check of list.checks) {
      assert.match(check.reference, checkReferencePattern);
      assert.equal(check.mode, "test");
      assert.equal(check.executable, false);
      assert.equal(check.executionUnavailableReason, "dev_test_version");
      assert.equal(check.claimRule, "personal");
      assert.ok(check.expiresAt === check.createdAt + defaultCheckTtlSeconds * 1_000);
      assert.ok(check.timeline[0]?.status === "created" && check.timeline[0].at === check.createdAt);
    }
  });

  it("resolves a check by its opaque claim reference and rejects anything else", () => {
    const book = createCheckBook({ clock: () => now });
    const [first] = book.list("verified").checks;
    assert.ok(first);
    assert.deepEqual(book.view(first.reference, "verified"), first);
    for (const reference of ["", "chk_", "chk_000000000000000000000000", first.reference.toUpperCase(), `${first.reference}x`, `../${first.reference}`]) {
      assert.equal(book.view(reference, "verified"), undefined, reference);
    }
  });

  it("shows a received open check as waiting for KYC to an unverified recipient", () => {
    const received = book().list("verified").checks.find((check) => check.direction === "received" && check.status === "created");
    assert.ok(received);
    const gated = book().view(received.reference, "kyc-gated");
    assert.equal(gated?.status, "awaiting_recipient_kyc");
    assert.equal(gated?.executable, false);
    const sent = book().list("verified").checks.find((check) => check.direction === "sent" && check.status === "created");
    assert.ok(sent);
    assert.equal(book().view(sent.reference, "kyc-gated")?.status, "created");
  });

  it("keeps timeline entries consistent with the fixture status", () => {
    const expired = book().list("verified").checks.find((check) => check.status === "expired");
    assert.ok(expired);
    assert.deepEqual(expired.timeline.map((entry) => entry.status), ["created", "expired"]);
    assert.equal(expired.timeline[1]?.at, expired.expiresAt);
    const open = book().list("verified").checks.find((check) => check.status === "created");
    assert.deepEqual(open?.timeline.map((entry) => entry.status), ["created"]);
  });
});

describe("check status helpers", () => {
  it("derives the recipient-KYC gate only for open incoming checks", () => {
    assert.equal(effectiveCheckStatus("created", "received", "kyc-gated"), "awaiting_recipient_kyc");
    assert.equal(effectiveCheckStatus("created", "received", "verified"), "created");
    assert.equal(effectiveCheckStatus("created", "sent", "kyc-gated"), "created");
    assert.equal(effectiveCheckStatus("claimed", "received", "kyc-gated"), "claimed");
  });
});

describe("check book: boundaries", () => {
  it("does no I/O and uses no globals beyond an injected clock", async () => {
    const source = await readFile(new URL("../../src/server/checks.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /fetch\(|node:https?|node:net|node:fs|randomBytes|Math\.random|Date\.now|proce(?:ss)\.|import\(/);
  });
});
