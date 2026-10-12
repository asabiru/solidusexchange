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

function operationItem(operationId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
      { title: "Draft", detail: "Operation created", at: "2026-10-08T09:14:00.000Z", state: "done" },
      { title: "Review", detail: "Awaiting confirmation", at: "2026-10-08T09:15:00.000Z", state: "current" },
      { title: "Settled", detail: "Legs settle", at: null, state: "pending" }
    ],
    created_at: "2026-10-08T09:15:00.000Z",
    posting: "none",
    ...overrides
  };
}

function screeningRecord(
  screeningId: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
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
    posting: "none",
    ...overrides
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

function marketDepthView(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: "test",
    instrument: "USDT/RUB",
    base_asset: "USDT",
    quote_asset: "RUB",
    bids: [{ price: "89.99000000", quantity: "25.000000", order_count: 1 }],
    asks: [{ price: "90.01000000", quantity: "18.000000", order_count: 1 }],
    last_trade: { price: "90.00000000", quantity: "10.000000", executed_at: "2026-10-02T14:05:00.000Z" },
    depth_levels: 1,
    as_of: "2026-10-02T14:10:00.000Z",
    posting: "none",
    ...overrides
  };
}

function marketEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    instrument: "USDT/RUB",
    base_asset: "USDT",
    quote_asset: "RUB",
    best_bid: { price: "89.99000000", quantity: "25.000000", order_count: 1 },
    best_ask: { price: "90.01000000", quantity: "18.000000", order_count: 1 },
    last_trade: { price: "90.00000000", quantity: "10.000000", executed_at: "2026-10-02T14:05:00.000Z" },
    spread_bps: 2,
    base_scale: 6,
    quote_scale: 2,
    price_scale: 8,
    as_of: "2026-10-02T14:10:00.000Z",
    posting: "none",
    ...overrides
  };
}

/** The canonical ORDER_PAIRS sequence the contract view must report once, in order. */
function canonicalMarkets(): Record<string, unknown>[] {
  return [
    marketEntry(),
    marketEntry({
      instrument: "TON/RUB",
      base_asset: "TON",
      base_scale: 9,
      best_bid: null,
      best_ask: null,
      last_trade: null,
      spread_bps: null
    }),
    marketEntry({
      instrument: "TON/USDT",
      base_asset: "TON",
      quote_asset: "USDT",
      base_scale: 9,
      quote_scale: 6,
      best_bid: null,
      best_ask: null,
      last_trade: null,
      spread_bps: null
    })
  ];
}

function tradeEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    trade_id: "trd_0123456789abcdef01234567",
    order_id: "ord_0123456789abcdef01234567",
    pair: "USDT/RUB",
    base_asset: "USDT",
    quote_asset: "RUB",
    side: "sell",
    liquidity: "maker",
    price: "90.00000000",
    quantity: "10.000000",
    quote_amount: "900.00",
    fee_bps: 30,
    fee_amount: "2.70",
    total_quote_amount: "897.30",
    executed_at: "2026-10-02T14:05:00.000Z",
    execution: "not_supported",
    posting: "none",
    ...overrides
  };
}

function orderEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    order_id: "ord_0123456789abcdef01234567",
    pair: "USDT/RUB",
    base_asset: "USDT",
    quote_asset: "RUB",
    side: "sell",
    order_type: "limit",
    base_amount: "25.000000",
    price: "89.77500000",
    quote_amount: "2244.37",
    fee_bps: 30,
    fee_amount: "6.74",
    total_quote_amount: "2237.63",
    status: "open",
    created_at: "2026-10-02T14:05:00.000Z",
    updated_at: "2026-10-02T14:05:00.000Z",
    execution: "not_supported",
    posting: "none",
    ...overrides
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

