import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createSyntheticUserDirectory } from "../src/users.mjs";
import { createSyntheticNotificationDirectory, validNotificationsView } from "../src/notifications.mjs";
import { createSyntheticSupportDirectory, validSupportTicketsView } from "../src/support.mjs";
import { createSyntheticDepositAddressDirectory, validDepositAddressesView } from "../src/deposit-addresses.mjs";
import { createSyntheticCheckDirectory, validChecksView } from "../src/checks.mjs";
import { createRequestObserver } from "../src/observability.mjs";
import { createFixedWindowRateLimiter } from "../src/rate-limit.mjs";
import { validProfileView, createSyntheticProfileDirectory } from "../src/profile.mjs";
import { createSyntheticWalletDirectory } from "../src/wallets.mjs";
import { createChecksSimulator } from "../../provider-simulators/src/index.mjs";
import { idempotencyKey } from "../../provider-simulators/src/simulator-core.mjs";
import { freshKey } from "../../provider-simulators/tests/helpers.mjs";

// The synthetic user epoch: registration is drawn from the elapsed span
// ahead of BASE_MS and bounded updates never reach past BASE + 30d.
const USERS_BASE_MS = Date.parse("2026-09-01T00:00:00.000Z");
const USERS_CREATED_WINDOW_MS = 90 * 86_400_000;
const USERS_UPDATED_WINDOW_MS = 30 * 86_400_000;
// Deposit-address mint instants: BASE + index * 1d in declaration order.
const DPA_BASE_MS = Date.parse("2026-09-01T00:00:00.000Z");
const DPA_STEP_MS = 86_400_000;

describe("wave-78 served-read derivations stay inside the elapsed epoch", () => {
  test("user views never serve a future created_at or updated_at", async () => {
    const directory = createSyntheticUserDirectory();
    const now = Date.now();
    for (let index = 0; index < 400; index += 1) {
      const view = await directory.viewFor(`syn_cust_w78${String(index).padStart(5, "0")}`);
      const created = Date.parse(view.created_at);
      const updated = Date.parse(view.updated_at);
      assert.ok(created > USERS_BASE_MS - USERS_CREATED_WINDOW_MS && created <= USERS_BASE_MS, view.created_at);
      assert.ok(created <= now, view.created_at);
      assert.ok(updated <= now, view.updated_at);
      if (view.status === "pending") {
        assert.equal(view.updated_at, view.created_at);
      } else {
        assert.ok(updated > created && updated - created <= USERS_UPDATED_WINDOW_MS);
      }
    }
  });

  test("profile, wallets and deposit addresses stay inside the elapsed epoch too", async () => {
    const now = Date.now();
    const profile = createSyntheticProfileDirectory();
    const wallets = createSyntheticWalletDirectory();
    const addresses = createSyntheticDepositAddressDirectory();
    for (let index = 0; index < 120; index += 1) {
      const subject = `syn_cust_w78b${String(index).padStart(5, "0")}`;
      const p = await profile.viewFor(subject);
      assert.ok(Date.parse(p.registered_at) <= now);
      assert.ok(validProfileView(p));
      const w = await wallets.listFor(subject);
      assert.equal(new Set(w.wallets.map((entry) => entry.asset)).size, w.wallets.length);
      const a = await addresses.listFor(subject);
      assert.equal(a.deposit_addresses.length, 3);
      a.deposit_addresses.forEach((entry, position) => {
        assert.equal(Date.parse(entry.created_at), DPA_BASE_MS + position * DPA_STEP_MS);
        assert.ok(Date.parse(entry.created_at) <= now);
      });
    }
  });
});

