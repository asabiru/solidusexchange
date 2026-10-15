import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { decodeTonRawTransaction } from "../src/wire/ton.mjs";
import { decodeTronRawTransaction } from "../src/wire/tron.mjs";

// ---------------------------------------------------------------------------
// Minimal protobuf encoder (test-side inverse of src/wire/protobuf.mjs).
// Building the fixture through a second implementation is the cross-check:
// encode → decode must round-trip, and any encoder-side mistake fails loudly.
// ---------------------------------------------------------------------------

function varint(value) {
  let v = BigInt(value);
  const out = [];
  while (true) {
    const byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v === 0n) {
      out.push(byte);
      break;
    }
    out.push(byte | 0x80);
  }
  return Buffer.from(out);
}

function key(field, wire) {
  return varint(BigInt(field) << 3n | BigInt(wire));
}

function bytesField(field, bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return Buffer.concat([key(field, 2), varint(b.length), b]);
}

function varintField(field, value) {
  return Buffer.concat([key(field, 0), varint(value)]);
}

// --- TRON fixtures -----------------------------------------------------------

const DESTINATION_HEX = `41${"aabbccddeeff00112233aabbccddeeff00112233"}`;
const OWNER_HEX = `41${"1122334455667788990011223344556677889900"}`;
const USDT_CONTRACT_HEX = `41${"0f".repeat(20)}`;
const OTHER_CONTRACT_HEX = `41${"0e".repeat(20)}`;

const resolvers = {
  resolveDestination(addressHex) {
    return addressHex === DESTINATION_HEX ? "destination_ref_tron_wallet" : null;
  },
  resolveContractAsset(addressHex) {
    return addressHex === USDT_CONTRACT_HEX ? "USDT" : null;
  }
};

const EXPIRATION_MS = 1_760_600_000_000; // 2025-10-11T12:00:00.000Z-ish; seconds = expiry
const EXPIRY_SECONDS = Math.floor(EXPIRATION_MS / 1000);

function tronAddressWord(hex) {
  const raw = Buffer.from(hex, "hex"); // 21 bytes, 0x41 prefixed
  return Buffer.concat([Buffer.alloc(11, 0), raw]);
}

