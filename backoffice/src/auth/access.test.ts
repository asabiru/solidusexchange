import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { can } from "./access.js";

describe("operator access", () => {
  it("denies unknown roles by default", () => {
    assert.equal(can("unknown", "dashboard:read"), false);
  });

  it("keeps support away from approvals", () => {
    assert.equal(can("support-l1", "kyc:read"), false);
    assert.equal(can("support-l1", "aml:read"), false);
    assert.equal(can("support-l1", "approvals:read"), false);
    assert.equal(can("support-l1", "approvals:review"), false);
    assert.equal(can("support-l1", "approvals:preview"), false);
    assert.equal(can("support-l1", "audit:read"), false);
    assert.equal(can("support-l1", "audit:export"), false);
  });

  it("keeps the auditor read-only", () => {
    assert.equal(can("auditor", "kyc:read"), true);
    assert.equal(can("auditor", "aml:read"), true);
    assert.equal(can("auditor", "approvals:read"), true);
    assert.equal(can("auditor", "approvals:review"), false);
    assert.equal(can("auditor", "approvals:preview"), false);
    assert.equal(can("auditor", "audit:read"), true);
    assert.equal(can("auditor", "audit:export"), true);
  });

  it("keeps AML investigators away from the system audit trail", () => {
    assert.equal(can("aml-investigator", "kyc:read"), true);
    assert.equal(can("aml-investigator", "aml:read"), true);
    assert.equal(can("aml-investigator", "approvals:read"), true);
    assert.equal(can("aml-investigator", "audit:read"), false);
    assert.equal(can("aml-investigator", "audit:export"), false);
  });

  it("allows compliance to review approval evidence", () => {
    assert.equal(can("compliance-lead", "kyc:read"), true);
    assert.equal(can("compliance-lead", "aml:read"), true);
    assert.equal(can("compliance-lead", "approvals:review"), true);
    assert.equal(can("compliance-lead", "approvals:preview"), true);
    assert.equal(can("compliance-lead", "audit:read"), true);
    assert.equal(can("compliance-lead", "audit:export"), true);
  });
});
