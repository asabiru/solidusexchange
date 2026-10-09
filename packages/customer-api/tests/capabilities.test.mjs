import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CAPABILITY_POLICY,
  createSyntheticKycDirectory,
  decisionReasonCode,
  evaluateCapabilities,
  KYC_STATUSES,
  REASON_CODES
} from "../src/capabilities.mjs";
import { OPERATIONS } from "../src/contract.mjs";
import { contract } from "./http-client.mjs";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const register = readFileSync(join(repositoryRoot, "Documentation", "regulated-core", "decision-register.md"), "utf8");
const MONEY_NAMESPACES = ["deposits", "withdrawals", "quotes", "exchange-orders", "payments", "cards"];

function decisionStatus(id) {
  const row = register.split("\n").find((line) => line.startsWith(`| ${id} |`));
  assert.ok(row, id);
  return row.split("|").map((cell) => cell.trim())[4];
}

test("only served read operations are ever granted", () => {
  // getCustomerWallets, getCustomerNotifications, getCustomerDeposits,
  // getCustomerWithdrawals, getCustomerQuotes, getCustomerExchangeOrders and
  // getCustomerPayments are the only KYC-gated served operations today.
  const gated = OPERATIONS.filter((operation) =>
    ["getCustomerWallets", "getCustomerNotifications", "getCustomerDeposits", "getCustomerWithdrawals", "getCustomerQuotes", "getCustomerExchangeOrders", "getCustomerPayments"].includes(operation.operationId)
  ).length;
  assert.equal(gated, 7);
  for (const kycStatus of KYC_STATUSES) {
    const { granted, commandsEnabled } = evaluateCapabilities({ kycStatus });
    // customer.kyc.read, customer.profile.read and customer.support.read are
    // granted at every KYC status: the status, profile and support tickets
    // reads are the onboarding/identity/service-requests surface and must
    // stay readable for unverified subjects.
    const expected = ["customer.session.read", "customer.capabilities.read", "customer.kyc.read", "customer.profile.read", "customer.support.read"];
    if (kycStatus === "verified") {
      expected.push("customer.wallets.read", "customer.notifications.read", "customer.deposits.read", "customer.withdrawals.read", "customer.quotes.read", "customer.exchange-orders.read", "customer.payments.read");
    }
    assert.deepEqual([...granted], expected);
    assert.equal(commandsEnabled, false);
    assert.equal(
      granted.length,
      OPERATIONS.filter((operation) => operation.authenticated).length - (kycStatus === "verified" ? 0 : gated)
    );
  }
});

test("every financial capability is disabled with explicit reason codes", () => {
  for (const kycStatus of KYC_STATUSES) {
    const { denied } = evaluateCapabilities({ kycStatus });
    for (const policy of CAPABILITY_POLICY.filter((item) => item.kind === "financial")) {
      const entry = denied.find((item) => item.capability === policy.capability);
      assert.ok(entry, policy.capability);
      assert.ok(entry.reasons.includes(REASON_CODES.financialCommandsDisabled));
      assert.ok(entry.reasons.includes(decisionReasonCode("D-001")));
      assert.equal(entry.reasons.includes(REASON_CODES.kycVerificationRequired), kycStatus !== "verified");
      assert.ok(policy.requiresVerifiedKyc, policy.capability);
    }
  }
});

