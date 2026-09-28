import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { can } from "./access.js";

describe("operator access", () => {
  it("denies unknown roles by default", () => {
    assert.equal(can("unknown", "dashboard:read"), false);
  });

  it("keeps support away from approvals", () => {
    assert.equal(can("support-l1", "approvals:read"), false);
    assert.equal(can("support-l1", "approvals:review"), false);
  });

  it("keeps the auditor read-only", () => {
    assert.equal(can("auditor", "approvals:read"), true);
    assert.equal(can("auditor", "approvals:review"), false);
  });

  it("allows compliance to review approval evidence", () => {
    assert.equal(can("compliance-lead", "approvals:review"), true);
  });
});
