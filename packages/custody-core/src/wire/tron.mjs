// Independent real-format TRON transaction decoder for the co-verifier role.
// Unlike the synthetic JSON wire in ../tx-decoders.mjs, this parses the actual
// protobuf encoding a TRON node broadcasts (protocol/core/Tron.proto):
//
//   Transaction { raw_data: bytes (field 1), ... }
//   Transaction.Raw { contract: repeated Contract (field 11),
//                     timestamp: field 14, expiration: field 8, ... }
//   Transaction.Contract { type: enum (field 1), parameter: Any (field 2) }
//   TransferContract        { owner_address 1, to_address 2, amount 3 }
//   TriggerSmartContract    { owner_address 1, contract_address 2,
//                             call_value 3, data 4 }
//
// Only asset-moving contracts decode: native TRX transfers (type 1) and
// TRC-20 `transfer(address,uint256)` calls (type 31 with ABI selector
// 0xa9059cbb). Raw 21-byte TRON addresses stay inside the wire — the caller
// supplies resolvers that map them to custody references and known contract
// addresses to assets, so an unregistered contract or an unmapped address
// fails closed instead of leaking a raw address into the canonical shape.

import { fieldValues, readProtobufMessage, singleField } from "./protobuf.mjs";

const HEX_PATTERN = /^[0-9a-f]+$/u;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;
const REFERENCE_PATTERN = /^[a-z][a-z0-9_]{2,127}$/u;
const TRON_ADDRESS_PATTERN = /^41[0-9a-f]{40}$/u;
const TRC20_TRANSFER_SELECTOR = Buffer.from("a9059cbb", "hex");
const CONTRACT_TYPE_TRANSFER = 1;
const CONTRACT_TYPE_TRIGGER_SMART = 31;
const TRC20_DECIMALS = 6;
const TRX_DECIMALS = 6;
const MAX_UINT256_BYTES = 32;

function fail(message) {
  throw new Error(message);
}

function hexToBuffer(hexPayload, label) {
  if (
    typeof hexPayload !== "string" ||
    hexPayload.length === 0 ||
    hexPayload.length % 2 !== 0 ||
    !HEX_PATTERN.test(hexPayload)
  ) {
    fail(`${label} must be non-empty lowercase hex`);
  }
  return Buffer.from(hexPayload, "hex");
}

function requireBytes(message, fieldNumber, label) {
  const value = singleField(message, fieldNumber, label, 2);
  if (!Buffer.isBuffer(value)) fail(`${label} must be bytes`);
  return value;
}

function requireVarint(message, fieldNumber, label) {
  const value = singleField(message, fieldNumber, label, 0);
  if (typeof value !== "bigint") fail(`${label} must be a varint`);
  return value;
}

function optionalVarint(message, fieldNumber, label) {
  const entries = fieldValues(message, fieldNumber);
  if (entries.length === 0) return 0n;
  if (entries.length !== 1 || entries[0].wire !== 0 || typeof entries[0].value !== "bigint") {
    fail(`${label} must be a single varint`);
  }
  return entries[0].value;
}

function requireTronAddress(buffer, label) {
  if (!Buffer.isBuffer(buffer) || buffer.length !== 21 || buffer[0] !== 0x41) {
    fail(`${label} must be a 21-byte TRON address (0x41 prefix)`);
  }
  return buffer.toString("hex");
}

function minorUnitsToDecimal(minor, decimals, label) {
  if (minor < 0n) fail(`${label} must be non-negative`);
  const digits = minor.toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals).replace(/^0+(?=\d)/u, "");
  const fraction = digits.slice(digits.length - decimals);
  const result = `${whole}.${fraction}`;
  if (!DECIMAL_PATTERN.test(result) || BigInt(result.replace(".", "")) <= 0n) {
    fail(`${label} must be positive`);
  }
  return result;
}

function decodeAbiTransfer(data) {
  if (!Buffer.isBuffer(data) || data.length !== 68) {
    fail("trc20 calldata must be exactly 68 bytes");
  }
  if (!data.subarray(0, 4).equals(TRC20_TRANSFER_SELECTOR)) {
    fail("trc20 calldata must carry the transfer(address,uint256) selector");
  }
  const addressWord = data.subarray(4, 36);
  if (!addressWord.subarray(0, 11).every((byte) => byte === 0) || addressWord[11] !== 0x41) {
    fail("trc20 destination must be a 0x41-prefixed TRON address");
  }
  const amountWord = data.subarray(36, 68);
  if (amountWord.length > MAX_UINT256_BYTES) fail("trc20 amount word is malformed");
  const amountMinor = amountWord.reduce((acc, byte) => (acc << 8n) | BigInt(byte), 0n);
  return { addressHex: addressWord.subarray(11, 32).toString("hex"), amountMinor };
}

function requireContractType(contract, expected, label) {
  const typeValue = singleField(contract, 1, "contract type", 0);
  if (typeof typeValue !== "bigint") fail(`${label} must be a varint`);
  if (typeValue !== BigInt(expected)) {
    fail(`contract type ${typeValue} does not match ${label} parameter`);
  }
}

