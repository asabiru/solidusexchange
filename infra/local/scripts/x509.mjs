// Minimal DER/X.509 builder for dev-only, loopback TLS material. It exists
// because the pinned base images ship no openssl CLI; nothing here is a
// production PKI.
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";

const OID = Object.freeze({
  commonName: "2.5.4.3",
  organizationName: "2.5.4.10",
  ecdsaWithSha256: "1.2.840.10045.4.3.2",
  basicConstraints: "2.5.29.19",
  keyUsage: "2.5.29.15",
  extKeyUsage: "2.5.29.37",
  subjectAltName: "2.5.29.17",
  subjectKeyIdentifier: "2.5.29.14",
  authorityKeyIdentifier: "2.5.29.35",
  serverAuth: "1.3.6.1.5.5.7.3.1"
});

function length(size) {
  if (size < 0x80) return Buffer.from([size]);
  const bytes = [];
  for (let rest = size; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag, ...parts) {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), length(body.length), body]);
}

const sequence = (...parts) => tlv(0x30, ...parts);
const set = (...parts) => tlv(0x31, ...parts);
const octetString = (value) => tlv(0x04, value);
const bitString = (value, unusedBits = 0) => tlv(0x03, Buffer.from([unusedBits]), value);
const utf8String = (value) => tlv(0x0c, Buffer.from(value, "utf8"));
const explicit = (number, value) => tlv(0xa0 + number, value);
const booleanTrue = () => tlv(0x01, Buffer.from([0xff]));

function objectIdentifier(dotted) {
  const [first, second, ...rest] = dotted.split(".").map(Number);
  const bytes = [40 * first + second];
  for (const value of rest) {
    const chunk = [value % 128];
    for (let remaining = Math.floor(value / 128); remaining > 0; remaining = Math.floor(remaining / 128)) {
      chunk.unshift((remaining % 128) | 0x80);
    }
    bytes.push(...chunk);
  }
  return tlv(0x06, Buffer.from(bytes));
}

function integer(value) {
  let bytes = Buffer.from(value);
  while (bytes.length > 1 && bytes[0] === 0 && bytes[1] < 0x80) bytes = bytes.subarray(1);
  if (bytes[0] >= 0x80) bytes = Buffer.concat([Buffer.from([0]), bytes]);
  return tlv(0x02, bytes);
}

function utcTime(date) {
  const text = date.toISOString().replace(/[-:T]/g, "").slice(2, 14);
  return tlv(0x17, Buffer.from(`${text}Z`, "ascii"));
}

function name(commonName) {
  return sequence(
    set(sequence(objectIdentifier(OID.organizationName), utf8String("SolidChange local dev (synthetic)"))),
    set(sequence(objectIdentifier(OID.commonName), utf8String(commonName)))
  );
}

function extension(oid, value, critical = false) {
  return critical
    ? sequence(objectIdentifier(oid), booleanTrue(), octetString(value))
    : sequence(objectIdentifier(oid), octetString(value));
}

function ipv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    throw new Error(`invalid IPv4 address: ${address}`);
  }
  return Buffer.from(parts);
}

function keyIdentifier(spki) {
  return createHash("sha1").update(spki).digest();
}

function serialNumber() {
  const serial = randomBytes(16);
  serial[0] = (serial[0] & 0x7f) | 0x01;
  return serial;
}

function certificate({ subject, issuer, subjectKey, issuerKey, issuerSpki, notBefore, notAfter, extensions }) {
  const spki = subjectKey.publicKey.export({ type: "spki", format: "der" });
  const algorithm = sequence(objectIdentifier(OID.ecdsaWithSha256));
  const tbs = sequence(
    explicit(0, integer(Buffer.from([2]))),
    integer(serialNumber()),
    algorithm,
    name(issuer),
    sequence(utcTime(notBefore), utcTime(notAfter)),
    name(subject),
    spki,
    explicit(3, sequence(
      extension(OID.subjectKeyIdentifier, octetString(keyIdentifier(spki))),
      extension(OID.authorityKeyIdentifier, sequence(tlv(0x80, keyIdentifier(issuerSpki ?? spki)))),
      ...extensions
    ))
  );
  const signature = sign("sha256", tbs, issuerKey.privateKey);
  const der = sequence(tbs, algorithm, bitString(signature));
  return { der, spki };
}

export function toPem(label, der) {
  const lines = der.toString("base64").match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

export function createDevTlsMaterial({ now = new Date(), validityDays = 30, ipAddresses = ["127.0.0.1"], dnsNames = ["localhost"] } = {}) {
  const notBefore = new Date(now.getTime() - 60 * 60 * 1000);
  const notAfter = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000);
  const caKey = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const serverKey = generateKeyPairSync("ec", { namedCurve: "P-256" });

  const ca = certificate({
    subject: "SolidChange local dev CA (synthetic)",
    issuer: "SolidChange local dev CA (synthetic)",
    subjectKey: caKey,
    issuerKey: caKey,
    notBefore,
    notAfter,
    extensions: [
      extension(OID.basicConstraints, sequence(booleanTrue(), integer(Buffer.from([0]))), true),
      extension(OID.keyUsage, bitString(Buffer.from([0x06]), 1), true)
    ]
  });

  const altNames = [
    ...ipAddresses.map((address) => tlv(0x87, ipv4(address))),
    ...dnsNames.map((dnsName) => tlv(0x82, Buffer.from(dnsName, "ascii")))
  ];
  const server = certificate({
    subject: "SolidChange local audit database (synthetic)",
    issuer: "SolidChange local dev CA (synthetic)",
    subjectKey: serverKey,
    issuerKey: caKey,
    issuerSpki: ca.spki,
    notBefore,
    notAfter,
    extensions: [
      extension(OID.basicConstraints, sequence(), true),
      extension(OID.keyUsage, bitString(Buffer.from([0x80]), 7), true),
      extension(OID.extKeyUsage, sequence(objectIdentifier(OID.serverAuth))),
      extension(OID.subjectAltName, sequence(...altNames))
    ]
  });

  return Object.freeze({
    caCertificatePem: toPem("CERTIFICATE", ca.der),
    serverCertificatePem: toPem("CERTIFICATE", server.der),
    serverPrivateKeyPem: serverKey.privateKey.export({ type: "pkcs8", format: "pem" }),
    notAfter
  });
}
