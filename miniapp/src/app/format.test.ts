import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createFormatter } from "./format.js";

const format = createFormatter("en");

describe("formatter fail-closed rendering", () => {
  it("renders a dash for malformed decimal input instead of throwing", () => {
    for (const value of ["abc", "", "1.2.3", "1e5", "0x10", " 12", "12 ", "12.", ".5", "+1", "NaN"]) {
      assert.equal(format.decimal(value, { fractionDigits: 2 }), "—", value);
    }
    // Untrusted server text can arrive as a non-string; it must never crash the render.
    for (const value of [undefined, null, 42, {}, ["1.5"]]) {
      assert.equal(format.decimal(value as string, { fractionDigits: 2 }), "—", String(value));
    }
  });

  it("bounds fractionDigits so hostile server scales cannot blow up or crash rendering", () => {
    for (const fractionDigits of [Number.NaN, -1, 1.5, 31, 1e9, Number.MAX_SAFE_INTEGER, "8" as unknown as number]) {
      assert.equal(format.decimal("1.5", { fractionDigits }), "—", String(fractionDigits));
    }
    assert.equal(format.decimal("1.5", { fractionDigits: 8 }), "1.50000000");
    assert.equal(format.decimal("1.5", { fractionDigits: 0 }), "2");
    assert.equal(format.decimal("1.5", { fractionDigits: 30 }).length, 32);
  });

  it("keeps formatting valid decimals, money and legs exactly", () => {
    assert.equal(format.decimal("12.5", { fractionDigits: 2 }), "12.50");
    assert.equal(format.decimal("0.00000001", { fractionDigits: 8 }), "0.00000001");
    assert.equal(format.money("USDT", "abc"), "— USDT");
    assert.equal(format.money("BTC", "1.5"), "— BTC");
    assert.equal(format.signedLeg({ direction: "out", asset: "USDT", amount: "abc" }), "— USDT");
    assert.equal(format.rate({ base: "USDT", quote: "RUB", value: "abc" }), "1 USDT = — ₽");
  });
});
