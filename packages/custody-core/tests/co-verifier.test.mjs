import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { verifyWireAgainstCanonical } from "../src/co-verifier.mjs";

import {
  abiTransfer,
  tonJettonWire,
  tonNativeWire,
  tonResolvers,
  trc20Fixture,
  TRON_DESTINATION_HEX,
  TRON_EXPIRY_SECONDS,
  tronResolvers,
  trxFixture
} from "./fixtures/wire-encode.mjs";

// The co-verifier seam decodes the real wire format independently of the
// canonical path the policy module uses. These tests pin agreement and every
// fail-closed divergence.

const tronCanonical = {
  chain: "TRON",
  network: "TRON_TESTNET",
  asset: "USDT",
  amount: "12.345678",
  destination_reference: "destination_ref_tron_wallet",
  expiry: TRON_EXPIRY_SECONDS,
  sequence: 0
};

const trc20Wire = trc20Fixture({ data: abiTransfer(TRON_DESTINATION_HEX, 12_345_678n) });

test("TRC-20 wire agrees with the canonical shape end to end", () => {
  const result = verifyWireAgainstCanonical({
    network: "TRON_TESTNET",
    rawPayload: trc20Wire,
    canonical: tronCanonical,
    resolvers: tronResolvers
  });
  assert.equal(result.consistent, true);
  assert.equal(result.co_verifier, "real-wire");
  assert.ok(Object.isFrozen(result));
  // The evidence digest pins exactly what the co-verifier compared.
  const again = verifyWireAgainstCanonical({
    network: "TRON_TESTNET",
    rawPayload: trc20Wire,
    canonical: tronCanonical,
    resolvers: tronResolvers
  });
  assert.equal(result.evidence_digest, again.evidence_digest);
});

test("TRX and TON wires agree with their canonical shapes", () => {
  const trx = verifyWireAgainstCanonical({
    network: "TRON_TESTNET",
    rawPayload: trxFixture({ amountSun: 42_000_000n }),
    canonical: { ...tronCanonical, asset: "TRX", amount: "42.000000" },
    resolvers: tronResolvers
  });
  assert.equal(trx.consistent, true);

  const ton = verifyWireAgainstCanonical({
    network: "TON_TESTNET",
    rawPayload: tonNativeWire(),
    canonical: {
      chain: "TON",
      network: "TON_TESTNET",
      asset: "TON",
      amount: "1.500000000",
      destination_reference: "destination_ref_ton_wallet",
      expiry: 1_800_000_000,
      sequence: 42
    },
    resolvers: tonResolvers
  });
  assert.equal(ton.consistent, true);

  const tonJetton = verifyWireAgainstCanonical({
    network: "TON_TESTNET",
    rawPayload: tonJettonWire(),
    canonical: {
      chain: "TON",
      network: "TON_TESTNET",
      asset: "USDT",
      amount: "25.000000",
      destination_reference: "destination_ref_ton_wallet",
      expiry: 1_800_000_000,
      sequence: 42
    },
    resolvers: tonResolvers
  });
  assert.equal(tonJetton.consistent, true);
});

test("every canonical-field divergence fails closed", () => {
  for (const [key, wrong] of [
    ["asset", "TRX"],
    ["amount", "12.345679"],
    ["destination_reference", "destination_ref_other_wallet"],
    ["expiry", TRON_EXPIRY_SECONDS - 1],
    ["sequence", 1]
  ]) {
    assert.throws(
      () =>
        verifyWireAgainstCanonical({
          network: "TRON_TESTNET",
          rawPayload: trc20Wire,
          canonical: { ...tronCanonical, [key]: wrong },
          resolvers: tronResolvers
        }),
      new RegExp(`coverifier_mismatch:${key}`)
    );
  }
  // A wire that claims another network entirely must not be silently
  // re-interpreted.
  assert.throws(
    () =>
      verifyWireAgainstCanonical({
        network: "TON_TESTNET",
        rawPayload: trc20Wire,
        canonical: { ...tronCanonical, chain: "TON", network: "TON_TESTNET" },
        resolvers: tonResolvers
      }),
    /coverifier_decode_failed/
  );
});

test("malformed wires and malformed canonical inputs fail closed", () => {
  assert.throws(
    () =>
      verifyWireAgainstCanonical({
        network: "TRON_TESTNET",
        rawPayload: trc20Wire.slice(0, 30),
        canonical: tronCanonical,
        resolvers: tronResolvers
      }),
    /coverifier_decode_failed/
  );
  assert.throws(
    () =>
      verifyWireAgainstCanonical({
        network: "TRON_TESTNET",
        rawPayload: trc20Wire,
        canonical: { ...tronCanonical, amount: "12,345678" },
        resolvers: tronResolvers
      }),
    /coverifier_canonical_amount_invalid/
  );
  assert.throws(
    () =>
      verifyWireAgainstCanonical({
        network: "TRON_TESTNET",
        rawPayload: trc20Wire,
        canonical: { ...tronCanonical, destination_reference: "T" + "A".repeat(10) + "RAW" },
        resolvers: tronResolvers
      }),
    /coverifier_canonical_destination_invalid/
  );
  assert.throws(
    () =>
      verifyWireAgainstCanonical({
        network: "TRON_MAINNET",
        rawPayload: trc20Wire,
        canonical: tronCanonical,
        resolvers: tronResolvers
      }),
    /coverifier_unsupported_network/
  );
});

test("the evidence digest commits to both shapes", () => {
  const a = verifyWireAgainstCanonical({
    network: "TRON_TESTNET",
    rawPayload: trc20Wire,
    canonical: tronCanonical,
    resolvers: tronResolvers
  });
  // Same fields, different wire (TRX this time) — digest must differ, proving
  // the digest binds to the decoded wire content, not only the intent.
  const b = verifyWireAgainstCanonical({
    network: "TRON_TESTNET",
    rawPayload: trxFixture({ amountSun: 12_345_678n }),
    canonical: { ...tronCanonical, asset: "TRX" },
    resolvers: tronResolvers
  });
  assert.notEqual(a.evidence_digest, b.evidence_digest);
  assert.equal(a.evidence_digest.length, 64);
  assert.match(a.evidence_digest, /^[0-9a-f]{64}$/u);
  // sanity: digest is sha256-shaped
  assert.equal(createHash("sha256").update("x").digest("hex").length, a.evidence_digest.length);
});
