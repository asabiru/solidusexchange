// Independent real-format TON transaction decoder for the co-verifier role.
// Parses a real Bag of Cells (b5ee9c42) carrying the unsigned external input
// message to the custody wallet — the artifact the signer boundary would
// seal — down to the first outbound internal message:
//
//   root cell     = ext_in_msg_info$10 {src=addr_none, dest=addr_std,
//                   import_fee, init:0, body:1→ref}
//   body cell     = wallet v4 send layout minus the signature:
//                   subwallet_id(32) valid_until(32) seqno(32) op(8) mode(8)
//                   → ref to the outbound internal message
//   internal cell = int_msg_info$0 {ihr, bounce, bounced, src, dest,
//                   value grams, fees, created, init:0, body}
//   jetton body   = TEP-74 transfer opcode 0xf8a7ea5 + query_id(64) +
//                   amount(VarUInteger) + destination addr + response addr +
//                   custom_hook(1) + fwd_amount(VarUInteger) + fwd_payload
//
// TON has no chain id on the wire — custody pins the network upstream and
// resolvers map raw (workchain, address) pairs to custody references and
// known jetton wallets to assets. Anything outside this exact shape fails
// closed; raw addresses never enter the canonical result.

import { parseBoc, sliceReader } from "./boc.mjs";

const HEX_PATTERN = /^[0-9a-f]+$/u;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;
const REFERENCE_PATTERN = /^[a-z][a-z0-9_]{2,127}$/u;
const JETTON_TRANSFER_OPCODE = 0xf8a7ea5n;
const TON_DECIMALS = 9;
const JETTON_DECIMALS = 6;

function fail(message) {
  throw new Error(message);
}

function hexToBuffer(hexPayload) {
  if (
    typeof hexPayload !== "string" ||
    hexPayload.length === 0 ||
    hexPayload.length % 2 !== 0 ||
    !HEX_PATTERN.test(hexPayload)
  ) {
    fail("TON wire must be non-empty lowercase hex");
  }
  return Buffer.from(hexPayload, "hex");
}

function readGrams(slice, label) {
  const len = Number(slice.readBits(4, label));
  if (len > 16) fail(`${label} exceeds the 128-bit coin bound`);
  if (len === 0) return 0n;
  return slice.readBits(len * 8, label);
}

function readAddress(slice, label) {
  const tag = slice.readBits(2, `${label} tag`);
  if (tag === 0n) return null; // addr_none
  if (tag !== 2n) fail(`${label} must be addr_none or addr_std`);
  slice.expectBits("0", `${label} anycast`);
  const workchain = slice.readBits(8, `${label} workchain`);
  const signedWorkchain = workchain >= 128n ? workchain - 256n : workchain;
  const address = slice.readBits(256, `${label} address`);
  return { workchain: Number(signedWorkchain), addressHex: address.toString(16).padStart(64, "0") };
}

function minorUnitsToDecimal(minor, decimals, label) {
  if (minor <= 0n) fail(`${label} must be positive`);
  const digits = minor.toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals).replace(/^0+(?=\d)/u, "");
  return `${whole}.${digits.slice(digits.length - decimals)}`;
}

function cellSlice(cell, label) {
  if (!cell || cell.bitsLength === 0) fail(`${label} must be a non-empty cell`);
  return sliceReader(cell.data, cell.bitsLength);
}

function assertResolvers(resolvers) {
  if (typeof resolvers?.resolveDestination !== "function" || typeof resolvers?.resolveJettonWallet !== "function") {
    fail("TON decode requires resolveDestination and resolveJettonWallet resolvers");
  }
  const check = (value, pattern, message) => {
    if (value === null) return null;
    if (
      typeof value !== "object" ||
      !Number.isInteger(value.workchain) ||
      value.workchain < -128 ||
      value.workchain > 127 ||
      !/^[0-9a-f]{64}$/u.test(value.addressHex)
    ) {
      fail(message);
    }
    return value;
  };
  return {
    resolveDestination(address) {
      check(address, null, "decoder produced a malformed TON address");
      const reference = resolvers.resolveDestination(address.workchain, address.addressHex);
      if (
        typeof reference !== "string" ||
        !REFERENCE_PATTERN.test(reference) ||
        !reference.startsWith("destination_ref_")
      ) {
        fail(`destination ${address.workchain}:${address.addressHex} is not in the custody address registry`);
      }
      return reference;
    },
    resolveJettonWallet(address) {
      check(address, null, "decoder produced a malformed jetton wallet");
      const asset = resolvers.resolveJettonWallet(address.workchain, address.addressHex);
      if (typeof asset !== "string" || !/^[A-Z][A-Z0-9]{1,15}$/u.test(asset)) {
        fail(`jetton wallet ${address.workchain}:${address.addressHex} is not allowlisted`);
      }
      return asset;
    }
  };
}

// Reads the unsigned wallet-input body cell: subwallet(32) | valid_until(32)
// | seqno(32) | op(8) | mode(8) | ref→internal message. The signature slot
// is intentionally absent — the co-verifier decodes the pre-signature body
// exactly as the signer-boundary artifact defines it.
function readWalletBody(cell) {
  const slice = cellSlice(cell, "wallet body");
  const subwallet = slice.readBits(32, "subwallet_id");
  const validUntil = slice.readBits(32, "valid_until");
  const seqno = slice.readBits(32, "seqno");
  const op = slice.readBits(8, "wallet op");
  if (op !== 0n) fail("only the simple send op is custody-decodable");
  const mode = slice.readBits(8, "send mode");
  if (slice.remaining !== 0) fail("wallet body has trailing inline bits");
  if (cell.refs.length !== 1) fail("wallet body must reference exactly one internal message");
  return {
    subwallet,
    validUntil: Number(validUntil),
    seqno: Number(seqno),
    mode: Number(mode),
    messageCell: cell.refs[0]
  };
}