describe("wave-78 derived fields are bound, not shape-checked", () => {
  test("notification text must be the dictionary entry for the template and the feed is newest-first", async () => {
    const view = await createSyntheticNotificationDirectory().listFor("syn_cust_verified01");
    assert.equal(validNotificationsView(view), true);
    const drifted = { ...view, notifications: view.notifications.map((n, i) => (i === 0 ? { ...n, text: "Посторонний текст не из словаря шаблона" } : n)) };
    assert.equal(validNotificationsView(drifted), false);
    const ascending = { ...view, notifications: [...view.notifications].reverse() };
    assert.equal(validNotificationsView(ascending), false);
    // A template-bound body: valid dictionary text under the wrong template.
    const firstTemplate = view.notifications[0].template;
    const wrongText =
      firstTemplate === "session_login"
        ? "Тестовый режим. Заявка на проверку личности принята."
        : "Тестовый режим. Выполнен вход в SOLID.";
    const crossTemplate = {
      ...view,
      notifications: view.notifications.map((n, i) => (i === 0 ? { ...n, text: wrongText } : n)),
    };
    assert.equal(validNotificationsView(crossTemplate), false);
  });

  test("support topic and message must be the dictionary entries for the category; ids unique; feed newest-first", async () => {
    const view = await createSyntheticSupportDirectory().listFor("syn_cust_verified01");
    assert.equal(validSupportTicketsView(view), true);
    const drifted = { ...view, tickets: view.tickets.map((t, i) => (i === 0 ? { ...t, topic: "Совершенно другая тема", message: "Посторонний текст" } : t)) };
    assert.equal(validSupportTicketsView(drifted), false);
    const duplicated = { ...view, tickets: view.tickets.map((t) => ({ ...t, ticket_id: view.tickets[0].ticket_id })) };
    assert.equal(validSupportTicketsView(duplicated), false);
    const ascending = { ...view, tickets: [...view.tickets].reverse() };
    assert.equal(validSupportTicketsView(ascending), false);
    // A category-bound body: valid dictionary text under the wrong category.
    const firstCategory = view.tickets[0].category;
    const wrongTopic =
      firstCategory === "question" ? "Тестовый режим. Проблема с операцией." : "Тестовый режим. Вопрос о работе сервиса.";
    const mismatchedCategory = {
      ...view,
      tickets: view.tickets.map((t, i) => (i === 0 ? { ...t, topic: wrongTopic } : t)),
    };
    assert.equal(validSupportTicketsView(mismatchedCategory), false);
  });

  test("deposit addresses pin the allowlist order and the per-index mint instant", async () => {
    const view = await createSyntheticDepositAddressDirectory().listFor("syn_cust_verified01");
    assert.equal(validDepositAddressesView(view), true);
    const reordered = { ...view, deposit_addresses: [...view.deposit_addresses].reverse() };
    assert.equal(validDepositAddressesView(reordered), false);
    const drifted = {
      ...view,
      deposit_addresses: view.deposit_addresses.map((a) => ({ ...a, created_at: "2027-01-01T00:00:00.000Z" })),
    };
    assert.equal(validDepositAddressesView(drifted), false);
    const duplicatedIds = {
      ...view,
      deposit_addresses: view.deposit_addresses.map((a) => ({ ...a, deposit_address_id: view.deposit_addresses[0].deposit_address_id })),
    };
    assert.equal(validDepositAddressesView(duplicatedIds), false);
  });

  test("a served check carries the simulator-pinned zero fee", async () => {
    const scales = { USDT: 6, TON: 9 };
    for (let index = 0; index < 64; index += 1) {
      const view = await createSyntheticCheckDirectory().viewFor(`syn_cust_w78c${String(index).padStart(5, "0")}`);
      for (const check of view.checks) {
        assert.equal(check.fee_amount, `0.${"0".repeat(scales[check.asset])}`, check.check_id);
      }
      assert.equal(validChecksView(view), true);
      const charged = {
        ...view,
        checks: view.checks.map((c) => ({ ...c, fee_amount: `0.${"0".repeat(scales[c.asset] - 1)}1` })),
      };
      assert.equal(validChecksView(charged), false);
    }
  });
});

describe("wave-78 observability route labels", () => {
  const observer = () =>
    createRequestObserver({
      service: "customer-api",
      routes: ["/api/v1/operator/queue", "/api/v1/operator/audit", "/api/v1/customer/session"],
      config: { log: "off", metrics: "loopback" },
    });

  test("a query string never demotes a declared route to unmatched", () => {
    const routes = observer();
    assert.equal(routes.routeOf("/api/v1/operator/queue?kind=aml"), "/api/v1/operator/queue");
    assert.equal(routes.routeOf("/api/v1/operator/audit?cursor=auc_x"), "/api/v1/operator/audit");
    assert.equal(routes.routeOf("/api/v1/customer/session?token=secret"), "/api/v1/customer/session");
  });

  test("unmatched stays reserved for undeclared paths", () => {
    const routes = observer();
    assert.equal(routes.routeOf("/api/v1/operator/queue/extra?kind=aml"), "unmatched");
    assert.equal(routes.routeOf("/api/v1/unknown?x=1"), "unmatched");
    assert.equal(routes.routeOf("/"), "unmatched");
  });
});