describe("customer-api depth/order/trade adapter audit (wave 63)", () => {
  it("fails closed on timestamps that normalize instead of reserializing canonically", async () => {
    const key = randomBytes(32).toString("hex");
    // The upstream validator reserializes the parsed stamp: a pattern-passing
    // string whose components overflow ("2026-02-31" rolls into March,
    // "T24:00" into the next day) is not the contract's timestamp.
    const normalized = [
      "2026-02-31T00:00:00.000Z",
      "2026-04-31T00:00:00.000Z",
      "2026-01-01T24:00:00.000Z"
    ];
    for (const stamp of normalized) {
      const drifted: [Record<string, unknown>, (client: ReturnType<typeof createCustomerApiClient>) => Promise<unknown>][] = [
        [marketDepthView({ as_of: stamp }), (client) => client.marketDepth(bffSubject, "USDT/RUB", Date.now())],
        [
          marketDepthView({ last_trade: { price: "90.00000000", quantity: "10.000000", executed_at: stamp } }),
          (client) => client.marketDepth(bffSubject, "USDT/RUB", Date.now())
        ],
        [
          { mode: "test", markets: [marketEntry({ as_of: stamp }), ...canonicalMarkets().slice(1)] },
          (client) => client.markets(bffSubject, Date.now())
        ],
        [{ mode: "test", trades: [tradeEntry({ executed_at: stamp })] }, (client) => client.trades(bffSubject, Date.now())],
        [{ mode: "test", orders: [orderEntry({ created_at: stamp })] }, (client) => client.exchangeOrders(bffSubject, Date.now())]
      ];
      for (const [body, read] of drifted) {
        await withFakeApi(
          () => body,
          async (baseUrl) => {
            const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
            assert.deepEqual(await read(client), { status: "unavailable" }, JSON.stringify(body));
          }
        );
      }
    }
    // Boundary control: a last trade stamped exactly at the snapshot close is inside the session.
    await withFakeApi(
      () => marketDepthView({ last_trade: { price: "90.00000000", quantity: "10.000000", executed_at: "2026-10-02T14:10:00.000Z" } }),
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.marketDepth(bffSubject, "USDT/RUB", Date.now());
        assert.equal(result.status, "ok", "executed_at === as_of stays inside the replayed session");
      }
    );
  });

  it("fails closed on a markets view dropping or reordering the canonical pair sequence", async () => {
    const key = randomBytes(32).toString("hex");
    const canonical = canonicalMarkets();
    const bad: Record<string, unknown>[][] = [
      [canonical[0] as Record<string, unknown>, canonical[1] as Record<string, unknown>],
      [canonical[1] as Record<string, unknown>, canonical[0] as Record<string, unknown>, canonical[2] as Record<string, unknown>],
      [canonical[0] as Record<string, unknown>, canonical[2] as Record<string, unknown>, canonical[1] as Record<string, unknown>],
      [canonical[0] as Record<string, unknown>],
      [...canonical, marketEntry({ instrument: "BTC/EUR", base_asset: "BTC", quote_asset: "EUR" })]
    ];
    for (const markets of bad) {
      await withFakeApi(
        () => ({ mode: "test", markets }),
        async (baseUrl) => {
          const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
          assert.deepEqual(
            await client.markets(bffSubject, Date.now()),
            { status: "unavailable" },
            `${markets.length} markets, first ${String(markets[0]?.instrument)}`
          );
        }
      );
    }
    await withFakeApi(
      () => ({ mode: "test", markets: canonical }),
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.markets(bffSubject, Date.now());
        assert.equal(result.status, "ok", "the canonical sequence still serves");
      }
    );
  });

  it("fails closed on a markets entry whose last_trade post-dates the snapshot", async () => {
    const key = randomBytes(32).toString("hex");
    const drifted = canonicalMarkets();
    drifted[0] = marketEntry({
      last_trade: { price: "90.00000000", quantity: "10.000000", executed_at: "2026-10-03T00:00:00.000Z" }
    });
    await withFakeApi(
      () => ({ mode: "test", markets: drifted }),
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        assert.deepEqual(await client.markets(bffSubject, Date.now()), { status: "unavailable" });
      }
    );
  });

  it("fails closed on duplicated ids inside the trades and exchange-orders collections", async () => {
    const key = randomBytes(32).toString("hex");
    // A trade id is minted once per (order, fill) and an order id once per
    // submission: a repeat is two rows claiming one record upstream pins as
    // invalid, and the adapter must pin it too.
    await withFakeApi(
      () => ({ mode: "test", trades: [tradeEntry(), tradeEntry()] }),
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        assert.deepEqual(await client.trades(bffSubject, Date.now()), { status: "unavailable" });
      }
    );
    await withFakeApi(
      () => ({ mode: "test", orders: [orderEntry(), orderEntry()] }),
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        assert.deepEqual(await client.exchangeOrders(bffSubject, Date.now()), { status: "unavailable" });
      }
    );
    // Positive control: one order filling twice keeps distinct trade ids.
    await withFakeApi(
      () => ({
        mode: "test",
        trades: [tradeEntry(), tradeEntry({ trade_id: "trd_fedcba9876543210fedcba98" })]
      }),
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.trades(bffSubject, Date.now());
        assert.equal(result.status, "ok", "distinct trade ids for one order_id still serve");
      }
    );
  });

  it("degrades to unavailable — never throws — on decimals beyond the adapter's numeric bounds", async () => {
    const key = randomBytes(32).toString("hex");
    // The wire validator bounds scale, not magnitude: a pattern-valid price
    // wider than the adapter's 30-digit unit conversion must reject cleanly
    // as unavailable, not escape as a thrown error.
    const giant = "1" + "0".repeat(31);
    const drifted: [Record<string, unknown>, (client: ReturnType<typeof createCustomerApiClient>) => Promise<unknown>][] = [
      [
        marketDepthView({ asks: [{ price: `${giant}.00000000`, quantity: "18.000000", order_count: 1 }] }),
        (client) => client.marketDepth(bffSubject, "USDT/RUB", Date.now())
      ],
      [
        marketDepthView({ bids: [{ price: "89.99000000", quantity: `${giant}.000000`, order_count: 1 }] }),
        (client) => client.marketDepth(bffSubject, "USDT/RUB", Date.now())
      ],
      [
        { mode: "test", trades: [tradeEntry({ quantity: `${giant}.000000` })] },
        (client) => client.trades(bffSubject, Date.now())
      ]
    ];
    for (const [body, read] of drifted) {
      await withFakeApi(
        () => body,
        async (baseUrl) => {
          const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
          assert.deepEqual(await read(client), { status: "unavailable" }, JSON.stringify(body));
        }
      );
    }
  });
});

