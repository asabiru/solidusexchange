import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  arrayOf,
  capabilitiesOf,
  checkStatusKeyOf,
  checkStatusOf,
  countToward,
  intOf,
  numberOf,
  operatorRoleKeyOf,
  operatorRoleOf,
  recordOf,
  rowsOf,
  subjectEntryLinkOf,
  subjectKindKeyOf,
  supportAuthorKeyOf,
  textOf,
  ticketChannelKeyOf,
  ticketPriorityKeyOf,
  ticketStatusKeyOf,
  ticketStatusOf,
  toneOf,
  truncatedOf,
  withdrawalDecisionKeyOf,
  withdrawalRoleKeyOf,
  withdrawalStatusKeyOf,
  withdrawalStatusOf
} from "./server-fields.js";

const source = readFileSync(new URL("../../src/app/App.tsx", import.meta.url), "utf8");

describe("arrayOf / rowsOf collection normalization", () => {
  it("degrades non-array server collections to empty lists", () => {
    for (const hostile of [undefined, null, {}, "x", 5, NaN, { length: 3 }, Object.create(null)]) {
      assert.deepEqual(arrayOf(hostile), []);
      assert.deepEqual(rowsOf(hostile), []);
    }
  });

  it("drops non-record rows so row.field access cannot dereference a primitive", () => {
    const rows = rowsOf<{ id: string }>([null, "x", 5, { id: "a" }, undefined, { id: "b" }]);
    assert.deepEqual(rows.map((row) => row.id), ["a", "b"]);
  });

  it("keeps well-formed arrays untouched", () => {
    const rows = [{ id: "a" }, { id: "b" }];
    assert.deepEqual(arrayOf(rows), rows);
    assert.deepEqual(rowsOf(rows), rows);
  });
});

describe("textOf / numeric coercion", () => {
  it("renders scalars and degrades objects, arrays and non-finite numbers", () => {
    assert.equal(textOf("ok"), "ok");
    assert.equal(textOf(5), "5");
    assert.equal(textOf(0), "0");
    for (const hostile of [{}, [], null, undefined, NaN, Infinity, -Infinity, true, () => 1, Symbol("x"), 10n]) {
      assert.equal(textOf(hostile), "—", typeof hostile);
      assert.equal(textOf(hostile, "?"), "?");
    }
  });

  it("truncates only over-long strings and keeps the fallback free of markers", () => {
    assert.equal(truncatedOf("abcdef", 3), "abc…");
    assert.equal(truncatedOf("abc", 3), "abc");
    assert.equal(truncatedOf(undefined, 16), "—");
    assert.equal(truncatedOf({}, 16), "—");
    assert.equal(truncatedOf(42, 2), "42");
  });

  it("rejects NaN, Infinity, fractions and non-numbers for numeric fields", () => {
    for (const hostile of [NaN, Infinity, -Infinity, "5", {}, [], null, undefined, true]) {
      assert.equal(numberOf(hostile), undefined);
      assert.equal(intOf(hostile), undefined);
    }
    assert.equal(intOf(1.5), undefined);
    assert.equal(intOf(4), 4);
    assert.equal(numberOf(1.5), 1.5);
    assert.equal(numberOf(0), 0);
  });

  it("clamps hostile chart counts to zero instead of emitting NaN coordinates", () => {
    for (const hostile of [NaN, Infinity, -Infinity, -3, "5", {}, [], null, undefined]) {
      assert.equal(countToward(hostile), 0);
    }
    assert.equal(countToward(7), 7);
    assert.equal(countToward(0), 0);
  });
});

describe("recordOf nested access", () => {
  it("degrades missing or non-object nested fields to an empty record", () => {
    for (const hostile of [undefined, null, "x", 5, NaN, true, []]) {
      assert.deepEqual(recordOf(hostile), {});
    }
    assert.equal(recordOf({ a: 1 }).a, 1);
  });
});

