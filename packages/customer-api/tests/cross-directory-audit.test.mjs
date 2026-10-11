import assert from "node:assert/strict";
import test from "node:test";

// Cross-directory consistency audit (wave 53): every served-read directory is
// compared against the class-wide conventions — fail-closed validators that
// pin the same invariants the generator emits, deep-frozen deterministic
// views, subject isolation and disjoint id namespaces. Each regression case
// below was accepted by the pre-audit validators and must now be rejected.
// See Documentation/regulated-core/customer-api-directories-audit-wave53.md.

import { evaluateOperatorCapabilities } from "../src/capabilities.mjs";
import { createSyntheticWalletDirectory, validWalletsView } from "../src/wallets.mjs";
import {
  createSyntheticNotificationDirectory,
  validNotificationsView
} from "../src/notifications.mjs";
import {
  createSyntheticKycApplicationDirectory,
  validKycStatusView
} from "../src/kyc.mjs";
import { createSyntheticProfileDirectory, validProfileView } from "../src/profile.mjs";
import { createSyntheticSupportDirectory, validSupportTicketsView } from "../src/support.mjs";
import {
  createSyntheticAuthSessionDirectory,
  validAuthSessionsView
} from "../src/auth-sessions.mjs";
import { createSyntheticUserDirectory, validUserView } from "../src/users.mjs";
import { createSyntheticDepositDirectory, validDepositsView } from "../src/deposits.mjs";
import {
  createSyntheticWithdrawalDirectory,
  validWithdrawalsView
} from "../src/withdrawals.mjs";
import { createSyntheticQuoteDirectory, validQuotesView } from "../src/quotes.mjs";
import {
  createSyntheticExchangeOrderDirectory,
  createSyntheticMarketDirectory,
  createSyntheticTradeDirectory,
  validExchangeOrdersView,
  validMarketDepthView,
  validMarketsView, validTradesView
} from "../src/exchange-orders.mjs";
import { createSyntheticPaymentDirectory, validPaymentsView } from "../src/payments.mjs";
import { createSyntheticCardDirectory, validCardsView } from "../src/cards.mjs";
import { createSyntheticCheckDirectory, validChecksView } from "../src/checks.mjs";
import { createSyntheticActivityDirectory, validActivityView } from "../src/activity.mjs";
import {
  createSyntheticOperationDirectory,
  validOperationsView
} from "../src/operations.mjs";
import {
  createSyntheticDepositAddressDirectory,
  validDepositAddressesView
} from "../src/deposit-addresses.mjs";
import {
  createSyntheticAddressScreeningDirectory,
  validAddressScreeningsView
} from "../src/address-screenings.mjs";
import {
  createSyntheticOperatorDirectory,
  operatorCapabilitiesViewFor,
  validOperatorAdminView,
  validOperatorCapabilitiesView
} from "../src/operator.mjs";
import { SUBJECT, VERIFIED_SUBJECT } from "./http-client.mjs";

const SUBJECT_B = "syn_cust_bbbbbbbb";

/** @param {unknown} value */
const clone = (value) => JSON.parse(JSON.stringify(value));

