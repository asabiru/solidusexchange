import assert from "node:assert/strict";
import test from "node:test";

import {
  ADDRESS_SCREENING_TARGETS,
  createSyntheticAddressScreeningDirectory,
  validAddressScreeningView
} from "../src/address-screenings.mjs";
import { createSyntheticCardDirectory } from "../src/cards.mjs";
import {
  createSyntheticOperationDirectory,
  validOperationView
} from "../src/operations.mjs";
import { NOW_MS, SUBJECT, VERIFIED_SUBJECT } from "./http-client.mjs";

// Wave-76 builder-level served-read audit: the earlier waves pinned the
// contract surface and the client-side guards, but the view builders
// themselves can emit contract-valid-but-wrong records. Each test below was
// a reproduction that failed on the pre-fix builders and now pins the
// repaired derivation.

const PROBE_SUBJECTS = Object.freeze(
  Array.from({ length: 96 }, (_value, index) => `syn_cust_w76${String(index).padStart(5, "0")}`)
);
const SCREENING_WINDOW_MS = 900_000;

// The mirrored miniapp screening surface and the KYT simulator both pin the
// screening deadline to the submitted_at plus a 900-second window; the served
// builder derived a different 1800-second window.
test("address screenings pin the mirrored 900-second deadline window", async () => {
  const directory = createSyntheticAddressScreeningDirectory();
  for (const subject of [SUBJECT, VERIFIED_SUBJECT, ...PROBE_SUBJECTS.slice(0, 8)]) {
    const view = await directory.listFor(subject);
    assert.equal(view.screenings.length, ADDRESS_SCREENING_TARGETS.length);
    for (const entry of view.screenings) {
      assert.equal(
        Date.parse(entry.deadline) - Date.parse(entry.submitted_at),
        SCREENING_WINDOW_MS,
        `${subject} ${entry.screening_id} deadline drifted from the mirrored screening window`
      );
    }
  }
});

test("address screening validator rejects a drifted deadline window", () => {
  const directory = createSyntheticAddressScreeningDirectory();
  return directory.listFor(VERIFIED_SUBJECT).then((view) => {
    const entry = view.screenings[0];
    assert.equal(validAddressScreeningView(entry), true);
    assert.equal(
      validAddressScreeningView({
        ...entry,
        deadline: new Date(Date.parse(entry.submitted_at) + 1_800_000).toISOString()
      }),
      false
    );
    assert.equal(
      validAddressScreeningView({
        ...entry,
        deadline: new Date(Date.parse(entry.submitted_at) + SCREENING_WINDOW_MS).toISOString()
      }),
      true
    );
  });
});

// A QR operation projects the subject's own SBP rail payment: the payments
// domain only ever settles RUB outbound, and the miniapp's operation
// vocabulary renders the leg the same way. The builder emitted "in" legs on
// any OPERATION_ASSETS member (USDT/TON included) — contract-valid but wrong.
test("qr operations carry a RUB outbound leg like the payments domain", async () => {
  const directory = createSyntheticOperationDirectory();
  let seen = 0;
  for (const subject of [SUBJECT, VERIFIED_SUBJECT, ...PROBE_SUBJECTS]) {
    const view = await directory.viewFor(subject);
    for (const item of view.operations) {
      if (item.kind !== "qr") {
        continue;
      }
      seen += 1;
      assert.equal(item.legs.length, 1);
      assert.equal(item.legs[0].asset, "RUB", `${subject} ${item.operation_id} settled a non-RUB qr leg`);
      assert.equal(
        item.legs[0].direction,
        "out",
        `${subject} ${item.operation_id} reported an inbound leg on an outbound payment`
      );
    }
  }
  assert.ok(seen > 0, "probe subjects never produced a qr operation");
});

test("operation validator fails closed on a foreign-asset or inbound qr leg", async () => {
  const directory = createSyntheticOperationDirectory();
  const view = await directory.viewFor(VERIFIED_SUBJECT);
  const qr = view.operations.find((item) => item.kind === "qr") ?? view.operations[0];
  const forged = {
    ...qr,
    kind: "qr",
    status: "completed",
    legs: Object.freeze([Object.freeze({ asset: "RUB", amount: "1250.00", direction: "out" })]),
    exchange: null
  };
  assert.equal(validOperationView(forged), true);
  assert.equal(
    validOperationView({ ...forged, legs: Object.freeze([Object.freeze({ asset: "RUB", amount: "1250.00", direction: "in" })]) }),
    false
  );
  assert.equal(
    validOperationView({ ...forged, legs: Object.freeze([Object.freeze({ asset: "USDT", amount: "1250.000000", direction: "out" })]) }),
    false
  );
});

// An already-expired card must carry a past validity window: the builder
// stamped expiry one to two years AFTER issuance, so status "expired" came
// with a future expires_at and a future updated_at (the expiry transition).
test("expired cards carry a past expiry and a past last observation", async () => {
  const directory = createSyntheticCardDirectory();
  let seen = 0;
  for (const subject of [SUBJECT, VERIFIED_SUBJECT, ...PROBE_SUBJECTS]) {
    const view = await directory.listFor(subject);
    for (const card of view.cards) {
      if (card.status !== "expired") {
        continue;
      }
      seen += 1;
      const created = Date.parse(card.created_at);
      const expires = Date.parse(card.expires_at);
      const updated = Date.parse(card.updated_at);
      assert.ok(expires > created, `${subject} ${card.card_id} expired before issuance`);
      assert.ok(
        expires <= NOW_MS,
        `${subject} ${card.card_id} reports status expired with a future expires_at ${card.expires_at}`
      );
      assert.equal(updated, expires);
      assert.ok(
        updated <= NOW_MS,
        `${subject} ${card.card_id} reports a last observation in the future ${card.updated_at}`
      );
    }
  }
  assert.ok(seen > 0, "probe subjects never produced an expired card");
});

// In-force cards keep their long validity window — the fix only moves the
// terminal state's timestamps, not the live card's expiry.
test("non-expired cards keep a forward validity window", async () => {
  const directory = createSyntheticCardDirectory();
  const view = await directory.listFor(VERIFIED_SUBJECT);
  for (const card of view.cards) {
    if (card.status === "expired") {
      continue;
    }
    const expires = Date.parse(card.expires_at);
    assert.ok(expires > NOW_MS, `${card.card_id} lost its in-force validity window`);
  }
});
