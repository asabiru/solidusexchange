// Minimal Bag-of-Cells (BoC) deserializer for the TON co-verifier decoder.
// Implements the canonical subset a signed wallet input message uses:
// magic b5ee9c42, optional index, no CRC-32C verification inside the boundary
// (integrity is the wire_digest's job upstream), ordinary cells only, up to
// 4 references per cell. Exotic cells, pruned branches, merkle proofs and
// library cells are rejected outright — a custody wire never needs them.

const HEX_PATTERN = /^[0-9a-f]+$/u;
const BOC_MAGIC = 0xb5ee9c42;
const MAX_CELLS = 256;
const MAX_CELL_BITS = 1023;
const MAX_REF_DEPTH = 8;
const MAX_TOTAL_DATA = 65536;

function fail(message) {
  throw new Error(message);
}

function readUint(buffer, offset, bytes, label) {
  if (offset + bytes > buffer.length) fail(`${label} overruns the BoC`);
  let value = 0;
  for (let i = 0; i < bytes; i += 1) value = value * 256 + buffer[offset + i];
  return { value, next: offset + bytes };
}

// Bit-level cursor over a cell payload.
export function sliceReader(data, bitsLength) {
  let cursor = 0;
  const readBit = () => {
    if (cursor >= bitsLength) fail("cell payload exhausted");
    const bit = (data[cursor >> 3] >> (7 - (cursor & 7))) & 1;
    cursor += 1;
    return bit;
  };
  return {
    get remaining() {
      return bitsLength - cursor;
    },
    readBits(count, label) {
      if (count < 0 || count > 256) fail(`${label} bit count is out of range`);
      let value = 0n;
      for (let i = 0; i < count; i += 1) value = (value << 1n) | BigInt(readBit());
      return value;
    },
    readBytes(count, label) {
      const value = this.readBits(count * 8, label);
      const hex = value.toString(16).padStart(count * 2, "0");
      return Buffer.from(hex, "hex");
    },
    expectBits(expected, label) {
      const actual = this.readBits(expected.length, label);
      if (actual !== BigInt(`0b${expected}`)) fail(`${label} must be 0b${expected}`);
    }
  };
}

function parseCellData(buffer, offset, cells, refsDescriptorSize, cellsMeta) {
  let cursor = offset;
  for (let index = 0; index < cells; index += 1) {
    if (cursor + 2 > buffer.length) fail("cell descriptors overrun the BoC");
    const d1 = buffer[cursor];
    const d2 = buffer[cursor + 1];
    cursor += 2;
    const level = d1 >> 5;
    const exotic = (d1 >> 3) & 1;
    const refsCount = d1 & 7;
    if (exotic !== 0 || level !== 0) fail(`cell ${index} is exotic — not allowed in custody wires`);
    if (refsCount > 4) fail(`cell ${index} has too many references`);

    const fullBytes = Math.floor(d2 / 2);
    const hasPartial = d2 % 2 === 1;
    const dataBytes = fullBytes + (hasPartial ? 1 : 0);
    if (cursor + dataBytes > buffer.length) fail(`cell ${index} data overruns the BoC`);
    const data = buffer.subarray(cursor, cursor + dataBytes);
    cursor += dataBytes;

    let bitsLength = fullBytes * 8;
    if (hasPartial) {
      const last = data[data.length - 1];
      if (last === 0) fail(`cell ${index} has an empty padding byte`);
      // The rightmost set bit is the padding terminator; everything before
      // it in this byte is data.
      const tz = Math.floor(Math.log2(last & -last));
      bitsLength += 8 - tz - 1;
    }
    if (bitsLength > MAX_CELL_BITS) fail(`cell ${index} exceeds the bit bound`);

    const refs = [];
    for (let r = 0; r < refsCount; r += 1) {
      const refIndex = readUint(buffer, cursor, refsDescriptorSize, `cell ${index} ref`);
      cursor = refIndex.next;
      if (refIndex.value >= cells) fail(`cell ${index} references a missing cell`);
      refs.push(refIndex.value);
    }
    cellsMeta.push({ data, bitsLength, refs });
  }
  return cursor;
}

