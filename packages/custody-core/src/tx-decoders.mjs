// Independent synthetic transaction decoders for the co-verifier role in the
// HSM custody program (hsm-custody-program.md §"Engineering work possible
// now"). Production decoders will decode real TON cells and TRON protobufs;
// this reference decodes the synthetic wire shapes the dev stack produces so
// the intent-to-transaction matching seam is executable today.
//
// Wire formats (canonical JSON payloads, hex-encoded):
//   TON native:      {type:"ton_transfer",to,amount_nano,seqno,valid_until}
//   TON jetton USDT: {type:"jetton_transfer",jetton:"USDT",to,amount,seqno,
//                     valid_until}
//   TRON TRC-20:     {type:"trc20_transfer",contract:"USDT",to_address,amount,
//                     expiration}
//
// Both decode to the canonical shape
//   {chain, network, asset, amount, destination_reference, expiry, sequence}
// used by the HSM policy module's intent-matching arm. No key material,
// signatures or network access live here.

import { snapshotPlainData } from "./unsigned-intent.mjs";

const HEX_PATTERN = /^[0-9a-f]+$/u;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;
const REFERENCE_PATTERN = /^[a-z][a-z0-9_]{2,127}$/u;

function fail(message) {
  throw new Error(message);
}

function decodePayload(hexPayload) {
  if (typeof hexPayload !== "string" || hexPayload.length % 2 !== 0 || !HEX_PATTERN.test(hexPayload)) {
    fail("wire payload must be lowercase hex");
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(hexPayload, "hex").toString("utf8"));
  } catch {
    fail("wire payload is not canonical JSON");
  }
  return snapshotPlainData(parsed, "wire payload");
}

function assertDecimal(value, label) {
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value) || BigInt(value.replace(".", "")) <= 0n) {
    fail(`${label} must be a positive canonical decimal string`);
  }
}

function assertWireInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${label} must be a non-negative safe integer`);
  }
}

function normalizeTon(wire) {
  const base = {
    chain: "TON",
    network: "TON_TESTNET",
    sequence: wire.seqno,
    expiry: wire.valid_until,
    destination_reference: wire.to
  };
  if (wire.type === "ton_transfer") {
    // Native TON moves in nanoton; the synthetic intent surface uses the
    // asset's 9-scale decimal string.
    if (typeof wire.amount_nano !== "string" || !/^[1-9][0-9]*$/u.test(wire.amount_nano)) {
      fail("ton_transfer amount_nano must be a positive integer string");
    }
    const padded = wire.amount_nano.padStart(10, "0");
    const whole = padded.slice(0, -9).replace(/^0+(?=\d)/u, "");
    return {
      ...base,
      asset: "TON",
      amount: `${whole}.${padded.slice(-9)}`
    };
  }
  if (wire.type === "jetton_transfer") {
    if (wire.jetton !== "USDT") {
      fail(`unsupported jetton ${wire.jetton}`);
    }
    assertDecimal(wire.amount, "jetton amount");
    return { ...base, asset: "USDT", amount: wire.amount };
  }
  fail(`unsupported TON wire type ${wire.type}`);
}

function normalizeTron(wire) {
  if (wire.type !== "trc20_transfer") {
    fail(`unsupported TRON wire type ${wire.type}`);
  }
  if (wire.contract !== "USDT") {
    fail(`unsupported TRC-20 contract ${wire.contract}`);
  }
  assertDecimal(wire.amount, "trc20 amount");
  return {
    chain: "TRON",
    network: "TRON_TESTNET",
    asset: "USDT",
    amount: wire.amount,
    destination_reference: wire.to_address,
    expiry: wire.expiration,
    sequence: wire.nonce
  };
}

function assertCanonicalShape(tx) {
  for (const key of ["chain", "network", "asset", "amount", "destination_reference", "expiry", "sequence"]) {
    if (!Object.hasOwn(tx, key)) fail(`decoded transaction is missing ${key}`);
  }
  if (!tx.network.endsWith("_TESTNET")) fail("decoded transaction is not a testnet transaction");
  assertDecimal(tx.amount, "decoded amount");
  if (!REFERENCE_PATTERN.test(tx.destination_reference)) {
    fail("decoded destination must be a reference, never a raw address");
  }
  assertWireInteger(tx.sequence, "decoded sequence");
  assertWireInteger(tx.expiry, "decoded expiry");
  return Object.freeze(tx);
}

export function decodeTonTransaction(hexPayload) {
  return assertCanonicalShape(normalizeTon(decodePayload(hexPayload)));
}

export function decodeTronTransaction(hexPayload) {
  return assertCanonicalShape(normalizeTron(decodePayload(hexPayload)));
}

export function decodeTransactionForNetwork(network, hexPayload) {
  if (network === "TON_TESTNET") return decodeTonTransaction(hexPayload);
  if (network === "TRON_TESTNET") return decodeTronTransaction(hexPayload);
  fail(`unsupported network ${network}`);
}
