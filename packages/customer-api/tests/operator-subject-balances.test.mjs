import assert from "node:assert/strict";
import test from "node:test";

import { createSyntheticKycDirectory } from "../src/capabilities.mjs";
import {
  createSyntheticOperatorSubjectsDirectory,
  validOperatorSubjectBalances,
  validOperatorSubjectDetailView
} from "../src/operator.mjs";
import { buildWalletsView, WALLET_ASSETS } from "../src/wallets.mjs";
import {
  checkedRequest,
  customerHeaders,
  operatorHeaders,
  startTestServer,
  stopServer,
  token
} from "./http-client.mjs";

// The operator subject-360 balances block folds the subject's synthetic
// wallet universe into the composed detail — the exact derivation the
// customer's own /customer/wallets read serves, minus the wallet handle and
// plus the asset scale, with the #314 account-state rule on top: a closed
// account holds no positions. This suite pins the operator↔customer
// identity, the closed-account zeroing and the fail-closed echo rules.
const OPERATOR_SUBJECTS = "/api/v1/operator/subjects";
const WALLETS = "/api/v1/customer/wallets";

const directory = createSyntheticOperatorSubjectsDirectory();
const subjectsView = await directory.subjectsFor();
const details = await Promise.all(subjectsView.subjects.map((row) => directory.subjectFor(row.subject_id)));

// The expected block, recomputed the way the contract reads it: one row per
// fixed asset carrying the customer's wallet amounts verbatim — or the
// canonical zero when the account is closed.
function expectedBalances(subjectId, accountStatus) {
  const closed = accountStatus === "closed";
  const wallets = buildWalletsView(subjectId).wallets;
  return WALLET_ASSETS.map(({ code, scale }) => {
    const wallet = wallets.find((entry) => entry.asset === code);
    assert.ok(wallet !== undefined, `${subjectId} ${code} missing from the wallet universe`);
    const zero = `0.${"0".repeat(scale)}`;
    return {
      asset: code,
      asset_scale: scale,
      available: closed ? zero : wallet.available,
      hold: closed ? zero : wallet.hold
    };
  });
}

async function withServer(options, run) {
  const { server, port } = await startTestServer(options);
  try {
    await run(port);
  } finally {
    await stopServer(server);
  }
}

test("operator balances equal the customer's own wallets view for every roster subject", () => {
  // THE KEY INVARIANT: the operator-360 block is the customer's wallets
  // view minus wallet_id, plus asset_scale — never a second derivation.
  for (const detail of details) {
    const subject = detail.subject;
    assert.deepEqual(subject.balances, expectedBalances(subject.subject_id, subject.account_status), subject.subject_id);
    if (subject.account_status === "closed") continue;
    // Row-level identity with the customer read: same assets, same amounts.
    const wallets = buildWalletsView(subject.subject_id).wallets;
    assert.deepEqual(
      subject.balances.map(({ asset, available, hold }) => ({ asset, available, hold })),
      wallets.map(({ asset, available, hold }) => ({ asset, available, hold })),
      `${subject.subject_id} positions drifted from the customer view`
    );
  }
});

test("closed accounts report the canonical zero at each asset scale", () => {
  const closedDetails = details.filter((detail) => detail.subject.account_status === "closed");
  // The universe must actually contain a closed subject — otherwise the
  // zeroing invariant is untested rather than verified.
  assert.ok(closedDetails.length >= 1, "roster has no closed subject");
  let nonzeroDraws = 0;
  for (const detail of closedDetails) {
    const subject = detail.subject;
    for (const entry of subject.balances) {
      const scale = WALLET_ASSETS.find(({ code }) => code === entry.asset).scale;
      assert.equal(entry.asset_scale, scale, `${subject.subject_id} ${entry.asset} scale`);
      assert.equal(entry.available, `0.${"0".repeat(scale)}`, `${subject.subject_id} ${entry.asset} available`);
      assert.equal(entry.hold, `0.${"0".repeat(scale)}`, `${subject.subject_id} ${entry.asset} hold`);
    }
    // The zeroing is exercised, not vacuous: the underlying universe draw
    // for at least one closed subject carries real positions.
    const wallets = buildWalletsView(subject.subject_id).wallets;
    if (wallets.some((wallet) => BigInt(wallet.available.replace(".", "")) !== 0n || BigInt(wallet.hold.replace(".", "")) !== 0n)) {
      nonzeroDraws += 1;
    }
  }
  assert.ok(nonzeroDraws >= 1, "every closed subject drew an empty universe — zeroing was never exercised");
});

test("every served balances block validates its own shape", () => {
  for (const detail of details) {
    assert.equal(validOperatorSubjectBalances(detail.subject.balances), true, detail.subject.subject_id);
    assert.equal(validOperatorSubjectDetailView(detail), true, detail.subject.subject_id);
  }
});