// Every served directory: factory plus a way to build the default view and a
// runtime validator. The audit pins class invariants once, not per file.
const DIRECTORIES = [
  {
    name: "wallets",
    make: () => createSyntheticWalletDirectory(),
    call: (directory, subject) => directory.listFor(subject),
    valid: validWalletsView
  },
  {
    name: "notifications",
    make: () => createSyntheticNotificationDirectory(),
    call: (directory, subject) => directory.listFor(subject),
    valid: validNotificationsView
  },
  {
    name: "profile",
    make: () => createSyntheticProfileDirectory(),
    call: (directory, subject) => directory.viewFor(subject),
    valid: validProfileView
  },
  {
    name: "support",
    make: () => createSyntheticSupportDirectory(),
    call: (directory, subject) => directory.listFor(subject),
    valid: validSupportTicketsView
  },
  {
    name: "auth-sessions",
    make: () => createSyntheticAuthSessionDirectory(),
    call: (directory, subject) => directory.listFor(subject),
    valid: validAuthSessionsView
  },
  {
    name: "users",
    make: () => createSyntheticUserDirectory(),
    call: (directory, subject) => directory.viewFor(subject),
    valid: validUserView
  },
  {
    name: "deposits",
    make: () => createSyntheticDepositDirectory(),
    call: (directory, subject) => directory.listFor(subject),
    valid: validDepositsView
  },
  {
    name: "withdrawals",
    make: () => createSyntheticWithdrawalDirectory(),
    call: (directory, subject) => directory.listFor(subject),
    valid: validWithdrawalsView
  },
  {
    name: "quotes",
    make: () => createSyntheticQuoteDirectory(),
    call: (directory, subject) => directory.listFor(subject),
    valid: validQuotesView
  },
  {
    name: "exchange-orders",
    make: () => createSyntheticExchangeOrderDirectory(),
    call: (directory, subject) => directory.listFor(subject),
    valid: validExchangeOrdersView
  },
  {
    name: "trades",
    make: () => createSyntheticTradeDirectory(),
    call: (directory, subject) => directory.listFor(subject),
    valid: validTradesView,
    // A trade's order_id is a foreign key back to the order its leg
    // executed on — the id is minted by the exchange-orders namespace,
    // not by the trades directory, so the namespace-disjointness pin
    // excludes it (the cross-subject leak check still sees it: the ord_*
    // digest is subject-scoped either way).
    references: new Set(["order_id"])
  },
  {
    name: "markets",
    make: () => createSyntheticMarketDirectory(),
    call: (directory, subject) => directory.listFor(subject),
    valid: validMarketsView
  },
  {
    // The depth member read is a fourth projection of the same replay —
    // the audit pins it holding no per-subject state like every listFor.
    name: "market-depth",
    make: () => createSyntheticMarketDirectory(),
    call: (directory, subject) => directory.depthFor(subject, "USDT/RUB"),
    valid: validMarketDepthView
  },
  {
    name: "payments",
    make: () => createSyntheticPaymentDirectory(),
    call: (directory, subject) => directory.listFor(subject),
    valid: validPaymentsView
  },
  {
    name: "cards",
    make: () => createSyntheticCardDirectory(),
    call: (directory, subject) => directory.listFor(subject),
    valid: validCardsView
  },
  {
    name: "checks",
    make: () => createSyntheticCheckDirectory(),
    call: (directory, subject) => directory.viewFor(subject),
    valid: validChecksView
  },
  {
    name: "activity",
    make: () => createSyntheticActivityDirectory(),
    call: (directory, subject) => directory.viewFor(subject),
    valid: validActivityView
  },
  {
    name: "operations",
    make: () => createSyntheticOperationDirectory(),
    call: (directory, subject) => directory.viewFor(subject),
    valid: validOperationsView
  },
  {
    name: "deposit-addresses",
    make: () => createSyntheticDepositAddressDirectory(),
    call: (directory, subject) => directory.listFor(subject),
    valid: validDepositAddressesView
  },
  {
    name: "address-screenings",
    make: () => createSyntheticAddressScreeningDirectory(),
    call: (directory, subject) => directory.listFor(subject),
    valid: validAddressScreeningsView
  }
];

const ID_FIELD = /"(?<key>[a-z_]*(?:id|reference|ref))":\s*"(?<id>[a-z_]+_[0-9a-fA-Z]{4,40})"/gu;

/** @param {unknown} value */
function deepFrozen(value) {
  if (value === null || typeof value !== "object") {
    return true;
  }
  if (!Object.isFrozen(value)) {
    return false;
  }
  const entries = Array.isArray(value) ? value : Object.values(value);
  return entries.every(deepFrozen);
}

test("served directories hold no per-subject state between calls", async () => {
  // A retained memo grows without bound across distinct subjects and lets a
  // caller mutate shared state; every call must rebuild a fresh view whose
  // content stays byte-identical.
  for (const { name, make, call } of DIRECTORIES) {
    const directory = make();
    const first = await call(directory, VERIFIED_SUBJECT);
    for (let index = 0; index < 40; index += 1) {
      await call(directory, `syn_cust_probe${index}`);
    }
    const second = await call(directory, VERIFIED_SUBJECT);
    assert.notEqual(first, second, name);
    assert.deepEqual(second, first, name);
  }
});

test("served views are deep-frozen and deterministic across instances", async () => {
  for (const { name, make, call } of DIRECTORIES) {
    const one = await call(make(), VERIFIED_SUBJECT);
    const two = await call(make(), VERIFIED_SUBJECT);
    assert.deepEqual(two, one, `${name} deterministic`);
    assert.equal(deepFrozen(one), true, `${name} deep-frozen`);
  }
});

