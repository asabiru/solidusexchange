// Minimal protobuf wire-format reader for the co-verifier decoders. Only the
// shapes TRON raw transactions need: varint fields, 64/32-bit fixed fields
// and length-delimited fields. Unknown fields are skipped by wire type; the
// reader never allocates more than the input it was given.

const MAX_VARINT_BYTES = 10;
const MAX_FIELDS = 4096;

function fail(message) {
  throw new Error(message);
}

function readVarint(buffer, offset) {
  let result = 0n;
  let shift = 0n;
  let cursor = offset;
  while (true) {
    if (cursor >= buffer.length) fail("protobuf varint overruns the buffer");
    if (cursor - offset >= MAX_VARINT_BYTES) fail("protobuf varint exceeds 10 bytes");
    const byte = buffer[cursor];
    result |= BigInt(byte & 0x7f) << shift;
    cursor += 1;
    if ((byte & 0x80) === 0) break;
    shift += 7n;
  }
  return { value: result, next: cursor };
}

// Reads a protobuf message into { fieldNumber: [{wire, value}] } where value
// is a bigint for varints and a Buffer for length-delimited fields. Fixed32
// and fixed64 are kept as numbers/bigints without interpretation.
export function readProtobufMessage(buffer) {
  if (!Buffer.isBuffer(buffer)) fail("protobuf input must be a Buffer");
  const fields = new Map();
  let offset = 0;
  let count = 0;
  while (offset < buffer.length) {
    count += 1;
    if (count > MAX_FIELDS) fail("protobuf field count exceeds the bound");
    const key = readVarint(buffer, offset);
    offset = key.next;
    const fieldNumber = Number(key.value >> 3n);
    const wire = Number(key.value & 0x7n);
    if (fieldNumber === 0 || wire === 3 || wire === 4) {
      fail(`protobuf field ${fieldNumber} has an invalid wire type ${wire}`);
    }
    let value;
    if (wire === 0) {
      const varint = readVarint(buffer, offset);
      value = varint.value;
      offset = varint.next;
    } else if (wire === 1) {
      if (offset + 8 > buffer.length) fail("fixed64 overruns the buffer");
      value = buffer.readBigUInt64LE(offset);
      offset += 8;
    } else if (wire === 5) {
      if (offset + 4 > buffer.length) fail("fixed32 overruns the buffer");
      value = buffer.readUInt32LE(offset);
      offset += 4;
    } else if (wire === 2) {
      const length = readVarint(buffer, offset);
      offset = length.next;
      const end = offset + Number(length.value);
      if (end > buffer.length) fail("length-delimited field overruns the buffer");
      value = buffer.subarray(offset, end);
      offset = end;
    } else {
      fail(`unsupported protobuf wire type ${wire}`);
    }
    if (!fields.has(fieldNumber)) fields.set(fieldNumber, []);
    fields.get(fieldNumber).push({ wire, value });
  }
  return fields;
}

export function fieldValues(message, fieldNumber) {
  return message.get(fieldNumber) ?? [];
}

export function singleField(message, fieldNumber, label, wireType) {
  const entries = fieldValues(message, fieldNumber);
  if (entries.length !== 1) fail(`${label} must appear exactly once`);
  const entry = entries[0];
  if (wireType !== undefined && entry.wire !== wireType) {
    fail(`${label} must use wire type ${wireType}`);
  }
  return entry.value;
}
