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
    assert.equal(can("support-l1", "investigations:read"), false);
    assert.equal(can("support-l1", "fraud:read"), false);
    assert.equal(can("support-l1", "approvals:read"), false);
    assert.equal(can("support-l1", "approvals:review"), false);
    assert.equal(can("support-l1", "approvals:preview"), false);
    assert.equal(can("support-l1", "audit:read"), false);
    assert.equal(can("support-l1", "audit:export"), false);
  });

  it("keeps the auditor read-only", () => {
    assert.equal(can("auditor", "kyc:read"), true);
    assert.equal(can("auditor", "aml:read"), true);
    assert.equal(can("auditor", "investigations:read"), true);
    assert.equal(can("auditor", "fraud:read"), true);
    assert.equal(can("auditor", "approvals:read"), true);
    assert.equal(can("auditor", "approvals:review"), false);
    assert.equal(can("auditor", "approvals:preview"), false);
    assert.equal(can("auditor", "audit:read"), true);
    assert.equal(can("auditor", "audit:export"), true);
  });

  it("keeps AML investigators away from the system audit trail", () => {
    assert.equal(can("aml-investigator", "kyc:read"), true);
    assert.equal(can("aml-investigator", "aml:read"), true);
    assert.equal(can("aml-investigator", "investigations:read"), true);
    assert.equal(can("aml-investigator", "fraud:read"), true);
    assert.equal(can("aml-investigator", "approvals:read"), true);
    assert.equal(can("aml-investigator", "audit:read"), false);
    assert.equal(can("aml-investigator", "audit:export"), false);
  });

  it("gives fraud investigators only their customer-risk workspace", () => {
    assert.equal(can("fraud-investigator", "customers:read"), true);
    assert.equal(can("fraud-investigator", "kyc:read"), false);
    assert.equal(can("fraud-investigator", "aml:read"), false);
    assert.equal(can("fraud-investigator", "investigations:read"), true);
    assert.equal(can("fraud-investigator", "fraud:read"), true);
    assert.equal(can("fraud-investigator", "approvals:read"), true);
    assert.equal(can("fraud-investigator", "approvals:preview"), false);
    assert.equal(can("fraud-investigator", "audit:read"), false);
  });

  it("allows compliance to review approval evidence", () => {
    assert.equal(can("compliance-lead", "kyc:read"), true);
    assert.equal(can("compliance-lead", "aml:read"), true);
    assert.equal(can("compliance-lead", "investigations:read"), true);
    assert.equal(can("compliance-lead", "fraud:read"), true);
    assert.equal(can("compliance-lead", "approvals:review"), true);
    assert.equal(can("compliance-lead", "approvals:preview"), true);
    assert.equal(can("compliance-lead", "audit:read"), true);
    assert.equal(can("compliance-lead", "audit:export"), true);
  });

  it("grants custody visibility only to compliance, aml and auditor roles", () => {
    assert.equal(can("compliance-lead", "custody:read"), true);
    assert.equal(can("aml-investigator", "custody:read"), true);
    assert.equal(can("auditor", "custody:read"), true);
    assert.equal(can("support-l1", "custody:read"), false);
    assert.equal(can("fraud-investigator", "custody:read"), false);
    assert.equal(can("unknown", "custody:read"), false);
  });

  it("grants draft reports only to compliance and auditor read roles", () => {
    assert.equal(can("compliance-lead", "reports:read"), true);
    assert.equal(can("auditor", "reports:read"), true);
    assert.equal(can("support-l1", "reports:read"), false);
    assert.equal(can("aml-investigator", "reports:read"), false);
    assert.equal(can("fraud-investigator", "reports:read"), false);
    assert.equal(can("unknown", "reports:read"), false);
  });
});