test("no subject's minted ids appear inside another subject's views", async () => {
  const idsOfA = new Set();
  for (const { make, call } of DIRECTORIES) {
    const view = await call(make(), SUBJECT);
    for (const match of JSON.stringify(view).matchAll(ID_FIELD)) {
      idsOfA.add(match.groups.id);
    }
  }
  assert.ok(idsOfA.size > 0);
  for (const { name, make, call } of DIRECTORIES) {
    const view = await call(make(), SUBJECT_B);
    for (const match of JSON.stringify(view).matchAll(ID_FIELD)) {
      assert.equal(idsOfA.has(match.groups.id), false, `${name} leaked ${match.groups.id}`);
    }
  }
});

test("id namespaces stay disjoint across every served directory", async () => {
  const seen = new Map();
  for (const { name, make, call, references } of DIRECTORIES) {
    const view = await call(make(), VERIFIED_SUBJECT);
    for (const match of JSON.stringify(view).matchAll(ID_FIELD)) {
      // Foreign-key fields name an id another directory minted — they are
      // references, not mints, so they cannot collide with their owner.
      if (references?.has(match.groups.key)) {
        continue;
      }
      const owner = seen.get(match.groups.id);
      assert.equal(owner, undefined, `${name} collides with ${String(owner)} on ${match.groups.id}`);
      seen.set(match.groups.id, name);
    }
  }
});

test("wallets validator pins the fixed asset table and per-asset scale", async () => {
  const view = await createSyntheticWalletDirectory().listFor(VERIFIED_SUBJECT);
  const foreign = clone(view);
  foreign.wallets[0].asset = "BTC";
  assert.equal(validWalletsView(foreign), false);
  const duplicate = clone(view);
  duplicate.wallets[1].asset = duplicate.wallets[0].asset;
  assert.equal(validWalletsView(duplicate), false);
  const missing = clone(view);
  missing.wallets.pop();
  assert.equal(validWalletsView(missing), false);
  const offScale = clone(view);
  offScale.wallets[0].available = `${offScale.wallets[0].available}5`;
  assert.equal(validWalletsView(offScale), false);
  assert.equal(validWalletsView(view), true);
});

test("notifications validator pins contract constants, enum, id and recount", async () => {
  const view = await createSyntheticNotificationDirectory().listFor(VERIFIED_SUBJECT);
  const mutations = [
    (copy) => {
      copy.notifications[0].channel = "email";
    },
    (copy) => {
      copy.notifications[0].locale = "en";
    },
    (copy) => {
      copy.notifications[0].delivered = true;
    },
    (copy) => {
      copy.notifications[0].mode = "live";
    },
    (copy) => {
      copy.notifications[0].template = "bogus";
    },
    (copy) => {
      copy.notifications[0].text = "";
    },
    (copy) => {
      copy.notifications[0].text = "x".repeat(200);
    },
    (copy) => {
      copy.notifications[0].notification_id = "bogus_id";
    },
    (copy) => {
      copy.unread = copy.unread + 1;
    }
  ];
  for (const mutate of mutations) {
    const copy = clone(view);
    mutate(copy);
    assert.equal(validNotificationsView(copy), false, JSON.stringify(copy.notifications[0]));
  }
  assert.equal(validNotificationsView(view), true);
});

test("support validator pins the lifecycle prefix, expiry and complaint flag", async () => {
  const view = await createSyntheticSupportDirectory().listFor(VERIFIED_SUBJECT);
  const reordered = clone(view);
  reordered.tickets[0].timeline[0].status = "closed";
  assert.equal(validSupportTicketsView(reordered), false);
  const shifted = clone(view);
  shifted.tickets[0].timeline[0].at = "2030-01-01T00:00:00.000Z";
  assert.equal(validSupportTicketsView(shifted), false);
  const expiring = clone(view);
  expiring.tickets[0].expires_at = expiring.tickets[0].created_at;
  assert.equal(validSupportTicketsView(expiring), false);
  const complaint = clone(view);
  complaint.tickets[0].complaint_acknowledged = complaint.tickets[0].category !== "complaint";
  assert.equal(validSupportTicketsView(complaint), false);
  assert.equal(validSupportTicketsView(view), true);
});