test("money-moving and balance capabilities reference limits and scope decisions", () => {
  const financial = CAPABILITY_POLICY.filter((item) => item.kind === "financial");
  for (const namespace of MONEY_NAMESPACES) {
    assert.ok(financial.some((item) => item.capability.startsWith(`customer.${namespace}.`)), namespace);
  }
  // Every money namespace except deposits, withdrawals, quotes,
  // exchange-orders and payments — whose collection reads are now served —
  // stays a planned (unserved) contract namespace; their financial
  // capabilities themselves stay financial and unserved.
  for (const namespace of MONEY_NAMESPACES.filter((name) => name !== "deposits" && name !== "withdrawals" && name !== "quotes" && name !== "exchange-orders" && name !== "payments")) {
    assert.ok(contract.openapi["x-solidchange-planned-namespaces"].customer.includes(`/api/v1/customer/${namespace}`));
  }
  for (const policy of financial.filter((item) => !item.capability.endsWith(".read"))) {
    assert.ok(policy.decisions.includes("D-014"), policy.capability);
  }
  // The wallets namespace stays read-only in this dev boundary: no financial
  // or command capability exists for it.
  assert.deepEqual(
    CAPABILITY_POLICY.filter((item) => item.capability.startsWith("customer.wallets.")).map((item) => item.capability),
    ["customer.wallets.read"]
  );
  // The notifications namespace is likewise read-only and is deliberately NOT
  // a money namespace: it stays out of MONEY_NAMESPACES and the financial set.
  assert.ok(!MONEY_NAMESPACES.includes("notifications"));
  assert.deepEqual(
    CAPABILITY_POLICY.filter((item) => item.capability.startsWith("customer.notifications.")).map((item) => item.capability),
    ["customer.notifications.read"]
  );
  // The kyc namespace holds only the onboarding surface: the always-granted
  // status read plus the unserved submit capability. It is not a money
  // namespace and no financial capability exists for it.
  assert.ok(!MONEY_NAMESPACES.includes("kyc"));
  assert.deepEqual(
    CAPABILITY_POLICY.filter((item) => item.capability.startsWith("customer.kyc.")).map((item) => item.capability),
    ["customer.kyc.read", "customer.kyc.submit"]
  );
  assert.ok(
    CAPABILITY_POLICY.every(
      (item) => !item.capability.startsWith("customer.kyc.") || item.kind !== "financial"
    )
  );
  // The profile namespace holds only the always-granted identity read: it
  // is not a money namespace and no financial capability exists for it.
  assert.ok(!MONEY_NAMESPACES.includes("profile"));
  assert.deepEqual(
    CAPABILITY_POLICY.filter((item) => item.capability.startsWith("customer.profile.")).map((item) => item.capability),
    ["customer.profile.read"]
  );
  // The support namespace holds only the always-granted tickets read: it is
  // not a money namespace and no financial capability exists for it.
  assert.ok(!MONEY_NAMESPACES.includes("support"));
  assert.deepEqual(
    CAPABILITY_POLICY.filter((item) => item.capability.startsWith("customer.support.")).map((item) => item.capability),
    ["customer.support.read"]
  );
  // The deposits namespace stays a money namespace: it now serves the
  // KYC-gated synthetic collection read while deposits.create remains a
  // denied financial capability under its open decisions.
  assert.ok(MONEY_NAMESPACES.includes("deposits"));
  assert.deepEqual(
    CAPABILITY_POLICY.filter((item) => item.capability.startsWith("customer.deposits.")).map((item) => item.capability),
    ["customer.deposits.read", "customer.deposits.create"]
  );
  // The withdrawals namespace likewise stays a money namespace: it now
  // serves the KYC-gated synthetic collection read while withdrawals.create
  // remains a denied financial capability under its open decisions.
  assert.ok(MONEY_NAMESPACES.includes("withdrawals"));
  assert.deepEqual(
    CAPABILITY_POLICY.filter((item) => item.capability.startsWith("customer.withdrawals.")).map((item) => item.capability),
    ["customer.withdrawals.read", "customer.withdrawals.create"]
  );
  const withdrawals = financial.find((item) => item.capability === "customer.withdrawals.create");
  assert.deepEqual([...withdrawals.decisions], ["D-001", "D-002", "D-003", "D-011", "D-014"]);
  // The quotes namespace likewise stays a money namespace: it now serves the
  // KYC-gated synthetic collection read while the quote commands — preview
  // (rate lock against liquidity) and accept (the execution leg) — remain
  // denied financial capabilities under their open decisions.
  assert.ok(MONEY_NAMESPACES.includes("quotes"));
  assert.deepEqual(
    CAPABILITY_POLICY.filter((item) => item.capability.startsWith("customer.quotes.")).map((item) => item.capability),
    ["customer.quotes.read", "customer.quotes.preview", "customer.quotes.accept"]
  );
  const quoteAccept = financial.find((item) => item.capability === "customer.quotes.accept");
  assert.deepEqual([...quoteAccept.decisions], ["D-001", "D-007", "D-011", "D-014"]);
  // The exchange-orders namespace likewise stays a money namespace: it now
  // serves the KYC-gated synthetic collection read while the order commands
  // — create (placing liquidity demand, KYT-screened like quotes.accept) and
  // cancel (withdrawing a resting order) — remain denied financial
  // capabilities under their open decisions.
  assert.ok(MONEY_NAMESPACES.includes("exchange-orders"));
  assert.deepEqual(
    CAPABILITY_POLICY.filter((item) => item.capability.startsWith("customer.exchange-orders.")).map((item) => item.capability),
    ["customer.exchange-orders.read", "customer.exchange-orders.create", "customer.exchange-orders.cancel"]
  );
  const orderCreate = financial.find((item) => item.capability === "customer.exchange-orders.create");
  assert.deepEqual([...orderCreate.decisions], ["D-001", "D-007", "D-011", "D-014"]);
  const orderCancel = financial.find((item) => item.capability === "customer.exchange-orders.cancel");
  assert.deepEqual([...orderCancel.decisions], ["D-001", "D-007", "D-014"]);
  // The payments namespace likewise stays a money namespace: it now serves
  // the KYC-gated synthetic collection read while payments.create (the
  // outbound fiat payment command on the bank rail) remains a denied
  // financial capability under its open decisions.
  assert.ok(MONEY_NAMESPACES.includes("payments"));
  assert.deepEqual(
    CAPABILITY_POLICY.filter((item) => item.capability.startsWith("customer.payments.")).map((item) => item.capability),
    ["customer.payments.read", "customer.payments.create"]
  );
  const paymentCreate = financial.find((item) => item.capability === "customer.payments.create");
  assert.deepEqual([...paymentCreate.decisions], ["D-001", "D-004", "D-010", "D-014"]);
});

