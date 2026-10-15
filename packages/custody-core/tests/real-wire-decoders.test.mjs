import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { decodeTonRawTransaction } from "../src/wire/ton.mjs";
import { decodeTronRawTransaction } from "../src/wire/tron.mjs";

import {
  abiTransfer,
  BitWriter,
  buildBoc,
  bytesField,
  contract,
  externalMessageCell,
  internalMessageCell,
  jettonBodyCell,
  TON_DEST,
  TON_JETTON_WALLET,
  tonJettonWire,
  tonNativeWire,
  tonResolvers,
  trc20Fixture,
  TRON_DESTINATION_HEX,
  TRON_EXPIRATION_MS,
  TRON_EXPIRY_SECONDS,
  TRON_OTHER_CONTRACT_HEX,
  TRON_OWNER_HEX,
  TRON_USDT_CONTRACT_HEX,
  tronRaw,
  tronResolvers,
  trxFixture,
  varintField,
  walletBodyCell
} from "./fixtures/wire-encode.mjs";

// Fixture encoders live in tests/fixtures/wire-encode.mjs — a second,
// independent implementation. Encode → decode round-trips are the
// cross-check the co-verifier role needs.

// --- TRON tests ----------------------------------------------------------------

const resolvers = tronResolvers;
const DESTINATION_HEX = TRON_DESTINATION_HEX;
const OWNER_HEX = TRON_OWNER_HEX;
const USDT_CONTRACT_HEX = TRON_USDT_CONTRACT_HEX;
const OTHER_CONTRACT_HEX = TRON_OTHER_CONTRACT_HEX;
const EXPIRY_SECONDS = TRON_EXPIRY_SECONDS;

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

// --- TON tests -----------------------------------------------------------------

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
  badOp.refs = [2];
  const cells = [externalMessageCell(), badOp, internalMessageCell({ dest: TON_DEST, valueNano: 1n })];
  assert.throws(() => decodeTonRawTransaction(buildBoc(cells), tonResolvers), /simple send op/);

  // jetton call aimed at an unregistered jetton wallet
  const foreign = internalMessageCell({
    dest: { workchain: 0, addressHex: "dd".repeat(32) },
    valueNano: 1n,
    jettonBody: true
  });
  const foreignBody = walletBodyCell();
  foreignBody.refs = [2];
  const foreignWire = buildBoc([externalMessageCell(), foreignBody, foreign, jettonBodyCell()]);
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
