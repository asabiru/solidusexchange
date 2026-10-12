import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";

import {
  createCustomerApiClient,
  customerApiSubject
} from "./customer-api-client.js";

const bffSubject = "tg-0123456789abcdef";
const upstreamSubject = customerApiSubject(bffSubject);

async function withFakeApi(
  respond: (path: string, headers: IncomingHttpHeaders) => unknown,
  run: (baseUrl: string) => Promise<void>
): Promise<void> {
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.statusCode = 200;
    response.end(JSON.stringify(respond(request.url ?? "", request.headers)));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/**
 * The session view the upstream contract serves for the presented dev token:
 * the exact minted expiry and the fixed customer scope pair. Anything else is
 * a view signed over another principal and must fail closed.
 */
function sessionEcho(headers: IncomingHttpHeaders): Record<string, unknown> {
  const expiresAtSeconds = Number(String(headers.authorization ?? "").split(".")[2]);
  return {
    actor_type: "customer",
    expires_at: new Date(expiresAtSeconds * 1_000).toISOString(),
    scopes: ["customer.session.read", "customer.capabilities.read"],
    subject: upstreamSubject
  };
}

function validCapabilities(): Record<string, unknown> {
  return { capabilities: ["customer.session.read", "customer.wallets.read"], commands_enabled: false };
}

function operationItem(operationId: string): Record<string, unknown> {
  return {
    operation_id: operationId,
    reference: "SCX-90001",
    kind: "exchange",
    status: "open",
    title: "Exchange USDT → RUB",
    channel: "miniapp",
    legs: [
      { asset: "USDT", amount: "10.000000", direction: "out" },
      { asset: "RUB", amount: "950.00", direction: "in" }
    ],
    fee_amount: "0.050000",
    fee_asset: "USDT",
    exchange: { base_asset: "USDT", quote_asset: "RUB", rate: "95.000000" },
    note: "Synthetic exchange operation",
    timeline: [
      { title: "Draft", detail: "Operation created", at: "2026-10-08T09:15:00.000Z", state: "done" },
      { title: "Review", detail: "Awaiting confirmation", at: "2026-10-08T09:16:00.000Z", state: "current" },
      { title: "Settled", detail: "Legs settle", at: null, state: "pending" }
    ],
    created_at: "2026-10-08T09:15:00.000Z",
    posting: "none"
  };
}

function screeningRecord(screeningId: string): Record<string, unknown> {
  return {
    screening_id: screeningId,
    asset: "USDT",
    network: "TON_TESTNET",
    direction: "outbound",
    status: "low",
    verdict: "clear",
    risk_level: "low",
    advisory: true,
    executable: false,
    submitted_at: "2026-10-01T10:00:00.000Z",
    deadline: "2026-10-01T11:00:00.000Z",
    posting: "none"
  };
}

function kycView(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: "test",
    provider: "simulator",
    session_kyc: "unverified",
    status: "rejected",
    application_id: "kyc_0123456789abcdef01234567",
    submitted_at: "2026-10-01T12:00:00.000Z",
    updated_at: "2026-10-02T12:00:00.000Z",
    reason_codes: ["SIM_DOCUMENT_UNREADABLE"],
    can_submit: true,
    ...overrides
  };
}

function supportTicket(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ticket_id: "tck_0123456789abcdef01234567",
    category: "complaint",
    topic: "Тестовый режим. Жалоба на обслуживание.",
    message: "Тестовый режим. Синтетическая жалоба, её никто не получит.",
    status: "in_review",
    timeline: [
      { status: "received", at: "2026-10-01T12:00:00.000Z" },
      { status: "in_review", at: "2026-10-01T13:00:00.000Z" }
    ],
    complaint_acknowledged: true,
    created_at: "2026-10-01T12:00:00.000Z",
    expires_at: "2026-10-02T12:00:00.000Z",
    ...overrides
  };
}

function supportView(tickets: readonly Record<string, unknown>[]): Record<string, unknown> {
  return { mode: "test", delivery: "disabled", tickets };
}