describe("toneOf whitelists data-tone values", () => {
  it("keeps the five supported tones", () => {
    for (const tone of ["neutral", "info", "success", "warning", "danger"]) {
      assert.equal(toneOf(tone), tone);
    }
  });

  it("maps foreign and prototype-member values to neutral", () => {
    for (const hostile of ["critical", "constructor", "toString", "__proto__", "hasOwnProperty", {}, [], null, undefined, 5]) {
      assert.equal(toneOf(hostile), "neutral");
    }
  });
});

describe("prototype-key lookups fail closed", () => {
  it("subjectEntryLinkOf never resolves inherited Object.prototype members", () => {
    for (const hostile of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf", "check ".trimEnd() + "x", {}, [], null, undefined]) {
      assert.equal(subjectEntryLinkOf(hostile), undefined);
    }
    assert.deepEqual(subjectEntryLinkOf("check"), { screen: "checks", capability: "checks:read" });
    assert.deepEqual(subjectEntryLinkOf("support"), { screen: "support", capability: "support:read" });
    assert.deepEqual(subjectEntryLinkOf("withdrawal"), { screen: "withdrawal", capability: "custody:read" });
    // Kinds without a dedicated screen stay unlinked even though they are whitelisted labels.
    assert.equal(subjectEntryLinkOf("kyc"), undefined);
  });

  it("enum accessors reject inherited members instead of fabricating labels", () => {
    for (const hostile of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      assert.equal(checkStatusKeyOf(hostile), undefined, hostile);
      assert.equal(ticketStatusKeyOf(hostile), undefined, hostile);
      assert.equal(ticketChannelKeyOf(hostile), undefined, hostile);
      assert.equal(ticketPriorityKeyOf(hostile), undefined, hostile);
      assert.equal(supportAuthorKeyOf(hostile), undefined, hostile);
      assert.equal(withdrawalStatusKeyOf(hostile), undefined, hostile);
      assert.equal(withdrawalRoleKeyOf(hostile), undefined, hostile);
      assert.equal(withdrawalDecisionKeyOf(hostile), undefined, hostile);
      assert.equal(subjectKindKeyOf(hostile), undefined, hostile);
      assert.equal(operatorRoleKeyOf(hostile), undefined, hostile);
    }
  });
});

describe("enum whitelists cover exactly the documented members", () => {
  it("check statuses", () => {
    for (const status of ["created", "waiting-recipient-kyc", "claimed", "cancelled", "expired"]) {
      assert.equal(checkStatusOf(status), status);
      assert.equal(checkStatusKeyOf(status), `checks.status.${status}`, status);
    }
    for (const hostile of ["settled", "blocked", {}, [], null, undefined, 5]) {
      assert.equal(checkStatusOf(hostile), undefined);
      assert.equal(checkStatusKeyOf(hostile), undefined);
    }
  });

  it("support ticket statuses, priorities, channels and authors", () => {
    for (const status of ["open", "pending-customer", "escalated", "resolved"]) {
      assert.equal(ticketStatusOf(status), status);
      assert.equal(ticketStatusKeyOf(status), `support.status.${status}`);
    }
    for (const priority of ["low", "normal", "high", "urgent"]) {
      assert.equal(ticketPriorityKeyOf(priority), `support.priority.${priority}`);
    }
    for (const channel of ["miniapp", "telegram"]) {
      assert.equal(ticketChannelKeyOf(channel), `support.channel.${channel}`);
    }
    for (const author of ["customer", "operator", "system"]) {
      assert.equal(supportAuthorKeyOf(author), `support.author.${author}`);
    }
    for (const hostile of ["closed", "email", "vip", "bot", {}, [], null, undefined, 5]) {
      assert.equal(ticketStatusKeyOf(hostile), undefined);
      assert.equal(ticketPriorityKeyOf(hostile), undefined);
      assert.equal(ticketChannelKeyOf(hostile), undefined);
      assert.equal(supportAuthorKeyOf(hostile), undefined);
    }
  });

  it("withdrawal statuses, roles and decisions", () => {
    for (const status of ["draft", "pending-approval", "screened", "broadcast", "confirmed", "rejected", "cancelled"]) {
      assert.equal(withdrawalStatusOf(status), status);
      assert.equal(withdrawalStatusKeyOf(status), `withdrawals.status.${status}`);
    }
    for (const role of ["custody_maker", "custody_checker"]) {
      assert.equal(withdrawalRoleKeyOf(role), `withdrawals.role.${role}`);
    }
    for (const decision of ["pending", "approved", "rejected"]) {
      assert.equal(withdrawalDecisionKeyOf(decision), `withdrawals.decision.${decision}`);
    }
    for (const hostile of ["executed", "owner", "maybe", {}, [], null, undefined, 5]) {
      assert.equal(withdrawalStatusKeyOf(hostile), undefined);
      assert.equal(withdrawalRoleKeyOf(hostile), undefined);
      assert.equal(withdrawalDecisionKeyOf(hostile), undefined);
    }
  });

  it("subject kinds and operator roles", () => {
    for (const kind of ["check", "support", "withdrawal", "kyc", "aml", "investigation", "fraud-alert", "audit"]) {
      assert.equal(subjectKindKeyOf(kind), `subjects.kind.${kind}`);
    }
    for (const role of ["compliance-lead", "support-l1", "aml-investigator", "fraud-investigator", "auditor"]) {
      assert.equal(operatorRoleOf(role), role);
      assert.equal(operatorRoleKeyOf(role), `role.${role}`);
    }
    for (const hostile of ["payment", "admin", {}, [], null, undefined, 5]) {
      assert.equal(subjectKindKeyOf(hostile), undefined);
      assert.equal(operatorRoleOf(hostile), undefined);
      assert.equal(operatorRoleKeyOf(hostile), undefined);
    }
  });
});

