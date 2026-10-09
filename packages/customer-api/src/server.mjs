import path from "node:path";
import { fileURLToPath } from "node:url";

import { createCustomerApiServer } from "./app.mjs";
import { createDenyAllVerifier, createSyntheticTokenVerifier } from "./auth.mjs";
import { createSyntheticKycDirectory } from "./capabilities.mjs";
import { isLoopbackAddress, loadConfig } from "./config.mjs";
import { createSyntheticDepositDirectory } from "./deposits.mjs";
import { createSyntheticExchangeOrderDirectory } from "./exchange-orders.mjs";
import { createSyntheticKycApplicationDirectory } from "./kyc.mjs";
import { createSyntheticNotificationDirectory } from "./notifications.mjs";
import { createSyntheticPaymentDirectory } from "./payments.mjs";
import { createSyntheticProfileDirectory } from "./profile.mjs";
import { createSyntheticQuoteDirectory } from "./quotes.mjs";
import { createSyntheticSupportDirectory } from "./support.mjs";
import { createSyntheticWalletDirectory } from "./wallets.mjs";
import { createSyntheticWithdrawalDirectory } from "./withdrawals.mjs";
import { createFixedWindowRateLimiter } from "./rate-limit.mjs";

/**
 * @param {import("./config.mjs").CustomerApiConfig} config
 * @param {{
 *   kycDirectory?: import("./capabilities.mjs").KycDirectory,
 *   walletDirectory?: import("./wallets.mjs").WalletDirectory,
 *   notificationDirectory?: import("./notifications.mjs").NotificationDirectory,
 *   kycApplicationDirectory?: import("./kyc.mjs").KycApplicationDirectory,
 *   profileDirectory?: import("./profile.mjs").ProfileDirectory,
 *   supportDirectory?: import("./support.mjs").SupportDirectory,
 *   depositDirectory?: import("./deposits.mjs").DepositDirectory,
 *   withdrawalDirectory?: import("./withdrawals.mjs").WithdrawalDirectory,
 *   quoteDirectory?: import("./quotes.mjs").QuoteDirectory,
 *   exchangeOrderDirectory?: import("./exchange-orders.mjs").ExchangeOrderDirectory,
 *   paymentDirectory?: import("./payments.mjs").PaymentDirectory,
 *   clock?: () => number,
 *   logSink?: (line: string) => void,
 *   timer?: () => number
 * }} [dependencies]
 */
export async function startCustomerApi(config, { kycDirectory, walletDirectory, notificationDirectory, kycApplicationDirectory, profileDirectory, supportDirectory, depositDirectory, withdrawalDirectory, quoteDirectory, exchangeOrderDirectory, paymentDirectory, clock, logSink, timer } = {}) {
  const verifier =
    config.authMode === "synthetic-dev"
      ? createSyntheticTokenVerifier({ key: config.devTokenKey, clock })
      : createDenyAllVerifier();
  const server = createCustomerApiServer({
    verifier,
    kycDirectory: kycDirectory ?? createSyntheticKycDirectory(),
    walletDirectory: walletDirectory ?? createSyntheticWalletDirectory(),
    notificationDirectory: notificationDirectory ?? createSyntheticNotificationDirectory(),
    kycApplicationDirectory: kycApplicationDirectory ?? createSyntheticKycApplicationDirectory(),
    profileDirectory: profileDirectory ?? createSyntheticProfileDirectory(),
    supportDirectory: supportDirectory ?? createSyntheticSupportDirectory(),
    depositDirectory: depositDirectory ?? createSyntheticDepositDirectory(),
    withdrawalDirectory: withdrawalDirectory ?? createSyntheticWithdrawalDirectory(),
    quoteDirectory: quoteDirectory ?? createSyntheticQuoteDirectory(),
    exchangeOrderDirectory: exchangeOrderDirectory ?? createSyntheticExchangeOrderDirectory(),
    paymentDirectory: paymentDirectory ?? createSyntheticPaymentDirectory(),
    rateLimiter: createFixedWindowRateLimiter({ limit: config.rateLimitPerMinute, clock }),
    clock,
    observability: { log: config.log ?? "off", metrics: config.metrics ?? "off" },
    logSink,
    timer
  });

  await /** @type {Promise<void>} */ (
    new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.port, config.host, () => {
        server.off("error", reject);
        resolve();
      });
    })
  );

  const address = server.address();
  if (typeof address !== "object" || address === null || !isLoopbackAddress(address.address)) {
    await new Promise((resolve) => server.close(resolve));
    throw new Error("customer-api must only listen on a loopback address");
  }
  return { server, verifierKind: verifier.kind, address };
}

async function main() {
  try {
    const config = loadConfig(process.env);
    const { address, verifierKind } = await startCustomerApi(config);
    const host = address.family === "IPv6" ? `[${address.address}]` : address.address;
    console.log(`customer-api (dev-only) listening on http://${host}:${address.port} auth=${verifierKind}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "customer-api failed to start");
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