describe("wave-78 rate-limit isolation", () => {
  test("one peer's exhausted bucket never costs another key its quota", () => {
    let now = 1_000_000;
    const limiter = createFixedWindowRateLimiter({ limit: 2, windowMs: 60_000, clock: () => now });
    assert.equal(limiter.consume("peer-a").allowed, true);
    assert.equal(limiter.consume("peer-a").allowed, true);
    assert.equal(limiter.consume("peer-a").allowed, false);
    assert.equal(limiter.consume("peer-b").allowed, true);
    const denied = limiter.consume("peer-a");
    assert.equal(denied.allowed, false);
    assert.equal(denied.retryAfterSeconds, 60);
    now += 61_000;
    assert.equal(limiter.consume("peer-a").allowed, true);
  });

  test("a non-finite clock denies instead of reset, and maxKeys fails closed", () => {
    const deny = createFixedWindowRateLimiter({ limit: 1, clock: () => Number.NaN });
    assert.equal(deny.consume("k").allowed, false);
    const bounded = createFixedWindowRateLimiter({ limit: 100, maxKeys: 2, clock: () => 0 });
    assert.equal(bounded.consume("a").allowed, true);
    assert.equal(bounded.consume("b").allowed, true);
    assert.equal(bounded.consume("c").allowed, false);
  });
});

describe("wave-78 check command machinery", () => {
  const MEMBERS = {
    "sim-sender-1": { kyc_verified: true },
    "sim-recipient-1": { kyc_verified: true },
  };
  const build = () =>
    createChecksSimulator({
      seed: "wave78",
      key: freshKey(),
      members: MEMBERS,
      defaultScenario: "delivered",
    });
  const create = {
    check_ref: "sim-check-1",
    check_type: "personal",
    sender_ref: "sim-sender-1",
    recipient_ref: "sim-recipient-1",
    amount: "25.000000",
    asset: "USDT",
    claim_reference: "claimref-0000000000000001",
    idempotency_key: "idem-check-0001x",
  };

  test("the idempotency-key grammar is the contract's 16-128 bound, not a looser one", () => {
    for (const short of ["", "1", "12345678", "123456789012345"]) {
      assert.throws(() => idempotencyKey(short), /idempotency_key/);
    }
    assert.equal(idempotencyKey("1234567890123456"), "1234567890123456");
    for (const ch of [" ", "a b", "a;b", "a'b", "a\u0000b"]) {
      assert.throws(() => idempotencyKey(`12345678901234${ch}`), /idempotency_key/);
    }
  });

  test("claim and cancel replay exactly and conflict on a different request under the same key", async () => {
    const simulator = build();
    const created = await simulator.createCheck(create);
    await simulator.issueCheck({ check_id: created.check_id, member_ref: "sim-sender-1", idempotency_key: "idem-issue-0001x" });
    const claim = {
      check_id: created.check_id,
      member_ref: "sim-recipient-1",
      claim_reference: "claimref-0000000000000001",
      idempotency_key: "idem-claim-0001x",
    };
    const first = await simulator.claimCheck(claim);
    const replay = await simulator.claimCheck(claim);
    assert.deepEqual(replay, first);
    await assert.rejects(
      simulator.claimCheck({ ...claim, claim_reference: "claimref-0000000000000002" }),
      (error) => error.code === "idempotency_conflict"
    );
    // A claimed check can no longer be cancelled.
    const cancel = { check_id: created.check_id, member_ref: "sim-sender-1", idempotency_key: "idem-cancel-0001x" };
    await assert.rejects(simulator.cancelCheck(cancel), (error) => error.code === "invalid_request");
  });

  test("member binding: only the recipient claims and only the sender cancels", async () => {
    const simulator = build();
    const created = await simulator.createCheck(create);
    await simulator.issueCheck({ check_id: created.check_id, member_ref: "sim-sender-1", idempotency_key: "idem-issue-0001x" });
    await assert.rejects(
      simulator.claimCheck({ check_id: created.check_id, member_ref: "sim-sender-1", claim_reference: "claimref-0000000000000001", idempotency_key: "idem-claim-0002x" }),
      (error) => error.code === "invalid_request"
    );
    await assert.rejects(
      simulator.cancelCheck({ check_id: created.check_id, member_ref: "sim-recipient-1", idempotency_key: "idem-cancel-0002x" }),
      (error) => error.code === "invalid_request"
    );
    await assert.rejects(
      simulator.claimCheck({ check_id: created.check_id, member_ref: "sim-recipient-1", claim_reference: "claimref-9999999999999999", idempotency_key: "idem-claim-0003x" }),
      (error) => error.code === "not_found" || error.code === "invalid_request"
    );
  });
});
