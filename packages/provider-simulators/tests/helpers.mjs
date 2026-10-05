import { createHash, createHmac, sign } from "node:crypto";
import {
  createNonceStore,
  createSimulatedClock,
  createVerificationKeyring,
  generateSimulatorKey,
  SIGNATURE_SCHEME,
  verificationKeyOf,
} from "../src/index.mjs";

/** Keys are generated fresh for every test run and never derived from seeds. */
export function freshKey(algorithm = "ed25519", keyId = "sim-key-1") {
  return generateSimulatorKey({ keyId, algorithm });
}

export function keyringOf(...keys) {
  return createVerificationKeyring(keys.map(verificationKeyOf));
}

/**
 * Independent re-implementation of the documented signing input, used to
 * sign hand-crafted bodies so verifier checks after the signature can be hit.
 */
export function signRaw({ key, domain, body, timestamp, nonce = `${"0".repeat(31)}1` }) {
  const bytes = typeof body === "string" ? Buffer.from(body, "utf8") : Buffer.from(body);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const input = Buffer.from(
    [SIGNATURE_SCHEME, domain, key.keyId, String(timestamp), nonce, digest].join("\n"),
    "utf8",
  );
  const signature =
    key.algorithm === "ed25519"
      ? sign(null, input, key.signingKey)
      : createHmac("sha256", key.signingKey).update(input).digest();
  return {
    headers: {
      "x-sim-key-id": key.keyId,
      "x-sim-timestamp": String(timestamp),
      "x-sim-nonce": nonce,
      "x-sim-signature": `v1=${signature.toString("base64url")}`,
    },
    body: bytes,
  };
}

let nonceCounter = 0;
export function nextNonce() {
  nonceCounter += 1;
  return nonceCounter.toString(16).padStart(32, "a");
}

/**
 * Drives one simulator subject end to end: request, advance the simulated
 * clock, verify every delivery and feed it to the consumer inbox.
 */
export async function runFlow({ createSimulator, createVerifier, createInbox, request, scenario, subjectOf, deadlineOf, seed = "seed-1", advance = 7200, key = freshKey() }) {
  const clock = createSimulatedClock();
  const simulator = createSimulator({ seed, key, clock, defaultScenario: scenario });
  const verify = createVerifier({ keyring: keyringOf(key), nonceStore: createNonceStore() });
  const inbox = createInbox();
  const response = await simulator[request.method](request.body);
  const subject = subjectOf(response);
  inbox.openSubject(subject, { deadline: deadlineOf(response) });
  clock.advance(advance);
  const deliveries = simulator.drainCallbacks();
  const steps = [];
  for (const delivery of deliveries) {
    const verified = verify({ headers: delivery.headers, body: delivery.body, now: delivery.deliverAt });
    if (!verified.ok) {
      steps.push({ verified: false, reason: verified.reason });
      continue;
    }
    const result = inbox.accept(verified.payload, { receivedAt: delivery.deliverAt });
    steps.push({ verified: true, status: verified.payload.status, action: result.action, payload: verified.payload });
  }
  const expired = inbox.expire(clock.now());
  return { simulator, response, subject, deliveries, steps, inbox, expired, clock, state: inbox.get(subject) };
}

export const epochOf = (iso) => Date.parse(iso) / 1000;
