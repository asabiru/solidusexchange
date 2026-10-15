// Co-verifier seam: the assurance layer's second, independent decode of the
// wire. The policy module (`hsm-policy.mjs`) decodes the dev stack's
// canonical-JSON wires through `tx-decoders.mjs`; this module decodes the
// real wire format — TRON protobuf or TON BoC — through `src/wire/` and
// compares every canonical field against what the policy/intent claims.
// Any disagreement, unregistered address, or malformed wire fails closed
// with a `coverifier_*` reason; nothing here mutates policy state, signs or
// broadcasts. Evidence is a digest of the compared fields so the audit
// trail can pin which canonical values the second implementation saw.

import { createHash } from "node:crypto";

import { decodeTonRawTransaction } from "./wire/ton.mjs";
import { decodeTronRawTransaction } from "./wire/tron.mjs";

const REFERENCE_PATTERN = /^[a-z][a-z0-9_]{2,127}$/u;
const CANONICAL_KEYS = [
  "chain",
  "network",
  "asset",
  "amount",
  "destination_reference",
  "expiry",
  "sequence"
];

function fail(message) {
  throw new Error(message);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

export function decodeRealWireForNetwork(network, hexPayload, resolvers) {
  if (network === "TON_TESTNET") return decodeTonRawTransaction(hexPayload, resolvers);
  if (network === "TRON_TESTNET") return decodeTronRawTransaction(hexPayload, resolvers);
  fail(`coverifier_unsupported_network:${network}`);
}

function assertCanonicalShape(canonical) {
  for (const key of CANONICAL_KEYS) {
    if (!Object.hasOwn(canonical, key)) fail(`coverifier_canonical_missing:${key}`);
  }
  if (typeof canonical.amount !== "string" || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(canonical.amount)) {
    fail("coverifier_canonical_amount_invalid");
  }
  if (
    typeof canonical.destination_reference !== "string" ||
    !REFERENCE_PATTERN.test(canonical.destination_reference)
  ) {
    fail("coverifier_canonical_destination_invalid");
  }
  if (!Number.isSafeInteger(canonical.sequence) || canonical.sequence < 0) {
    fail("coverifier_canonical_sequence_invalid");
  }
  if (!Number.isSafeInteger(canonical.expiry) || canonical.expiry < 0) {
    fail("coverifier_canonical_expiry_invalid");
  }
  return canonical;
}

// Decodes the real wire and field-compares it against the canonical shape
// the policy module trusted. Returns a frozen evidence object or throws —
// a caller that cannot afford the throw should catch and record the reason.
export function verifyWireAgainstCanonical({ network, rawPayload, canonical, resolvers }) {
  const expected = assertCanonicalShape(canonical);
  let decoded;
  try {
    decoded = decodeRealWireForNetwork(network, rawPayload, resolvers);
  } catch (error) {
    fail(`coverifier_decode_failed:${error.message}`);
  }
  for (const key of CANONICAL_KEYS) {
    if (decoded[key] !== expected[key]) {
      fail(`coverifier_mismatch:${key}`);
    }
  }
  const evidenceDigest = createHash("sha256")
    .update(JSON.stringify(canonicalize({ network, canonical: expected, wire: decoded })))
    .digest("hex");
  return Object.freeze({
    co_verifier: "real-wire",
    consistent: true,
    network,
    evidence_digest: evidenceDigest
  });
}
