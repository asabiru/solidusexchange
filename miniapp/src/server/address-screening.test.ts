import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { KytScenario, ScheduledDelivery } from "@solidchange/provider-simulators";
import type { AddressScreeningStatus } from "../shared/api.js";
import {
  ScreeningInputError,
  ScreeningRateLimitError,
  ScreeningUnavailableError,
  canonicalScreeningAddress,
  createAddressScreeningService,
  maxNewScreeningsPerWindow,
  maxScreeningsPerSubject,
  screeningWindowSeconds
} from "./address-screening.js";

const startMs = 1_790_000_000_000;
const subject = "tg-0123456789abcdef";
const otherSubject = "tg-fedcba9876543210";
const base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function crc16(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function tonAddress(options: { tag?: number; workchain?: number; fill?: number; encoding?: "base64url" | "base64" } = {}): string {
  const bytes = Buffer.alloc(36);
  bytes[0] = options.tag ?? 0x91;
  bytes[1] = options.workchain ?? 0x00;
  for (let index = 2; index < 34; index += 1) bytes[index] = ((options.fill ?? 1) * 31 + index * 7) & 0xff;
  bytes.writeUInt16BE(crc16(bytes.subarray(0, 34)), 34);
  return bytes.toString(options.encoding ?? "base64url");
}

function tronAddress(fill = 1, prefix = 0x41): string {
  const payload = Buffer.alloc(21);
  payload[0] = prefix;
  for (let index = 1; index < 21; index += 1) payload[index] = (fill * 17 + index * 5) & 0xff;
  const check = createHash("sha256").update(createHash("sha256").update(payload).digest()).digest().subarray(0, 4);
  let value = BigInt(`0x${Buffer.concat([payload, check]).toString("hex")}`);
  let out = "";
  while (value > 0n) {
    out = base58Alphabet[Number(value % 58n)] + out;
    value /= 58n;
  }
  return out;
}

function service(scenario: KytScenario = "low", seed = "miniapp-kyt-test", screeningTimeoutSeconds = 900) {
  let now = startMs;
  const screening = createAddressScreeningService({ seed, scenario, screeningTimeoutSeconds, clock: () => now });
  return {
    screening,
    advance(seconds: number) {
      now += seconds * 1_000;
    }
  };
}

const tonInput = (address = tonAddress()) => ({ asset: "TON", network: "TON_TESTNET", address });

function walk(run: ReturnType<typeof service>, id: string, seconds: number, owner = subject): AddressScreeningStatus[] {
  const statuses: AddressScreeningStatus[] = [];
  for (let elapsed = 0; elapsed < seconds; elapsed += 5) {
    run.advance(5);
    const status = run.screening.view(owner, id)?.status;
    assert.ok(status);
    if (statuses.at(-1) !== status) statuses.push(status);
  }
  return statuses;
}

function payloadOf(delivery: ScheduledDelivery): Record<string, unknown> {
  return JSON.parse(delivery.body.toString("utf8")) as Record<string, unknown>;
}

function flip(address: string, index: number, alphabet: string): string {
  const current = address[index] ?? "";
  const replacement = alphabet[(alphabet.indexOf(current) + 1) % alphabet.length] ?? "";
  return address.slice(0, index) + replacement + address.slice(index + 1);
}

describe("address screening: syntactic testnet address validation", () => {
  it("accepts testnet TON addresses and canonicalizes equivalent forms", () => {
    const bounceable = tonAddress();
    const nonBounceable = tonAddress({ tag: 0xd1 });
    assert.match(bounceable, /^kQ/);
    assert.match(nonBounceable, /^0Q/);
    const raw = canonicalScreeningAddress("TON_TESTNET", bounceable);
    assert.match(raw ?? "", /^0:[0-9a-f]{64}$/);
    assert.equal(canonicalScreeningAddress("TON_TESTNET", nonBounceable), raw);
    assert.equal(canonicalScreeningAddress("TON_TESTNET", tonAddress({ encoding: "base64" })), raw);
    assert.match(canonicalScreeningAddress("TON_TESTNET", tonAddress({ workchain: 0xff })) ?? "", /^-1:[0-9a-f]{64}$/);
  });

  it("rejects mainnet, corrupted, raw and oversized TON addresses", () => {
    const valid = tonAddress();
    for (const address of [
      tonAddress({ tag: 0x11 }),
      tonAddress({ tag: 0x51 }),
      tonAddress({ workchain: 0x01 }),
      flip(valid, 47, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"),
      flip(valid, 10, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"),
      valid.slice(0, 47),
      `${valid}A`,
      ` ${valid}`,
      `${valid.slice(0, 20)}+${valid.slice(21, 30)}_${valid.slice(31)}`,
      `0:${"ab".repeat(32)}`,
      tronAddress(),
      "",
      "k".repeat(65)
    ]) {
      assert.equal(canonicalScreeningAddress("TON_TESTNET", address), undefined, address);
    }
  });

  it("accepts Base58Check TRON addresses and rejects anything else", () => {
    const valid = tronAddress();
    assert.match(valid, /^T[1-9A-HJ-NP-Za-km-z]{33}$/);
    assert.equal(canonicalScreeningAddress("TRON_TESTNET", valid), valid);
    for (const address of [
      flip(valid, 33, base58Alphabet),
      flip(valid, 12, base58Alphabet),
      tronAddress(1, 0x42),
      `${valid.slice(0, 10)}0${valid.slice(11)}`,
      `${valid.slice(0, 10)}O${valid.slice(11)}`,
      `${valid.slice(0, 10)}l${valid.slice(11)}`,
      valid.slice(0, 33),
      `${valid}1`,
      valid.toLowerCase(),
      `0x${"ab".repeat(20)}`,
      tonAddress(),
      "",
      "T".repeat(65)
    ]) {
      assert.equal(canonicalScreeningAddress("TRON_TESTNET", address), undefined, address);
    }
    assert.equal(canonicalScreeningAddress("ETH_TESTNET", valid), undefined);
  });

  it("rejects unsupported asset/network pairs and invalid addresses before any provider call", async () => {
    const run = service();
    for (const input of [
      { asset: "RUB", network: "TON_TESTNET", address: tonAddress() },
      { asset: "TON", network: "TRON_TESTNET", address: tronAddress() },
      { asset: "USDT", network: "ETH_TESTNET", address: tronAddress() },
      { asset: "usdt", network: "TON_TESTNET", address: tonAddress() },
      { asset: "TON", network: "TON_MAINNET", address: tonAddress() }
    ]) {
      await assert.rejects(run.screening.submit(subject, input), (error: unknown) =>
        error instanceof ScreeningInputError && error.code === "invalid_target");
    }
    for (const input of [
      { asset: "TON", network: "TON_TESTNET", address: tronAddress() },
      { asset: "USDT", network: "TON_TESTNET", address: tonAddress({ tag: 0x11 }) },
      { asset: "USDT", network: "TRON_TESTNET", address: tonAddress() }
    ]) {
      await assert.rejects(run.screening.submit(subject, input), (error: unknown) =>
        error instanceof ScreeningInputError && error.code === "invalid_address");
    }
    assert.equal(run.screening.size(subject), 0);
    run.advance(600);
    assert.equal(run.screening.drainDeliveries().length, 0);
  });
});

describe("address screening: risk only from verified, in-order signed callbacks", () => {
  it("starts pending and reports the risk level once the signed completion is applied", async () => {
    const run = service();
    const { created, view } = await run.screening.submit(subject, tonInput());
    assert.equal(created, true);
    assert.match(view.id, /^scr_[0-9a-f]{32}$/);
    assert.deepEqual(Object.keys(view).sort(), ["advisory", "asset", "deadline", "executable", "id", "mode", "network", "status", "submittedAt"]);
    assert.equal(view.mode, "test");
    assert.equal(view.status, "pending");
    assert.equal(view.advisory, true);
    assert.equal(view.executable, false);
    assert.equal(view.deadline, startMs + 900_000);
    assert.deepEqual(walk(run, view.id, 120), ["pending", "low"]);
    const state = run.screening.inspect(subject, view.id);
    assert.equal(state?.status, "completed");
    assert.equal(state?.sequence, 2);
  });

  it("maps every risk scenario on every allowed asset/network pair", async () => {
    for (const [scenario, expected] of [
      ["low", "low"],
      ["medium", "medium"],
      ["high", "high"],
      ["severe", "severe"],
      ["sanctions_hit", "severe"]
    ] as const) {
      const run = service(scenario);
      for (const input of [
        tonInput(),
        { asset: "USDT", network: "TON_TESTNET", address: tonAddress({ tag: 0xd1 }) },
        { asset: "USDT", network: "TRON_TESTNET", address: tronAddress() }
      ]) {
        const { view } = await run.screening.submit(subject, input);
        assert.equal(view.asset, input.asset);
        assert.equal(view.network, input.network);
        assert.equal(walk(run, view.id, 120).at(-1), expected, `${scenario} ${input.network}`);
      }
    }
  });

  it("is idempotent per subject, asset/network and canonical address", async () => {
    const run = service();
    const first = await run.screening.submit(subject, tonInput());
    const again = await run.screening.submit(subject, tonInput(tonAddress({ tag: 0xd1 })));
    assert.equal(again.created, false);
    assert.equal(again.view.id, first.view.id);
    const usdt = await run.screening.submit(subject, { asset: "USDT", network: "TON_TESTNET", address: tonAddress() });
    assert.notEqual(usdt.view.id, first.view.id);
    const foreign = await run.screening.submit(otherSubject, tonInput());
    assert.notEqual(foreign.view.id, first.view.id);
    run.advance(120);
    assert.equal(run.screening.drainDeliveries().length, 6);
    assert.equal(run.screening.size(subject), 2);
  });

  async function pending() {
    const run = service();
    const { view } = await run.screening.submit(subject, tonInput());
    run.advance(120);
    const deliveries = run.screening.drainDeliveries();
    assert.deepEqual(deliveries.map((delivery) => payloadOf(delivery).status), ["pending", "completed"]);
    return { ...run, id: view.id, ack: deliveries[0], completion: deliveries[1] };
  }

  it("ignores unsigned, forged, foreign-keyed and stale callbacks", async () => {
    const { screening, id, completion } = await pending();
    const at = completion.deliverAt;
    assert.deepEqual(screening.receiveCallback({ headers: {}, body: completion.body }, at), { verified: false, reason: "missing_header" });
    assert.deepEqual(screening.receiveCallback({ headers: completion.headers, body: completion.body.toString("utf8") }, at), { verified: false, reason: "invalid_body_type" });
    const forged = Buffer.from(completion.body.toString("utf8").replace("\"risk_level\":\"low\"", "\"risk_level\":\"severe\""), "utf8");
    assert.notDeepEqual(forged, completion.body);
    assert.deepEqual(screening.receiveCallback({ headers: completion.headers, body: forged }, at), { verified: false, reason: "signature_mismatch" });

    const other = service();
    await other.screening.submit(subject, tonInput());
    other.advance(120);
    const foreign = other.screening.drainDeliveries()[1];
    assert.ok(foreign);
    assert.deepEqual(screening.receiveCallback(foreign, foreign.deliverAt), { verified: false, reason: "signature_mismatch" });

    assert.deepEqual(screening.receiveCallback(completion, at + 301), { verified: false, reason: "stale_timestamp" });
    assert.equal(screening.view(subject, id)?.status, "pending");
    assert.equal(screening.inspect(subject, id)?.status, "requested");
  });

  it("buffers a completion delivered before its predecessor and refuses replays", async () => {
    const { screening, id, ack, completion } = await pending();
    assert.deepEqual(screening.receiveCallback(completion, completion.deliverAt), { verified: true, action: "buffered" });
    assert.equal(screening.view(subject, id)?.status, "pending");
    assert.equal(screening.inspect(subject, id)?.buffered, 1);
    assert.deepEqual(screening.receiveCallback(completion, completion.deliverAt), { verified: false, reason: "replayed_nonce" });
    assert.deepEqual(screening.receiveCallback(ack, ack.deliverAt), { verified: true, action: "applied" });
    assert.equal(screening.view(subject, id)?.status, "low");
    assert.deepEqual(screening.receiveCallback(ack, ack.deliverAt), { verified: false, reason: "replayed_nonce" });
    assert.equal(screening.view(subject, id)?.status, "low");
  });

  it("applies duplicated and reordered simulator deliveries exactly once", async () => {
    for (const scenario of ["duplicate_callback", "out_of_order_callback"] as const) {
      const run = service(scenario);
      const { view } = await run.screening.submit(subject, tonInput());
      assert.deepEqual(walk(run, view.id, 120), ["pending", "medium"], scenario);
      const state = run.screening.inspect(subject, view.id);
      assert.equal(state?.sequence, 2, scenario);
      assert.equal(state?.lateEvents, 0, scenario);
      assert.equal(state?.buffered, 0, scenario);
    }
  });
});

describe("address screening: outage, timeout and late results", () => {
  it("reports a provider outage as unavailable without inventing a result", async () => {
    const run = service("provider_outage");
    let id = "";
    await assert.rejects(run.screening.submit(subject, tonInput()), (error: unknown) => {
      if (!(error instanceof ScreeningUnavailableError)) return false;
      id = error.view.id;
      return error.view.status === "unavailable" && error.view.executable === false;
    });
    assert.equal(run.screening.view(subject, id)?.status, "unavailable");
    await assert.rejects(run.screening.submit(subject, tonInput()), ScreeningUnavailableError);
    assert.equal(run.screening.size(subject), 1);
    run.advance(600);
    assert.equal(run.screening.drainDeliveries().length, 0);
    assert.equal(run.screening.view(subject, id)?.status, "unavailable");
  });

  it("times out when no completion arrives before the deadline", async () => {
    const run = service("pending_timeout", "miniapp-kyt-test", 60);
    const { view } = await run.screening.submit(subject, tonInput());
    assert.deepEqual(walk(run, view.id, 120), ["pending", "timed_out"]);
    assert.equal(run.screening.inspect(subject, view.id)?.timedOut, true);
  });

  it("keeps a timed-out screening timed out when the completion arrives late", async () => {
    const run = service("late_callback", "miniapp-kyt-test", 60);
    const { view } = await run.screening.submit(subject, tonInput());
    assert.deepEqual(walk(run, view.id, 900), ["pending", "timed_out"]);
    const state = run.screening.inspect(subject, view.id);
    assert.equal(state?.timedOut, true);
    assert.equal(state?.lateEvents, 1);
    assert.equal(state?.status, "pending");
  });
});

describe("address screening: determinism, isolation and bounded storage", () => {
  it("produces identical signed payloads for the same seed and different ones for another seed", async () => {
    async function payloads(seed: string) {
      const run = service("medium", seed);
      const { view } = await run.screening.submit(subject, tonInput());
      run.advance(120);
      return { id: view.id, payloads: run.screening.drainDeliveries().map(payloadOf) };
    }
    const first = await payloads("miniapp-kyt-a");
    const second = await payloads("miniapp-kyt-a");
    const other = await payloads("miniapp-kyt-b");
    assert.deepEqual(second, first);
    assert.equal(other.id, first.id);
    assert.notEqual(other.payloads[0]?.assessment_id, first.payloads[0]?.assessment_id);
  });

  it("never shows one subject's screening to another", async () => {
    const run = service();
    const { view } = await run.screening.submit(subject, tonInput());
    assert.equal(run.screening.view(otherSubject, view.id), undefined);
    assert.equal(run.screening.inspect(otherSubject, view.id), undefined);
    assert.equal(run.screening.size(otherSubject), 0);
    assert.equal(run.screening.view(subject, "scr_unknown"), undefined);
    assert.equal(run.screening.view(subject, `${view.id}x`), undefined);
    assert.equal(run.screening.view(subject, view.id)?.id, view.id);
  });

  it("keeps the newest screenings per subject and rate-limits new submissions", async () => {
    const run = service();
    const ids: string[] = [];
    for (let fill = 0; fill < maxNewScreeningsPerWindow; fill += 1) {
      ids.push((await run.screening.submit(subject, tonInput(tonAddress({ fill })))).view.id);
    }
    assert.equal(run.screening.size(subject), maxScreeningsPerSubject);
    assert.equal(run.screening.view(subject, ids[0] ?? ""), undefined);
    assert.equal(run.screening.view(subject, ids.at(-1) ?? "")?.status, "pending");
    const retained = await run.screening.submit(subject, tonInput(tonAddress({ fill: maxNewScreeningsPerWindow - 1 })));
    assert.equal(retained.created, false);
    await assert.rejects(run.screening.submit(subject, tonInput(tonAddress({ fill: 100 }))), ScreeningRateLimitError);
    const foreign = await run.screening.submit(otherSubject, tonInput(tonAddress({ fill: 100 })));
    assert.equal(foreign.created, true);
    run.advance(screeningWindowSeconds);
    assert.equal((await run.screening.submit(subject, tonInput(tonAddress({ fill: 100 })))).created, true);
    assert.equal(run.screening.size(subject), maxScreeningsPerSubject);
  });

  it("never exposes provider references, addresses or raw risk evidence", async () => {
    const run = service("sanctions_hit");
    const address = tonAddress();
    const { view } = await run.screening.submit(subject, tonInput(address));
    walk(run, view.id, 120);
    const body = JSON.stringify(run.screening.view(subject, view.id));
    assert.match(body, /"status":"severe"/);
    assert.equal(body.includes(address), false);
    assert.doesNotMatch(body, /sim-|kytasm|kytevt|binding|risk_score|sanctions|categories|0:[0-9a-f]{64}|tg-/);
  });

  it("does not log, fetch or open sockets from the screening service", () => {
    const source = readFileSync(fileURLToPath(new URL("../../src/server/address-screening.ts", import.meta.url)), "utf8");
    assert.doesNotMatch(source, /console\.|fetch\(|node:(http|https|net|dns|tls|dgram)/);
  });
});
