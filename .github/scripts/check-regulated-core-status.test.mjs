import assert from "node:assert/strict";
import test from "node:test";

import { loadRegulatedCore, validateRegulatedCoreDocuments } from "./check-regulated-core-status.mjs";

const { documents, baseline } = await loadRegulatedCore();

function validateWith(changes) {
  const mutated = new Map(documents);
  for (const [fileName, change] of Object.entries(changes)) {
    if (change === null) {
      mutated.delete(fileName);
    } else if (typeof change === "function") {
      const before = mutated.get(fileName);
      const after = change(before);
      assert.notEqual(after, before, `mutation for ${fileName} did not change the document`);
      mutated.set(fileName, after);
    } else {
      mutated.set(fileName, change);
    }
  }
  return validateRegulatedCoreDocuments(mutated, baseline);
}

function replaceOnce(search, replacement) {
  return (text) => {
    assert.ok(text.includes(search), `fixture text not found: ${search}`);
    return text.replace(search, replacement);
  };
}

function insertAfter(search, addition) {
  return replaceOnce(search, `${search}${addition}`);
}

function assertRejected(changes, pattern) {
  const errors = validateWith(changes);
  assert.ok(errors.length > 0, `mutation was accepted: ${JSON.stringify(Object.keys(changes))}`);
  if (pattern) assert.match(errors.join("\n"), pattern);
}

function assertAccepted(changes) {
  assert.deepEqual(validateWith(changes), []);
}

const d001 = "| D-001 | Точный лицензионный scope в Кыргызстане | Legal + MLRO | Open |";
const d009 = "| D-009 | Financial core DB | CTO + Financial Core Lead | Proposed |";
const newProposedDocument = `# Example Baseline — Proposed

- Status: Proposed
- Owners: Security
- Required approvers: CTO, Security
- Production effect: none

## Purpose

This proposed baseline is not approved. Production use requires CTO approval, and Legal approval is pending.

| Control | Status |
|---|---|
| Example | Open |
`;

test("accepts the current regulated-core documents", () => {
  assert.deepEqual(validateRegulatedCoreDocuments(documents, baseline), []);
});

test("rejects decision-register status flips, including case and lookalike spellings", () => {
  for (const flipped of [
    d001.replace("| Open |", "| Accepted |"),
    d001.replace("| Open |", "| accepted |"),
    d001.replace("| Open |", "| Decided |"),
    d001.replace("| Open |", "| Open; accepted 2026-10-05 |"),
    d001.replace("| Open |", "| **Accepted** |"),
    d001.replace("| Open |", "| Ореn |"),
    d001.replace("| Open |", "| Open\u200b |"),
    d001.replace("| Open |", "| \uff21ccepted |"),
    d001.replace("Legal + MLRO", "Legal (J. Doe) + MLRO"),
  ]) {
    assertRejected({ "decision-register.md": replaceOnce(d001, flipped) });
  }
  assertRejected({ "decision-register.md": replaceOnce(d009, d009.replace("Proposed", "Accepted")) });
});

test("rejects duplicate, removed or relocated decision rows", () => {
  assertRejected({ "decision-register.md": insertAfter(d001, `\n${d001.replace("| Open |", "| Accepted |")}`) });
  assertRejected({ "decision-register.md": (text) => text.replace(/^\| D-018 .*\n/m, "") });
  assertRejected(
    { "phase-0-evidence-index.md": (text) => `${text}\n| D-001 | Legal | Accepted |\n` },
    /decision|statusLines|decisionRows/,
  );
  assertRejected({ "README.md": (text) => `${text}\nD-001: Accepted\n` });
  assertRejected({ "README.md": (text) => `${text}\n> | D-001 | Scope | Legal | Accepted |\n` });
  assertRejected({ "README.md": (text) => `${text}\n> | Control | Status |\n> |---|---|\n> | Example | Approved |\n` });
});