function abiTransfer(hexAddress, amountMinor) {
  const selector = Buffer.from("a9059cbb", "hex");
  const amount = Buffer.alloc(32);
  let v = BigInt(amountMinor);
  for (let i = 31; i >= 0; i -= 1) {
    amount[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return Buffer.concat([selector, tronAddressWord(hexAddress), amount]);
}

function anyField(typeUrl, value) {
  const any = Buffer.concat([bytesField(1, Buffer.from(typeUrl, "utf8")), bytesField(2, value)]);
  return bytesField(2, any);
}

function contract(type, typeUrl, value) {
  const c = Buffer.concat([varintField(1, type), anyField(typeUrl, value)]);
  return bytesField(11, c);
}

function tronRaw({ contracts, expiration = EXPIRATION_MS }) {
  const parts = [
    bytesField(1, Buffer.from("dead", "hex")),
    bytesField(3, Buffer.from("beefbeefbeefbeef", "hex")),
    varintField(8, expiration),
    varintField(14, EXPIRATION_MS - 30_000),
    ...contracts
  ];
  return bytesField(1, Buffer.concat(parts));
}

function trc20Fixture({ data, contractAddress = USDT_CONTRACT_HEX, owner = OWNER_HEX } = {}) {
  const trigger = Buffer.concat([
    bytesField(1, Buffer.from(owner, "hex")),
    bytesField(2, Buffer.from(contractAddress, "hex")),
    varintField(3, 0n),
    bytesField(4, data)
  ]);
  return tronRaw({
    contracts: [contract(31, "type.googleapis.com/protocol.TriggerSmartContract", trigger)]
  }).toString("hex");
}

function trxFixture({ to = DESTINATION_HEX, amountSun = 42_000_000n, owner = OWNER_HEX } = {}) {
  const transfer = Buffer.concat([
    bytesField(1, Buffer.from(owner, "hex")),
    bytesField(2, Buffer.from(to, "hex")),
    varintField(3, amountSun)
  ]);
  return tronRaw({
    contracts: [contract(1, "type.googleapis.com/protocol.TransferContract", transfer)]
  }).toString("hex");
}

// --- tests -------------------------------------------------------------------

test("decodes a real-format TRC-20 transfer into the canonical shape", () => {
  const wire = trc20Fixture({ data: abiTransfer(DESTINATION_HEX, 12_345_678n) });
  const tx = decodeTronRawTransaction(wire, resolvers);
  assert.deepEqual(tx, {
    chain: "TRON",
    network: "TRON_TESTNET",
    asset: "USDT",
    amount: "12.345678",
    destination_reference: "destination_ref_tron_wallet",
    expiry: EXPIRY_SECONDS,
    sequence: 0
  });
  assert.ok(Object.isFrozen(tx));
});

test("decodes a real-format native TRX transfer into the canonical shape", () => {
  const wire = trxFixture({ amountSun: 42_500_000n });
  const tx = decodeTronRawTransaction(wire, resolvers);
  assert.deepEqual(tx, {
    chain: "TRON",
    network: "TRON_TESTNET",
    asset: "TRX",
    amount: "42.500000",
    destination_reference: "destination_ref_tron_wallet",
    expiry: EXPIRY_SECONDS,
    sequence: 0
  });
});

test("unmapped destinations and contracts fail closed", () => {
  const unknownDestination = `41${"99".repeat(20)}`;
  const wire = trc20Fixture({ data: abiTransfer(unknownDestination, 5_000_000n) });
  assert.throws(() => decodeTronRawTransaction(wire, resolvers), /address registry/);

  const foreignContract = trc20Fixture({
    data: abiTransfer(DESTINATION_HEX, 5_000_000n),
    contractAddress: OTHER_CONTRACT_HEX
  });
  assert.throws(() => decodeTronRawTransaction(foreignContract, resolvers), /allowlisted asset/);

  assert.throws(
    () => decodeTronRawTransaction(trc20Fixture({ data: abiTransfer(DESTINATION_HEX, 1n) }), {}),
    /requires resolveDestination/
  );
});

test("wire tampering, wrong selectors and non-asset contracts fail closed", () => {
  // contract.type disagrees with the packed Any type_url
  const transfer = Buffer.concat([
    bytesField(1, Buffer.from(OWNER_HEX, "hex")),
    bytesField(2, Buffer.from(DESTINATION_HEX, "hex")),
    varintField(3, 1_000_000n)
  ]);
  const mismatched = tronRaw({
    contracts: [contract(31, "type.googleapis.com/protocol.TransferContract", transfer)]
  }).toString("hex");
  assert.throws(() => decodeTronRawTransaction(mismatched, resolvers), /does not match/);

  // wrong ABI selector
  const badSelector = Buffer.concat([Buffer.from("deadbeef", "hex"), abiTransfer(DESTINATION_HEX, 1_000_000n).subarray(4)]);
  assert.throws(
    () => decodeTronRawTransaction(trc20Fixture({ data: badSelector }), resolvers),
    /selector/
  );

  // nonzero call_value on a token call is a covert TRX outflow — refuse
  const trigger = Buffer.concat([
    bytesField(1, Buffer.from(OWNER_HEX, "hex")),
    bytesField(2, Buffer.from(USDT_CONTRACT_HEX, "hex")),
    varintField(3, 500n),
    bytesField(4, abiTransfer(DESTINATION_HEX, 1_000_000n))
  ]);
  const covert = tronRaw({
    contracts: [contract(31, "type.googleapis.com/protocol.TriggerSmartContract", trigger)]
  }).toString("hex");
  assert.throws(() => decodeTronRawTransaction(covert, resolvers), /call_value/);

  // governance/staking contract types are not asset movements we support
  const vote = Buffer.concat([bytesField(1, Buffer.from(OWNER_HEX, "hex"))]);
  const voteTx = tronRaw({
    contracts: [contract(4, "type.googleapis.com/protocol.VoteWitnessContract", vote)]
  }).toString("hex");
  assert.throws(() => decodeTronRawTransaction(voteTx, resolvers), /type_url/);

  // truncated/corrupt protobuf
  const wire = trc20Fixture({ data: abiTransfer(DESTINATION_HEX, 1_000_000n) });
  assert.throws(() => decodeTronRawTransaction(wire.slice(0, 40), resolvers));
  assert.throws(() => decodeTronRawTransaction("zz00", resolvers), /hex/);
});

test("zero-amount, malformed addresses and multi-contract payloads fail", () => {
  assert.throws(
    () => decodeTronRawTransaction(trc20Fixture({ data: abiTransfer(DESTINATION_HEX, 0n) }), resolvers),
    /positive/
  );
  // TRON address without the 0x41 prefix must not decode
  const badWord = Buffer.concat([
    Buffer.from("a9059cbb", "hex"),
    Buffer.concat([Buffer.alloc(11, 0), Buffer.from(`7f${"22".repeat(20)}`, "hex")]),
    Buffer.alloc(32, 1)
  ]);
  assert.throws(
    () => decodeTronRawTransaction(trc20Fixture({ data: badWord }), resolvers),
    /0x41-prefixed/
  );
  // custody wires carry exactly one contract
  const double = tronRaw({
    contracts: [
      contract(1, "type.googleapis.com/protocol.TransferContract", Buffer.concat([
        bytesField(1, Buffer.from(OWNER_HEX, "hex")),
        bytesField(2, Buffer.from(DESTINATION_HEX, "hex")),
        varintField(3, 1_000_000n)
      ])),
      contract(1, "type.googleapis.com/protocol.TransferContract", Buffer.concat([
        bytesField(1, Buffer.from(OWNER_HEX, "hex")),
        bytesField(2, Buffer.from(DESTINATION_HEX, "hex")),
        varintField(3, 1_000_000n)
      ]))
    ]
  }).toString("hex");
  assert.throws(() => decodeTronRawTransaction(double, resolvers), /exactly one contract/);
});

test("the same fixture decodes identically twice (determinism)", () => {
  const wire = trc20Fixture({ data: abiTransfer(DESTINATION_HEX, 999n) });
  const first = decodeTronRawTransaction(wire, resolvers);
  const second = decodeTronRawTransaction(wire, resolvers);
  assert.deepEqual(first, second);
  assert.equal(createHash("sha256").update(JSON.stringify(first)).digest("hex"), createHash("sha256").update(JSON.stringify(second)).digest("hex"));
});

// ---------------------------------------------------------------------------
// TON fixtures: test-side BoC writer (inverse of src/wire/boc.mjs) and wallet
// message builder. Round-trip through a second implementation is the
// cross-check — encode → decode must agree bit for bit.
// ---------------------------------------------------------------------------

class BitWriter {
  constructor() {
    this.bits = [];
  }
  push(value, count) {
    let v = BigInt(value);
    for (let i = count - 1; i >= 0; i -= 1) {
      this.bits.push(Number((v >> BigInt(i)) & 1n));
    }
    return this;
  }
  pushGrams(nano) {
    if (nano === 0n) return this.push(0n, 4);
    const bytes = (nano.toString(16).length + 1) >> 1;
    this.push(bytes, 4);
    return this.push(nano, bytes * 8);
  }
  pushAddress(addr) {
    if (addr === null) return this.push(0n, 2); // addr_none
    this.push(2n, 2); // addr_std$10
    this.push(0n, 1); // anycast
    this.push(BigInt(addr.workchain < 0 ? addr.workchain + 256 : addr.workchain), 8);
    return this.push(BigInt(`0x${addr.addressHex}`), 256);
  }
  build() {
    const count = this.bits.length;
    const fullBytes = Math.floor(count / 8);
    const partial = count % 8 !== 0;
    const totalBytes = fullBytes + (partial ? 1 : 0);
    const data = Buffer.alloc(totalBytes);
    for (let i = 0; i < count; i += 1) {
      if (this.bits[i]) data[i >> 3] |= 0x80 >> (i & 7);
    }
    if (partial) data[totalBytes - 1] |= 0x80 >> (count % 8); // padding terminator
    const d2 = fullBytes + Math.ceil(count / 8);
    return { data, bitsLength: count, d2 };
  }
}

function buildBoc(cells) {
  // cells: [{bits: BitWriter|number[], refs: [indices]}] — root first.
  const serialized = cells.map((cell) => {
    const payload = cell.writer.build();
    const d1 = cell.refs.length;
    return Buffer.concat([Buffer.from([d1, payload.d2]), payload.data, Buffer.from(cell.refs)]);
  });
  const totalSize = serialized.reduce((sum, s) => sum + s.length, 0);
  const header = Buffer.concat([
    Buffer.from("b5ee9c42", "hex"),
    Buffer.from([0x01, 0x02]), // flags: size_bytes=1; offset_bytes=2
    Buffer.from([cells.length, 1, 0]),
    Buffer.from([totalSize >> 8, totalSize & 0xff]),
    Buffer.from([0])
  ]);
  return Buffer.concat([header, ...serialized]).toString("hex");
}

const TON_WALLET = { workchain: 0, addressHex: "aa".repeat(32) };
const TON_DEST = { workchain: 0, addressHex: "bb".repeat(32) };
const TON_JETTON_WALLET = { workchain: 0, addressHex: "cc".repeat(32) };

const tonResolvers = {
  resolveDestination(workchain, addressHex) {
    return workchain === 0 && addressHex === TON_DEST.addressHex ? "destination_ref_ton_wallet" : null;
  },
  resolveJettonWallet(workchain, addressHex) {
    return workchain === 0 && addressHex === TON_JETTON_WALLET.addressHex ? "USDT" : null;
  }
};

function internalMessageCell({ dest, valueNano = 0n, bounce = 1, jettonBody = null }) {
  const writer = new BitWriter();
  writer.push(0n, 1).push(1n, 1).push(BigInt(bounce), 1).push(0n, 1); // int_msg_info$0 ihr bounce bounced
  writer.pushAddress(TON_WALLET);
  writer.pushAddress(dest);
  writer.pushGrams(valueNano);
  writer.pushGrams(0n).pushGrams(0n); // ihr_fee, fwd_fee
  writer.push(0n, 64).push(0n, 32); // created_lt, created_at
  writer.push(0n, 1); // state init: none
  writer.push(jettonBody === null ? 0n : 1n, 1); // body either
  const refs = jettonBody === null ? [] : [3];
  return { writer, refs };
}

function walletBodyCell({ seqno = 42, validUntil = 1_800_000_000 } = {}) {
  const writer = new BitWriter();
  writer.push(0x2a7bd9d9n, 32); // subwallet_id
  writer.push(BigInt(validUntil), 32);
  writer.push(BigInt(seqno), 32);
  writer.push(0n, 8); // op: simple send
  writer.push(3n, 8); // mode: pay-gas + ignore-errors
  return { writer, refs: [2] }; // refs: [internalIdx] — filled by caller order
}

function externalMessageCell(destWallet = TON_WALLET) {
  const writer = new BitWriter();
  writer.push(2n, 2); // ext_in_msg_info$10
  writer.push(0n, 2); // src addr_none
  writer.pushAddress(destWallet);
  writer.pushGrams(0n); // import_fee
  writer.push(0n, 1); // state init none
  writer.push(1n, 1); // body by ref
  return { writer, refs: [1] };
}

function jettonBodyCell({ dest = TON_DEST, amount = 25_000_000n, opcode = 0xf8a7ea5n } = {}) {
  const writer = new BitWriter();
  writer.push(opcode, 32);
  writer.push(0n, 64); // query_id
  writer.pushGrams(amount);
  writer.pushAddress(dest);
  writer.pushAddress(TON_WALLET); // response address
  writer.push(0n, 1); // custom payload: none
  writer.pushGrams(1n); // forward amount (covers the notify)
  writer.push(0n, 1); // forward payload: inline nothing
  return { writer, refs: [] };
}

function tonNativeWire(opts = {}) {
  const internal = internalMessageCell({ dest: TON_DEST, valueNano: 1_500_000_000n, ...opts.internal });
  const cells = [externalMessageCell(), walletBodyCell(opts.wallet), internal];
  cells[1].refs = [2];
  return buildBoc(cells);
}

function tonJettonWire({ amount = 25_000_000n, dest = TON_DEST, walletDest = TON_JETTON_WALLET } = {}) {
  const internal = internalMessageCell({ dest: walletDest, valueNano: 50_000_000n, jettonBody: true });
  const jetton = jettonBodyCell({ dest, amount });
  const cells = [externalMessageCell(), walletBodyCell(), internal, jetton];
  cells[1].refs = [2];
  return buildBoc(cells);
}

test("decodes a real-format native TON transfer out of a BoC", () => {
  const tx = decodeTonRawTransaction(tonNativeWire(), tonResolvers);
  assert.deepEqual(tx, {
    chain: "TON",
    network: "TON_TESTNET",
    asset: "TON",
    amount: "1.500000000",
    destination_reference: "destination_ref_ton_wallet",
    expiry: 1_800_000_000,
    sequence: 42
  });
  assert.ok(Object.isFrozen(tx));
});

test("decodes a real-format TON jetton transfer out of a BoC", () => {
  const tx = decodeTonRawTransaction(tonJettonWire(), tonResolvers);
  assert.deepEqual(tx, {
    chain: "TON",
    network: "TON_TESTNET",
    asset: "USDT",
    amount: "25.000000",
    destination_reference: "destination_ref_ton_wallet",
    expiry: 1_800_000_000,
    sequence: 42
  });
});

test("TON BoC structure violations and tampering fail closed", () => {
  // corrupted magic
  const bad = Buffer.from(tonNativeWire(), "hex");
  bad[0] = 0xaa;
  assert.throws(() => decodeTonRawTransaction(bad.toString("hex"), tonResolvers), /magic/);

  // truncated wire
  const wire = tonNativeWire();
  assert.throws(() => decodeTonRawTransaction(wire.slice(0, 60), tonResolvers));

  // unknown wallet ops are not custody-decodable
  const badOp = walletBodyCell();
  badOp.writer = new BitWriter().push(0n, 32).push(1n, 32).push(1n, 32).push(7n, 8).push(0n, 8);
  const cells = [externalMessageCell(), badOp, internalMessageCell({ dest: TON_DEST, valueNano: 1n })];
  assert.throws(() => decodeTonRawTransaction(buildBoc(cells), tonResolvers), /simple send op/);

  // jetton call aimed at an unregistered jetton wallet
  const foreign = internalMessageCell({
    dest: { workchain: 0, addressHex: "dd".repeat(32) },
    valueNano: 1n,
    jettonBody: true
  });
  const foreignWire = buildBoc([externalMessageCell(), walletBodyCell(), foreign, jettonBodyCell()]);
  assert.throws(() => decodeTonRawTransaction(foreignWire, tonResolvers), /not allowlisted/);
});

test("TON amount and destination fields are resolver-gated", () => {
  const wire = tonJettonWire({ dest: { workchain: 0, addressHex: "ee".repeat(32) } });
  assert.throws(() => decodeTonRawTransaction(wire, tonResolvers), /address registry/);
  assert.throws(
    () => decodeTonRawTransaction(tonJettonWire({ amount: 0n }), tonResolvers),
    /positive/
  );
});