// Parses a BoC and returns the cells in serialization order. Each cell is
// { data: Buffer, bitsLength: number, refs: number[] } — refs index into the
// returned array, preserving the BoC's parent-before-child ordering.
export function parseBoc(buffer) {
  if (!Buffer.isBuffer(buffer)) fail("BoC input must be a Buffer");
  if (buffer.length < 4) fail("BoC is truncated");
  const magic = readUint(buffer, 0, 4, "BoC magic");
  if (magic.value !== BOC_MAGIC) fail("unsupported BoC magic — only the canonical header is accepted");
  let cursor = magic.next;
  if (cursor >= buffer.length) fail("BoC flags byte is missing");
  const flagsByte = buffer[cursor];
  cursor += 1;
  const hasIndex = (flagsByte & 0x80) !== 0;
  const hasCrc32 = (flagsByte & 0x40) !== 0;
  const hasCacheBits = (flagsByte & 0x20) !== 0;
  const flags = (flagsByte >> 3) & 3;
  const sizeBytes = flagsByte & 7;
  if (hasCrc32) fail("BoC CRC-32C is not accepted inside the trust boundary — wires carry the upstream digest instead");
  if (hasCacheBits) fail("BoC cache bits are not supported");
  if (flags !== 0) fail("BoC flags field must be zero");
  if (sizeBytes === 0 || sizeBytes > 4) fail("BoC size_bytes is out of range");

  const offsetSize = readUint(buffer, cursor, 1, "offset_bytes");
  cursor = offsetSize.next;
  const offsetBytes = offsetSize.value;
  if (offsetBytes === 0 || offsetBytes > 8) fail("BoC offset_bytes is out of range");

  const cellsCount = readUint(buffer, cursor, sizeBytes, "cells count");
  cursor = cellsCount.next;
  if (cellsCount.value === 0 || cellsCount.value > MAX_CELLS) fail("BoC cell count is out of range");
  const rootsCount = readUint(buffer, cursor, sizeBytes, "roots count");
  cursor = rootsCount.next;
  if (rootsCount.value !== 1) fail("custody wires must carry exactly one BoC root");
  const absentCount = readUint(buffer, cursor, sizeBytes, "absent count");
  cursor = absentCount.next;
  if (absentCount.value !== 0) fail("BoC absent cells are not supported");
  const totalSize = readUint(buffer, cursor, offsetBytes, "tot_cells_size");
  cursor = totalSize.next;
  if (totalSize.value > MAX_TOTAL_DATA) fail("BoC data size exceeds the bound");
  const rootIndex = readUint(buffer, cursor, sizeBytes, "root index");
  cursor = rootIndex.next;
  if (rootIndex.value >= cellsCount.value) fail("BoC root index is out of range");
  if (rootIndex.value !== 0) fail("custody wires must serialize the root cell first");

  if (hasIndex) {
    cursor += cellsCount.value * offsetBytes;
    if (cursor > buffer.length) fail("BoC index overruns the buffer");
  }
  const cells = [];
  cursor = parseCellData(buffer, cursor, cellsCount.value, sizeBytes, cells);
  if (cursor !== buffer.length) fail("BoC has trailing bytes");

  assertDepth(cells, 0, 0);
  return Object.freeze({
    cells,
    root: cells[0]
  });
}

function assertDepth(cells, index, depth) {
  if (depth > MAX_REF_DEPTH) fail("cell reference depth exceeds the bound");
  const cell = cells[index];
  const seen = new Set();
  for (const ref of cell.refs) {
    if (ref <= index) fail("BoC references must point forward — circular links are malformed");
    if (seen.has(ref)) fail("BoC duplicate references are malformed");
    seen.add(ref);
    assertDepth(cells, ref, depth + 1);
  }
}