function walletEntry(asset: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    wallet_id: `syn_wal_${asset.toLowerCase()}00001`,
    asset,
    available: asset === "RUB" ? "84200.00" : asset === "USDT" ? "482.180000" : "18.250000000",
    hold: asset === "RUB" ? "0.00" : asset === "USDT" ? "25.000000" : "1.500000000",
    ...overrides
  };
}

/** The wallet directory's fixed asset table: one entry per asset, nothing else. */
function canonicalWallets(): Record<string, unknown>[] {
  return [walletEntry("RUB"), walletEntry("USDT"), walletEntry("TON")];
}

function depositEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    deposit_id: "dep_0123456789abcdef01234567",
    asset: "USDT",
    method: "sbp",
    status: "payment_received",
    expected_amount: "250.000000",
    received_total: "250.000000",
    reversed_total: "0.000000",
    payment_reference: "SIMSBP0123456789AB",
    created_at: "2026-10-04T12:10:00.000Z",
    updated_at: "2026-10-04T12:14:00.000Z",
    posting: "none",
    ...overrides
  };
}

function withdrawalEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const amount = String(overrides.amount ?? "25.000000");
  const fee = String(overrides.fee_amount ?? "0.125000");
  return {
    withdrawal_id: "wdr_0123456789abcdef01234567",
    asset: "USDT",
    network: "TRON_TESTNET",
    status: "broadcast",
    amount,
    fee_amount: fee,
    destination_reference: "destination_ref_0123456789abcd",
    legs: [
      { leg_id: "wdl_0123456789abcdef01234567", asset: "USDT", amount, direction: "out" },
      { leg_id: "wdl_fedcba9876543210fedcba98", asset: "USDT", amount: fee, direction: "out" }
    ],
    created_at: "2026-10-02T14:05:00.000Z",
    updated_at: "2026-10-02T14:07:00.000Z",
    expires_at: "2026-10-02T14:10:00.000Z",
    posting: "none",
    ...overrides
  };
}

function checkEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    check_id: "chk_0123456789abcdef01234567",
    check_type: "personal",
    status: "created",
    sender_ref: upstreamSubject,
    recipient_ref: "syn_peer_0123456789ab",
    amount: "100.000000",
    asset: "USDT",
    fee_amount: "0.500000",
    outstanding_amount: "100.000000",
    created_at: "2026-10-01T12:00:00.000Z",
    expires_at: "2026-10-08T12:00:00.000Z",
    resolved_at: null,
    posting: "none",
    ...overrides
  };
}

function activityEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    activity_id: "act_0123456789abcdef01234567",
    kind: "deposit",
    status: "payment_received",
    title: "Deposit received",
    detail: "Deposit dep_0123456789abcdef01234567 received",
    money: { amount: "250.000000", asset: "USDT" },
    created_at: "2026-10-08T09:15:00.000Z",
    posting: "none",
    ...overrides
  };
}

function depositAddressEntry(
  asset: string,
  network: string,
  address: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    deposit_address_id: "dpa_0123456789abcdef01234567",
    asset,
    network,
    address,
    status: "active",
    created_at: "2026-10-01T10:00:00.000Z",
    posting: "none",
    ...overrides
  };
}