test("kyc validator pins session coherence and per-status optional fields", async () => {
  const directory = createSyntheticKycApplicationDirectory();
  const unverified = await directory.viewFor(VERIFIED_SUBJECT, "unverified");
  const approved = clone(unverified);
  approved.status = "approved";
  approved.application_id = "kyc_0123456789abcdef01234567";
  approved.submitted_at = approved.updated_at;
  assert.equal(validKycStatusView(approved), false);
  const inReview = clone(unverified);
  inReview.status = "in_review";
  assert.equal(validKycStatusView(inReview), false);
  const resubmit = clone(unverified);
  resubmit.can_submit = !resubmit.can_submit;
  assert.equal(validKycStatusView(resubmit), false);

  const pending = await directory.viewFor(VERIFIED_SUBJECT, "pending");
  const pendingApproved = clone(pending);
  pendingApproved.status = "approved";
  assert.equal(validKycStatusView(pendingApproved), false);
  const pendingDropped = clone(pending);
  delete pendingDropped.application_id;
  delete pendingDropped.submitted_at;
  assert.equal(validKycStatusView(pendingDropped), false);

  const verified = await directory.viewFor(VERIFIED_SUBJECT, "verified");
  assert.equal(validKycStatusView(unverified), true);
  assert.equal(validKycStatusView(pending), true);
  assert.equal(validKycStatusView(verified), true);
});

test("deposits validator pins the per-status totals and ordering lifecycle", async () => {
  const view = await createSyntheticDepositDirectory().listFor(VERIFIED_SUBJECT);
  const awaiting = clone(view);
  awaiting.deposits[0].status = "awaiting_payment";
  awaiting.deposits[0].received_total = awaiting.deposits[0].expected_amount;
  assert.equal(validDepositsView(awaiting), false);
  const reversed = clone(view);
  reversed.deposits[0].status = "payment_reversed";
  reversed.deposits[0].reversed_total = reversed.deposits[0].expected_amount;
  reversed.deposits[0].received_total = "0.00";
  assert.equal(validDepositsView(reversed), false);
  const backwards = clone(view);
  backwards.deposits[0].updated_at = "2020-01-01T00:00:00.000Z";
  assert.equal(validDepositsView(backwards), false);
  assert.equal(validDepositsView(view), true);
});

test("withdrawals validator pins the fixed TTL and per-status timestamps", async () => {
  const view = await createSyntheticWithdrawalDirectory().listFor(VERIFIED_SUBJECT);
  const draft = clone(view);
  draft.withdrawals[0].status = "draft";
  draft.withdrawals[0].updated_at = "2030-01-01T00:00:00.000Z";
  assert.equal(validWithdrawalsView(draft), false);
  const ttl = clone(view);
  ttl.withdrawals[0].expires_at = "2030-01-01T00:00:00.000Z";
  assert.equal(validWithdrawalsView(ttl), false);
  const backwards = clone(view);
  backwards.withdrawals[0].updated_at = "2020-01-01T00:00:00.000Z";
  assert.equal(validWithdrawalsView(backwards), false);
  assert.equal(validWithdrawalsView(view), true);
});

test("activity and operations validators pin one entry per kind", async () => {
  const activity = await createSyntheticActivityDirectory().viewFor(VERIFIED_SUBJECT);
  if (activity.activity.length > 1) {
    const copy = clone(activity);
    for (const key of ["kind", "status", "money", "detail", "title"]) {
      copy.activity[1][key] = clone(copy.activity[0][key]);
    }
    assert.equal(validActivityView(copy), false);
  }
  assert.equal(validActivityView(activity), true);

  const operations = await createSyntheticOperationDirectory().viewFor(VERIFIED_SUBJECT);
  if (operations.operations.length > 1) {
    const copy = clone(operations);
    const source = copy.operations.find((item) => item.kind !== "exchange") ?? copy.operations[0];
    const target = copy.operations.find((item) => item !== source);
    target.kind = source.kind;
    target.status = source.status;
    target.legs = clone(source.legs);
    target.exchange = clone(source.exchange);
    assert.equal(validOperationsView(copy), false);
  }
  assert.equal(validOperationsView(operations), true);
});

test("operations validator pins the timeline inside the creation window", async () => {
  const view = await createSyntheticOperationDirectory().viewFor(VERIFIED_SUBJECT);
  const future = clone(view);
  future.operations[0].timeline.at(-1).at = "2035-01-01T00:00:00.000Z";
  assert.equal(validOperationsView(future), false);
  const unsorted = clone(view);
  const steps = unsorted.operations[0].timeline;
  if (steps.length > 1) {
    const first = steps[0].at;
    steps[0].at = steps.at(-1).at;
    steps.at(-1).at = first;
    assert.equal(validOperationsView(unsorted), false);
  }
  assert.equal(validOperationsView(view), true);
});