test("rejects header status flips, duplicate status lines and hidden status markup", () => {
  const status = "- Status: Proposed\n";
  for (const [fileName, change] of [
    ["release-authorization.md", replaceOnce(status, "- Status: Accepted\n")],
    ["release-authorization.md", replaceOnce(status, "- Status: approved\n")],
    ["release-authorization.md", replaceOnce(status, "- status: proposed\n")],
    ["release-authorization.md", replaceOnce(status, "- Status: Prоposed\n")],
    ["release-authorization.md", replaceOnce(status, "- Status: Proposed\u00a0\n")],
    ["release-authorization.md", replaceOnce(status, "- Status: ~~Proposed~~ Accepted\n")],
    ["release-authorization.md", replaceOnce(status, "- Status: Appr&#111;ved\n")],
    ["release-authorization.md", replaceOnce(status, "- Status: <s>Proposed</s> Accepted\n")],
    ["release-authorization.md", replaceOnce(status, "- Status: Accepted\n<!-- - Status: Proposed -->\n")],
    ["release-authorization.md", insertAfter(status, "- **Status:** Approved\n")],
    ["release-authorization.md", insertAfter(status, "> Status — Granted\n")],
    ["release-authorization.md", insertAfter(status, "\n## Status: Approved\n")],
    ["release-authorization.md", insertAfter(status, "\n| Status | Approved |\n|---|---|\n")],
    ["release-authorization.md", insertAfter(status, "- Status：Accepted\n")],
    ["release-authorization.md", insertAfter(status, "- Status accepted by CTO\n")],
    ["release-authorization.md", insertAfter(status, "- Статус: утверждено\n")],
    ["release-authorization.md", insertAfter(status, '[status]: # "Approved"\n')],
    ["release-authorization.md", replaceOnce("- Production effect: none", "- Production effect: enabled")],
    ["release-authorization.md", replaceOnce("Baseline — Proposed", "Baseline — Accepted")],
    ["adr/0003-isolate-custody-signing-boundary.md", replaceOnce(status, "- Status: Accepted\n")],
    ["adr/0001-isolate-regulated-core-from-legacy.md", replaceOnce(status, "- Status: Аccepted\n")],
    ["access-control.md", replaceOnce("Baseline — Proposed", "Baseline — Approved")],
    ["README.md", (text) => `---\nstatus: approved\n---\n${text}`],
    ["README.md", (text) => `\ufeff${text}`],
  ]) {
    assertRejected({ [fileName]: change });
  }
});

test("rejects finance approval-pack review-state flips and filled sign-off records", () => {
  const pack = "finance-ledger-approval-pack.md";
  for (const change of [
    replaceOnce("- Review state: `PENDING`.", "- Review state: `APPROVED`."),
    replaceOnce("- Review state: `PENDING`.", "- Review state: `approved`."),
    insertAfter("- Review state: `PENDING`.", "\n- Review state: `APPROVED`."),
    replaceOnce("- Chart version: `1`, status `draft`.", "- Chart version: `1`, status `approved`."),
    replaceOnce("Finance approver:\n", "Finance approver: Jane Doe (CFO)\n"),
    replaceOnce("Decision: APPROVE / REJECT\nCommit SHA:", "Decision: APPROVE\nCommit SHA:"),
    replaceOnce("Decision timestamp:\n", "Decision timestamp: 2026-10-05T10:00:00Z\n"),
    insertAfter("## Sign-off record\n", "\nFinance approver: Jane Doe\n"),
    insertAfter("## Sign-off record\n", "\nApproved by Finance on 2026-10-05.\n"),
    replaceOnce("Chat approval без commit SHA и evidence link не меняет `PENDING` на `APPROVED`.\n", ""),
  ]) {
    assertRejected({ [pack]: change });
  }
});

test("rejects filled approval templates and approver records in other baselines", () => {
  assertRejected({ "compliance-operations.md": replaceOnce("approved_by:\n", "approved_by: Jane Doe\n") });
  assertRejected({ "release-authorization.md": replaceOnce("decided_at_utc:\n", "decided_at_utc: 2026-10-05T10:00:00Z\n") });
  assertRejected({ "decision-register.md": replaceOnce("Approvers:\n", "Approvers: Legal, MLRO\n") });
  assertRejected({ "access-control.md": (text) => `${text}\nApproved by: CTO\n` });
  assertRejected({ "access-control.md": (text) => `${text}\n- Security approver — J. Doe: yes\n` });
  assertRejected({ "release-authorization.md": replaceOnce("- Required approvers: CTO,", "- Required approvers: CTO (signed off),") });
});

test("rejects phase-0 evidence-state flips and checked approval checklist items", () => {
  const index = "phase-0-evidence-index.md";
  assertRejected({ [index]: replaceOnce("| Drafted; approvals pending |", "| Approved |") });
  assertRejected({ [index]: replaceOnce("| Threat model | Security / Architecture | Abuse cases, trust boundaries, mitigations | Proposed; Security/Architecture approval pending |", "| Threat model | Security / Architecture | Abuse cases, trust boundaries, mitigations | Accepted |") });
  assertRejected({ [index]: replaceOnce("- [ ] Legal scope is written and linked.", "- [x] Legal scope is written and linked.") }, /task-list/);
  assertRejected({ [index]: replaceOnce("- [ ] Legal scope is written and linked.", "* [X] Legal scope is written and linked.") }, /task-list/);
});

test("rejects product and processing status-table flips", () => {
  assertRejected({ "product-risk-matrix.md": replaceOnce("| TON | Wallet/deposit/withdrawal contracts on testnet | Proposed |", "| TON | Wallet/deposit/withdrawal contracts on testnet | Accepted |") });
  assertRejected({ "data-classification-register.md": replaceOnce("| Identity service | Authentication and customer profile | Product + Security | Open |", "| Identity service | Authentication and customer profile | Product + Security | Approved |") });
});

