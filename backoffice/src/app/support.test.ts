import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { can } from "../auth/access.js";
import { supportTicketStatuses } from "../server/support.js";
import { demoRepository, type SupportTicketStatus } from "../data/demo.js";
import { hasMessage } from "./i18n.js";
import { navigation } from "./navigation.js";

const docStatuses = [
  "open",
  "pending-customer",
  "escalated",
  "resolved"
] as const satisfies readonly SupportTicketStatus[];

describe("support desk wiring", () => {
  it("exposes a support screen gated by the support:read capability", () => {
    const item = navigation.find((entry) => entry.id === "support");
    assert.ok(item);
    assert.equal(item.group, "service");
    assert.equal(item.capability, "support:read");
    assert.equal(item.implemented, true);
    for (const role of ["compliance-lead", "support-l1", "aml-investigator", "auditor"]) {
      assert.equal(can(role, "support:read"), true, role);
    }
    assert.equal(can("fraud-investigator", "support:read"), false);
  });

  it("covers every documented ticket status with data and a localized label", () => {
    assert.deepEqual([...supportTicketStatuses], [...docStatuses]);
    const statuses = new Set(demoRepository.supportTickets().map((ticket) => ticket.status));
    for (const status of docStatuses) {
      assert.ok(statuses.has(status), status);
      assert.equal(hasMessage(`support.status.${status}`), true, status);
    }
    assert.equal(hasMessage("support.status.all"), true);
    assert.equal(hasMessage("screen.support"), true);
  });

  it("keeps disputed amounts exact decimal strings and carries no command surface", () => {
    for (const ticket of demoRepository.supportTickets()) {
      assert.match(ticket.id, /^SUP-\d{6}$/);
      assert.match(ticket.subject, /^sim-/);
      assert.ok(["miniapp", "telegram"].includes(ticket.channel));
      if (ticket.disputedAmount) assert.match(ticket.disputedAmount, /^\d+\.\d+$/);
      assert.ok(ticket.messages.length > 0);
      assert.ok(ticket.internalNotes.length > 0);
      assert.match(ticket.auditEvidenceDigest, /^sha256:[0-9a-f]+$/);
      assert.deepEqual(
        Object.keys(ticket).filter((key) => /reply|assign|execute|command|action/i.test(key)),
        []
      );
    }
  });
});