test("validOperatorSubjectBalances fails closed on hostile echoes", () => {
  const good = details.find((detail) => detail.subject.account_status !== "closed").subject.balances;
  const bad = [
    null,
    "balances",
    {},
    [],
    good.slice(0, WALLET_ASSETS.length - 1),
    [...good, { ...good[0] }],
    // A raw customer wallet row echoes wallet_id and lacks asset_scale —
    // the operator shape must reject it instead of absorbing it.
    buildWalletsView("syn_cust_other000").wallets,
    good.map((entry, index) => (index === 0 ? { ...entry, asset_scale: entry.asset_scale + 1 } : entry)),
    good.map((entry, index) => (index === 0 ? { ...entry, asset: "ETH" } : entry)),
    good.map((entry, index) => (index === 0 ? { ...entry, available: "1.5" } : entry)),
    good.map((entry, index) => (index === 0 ? { ...entry, available: "01.00" } : entry)),
    good.map((entry, index) => (index === 0 ? { ...entry, hold: 0 } : entry)),
    good.map((entry, index) => (index === 0 ? { ...entry, hold: `${entry.hold}0` } : entry)),
    good.map((entry, index) => (index === 0 ? { ...entry, extra: "x" } : entry)),
    good.map((entry, index) => (index === 0 ? { asset: entry.asset, asset_scale: entry.asset_scale, available: entry.available } : entry))
  ];
  for (const view of bad) {
    assert.equal(validOperatorSubjectBalances(view), false, JSON.stringify(view));
  }
});

test("the detail validator fails closed on balances drift", () => {
  for (const detail of details) {
    const subject = detail.subject;
    // An echoed block from a different subject can never stand in.
    const other = details.find((entry) => entry.subject.subject_id !== subject.subject_id);
    assert.equal(
      validOperatorSubjectDetailView({ mode: "test", subject: { ...subject, balances: other.subject.balances } }),
      false,
      `${subject.subject_id} foreign echo accepted`
    );
    // A tampered amount can never stand in.
    const tampered = subject.balances.map((entry, index) =>
      index === 0 ? { ...entry, available: entry.available === `0.${"0".repeat(entry.asset_scale)}` ? `1.${"0".repeat(entry.asset_scale)}` : `0.${"0".repeat(entry.asset_scale)}` } : entry
    );
    assert.equal(
      validOperatorSubjectDetailView({ mode: "test", subject: { ...subject, balances: tampered } }),
      false,
      `${subject.subject_id} tampered amount accepted`
    );
    // Dropping the block entirely can never stand in.
    const { balances: _dropped, ...withoutBalances } = subject;
    assert.equal(
      validOperatorSubjectDetailView({ mode: "test", subject: withoutBalances }),
      false,
      `${subject.subject_id} missing block accepted`
    );
    if (subject.account_status === "closed") {
      // Nonzero positions on a closed account can never stand in — the
      // same account-state coherence the sessions clamp pins.
      assert.equal(
        validOperatorSubjectDetailView({
          mode: "test",
          subject: { ...subject, balances: buildWalletsView(subject.subject_id).wallets.map((wallet) => ({ asset: wallet.asset, asset_scale: WALLET_ASSETS.find(({ code }) => code === wallet.asset).scale, available: wallet.available, hold: wallet.hold })) }
        }),
        false,
        `${subject.subject_id} closed account carried live positions`
      );
    }
  }
});

test("the served operator detail echoes the customer's own wallet read verbatim", async () => {
  const detail = details.find((entry) => entry.subject.account_status !== "closed");
  const subjectId = detail.subject.subject_id;
  const kycDirectory = createSyntheticKycDirectory({ [subjectId]: "verified" });
  await withServer({ kycDirectory }, async (port) => {
    const wallets = await checkedRequest(port, {
      path: WALLETS,
      headers: customerHeaders({ Authorization: `Bearer ${token({ subject: subjectId })}` })
    });
    assert.equal(wallets.status, 200);
    const served = await checkedRequest(port, {
      path: `${OPERATOR_SUBJECTS}/${subjectId}`,
      headers: operatorHeaders()
    });
    assert.equal(served.status, 200);
    const ownWallets = JSON.parse(wallets.body).wallets;
    const operatorBalances = JSON.parse(served.body).subject.balances;
    assert.deepEqual(
      operatorBalances.map(({ asset, available, hold }) => ({ asset, available, hold })),
      ownWallets.map(({ asset, available, hold }) => ({ asset, available, hold }))
    );
    assert.deepEqual(
      operatorBalances.map(({ asset, asset_scale }) => ({ asset, asset_scale })),
      WALLET_ASSETS.map(({ code, scale }) => ({ asset: code, asset_scale: scale }))
    );
  });
});