describe("capabilitiesOf", () => {
  it("grants nothing when the operator or the capability list is malformed", () => {
    assert.deepEqual(capabilitiesOf(undefined), []);
    assert.deepEqual(capabilitiesOf(null), []);
    assert.deepEqual(capabilitiesOf("x"), []);
    assert.deepEqual(capabilitiesOf({ capabilities: "checks:read" }), []);
    assert.deepEqual(capabilitiesOf({ capabilities: { "checks:read": true } }), []);
    assert.deepEqual(capabilitiesOf({ capabilities: ["checks:read"] }), ["checks:read"]);
  });
});

describe("App.tsx hostile-data wiring", () => {
  it("renders server collections only through the normalization guards", () => {
    assert.doesNotMatch(source, /data\.(?:metrics|queues|customers|cases|alerts|approvals|events|reports)\.(?:map|filter|length|some|find|forEach|reduce)|feed\.cases\.(?:map|filter|length)/);
    assert.doesNotMatch(source, /operator\??\.capabilities\??\.(?:includes|map|filter)|session\??\.operator\??\.capabilities\b/);
    assert.match(source, /capabilitiesOf\(session\?\.operator\)/);
  });

  it("never interpolates a server enum straight into a message key", () => {
    assert.doesNotMatch(
      source,
      /t\(`(?:checks\.status|support\.status|support\.priority|support\.channel|support\.author|withdrawals\.status|withdrawals\.role|withdrawals\.decision|subjects\.kind)\.\$\{/
    );
  });

  it("never indexes the subject-entry link map directly (prototype members must not resolve)", () => {
    assert.doesNotMatch(source, /subjectEntryLinks\[/);
    assert.match(source, /subjectEntryLinkOf\(entry\.kind\)/);
  });

  it("never slices or lowercases an unvalidated server string", () => {
    assert.doesNotMatch(source, /(?:item|row|record|entry|detail|customer|check|alert|intent|ticket|approval|metric|report|section|step|message|note|preview|chain|command|policy|subject|selected)\.(?:digest|hash|headHash|previousHash|providerReference|at|occurredAt|createdAt|updatedAt|expiresAt|decidedAt|lastReviewedAt|detectedAt|openedAt)\.slice\(/);
    assert.doesNotMatch(source, /value\.toLocaleLowerCase\(/);
  });
});