/** The allowlisted receiving targets the directory serves exactly once each. */
function canonicalDepositAddresses(): Record<string, unknown>[] {
  return [
    depositAddressEntry("TON", "TON_TESTNET", `kQ${"A".repeat(46)}`),
    depositAddressEntry("USDT", "TON_TESTNET", `kQ${"B".repeat(46)}`, { deposit_address_id: "dpa_fedcba9876543210fedcba98" }),
    depositAddressEntry("USDT", "TRON_TESTNET", `T${"9".repeat(33)}`, { deposit_address_id: "dpa_111111111111111111111111" })
  ];
}

/** The allowlisted screening targets the directory serves exactly once each. */
function canonicalScreenings(): Record<string, unknown>[] {
  return [
    screeningRecord("scr_0123456789abcdef0123456789abcdef", { asset: "TON", network: "TON_TESTNET" }),
    screeningRecord("scr_fedcba9876543210fedcba9876543210"),
    screeningRecord("scr_11111111111111111111111111111111", { network: "TRON_TESTNET" })
  ];
}

describe("customer-api client served-view contract audit (wave 75)", () => {
  it("fails closed on a wallets view that is not the exact per-asset set", async () => {
    const key = randomBytes(32).toString("hex");
    const wallets = canonicalWallets();
    const bad: Record<string, unknown>[][] = [
      wallets.slice(0, 2),
      [wallets[0] as Record<string, unknown>, walletEntry("RUB", { wallet_id: "syn_wal_rub00002" }), wallets[2] as Record<string, unknown>],
      [walletEntry("RUB", { wallet_id: "wal_rub00001" }), wallets[1] as Record<string, unknown>, wallets[2] as Record<string, unknown>],
      [walletEntry("RUB", { wallet_id: "syn_wal_TOO_LONG_0123456789abcdef0123456789" }), wallets[1] as Record<string, unknown>, wallets[2] as Record<string, unknown>],
      [walletEntry("RUB", { wallet_id: 42 }), wallets[1] as Record<string, unknown>, wallets[2] as Record<string, unknown>],
      []
    ];
    for (const view of bad) {
      await withFakeApi(
        () => ({ wallets: view }),
        async (baseUrl) => {
          const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
          assert.deepEqual(
            await client.wallets(bffSubject, Date.now()),
            { status: "unavailable" },
            `${view.length} wallet rows, first id ${String(view[0]?.wallet_id)}`
          );
        }
      );
    }
    await withFakeApi(
      () => ({ wallets }),
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.wallets(bffSubject, Date.now());
        assert.equal(result.status, "ok", "the exact asset table still serves");
      }
    );
  });

  it("fails closed on deposits contradicting the per-status totals lifecycle", async () => {
    const key = randomBytes(32).toString("hex");
    const bad: Record<string, unknown>[] = [
      depositEntry({ expected_amount: "0.000000", received_total: "0.000000" }),
      depositEntry({ status: "awaiting_payment", received_total: "0.000000", expected_amount: "250.000000" }),
      depositEntry({ status: "awaiting_payment", received_total: "1.000000" }),
      depositEntry({ status: "partial_payment", received_total: "0.000000" }),
      depositEntry({ status: "partial_payment", received_total: "250.000000" }),
      depositEntry({ status: "duplicate_payment", received_total: "250.000000" }),
      depositEntry({ status: "payment_reversed", reversed_total: "300.000000" }),
      depositEntry({ status: "payment_reversed", reversed_total: "0.000000" }),
      depositEntry({ status: "expired_no_payment", updated_at: "2026-10-04T12:10:00.000Z" }),
      depositEntry({ updated_at: "2026-10-04T12:05:00.000Z" }),
      depositEntry({ status: "awaiting_payment", received_total: "0.000000", updated_at: "2026-10-04T12:11:00.000Z" })
    ];
    for (const entry of bad) {
      await withFakeApi(
        () => ({ mode: "test", deposits: [entry] }),
        async (baseUrl) => {
          const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
          assert.deepEqual(
            await client.deposits(bffSubject, Date.now()),
            { status: "unavailable" },
            `status ${String(entry.status)} received ${String(entry.received_total)}`
          );
        }
      );
    }
    const coherent = [
      depositEntry(),
      depositEntry({
        deposit_id: "dep_fedcba9876543210fedcba98",
        status: "partial_payment",
        received_total: "100.000000",
        expected_amount: "250.000000"
      }),
      depositEntry({
        deposit_id: "dep_111111111111111111111111",
        status: "awaiting_payment",
        received_total: "0.000000",
        updated_at: "2026-10-04T12:10:00.000Z"
      })
    ];
    await withFakeApi(
      () => ({ mode: "test", deposits: coherent }),
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.deposits(bffSubject, Date.now());
        assert.equal(result.status, "ok", "status-coherent totals still serve");
      }
    );
  });

  it("fails closed on withdrawals drifting the fixed TTL or last-touch lifecycle", async () => {
    const key = randomBytes(32).toString("hex");
    const bad: Record<string, unknown>[] = [
      withdrawalEntry({ expires_at: "2026-10-02T14:15:00.000Z" }),
      withdrawalEntry({ expires_at: "2026-10-02T14:05:00.000Z" }),
      withdrawalEntry({ updated_at: "2026-10-02T14:04:00.000Z" }),
      withdrawalEntry({ status: "draft", updated_at: "2026-10-02T14:07:00.000Z" }),
      withdrawalEntry({ status: "draft" }),
      withdrawalEntry({ status: "expired" }),
      withdrawalEntry({ status: "confirmed" }),
      withdrawalEntry({ status: "broadcast", updated_at: "2026-10-02T14:05:00.000Z" }),
      withdrawalEntry({ status: "broadcast", updated_at: "2026-10-02T14:10:00.000Z" }),
      withdrawalEntry({ status: "rejected", updated_at: "2026-10-02T14:10:00.000Z" })
    ];
    for (const entry of bad) {
      await withFakeApi(
        () => ({ mode: "test", withdrawals: [entry] }),
        async (baseUrl) => {
          const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
          assert.deepEqual(
            await client.withdrawals(bffSubject, Date.now()),
            { status: "unavailable" },
            `status ${String(entry.status)} updated ${String(entry.updated_at)}`
          );
        }
      );
    }
    const coherent = [
      withdrawalEntry(),
      withdrawalEntry({
        withdrawal_id: "wdr_fedcba9876543210fedcba98",
        status: "draft",
        updated_at: "2026-10-02T14:05:00.000Z"
      }),
      withdrawalEntry({
        withdrawal_id: "wdr_111111111111111111111111",
        status: "confirmed",
        updated_at: "2026-10-02T14:11:00.000Z"
      })
    ];
    await withFakeApi(
      () => ({ mode: "test", withdrawals: coherent }),
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.withdrawals(bffSubject, Date.now());
        assert.equal(result.status, "ok", "status-coherent timestamps still serve");
      }
    );
  });

  it("fails closed on a market order resting in a non-rejected status", async () => {
    const key = randomBytes(32).toString("hex");
    for (const status of ["open", "cancelled", "expired"]) {
      await withFakeApi(
        () => ({ mode: "test", orders: [orderEntry({ order_type: "market", status })] }),
        async (baseUrl) => {
          const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
          assert.deepEqual(
            await client.exchangeOrders(bffSubject, Date.now()),
            { status: "unavailable" },
            `market + ${status} can never be served`
          );
        }
      );
    }
    await withFakeApi(
      () => ({ mode: "test", orders: [orderEntry({ order_type: "market", status: "rejected" })] }),
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.exchangeOrders(bffSubject, Date.now());
        assert.equal(result.status, "ok", "a rejected market order still serves");
      }
    );
  });

  it("fails closed on checks with an unbound counterparty ref or an off-directory asset", async () => {
    const key = randomBytes(32).toString("hex");
    const bad: Record<string, unknown>[] = [
      checkEntry({ recipient_ref: "a-random-string" }),
      checkEntry({ recipient_ref: "syn_cust_" }),
      checkEntry({ sender_ref: "not-the-subject", recipient_ref: upstreamSubject }),
      checkEntry({ asset: "RUB", amount: "100.00", fee_amount: "0.50", outstanding_amount: "100.00" }),
      checkEntry({ asset: "BTC", amount: "1.00000000", fee_amount: "0.01000000", outstanding_amount: "1.00000000" })
    ];
    for (const entry of bad) {
      await withFakeApi(
        () => ({ mode: "test", checks: [entry] }),
        async (baseUrl) => {
          const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
          assert.deepEqual(
            await client.checks(bffSubject, Date.now()),
            { status: "unavailable" },
            `sender ${String(entry.sender_ref)} recipient ${String(entry.recipient_ref)} asset ${String(entry.asset)}`
          );
        }
      );
    }
    await withFakeApi(
      () => ({ mode: "test", checks: [checkEntry()] }),
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.checks(bffSubject, Date.now());
        assert.equal(result.status, "ok", "a bound counterparty ref on a directory asset still serves");
      }
    );
  });

  it("fails closed on activity items off the per-kind status vocabulary or ref binding", async () => {
    const key = randomBytes(32).toString("hex");
    const bad: Record<string, unknown>[] = [
      activityEntry({ status: "pending_maker_approval" }),
      activityEntry({ status: "open" }),
      activityEntry({ kind: "quote", status: "payment_received", detail: "Quote qte_0123456789abcdef01234567 issued" }),
      activityEntry({ kind: "security", status: "created", money: null }),
      activityEntry({ detail: "A deposit was recorded" }),
      activityEntry({ kind: "kyc", status: "in_review", detail: "Review on dep_0123456789abcdef01234567", money: null })
    ];
    for (const entry of bad) {
      await withFakeApi(
        () => ({ mode: "test", activity: [entry] }),
        async (baseUrl) => {
          const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
          assert.deepEqual(
            await client.activity(bffSubject, Date.now()),
            { status: "unavailable" },
            `kind ${String(entry.kind)} status ${String(entry.status)}`
          );
        }
      );
    }
    const feed = [
      activityEntry(),
      activityEntry({
        activity_id: "act_fedcba9876543210fedcba98",
        kind: "security",
        status: "login",
        detail: "Session login from the Mini App",
        money: null,
        created_at: "2026-10-08T08:15:00.000Z"
      })
    ];
    await withFakeApi(
      () => ({ mode: "test", activity: feed }),
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.activity(bffSubject, Date.now());
        assert.equal(result.status, "ok", "ref-bound items on their kind vocabulary still serve");
      }
    );
  });

  it("fails closed on an activity feed violating bounds, uniqueness or ordering", async () => {
    const key = randomBytes(32).toString("hex");
    const first = activityEntry();
    const second = activityEntry({
      activity_id: "act_fedcba9876543210fedcba98",
      kind: "withdrawal",
      status: "broadcast",
      detail: "Withdrawal wdr_0123456789abcdef01234567 broadcast",
      created_at: "2026-10-08T08:15:00.000Z"
    });
    const ten = Array.from({ length: 10 }, (_value, index) =>
      activityEntry({
        activity_id: `act_${String(index).padStart(24, "0")}`,
        kind: "deposit",
        created_at: `2026-10-08T0${9 - Math.floor(index / 10)}:${59 - index}:00.000Z`
      }));
    const bad: Record<string, unknown>[][] = [
      [],
      ten,
      [first, first],
      [first, activityEntry({ activity_id: "act_fedcba9876543210fedcba98", detail: "Deposit dep_fedcba9876543210fedcba98 received" })],
      [{ ...first, created_at: "2026-10-08T07:15:00.000Z" }, second],
      [first, { ...second, created_at: first.created_at as string }]
    ];
    for (const activity of bad) {
      await withFakeApi(
        () => ({ mode: "test", activity }),
        async (baseUrl) => {
          const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
          assert.deepEqual(
            await client.activity(bffSubject, Date.now()),
            { status: "unavailable" },
            `${activity.length} items, first kind ${String(activity[0]?.kind)}`
          );
        }
      );
    }
    await withFakeApi(
      () => ({ mode: "test", activity: [first, second] }),
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.activity(bffSubject, Date.now());
        assert.equal(result.status, "ok", "a unique-kind newest-first feed still serves");
      }
    );
  });

  it("fails closed on operation items off the per-kind status, direction, fee or timeline rules", async () => {
    const key = randomBytes(32).toString("hex");
    const withdrawalOp = operationItem("ope_111111111111111111111111", {
      kind: "withdrawal",
      status: "broadcast",
      exchange: null,
      legs: [{ asset: "USDT", amount: "5.000000", direction: "out" }]
    });
    const bad: Record<string, unknown>[] = [
      operationItem("ope_222222222222222222222222", { status: "awaiting_payment" }),
      operationItem("ope_333333333333333333333333", { fee_amount: "0.000000" }),
      operationItem("ope_444444444444444444444444", {
        kind: "withdrawal",
        status: "broadcast",
        exchange: null,
        legs: [{ asset: "USDT", amount: "5.000000", direction: "in" }]
      }),
      operationItem("ope_555555555555555555555555", {
        kind: "deposit",
        status: "payment_received",
        exchange: null,
        legs: [{ asset: "RUB", amount: "25000.00", direction: "out" }]
      }),
      operationItem("ope_666666666666666666666666", { note: "" }),
      operationItem("ope_777777777777777777777777", {
        timeline: [
          { title: "A", detail: "step", at: "2026-10-08T09:10:00.000Z", state: "done" },
          { title: "B", detail: "step", at: "2026-10-08T09:11:00.000Z", state: "done" },
          { title: "C", detail: "step", at: "2026-10-08T09:12:00.000Z", state: "done" },
          { title: "D", detail: "step", at: "2026-10-08T09:13:00.000Z", state: "done" },
          { title: "E", detail: "step", at: null, state: "pending" }
        ]
      }),
      operationItem("ope_888888888888888888888888", {
        timeline: [
          { title: "A", detail: "step", at: "2026-10-08T09:14:00.000Z", state: "done" },
          { title: "B", detail: "step", at: "2026-10-08T09:13:00.000Z", state: "done" }
        ]
      }),
      operationItem("ope_999999999999999999999999", {
        timeline: [{ title: "A", detail: "step", at: "2026-10-08T09:16:00.000Z", state: "done" }]
      }),
      operationItem("ope_aaaaaaaaaaaaaaaaaaaaaaaa", {
        kind: "qr",
        status: "open",
        exchange: null,
        legs: [{ asset: "RUB", amount: "500.00", direction: "in" }]
      }),
      { ...withdrawalOp, status: "open" }
    ];
    for (const item of bad) {
      await withFakeApi(
        () => item,
        async (baseUrl) => {
          const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
          assert.deepEqual(
            await client.operation(bffSubject, String(item.operation_id), Date.now()),
            { status: "unavailable" },
            `kind ${String(item.kind)} status ${String(item.status)}`
          );
        }
      );
    }
    await withFakeApi(
      () => withdrawalOp,
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.operation(bffSubject, String(withdrawalOp.operation_id), Date.now());
        assert.equal(result.status, "ok", "a coherent non-exchange item still serves");
      }
    );
  });

  it("fails closed on an operations feed violating bounds, uniqueness or ordering", async () => {
    const key = randomBytes(32).toString("hex");
    const first = operationItem("ope_0123456789abcdef01234567");
    const second = operationItem("ope_fedcba9876543210fedcba98", {
      kind: "deposit",
      status: "payment_received",
      exchange: null,
      legs: [{ asset: "RUB", amount: "25000.00", direction: "in" }],
      timeline: [
        { title: "Draft", detail: "Operation created", at: "2026-10-08T08:14:00.000Z", state: "done" },
        { title: "Settled", detail: "Legs settle", at: "2026-10-08T08:15:00.000Z", state: "current" }
      ],
      created_at: "2026-10-08T08:15:00.000Z"
    });
    const statusByKind: Record<string, string> = {
      exchange: "open",
      deposit: "awaiting_payment",
      withdrawal: "draft",
      qr: "created"
    };
    const five = ["exchange", "deposit", "withdrawal", "qr", "deposit"].map((kind, index) =>
      operationItem(`ope_${String(index).repeat(24)}`, {
        kind,
        status: statusByKind[kind] as string,
        exchange: kind === "exchange" ? { base_asset: "USDT", quote_asset: "RUB", rate: "95.000000" } : null,
        legs:
          kind === "exchange"
            ? [
                { asset: "USDT", amount: "10.000000", direction: "out" },
                { asset: "RUB", amount: "950.00", direction: "in" }
              ]
            : [{ asset: "RUB", amount: "100.00", direction: kind === "withdrawal" ? "out" : "in" }],
        created_at: `2026-10-08T0${8 - index}:15:00.000Z`
      }));
    const bad: Record<string, unknown>[][] = [
      [],
      five,
      [first, first],
      [first, operationItem("ope_fedcba9876543210fedcba98", { created_at: "2026-10-08T08:15:00.000Z" })],
      [{ ...first, created_at: "2026-10-08T07:15:00.000Z" }, second],
      [first, { ...second, created_at: first.created_at as string }]
    ];
    for (const operations of bad) {
      await withFakeApi(
        () => ({ mode: "test", operations }),
        async (baseUrl) => {
          const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
          assert.deepEqual(
            await client.operations(bffSubject, Date.now()),
            { status: "unavailable" },
            `${operations.length} items, first kind ${String(operations[0]?.kind)}`
          );
        }
      );
    }
    await withFakeApi(
      () => ({ mode: "test", operations: [first, second] }),
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.operations(bffSubject, Date.now());
        assert.equal(result.status, "ok", "a unique-kind newest-first feed still serves");
      }
    );
  });

  it("fails closed on notification timestamps that normalize instead of reserializing", async () => {
    const key = randomBytes(32).toString("hex");
    for (const stamp of ["2026-02-31T00:00:00.000Z", "2026-01-01T24:00:00.000Z"]) {
      await withFakeApi(
        () => ({
          mode: "test",
          delivery: "disabled",
          unread: 0,
          notifications: [notificationEntry("ntf_0123456789abcdef01234567", true), { ...notificationEntry("ntf_fedcba9876543210fedcba98", false), created_at: stamp, read: true }]
        }),
        async (baseUrl) => {
          const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
          assert.deepEqual(
            await client.notifications(bffSubject, Date.now()),
            { status: "unavailable" },
            stamp
          );
        }
      );
    }
  });

  it("fails closed on support tickets off the fixed hourly step or the exact TTL", async () => {
    const key = randomBytes(32).toString("hex");
    const bad: Record<string, unknown>[] = [
      supportTicket({ expires_at: "2026-10-01T14:00:00.000Z" }),
      supportTicket({ expires_at: "2026-10-03T12:00:00.000Z" }),
      supportTicket({
        timeline: [
          { status: "received", at: "2026-10-01T12:00:00.000Z" },
          { status: "in_review", at: "2026-10-01T12:30:00.000Z" }
        ]
      }),
      supportTicket({
        timeline: [
          { status: "received", at: "2026-10-01T12:00:00.000Z" },
          { status: "in_review", at: "2026-10-01T14:00:00.000Z" }
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
            JSON.stringify(ticket.expires_at)
          );
        }
      );
    }
    await withFakeApi(
      () => supportView([supportTicket()]),
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.support(bffSubject, Date.now());
        assert.equal(result.status, "ok", "the exact-step exact-TTL ticket still serves");
      }
    );
  });

  it("fails closed on a deposit-addresses view that is not the exact allowlisted set or network shape", async () => {
    const key = randomBytes(32).toString("hex");
    const addresses = canonicalDepositAddresses();
    const bad: Record<string, unknown>[][] = [
      addresses.slice(0, 2),
      [addresses[0] as Record<string, unknown>, depositAddressEntry("TON", "TON_TESTNET", `kQ${"C".repeat(46)}`, { deposit_address_id: "dpa_444444444444444444444444" }), addresses[2] as Record<string, unknown>],
      [depositAddressEntry("TON", "TON_TESTNET", `T${"9".repeat(33)}`), addresses[1] as Record<string, unknown>, addresses[2] as Record<string, unknown>],
      [depositAddressEntry("USDT", "TRON_TESTNET", `kQ${"D".repeat(46)}`, { deposit_address_id: "dpa_555555555555555555555555" }), addresses[0] as Record<string, unknown>, addresses[1] as Record<string, unknown>],
      [depositAddressEntry("TON", "TON_TESTNET", "kQ123"), addresses[1] as Record<string, unknown>, addresses[2] as Record<string, unknown>],
      []
    ];
    for (const deposit_addresses of bad) {
      await withFakeApi(
        () => ({ mode: "test", deposit_addresses }),
        async (baseUrl) => {
          const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
          assert.deepEqual(
            await client.depositAddresses(bffSubject, Date.now()),
            { status: "unavailable" },
            `${deposit_addresses.length} rows, first network ${String(deposit_addresses[0]?.network)}`
          );
        }
      );
    }
    await withFakeApi(
      () => ({ mode: "test", deposit_addresses: addresses }),
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.depositAddresses(bffSubject, Date.now());
        assert.equal(result.status, "ok", "the exact target set still serves");
      }
    );
  });

  it("fails closed on a screenings view that is not the exact allowlisted target set", async () => {
    const key = randomBytes(32).toString("hex");
    const screenings = canonicalScreenings();
    const bad: Record<string, unknown>[][] = [
      screenings.slice(0, 2),
      [screenings[0] as Record<string, unknown>, screeningRecord("scr_99999999999999999999999999999999"), screeningRecord("scr_88888888888888888888888888888888")],
      []
    ];
    for (const view of bad) {
      await withFakeApi(
        () => ({ mode: "test", screenings: view }),
        async (baseUrl) => {
          const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
          assert.deepEqual(
            await client.addressScreenings(bffSubject, Date.now()),
            { status: "unavailable" },
            `${view.length} screening rows`
          );
        }
      );
    }
    await withFakeApi(
      () => ({ mode: "test", screenings }),
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.addressScreenings(bffSubject, Date.now());
        assert.equal(result.status, "ok", "the exact target set still serves");
      }
    );
  });

  it("maps every throw inside the read path to the documented union — never a thrown TypeError", async () => {
    const key = randomBytes(32).toString("hex");
    await withFakeApi(
      (path, headers) => (path === "/api/v1/customer/session" ? sessionEcho(headers) : validCapabilities()),
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const bogus = 0 as unknown as string;
        assert.deepEqual(await client.access(bogus, Date.now()), { status: "unavailable" });
        assert.deepEqual(await client.wallets(bogus, Date.now()), { status: "unavailable" });
        assert.deepEqual(await client.users(bogus, Date.now()), { status: "unavailable" });
      }
    );
  });
});