function decodeTransferContract(parameter, resolvers) {
  const message = readProtobufMessage(parameter);
  requireTronAddress(requireBytes(message, 1, "transfer owner_address"), "transfer owner_address");
  const toAddress = requireTronAddress(requireBytes(message, 2, "transfer to_address"), "transfer to_address");
  const amountSun = requireVarint(message, 3, "transfer amount");
  if (amountSun > BigInt("9223372036854775807")) fail("transfer amount exceeds int64");
  return {
    asset: "TRX",
    amount: minorUnitsToDecimal(amountSun, TRX_DECIMALS, "transfer amount"),
    destination_reference: resolvers.resolveDestination(toAddress)
  };
}

function decodeTriggerSmartContract(parameter, resolvers) {
  const message = readProtobufMessage(parameter);
  requireTronAddress(requireBytes(message, 1, "trigger owner_address"), "trigger owner_address");
  const contractAddress = requireTronAddress(
    requireBytes(message, 2, "trigger contract_address"),
    "trigger contract_address"
  );
  const callValue = optionalVarint(message, 3, "trigger call_value");
  if (callValue !== 0n) fail("trc20 transfers must not carry native TRX call_value");
  const data = requireBytes(message, 4, "trigger data");
  const transfer = decodeAbiTransfer(data);
  const asset = resolvers.resolveContractAsset(contractAddress);
  return {
    asset,
    amount: minorUnitsToDecimal(transfer.amountMinor, TRC20_DECIMALS, "trc20 amount"),
    destination_reference: resolvers.resolveDestination(transfer.addressHex)
  };
}

function assertResolvers(resolvers) {
  if (typeof resolvers?.resolveDestination !== "function" || typeof resolvers?.resolveContractAsset !== "function") {
    fail("TRON decode requires resolveDestination and resolveContractAsset resolvers");
  }
  const wrapper = {
    resolveDestination(addressHex) {
      if (!TRON_ADDRESS_PATTERN.test(addressHex)) fail("decoder produced a malformed TRON address");
      const reference = resolvers.resolveDestination(addressHex);
      if (
        typeof reference !== "string" ||
        !REFERENCE_PATTERN.test(reference) ||
        !reference.startsWith("destination_ref_")
      ) {
        fail(`destination ${addressHex} is not in the custody address registry`);
      }
      return reference;
    },
    resolveContractAsset(addressHex) {
      if (!TRON_ADDRESS_PATTERN.test(addressHex)) fail("decoder produced a malformed contract address");
      const asset = resolvers.resolveContractAsset(addressHex);
      if (typeof asset !== "string" || !/^[A-Z][A-Z0-9]{1,15}$/u.test(asset)) {
        fail(`contract ${addressHex} is not a custody allowlisted asset`);
      }
      return asset;
    }
  };
  return wrapper;
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

// Decodes a serialized protocol.Transaction hex payload into the canonical
// co-verifier shape. `network` is asserted by the caller/registry — the wire
// itself carries no chain id, so custody pins it to the dev testnet and the
// resolvers gate destination and contract membership.
export function decodeTronRawTransaction(hexPayload, resolvers, { network = "TRON_TESTNET" } = {}) {
  const safeResolvers = assertResolvers(resolvers);
  const transaction = readProtobufMessage(hexToBuffer(hexPayload, "TRON wire"));
  const rawData = requireBytes(transaction, 1, "transaction raw_data");
  const raw = readProtobufMessage(rawData);

  const contractFields = fieldValues(raw, 11);
  if (contractFields.length !== 1 || !Buffer.isBuffer(contractFields[0].value)) {
    fail("transaction must carry exactly one contract");
  }
  const contract = readProtobufMessage(contractFields[0].value);
  const parameterBytes = requireBytes(contract, 2, "contract parameter");
  const anyMessage = readProtobufMessage(parameterBytes);
  const typeUrl = requireBytes(anyMessage, 1, "parameter type_url").toString("utf8");
  const parameter = requireBytes(anyMessage, 2, "parameter value");

  let body;
  if (typeUrl === "type.googleapis.com/protocol.TransferContract") {
    requireContractType(contract, CONTRACT_TYPE_TRANSFER, "TransferContract");
    body = decodeTransferContract(parameter, safeResolvers);
  } else if (typeUrl === "type.googleapis.com/protocol.TriggerSmartContract") {
    requireContractType(contract, CONTRACT_TYPE_TRIGGER_SMART, "TriggerSmartContract");
    body = decodeTriggerSmartContract(parameter, safeResolvers);
  } else {
    fail(`unsupported TRON parameter type_url ${typeUrl}`);
  }

  const expirationMs = requireVarint(raw, 8, "raw_data expiration");
  if (expirationMs > BigInt(Number.MAX_SAFE_INTEGER)) fail("raw_data expiration is not a safe integer");

  return assertCanonicalShape({
    ...body,
    chain: "TRON",
    network,
    // TRON has no per-account sequence on the wire; nonce enforcement stays
    // with the upstream intent replay guard.
    sequence: 0,
    expiry: Math.floor(Number(expirationMs) / 1000)
  });
}