test("referenced decisions exist in the register and are still Open", () => {
  const referenced = new Set(CAPABILITY_POLICY.flatMap((item) => item.decisions));
  assert.ok(referenced.size > 0);
  for (const id of referenced) {
    assert.match(id, /^D-0[0-9]{2}$/u);
    assert.equal(decisionStatus(id), "Open", id);
  }
});

test("reason codes are stable identifiers", () => {
  assert.equal(decisionReasonCode("D-014"), "DECISION_D_014_OPEN");
  for (const kycStatus of KYC_STATUSES) {
    for (const entry of evaluateCapabilities({ kycStatus }).denied) {
      assert.ok(entry.reasons.length > 0, entry.capability);
      for (const reason of entry.reasons) {
        assert.match(reason, /^[A-Z][A-Z0-9_]{2,63}$/u);
      }
    }
  }
});

test("policy entries are unique, frozen and within the contract item limits", () => {
  const names = CAPABILITY_POLICY.map((item) => item.capability);
  assert.equal(new Set(names).size, names.length);
  assert.ok(Object.isFrozen(CAPABILITY_POLICY));
  for (const item of CAPABILITY_POLICY) {
    assert.ok(Object.isFrozen(item) && Object.isFrozen(item.decisions));
    assert.ok(item.capability.length >= 1 && item.capability.length <= 128);
    assert.ok(["read", "onboarding", "financial"].includes(item.kind));
  }
});

test("unknown KYC statuses fail closed", async () => {
  assert.throws(() => evaluateCapabilities({ kycStatus: "approved" }), /Unknown KYC status/u);
  assert.throws(() => evaluateCapabilities({}), /Unknown KYC status/u);
  assert.throws(() => createSyntheticKycDirectory({ syn_cust_00000001: "approved" }), /Unknown KYC status/u);
  const directory = createSyntheticKycDirectory({ syn_cust_00000001: "pending" });
  assert.equal(await directory.statusFor("syn_cust_00000001"), "pending");
  assert.equal(await directory.statusFor("syn_cust_unknown01"), "unverified");
  assert.equal(await directory.statusFor("__proto__"), "unverified");
});