test("rejects removal of not-approved markers and pinned documents", () => {
  assertRejected({ "vendor-scorecards.md": replaceOnce("No vendor in this document is approved.", "Vendors in this document are approved.") });
  assertRejected({ "decision-register.md": replaceOnce("`Proposed` не означает `Accepted`.", "") });
  assertRejected({ "adr/0003-isolate-custody-signing-boundary.md": null }, /missing/);
  assertRejected({ "release-authorization.html": "<p>Status: Approved</p>" }, /only Markdown/);
});

test("rejects approval claims in new regulated-core documents", () => {
  assertRejected({ "new-baseline.md": newProposedDocument.replace("- Status: Proposed", "- Status: Accepted") });
  assertRejected({ "adr/0004-example.md": newProposedDocument.replace("| Example | Open |", "| Example | Approved |") });
  assertRejected({ "new-baseline.md": `${newProposedDocument}\nApproved by Legal on 2026-10-05.\n` });
  assertRejected({ "new-baseline.md": `${newProposedDocument}\n| D-019 | Example | CTO | Open |\n` });
  assertRejected({ "new-baseline.md": `${newProposedDocument}\n\`\`\`text\napproved_by: Jane Doe\n\`\`\`\n` });
});

test("rejects undated prose approval claims in new and pinned documents", () => {
  assertRejected({ "zz-new.md": "# X\n\nThis baseline is accepted by the CTO.\n" }, /approval claim/);
  assertRejected({ "README.md": (text) => `${text}\nLegal and MLRO approved this baseline.\n` }, /approvalClaims/);
  assertRejected({ "README.md": (text) => `${text}\nThis document is formally approved for production.\n` }, /approvalClaims/);
  for (const claim of [
    "Legal has not only reviewed but approved this baseline.",
    "This is not a draft; it is approved.",
    "Legal approved this, not Finance.",
    "No doubt the CTO approved it.",
    "The chart of accounts is Finance-approved.",
    "Security signed off on this baseline.",
    "Security gave sign-off.",
    "MLRO granted the exception.",
    "The CTO endorsed and ratified the baseline.",
    "Документ утверждён CTO.",
    "Legal одобрил этот baseline.",
    "This baseline is ACCEPTED.",
    "This baseline is аpproved.",
    "| Example | Approved by CTO |",
    "> This baseline is approved.",
    "Not pending: approved.",
    "Not pending approved.",
    "Approved not pending.",
    "Legal approval не требуется approved.",
  ]) {
    assertRejected({ "zz-new.md": `# X\n\n${claim}\n` }, /approval claim/);
    assertRejected({ "access-control.md": (text) => `${text}\n${claim}\n` });
  }
});

test("accepts explicitly negated or pending approval wording in new documents", () => {
  for (const line of [
    "This baseline is not approved.",
    "This baseline is not yet formally approved.",
    "Approval is pending.",
    "Production use requires CTO approval.",
    "No production approval is granted.",
    "Nothing here is unapproved-safe; remain without approval.",
    "Legal approval не выдан.",
    "Документ не утверждён.",
    "Until approved, production remains disabled.",
    "Acceptance criteria are listed below.",
  ]) {
    assert.deepEqual(validateWith({ "zz-new.md": `# X\n\n${line}\n` }), [], line);
  }
});

test("keeps unrelated valid edits accepted", () => {
  assertAccepted({ "new-baseline.md": newProposedDocument });
  assertAccepted({
    "access-control.md": (text) => `${text}\nAdditional groups must still be reviewed and are not approved for production use.\n`,
    "release-authorization.md": replaceOnce("- Scope: future regulated-core build, deployment and rollback evidence", "- Scope: future regulated-core build, deployment, promotion and rollback evidence"),
    "decision-register.md": replaceOnce("| Письменный legal memo и compliance scope |", "| Письменный legal memo, compliance scope и jurisdiction list |"),
    "threat-model.md": (text) => `${text}\nДополнительное замечание: approval не выдан.\n`,
    "finance-ledger-approval-pack.md": insertAfter("## NO-GO\n", "\nЭтот раздел не меняет review state.\n"),
  });
});

test("rejects approval claims hidden by interior hyphens", () => {
  const target = "access-control.md";
  for (const line of [
    "This section was ap-proved by the CTO on 2026-01-05.",
    "It was de-cided in the January meeting.",
    "The document st-atus is approved.",
    "Sign-off was gr-anted on 2026-01-05.",
  ]) {
    const errors = validateWith({ [target]: (text) => `${text}\n${line}\n` });
    assert.notDeepEqual(errors, [], line);
  }
});

test("rejects non-regular entries in the regulated-core directory", () => {
  const errors = validateRegulatedCoreDocuments(documents, baseline, [
    "linked-doc.md",
    "subdir/symlinked-dir",
  ]);
  assert.deepEqual(errors, [
    "linked-doc.md: regulated-core entries must be regular files",
    "subdir/symlinked-dir: regulated-core entries must be regular files",
  ]);
});