function readInternalMessage(cell) {
  const slice = cellSlice(cell, "internal message");
  // int_msg_info$0 ihr_disabled bounce bounced
  slice.expectBits("0", "internal message tag");
  const ihrDisabled = slice.readBits(1, "ihr_disabled");
  const bounceable = slice.readBits(1, "bounce");
  slice.expectBits("0", "bounced");
  const source = readAddress(slice, "source");
  const destination = readAddress(slice, "destination");
  const value = readGrams(slice, "value");
  readGrams(slice, "ihr_fee");
  readGrams(slice, "fwd_fee");
  slice.readBits(64, "created_lt");
  slice.readBits(32, "created_at");
  slice.expectBits("0", "state init"); // maybe(Either): nothing
  const bodyKind = slice.readBits(1, "body either");
  let bodyRefIndex = null;
  if (bodyKind === 0n) {
    if (cell.refs.length !== 0) fail("inline-body messages cannot carry cell references");
  } else {
    if (cell.refs.length !== 1) fail("referenced body requires exactly one cell reference");
    bodyRefIndex = cell.refs[0];
  }
  return {
    ihrDisabled: Number(ihrDisabled),
    bounceable: Number(bounceable),
    source,
    destination,
    value,
    bodyInline: bodyKind === 0n,
    bodyRefIndex,
    inlineRemaining: slice.remaining,
    cellRefs: cell.refs.length
  };
}

function readJettonBody(cell) {
  const slice = cellSlice(cell, "jetton body");
  const opcode = slice.readBits(32, "jetton opcode");
  if (opcode !== JETTON_TRANSFER_OPCODE) {
    fail(`unsupported jetton body opcode 0x${opcode.toString(16)}`);
  }
  slice.readBits(64, "query_id");
  const amount = readGrams(slice, "jetton amount");
  const destination = readAddress(slice, "jetton destination");
  readAddress(slice, "response address");
  slice.expectBits("0", "custom payload"); // maybe: none
  readGrams(slice, "forward amount");
  const forwardPayloadInline = slice.readBits(1, "forward payload either");
  if (forwardPayloadInline !== 0n || cell.refs.length !== 0) {
    fail("forward payloads are not custody-decodable");
  }
  if (slice.remaining !== 0) fail("jetton body has trailing bits");
  return { amount, destination };
}

function assertCanonicalShape(tx) {
  for (const key of ["chain", "network", "asset", "amount", "destination_reference", "expiry", "sequence"]) {
    if (!Object.hasOwn(tx, key)) fail(`decoded transaction is missing ${key}`);
  }
  if (!tx.network.endsWith("_TESTNET")) fail("decoded transaction is not a testnet transaction");
  if (!DECIMAL_PATTERN.test(tx.amount)) fail("decoded amount must be a canonical decimal string");
  if (!REFERENCE_PATTERN.test(tx.destination_reference)) {
    fail("decoded destination must be a reference, never a raw address");
  }
  if (!Number.isSafeInteger(tx.sequence) || tx.sequence < 0) fail("decoded sequence is invalid");
  if (!Number.isSafeInteger(tx.expiry) || tx.expiry < 0) fail("decoded expiry is invalid");
  return Object.freeze(tx);
}

// Decodes a serialized BoC carrying one unsigned wallet input message into
// the canonical co-verifier shape.
export function decodeTonRawTransaction(hexPayload, resolvers, { network = "TON_TESTNET" } = {}) {
  const safeResolvers = assertResolvers(resolvers);
  const boc = parseBoc(hexToBuffer(hexPayload));
  const root = cellSlice(boc.root, "external message");
  // ext_in_msg_info$10
  root.expectBits("10", "external message tag");
  const srcTag = root.readBits(2, "external source");
  if (srcTag !== 0n) fail("external message source must be addr_none");
  const wallet = readAddress(root, "wallet destination");
  readGrams(root, "import_fee");
  root.expectBits("0", "state init"); // maybe(Either): nothing
  root.expectBits("1", "body either"); // body is a referenced cell
  if (boc.root.refs.length !== 1) fail("external message must reference exactly one body cell");
  if (root.remaining !== 0) fail("external message has trailing inline bits");
  if (wallet === null) fail("external message must name the custody wallet");

  const body = readWalletBody(boc.cells[boc.root.refs[0]]);
  const internal = readInternalMessage(boc.cells[body.messageCell]);
  if (internal.destination === null) fail("internal message must carry a destination");
  if (internal.bodyInline && internal.inlineRemaining !== 0) {
    fail("internal message carries unexpected payload");
  }

  let asset;
  let amount;
  let destinationReference;
  if (internal.bodyRefIndex === null) {
    // Plain TON transfer: the internal value is the outflow.
    asset = "TON";
    amount = minorUnitsToDecimal(internal.value, TON_DECIMALS, "transfer value");
    destinationReference = safeResolvers.resolveDestination(internal.destination);
  } else {
    // Jetton wallet call: amount lives in the referenced TEP-74 body and the
    // outer destination is the sender's jetton wallet, not the recipient.
    const jetton = readJettonBody(boc.cells[internal.bodyRefIndex]);
    if (jetton.destination === null) fail("jetton transfer must carry a destination");
    asset = safeResolvers.resolveJettonWallet(internal.destination);
    amount = minorUnitsToDecimal(jetton.amount, JETTON_DECIMALS, "jetton amount");
    destinationReference = safeResolvers.resolveDestination(jetton.destination);
  }

  return assertCanonicalShape({
    chain: "TON",
    network,
    asset,
    amount,
    destination_reference: destinationReference,
    expiry: body.validUntil,
    sequence: body.seqno
  });
}