test("operator validators pin the echo to the declared capability vocabulary", async () => {
  const { granted } = evaluateOperatorCapabilities();
  const view = await createSyntheticOperatorDirectory().viewFor("syn_oper_00000001", granted);
  const foreign = clone(view);
  foreign.granted_capabilities[0] = "operator.secrets.read";
  assert.equal(validOperatorAdminView(foreign), false);
  const customer = clone(view);
  customer.granted_capabilities[0] = "customer.wallets.read";
  assert.equal(validOperatorAdminView(customer), false);
  assert.equal(validOperatorAdminView(view), true);

  // The served capabilities view is held to the same vocabulary: a policy
  // evaluation echoing an undeclared capability name must fail validation.
  const evaluation = evaluateOperatorCapabilities();
  const capabilities = operatorCapabilitiesViewFor(evaluation);
  const foreignCapability = clone(capabilities);
  foreignCapability.capabilities = Object.freeze([...capabilities.capabilities, "operator.secrets.read"]);
  assert.equal(validOperatorCapabilitiesView(foreignCapability), false);
  assert.equal(validOperatorCapabilitiesView(capabilities), true);
});

test("deposit-addresses and address-screenings pin exact target coverage", async () => {
  const addresses = await createSyntheticDepositAddressDirectory().listFor(VERIFIED_SUBJECT);
  const duplicated = clone(addresses);
  duplicated.deposit_addresses[1].asset = duplicated.deposit_addresses[0].asset;
  duplicated.deposit_addresses[1].network = duplicated.deposit_addresses[0].network;
  assert.equal(validDepositAddressesView(duplicated), false);
  const extra = clone(addresses);
  extra.deposit_addresses.push(clone(extra.deposit_addresses[0]));
  assert.equal(validDepositAddressesView(extra), false);
  assert.equal(validDepositAddressesView(addresses), true);

  const screenings = await createSyntheticAddressScreeningDirectory().listFor(VERIFIED_SUBJECT);
  const dupTarget = clone(screenings);
  dupTarget.screenings[1].asset = dupTarget.screenings[0].asset;
  dupTarget.screenings[1].network = dupTarget.screenings[0].network;
  assert.equal(validAddressScreeningsView(dupTarget), false);
  assert.equal(validAddressScreeningsView(screenings), true);
});

test("profile, users and auth-sessions stay pinned by their lifecycle rules", async () => {
  // Regression pins for directories already proven strict: their own views
  // validate and obvious lifecycle drift stays rejected.
  const profile = await createSyntheticProfileDirectory().viewFor(VERIFIED_SUBJECT);
  assert.equal(validProfileView(profile), true);
  const badProfile = clone(profile);
  badProfile.locale = "fr";
  assert.equal(validProfileView(badProfile), false);

  const user = await createSyntheticUserDirectory().viewFor(VERIFIED_SUBJECT);
  assert.equal(validUserView(user), true);
  const pending = clone(user);
  pending.status = "pending";
  pending.updated_at = "2030-01-01T00:00:00.000Z";
  assert.equal(validUserView(pending), false);

  const sessions = await createSyntheticAuthSessionDirectory().listFor(VERIFIED_SUBJECT);
  assert.equal(validAuthSessionsView(sessions), true);
  const none = clone(sessions);
  none.sessions.forEach((session) => {
    session.current = false;
  });
  assert.equal(validAuthSessionsView(none), false);
});

test("quotes, orders, payments, cards and checks keep recomputing strict", async () => {
  const quotes = await createSyntheticQuoteDirectory().listFor(VERIFIED_SUBJECT);
  assert.equal(validQuotesView(quotes), true);
  const tamperedQuote = clone(quotes);
  tamperedQuote.quotes[0].receive_amount = "0.000001";
  assert.equal(validQuotesView(tamperedQuote), false);

  const orders = await createSyntheticExchangeOrderDirectory().listFor(VERIFIED_SUBJECT);
  assert.equal(validExchangeOrdersView(orders), true);

  const payments = await createSyntheticPaymentDirectory().listFor(VERIFIED_SUBJECT);
  assert.equal(validPaymentsView(payments), true);

  const cards = await createSyntheticCardDirectory().listFor(VERIFIED_SUBJECT);
  assert.equal(validCardsView(cards), true);

  const checks = await createSyntheticCheckDirectory().viewFor(VERIFIED_SUBJECT);
  assert.equal(validChecksView(checks), true);
});
