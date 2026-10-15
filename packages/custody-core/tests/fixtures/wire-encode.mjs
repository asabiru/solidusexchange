// Test-side wire encoders — the second implementation used for cross-checking
// the real-format decoders. Building fixtures through an independent encoder
// means encode → decode must round-trip, and encoder-side mistakes fail
// loudly instead of masquerading as decoder truth. Shared by
// real-wire-decoders.test.mjs and co-verifier.test.mjs.

// ---------------------------------------------------------------------------
// Minimal protobuf encoder (inverse of src/wire/protobuf.mjs)
// ---------------------------------------------------------------------------

export function varint(value) {
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

export function key(field, wire) {
  return varint(BigInt(field) << 3n | BigInt(wire));
}

export function bytesField(field, bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return Buffer.concat([key(field, 2), varint(b.length), b]);
}

export function varintField(field, value) {
  return Buffer.concat([key(field, 0), varint(value)]);
}

// --- TRON fixtures -----------------------------------------------------------

export const TRON_DESTINATION_HEX = `41${"aabbccddeeff00112233aabbccddeeff00112233"}`;
export const TRON_OWNER_HEX = `41${"1122334455667788990011223344556677889900"}`;
export const TRON_USDT_CONTRACT_HEX = `41${"0f".repeat(20)}`;
export const TRON_OTHER_CONTRACT_HEX = `41${"0e".repeat(20)}`;

export const tronResolvers = {
  resolveDestination(addressHex) {
    return addressHex === TRON_DESTINATION_HEX ? "destination_ref_tron_wallet" : null;
  },
  resolveContractAsset(addressHex) {
    return addressHex === TRON_USDT_CONTRACT_HEX ? "USDT" : null;
  }
};

export const TRON_EXPIRATION_MS = 1_760_600_000_000;
export const TRON_EXPIRY_SECONDS = Math.floor(TRON_EXPIRATION_MS / 1000);

export function tronAddressWord(hex) {
  const raw = Buffer.from(hex, "hex"); // 21 bytes, 0x41 prefixed
  return Buffer.concat([Buffer.alloc(11, 0), raw]);
}

export function abiTransfer(hexAddress, amountMinor) {
  const selector = Buffer.from("a9059cbb", "hex");
  const amount = Buffer.alloc(32);
  let v = BigInt(amountMinor);
  for (let i = 31; i >= 0; i -= 1) {
    amount[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return Buffer.concat([selector, tronAddressWord(hexAddress), amount]);
}

export function anyField(typeUrl, value) {
  const any = Buffer.concat([bytesField(1, Buffer.from(typeUrl, "utf8")), bytesField(2, value)]);
  return bytesField(2, any);
}

export function contract(type, typeUrl, value) {
  const c = Buffer.concat([varintField(1, type), anyField(typeUrl, value)]);
  return bytesField(11, c);
}

export function tronRaw({ contracts, expiration = TRON_EXPIRATION_MS }) {
  const parts = [
    bytesField(1, Buffer.from("dead", "hex")),
    bytesField(3, Buffer.from("beefbeefbeefbeef", "hex")),
    varintField(8, expiration),
    varintField(14, TRON_EXPIRATION_MS - 30_000),
    ...contracts
  ];
  return bytesField(1, Buffer.concat(parts));
}

export function trc20Fixture({ data, contractAddress = TRON_USDT_CONTRACT_HEX, owner = TRON_OWNER_HEX } = {}) {
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

export function trxFixture({ to = TRON_DESTINATION_HEX, amountSun = 42_000_000n, owner = TRON_OWNER_HEX } = {}) {
  const transfer = Buffer.concat([
    bytesField(1, Buffer.from(owner, "hex")),
    bytesField(2, Buffer.from(to, "hex")),
    varintField(3, amountSun)
  ]);
  return tronRaw({
    contracts: [contract(1, "type.googleapis.com/protocol.TransferContract", transfer)]
  }).toString("hex");
}

// ---------------------------------------------------------------------------
// TON fixtures: BitWriter + BoC serializer (inverse of src/wire/boc.mjs)
// ---------------------------------------------------------------------------

export class BitWriter {
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

export function buildBoc(cells) {
  // cells: [{writer: BitWriter, refs: [indices]}] — root first.
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

export const TON_WALLET = { workchain: 0, addressHex: "aa".repeat(32) };
export const TON_DEST = { workchain: 0, addressHex: "bb".repeat(32) };
export const TON_JETTON_WALLET = { workchain: 0, addressHex: "cc".repeat(32) };

export const tonResolvers = {
  resolveDestination(workchain, addressHex) {
    return workchain === 0 && addressHex === TON_DEST.addressHex ? "destination_ref_ton_wallet" : null;
  },
  resolveJettonWallet(workchain, addressHex) {
    return workchain === 0 && addressHex === TON_JETTON_WALLET.addressHex ? "USDT" : null;
  }
};

export function internalMessageCell({ dest, valueNano = 0n, bounce = 1, jettonBody = null }) {
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

export function walletBodyCell({ seqno = 42, validUntil = 1_800_000_000 } = {}) {
  const writer = new BitWriter();
  writer.push(0x2a7bd9d9n, 32); // subwallet_id
  writer.push(BigInt(validUntil), 32);
  writer.push(BigInt(seqno), 32);
  writer.push(0n, 8); // op: simple send
  writer.push(3n, 8); // mode: pay-gas + ignore-errors
  return { writer, refs: [] }; // refs filled by caller order
}

export function externalMessageCell(destWallet = TON_WALLET) {
  const writer = new BitWriter();
  writer.push(2n, 2); // ext_in_msg_info$10
  writer.push(0n, 2); // src addr_none
  writer.pushAddress(destWallet);
  writer.pushGrams(0n); // import_fee
  writer.push(0n, 1); // state init none
  writer.push(1n, 1); // body by ref
  return { writer, refs: [1] };
}

export function jettonBodyCell({ dest = TON_DEST, amount = 25_000_000n, opcode = 0xf8a7ea5n } = {}) {
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

export function tonNativeWire(opts = {}) {
  const internal = internalMessageCell({ dest: TON_DEST, valueNano: 1_500_000_000n, ...opts.internal });
  const cells = [externalMessageCell(), walletBodyCell(opts.wallet), internal];
  cells[1].refs = [2];
  return buildBoc(cells);
}

export function tonJettonWire({ amount = 25_000_000n, dest = TON_DEST, walletDest = TON_JETTON_WALLET } = {}) {
  const internal = internalMessageCell({ dest: walletDest, valueNano: 50_000_000n, jettonBody: true });
  const jetton = jettonBodyCell({ dest, amount });
  const cells = [externalMessageCell(), walletBodyCell(), internal, jetton];
  cells[1].refs = [2];
  return buildBoc(cells);
}