function notificationEntry(id: string, read: boolean): Record<string, unknown> {
  return {
    notification_id: id,
    created_at: "2026-10-01T12:00:00.000Z",
    channel: "telegram-draft",
    template: "kyc_approved",
    locale: "ru",
    text: "Тестовый режим. Проверка личности пройдена.",
    mode: "test",
    delivered: false,
    read
  };
}

describe("customer-api client envelope audit", () => {
  it("fails closed on a member operation view echoing a different operation_id", async () => {
    const key = randomBytes(32).toString("hex");
    const requested = "ope_0123456789abcdef01234567";
    await withFakeApi(
      () => operationItem("ope_fedcba9876543210fedcba98"),
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        assert.deepEqual(
          await client.operation(bffSubject, requested, Date.now()),
          { status: "unavailable" },
          "a view signed over another resource is drift, not an answer"
        );
      }
    );
    await withFakeApi(
      () => operationItem(requested),
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.operation(bffSubject, requested, Date.now());
        assert.equal(result.status, "ok", "the bound member read still serves its own record");
        if (result.status === "ok") assert.equal(result.operation.operation_id, requested);
      }
    );
  });

  it("fails closed on a member address-screening view echoing a different screening_id", async () => {
    const key = randomBytes(32).toString("hex");
    const requested = "scr_0123456789abcdef0123456789abcdef";
    await withFakeApi(
      () => screeningRecord("scr_fedcba9876543210fedcba9876543210"),
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        assert.deepEqual(
          await client.addressScreening(bffSubject, requested, Date.now()),
          { status: "unavailable" }
        );
      }
    );
    await withFakeApi(
      () => screeningRecord(requested),
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.addressScreening(bffSubject, requested, Date.now());
        assert.equal(result.status, "ok");
        if (result.status === "ok") assert.equal(result.screening.screening_id, requested);
      }
    );
  });

  it("fails closed on session views that are not the minted token's exact echo", async () => {
    const key = randomBytes(32).toString("hex");
    const patches: Record<string, unknown>[] = [
      { expires_at: "2030-01-01T00:00:00.000Z" },
      { expires_at: "2026-10-01" },
      { expires_at: 1_800_000_000_000 },
      { scopes: [] },
      { scopes: ["customer.session.read"] },
      { scopes: ["customer.capabilities.read", "customer.session.read"] },
      { scopes: ["customer.session.read", "customer.capabilities.read", "operator.payouts.approve"] },
      { scopes: "customer.session.read" }
    ];
    for (const patch of patches) {
      await withFakeApi(
        (path, headers) =>
          path === "/api/v1/customer/session"
            ? { ...sessionEcho(headers), ...patch }
            : validCapabilities(),
        async (baseUrl) => {
          const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
          assert.deepEqual(
            await client.access(bffSubject, Date.now()),
            { status: "unavailable" },
            JSON.stringify(patch)
          );
        }
      );
    }
    await withFakeApi(
      (path, headers) =>
        path === "/api/v1/customer/session" ? sessionEcho(headers) : validCapabilities(),
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.access(bffSubject, Date.now());
        assert.equal(result.status, "connected", "the truthful echo still connects");
      }
    );
  });

  it("fails closed on capability grants outside the declared vocabulary or duplicated", async () => {
    const key = randomBytes(32).toString("hex");
    const badGrants: unknown[][] = [
      ["customer.session.read", "customer.withdrawals.execute"],
      ["customer.admin.sudo"],
      ["customer.session.read", "customer.session.read"],
      ["operator.payouts.approve"],
      ["customer.session.read", 42]
    ];
    for (const grant of badGrants) {
      await withFakeApi(
        (path, headers) =>
          path === "/api/v1/customer/session"
            ? sessionEcho(headers)
            : { capabilities: grant, commands_enabled: false },
        async (baseUrl) => {
          const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
          assert.deepEqual(
            await client.access(bffSubject, Date.now()),
            { status: "unavailable" },
            JSON.stringify(grant)
          );
        }
      );
    }
  });

  it("fails closed on notifications views with a lying unread count or duplicated ids", async () => {
    const key = randomBytes(32).toString("hex");
    const first = notificationEntry("ntf_0123456789abcdef01234567", false);
    const second = notificationEntry("ntf_fedcba9876543210fedcba98", true);
    const feeds: Record<string, unknown>[] = [
      { mode: "test", delivery: "disabled", unread: 2, notifications: [first, second] },
      { mode: "test", delivery: "disabled", unread: 0, notifications: [first] },
      { mode: "test", delivery: "disabled", unread: 2, notifications: [first, first] }
    ];
    for (const feed of feeds) {
      await withFakeApi(
        () => feed,
        async (baseUrl) => {
          const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
          assert.deepEqual(
            await client.notifications(bffSubject, Date.now()),
            { status: "unavailable" },
            JSON.stringify(feed)
          );
        }
      );
    }
    await withFakeApi(
      () => ({ mode: "test", delivery: "disabled", unread: 1, notifications: [first, second] }),
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.notifications(bffSubject, Date.now());
        assert.equal(result.status, "ok", "a truthful recount still serves the feed");
      }
    );
  });

  it("fails closed on support tickets violating the contract lifecycle invariants", async () => {
    const key = randomBytes(32).toString("hex");
    const bad: Record<string, unknown>[] = [
      supportTicket({ category: "question" }),
      supportTicket({ complaint_acknowledged: false }),
      supportTicket({ timeline: [{ status: "in_review", at: "2026-10-01T12:00:00.000Z" }] }),
      supportTicket({
        timeline: [
          { status: "received", at: "2026-10-01T12:00:00.000Z" },
          { status: "answered", at: "2026-10-01T13:00:00.000Z" }
        ]
      }),
      supportTicket({ expires_at: "2026-10-01T12:00:00.000Z" }),
      supportTicket({ expires_at: "2026-09-30T12:00:00.000Z" }),
      supportTicket({
        timeline: [
          { status: "received", at: "2026-10-01T13:00:00.000Z" },
          { status: "in_review", at: "2026-10-01T14:00:00.000Z" }
        ]
      }),
      supportTicket({
        timeline: [
          { status: "received", at: "2026-10-01T12:00:00.000Z" },
          { status: "in_review", at: "2026-10-01T12:00:00.000Z" }
        ]
      })
    ];
    for (const ticket of bad) {
      await withFakeApi(
        () => supportView([ticket]),
        async (baseUrl) => {
          const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
          assert.deepEqual(
            await client.support(bffSubject, Date.now()),
            { status: "unavailable" },
            JSON.stringify(ticket)
          );
        }
      );
    }
    await withFakeApi(
      () => supportView([supportTicket()]),
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.support(bffSubject, Date.now());
        assert.equal(result.status, "ok", "a coherent ticket still serves");
      }
    );
  });

  it("fails closed on kyc views contradicting the session-level status or derived fields", async () => {
    const key = randomBytes(32).toString("hex");
    const bad: Record<string, unknown>[] = [
      kycView({ status: "approved" }),
      kycView({ status: "in_review", review_deadline: "2026-10-05T12:00:00.000Z", reason_codes: undefined }),
      kycView({ session_kyc: "verified" }),
      kycView({ session_kyc: "pending" }),
      kycView({ can_submit: false }),
      kycView({ status: "submitted" }),
      kycView({ session_kyc: "pending", status: "in_review", can_submit: false, reason_codes: undefined }),
      kycView({ review_deadline: "2026-10-05T12:00:00.000Z" }),
      kycView({ requested_items: ["proof_of_address"] }),
      kycView({ submitted_at: "2026-10-03T12:00:00.000Z" })
    ];
    for (const view of bad) {
      await withFakeApi(
        () => view,
        async (baseUrl) => {
          const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
          assert.deepEqual(
            await client.kyc(bffSubject, Date.now()),
            { status: "unavailable" },
            JSON.stringify(view)
          );
        }
      );
    }
    await withFakeApi(
      () => kycView(),
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.kyc(bffSubject, Date.now());
        assert.equal(result.status, "ok", "a coherent view still serves");
      }
    );
  });
});
