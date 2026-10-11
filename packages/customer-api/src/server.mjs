import path from "node:path";
import { fileURLToPath } from "node:url";

import { createCustomerApiServer } from "./app.mjs";
import { createDenyAllVerifier, createSyntheticTokenVerifier } from "./auth.mjs";
import { createSyntheticAuthSessionDirectory } from "./auth-sessions.mjs";
import { createSyntheticKycDirectory } from "./capabilities.mjs";
import { isLoopbackAddress, loadConfig } from "./config.mjs";
import { createSyntheticCardDirectory } from "./cards.mjs";
import { createSyntheticActivityDirectory } from "./activity.mjs";
import { createSyntheticCheckDirectory } from "./checks.mjs";
import { createSyntheticDepositDirectory } from "./deposits.mjs";
import { createSyntheticExchangeOrderDirectory, createSyntheticTradeDirectory } from "./exchange-orders.mjs";
import { createSyntheticKycApplicationDirectory } from "./kyc.mjs";
import { createSyntheticNotificationDirectory } from "./notifications.mjs";
import { createSyntheticOperationDirectory } from "./operations.mjs";
import { createSyntheticAddressScreeningDirectory } from "./address-screenings.mjs";
import { createSyntheticDepositAddressDirectory } from "./deposit-addresses.mjs";
import { createSyntheticOperatorDirectory } from "./operator.mjs";
import { createSyntheticPaymentDirectory } from "./payments.mjs";
import { createSyntheticProfileDirectory } from "./profile.mjs";
import { createSyntheticQuoteDirectory } from "./quotes.mjs";
import { createSyntheticSupportDirectory } from "./support.mjs";
import { createSyntheticUserDirectory } from "./users.mjs";
import { createSyntheticWalletDirectory } from "./wallets.mjs";
import { createSyntheticWithdrawalDirectory } from "./withdrawals.mjs";
import { createStoredRateLimiter } from "./rate-limit.mjs";
import { createMemoryStore } from "./store.mjs";
import { createPostgresStore } from "./postgres-store.mjs";

/**
 * @param {import("./config.mjs").CustomerApiConfig} config
 * @param {{
 *   kycDirectory?: import("./capabilities.mjs").KycDirectory,
 *   walletDirectory?: import("./wallets.mjs").WalletDirectory,
 *   notificationDirectory?: import("./notifications.mjs").NotificationDirectory,
 *   kycApplicationDirectory?: import("./kyc.mjs").KycApplicationDirectory,
 *   profileDirectory?: import("./profile.mjs").ProfileDirectory,
 *   supportDirectory?: import("./support.mjs").SupportDirectory,
 *   authSessionDirectory?: import("./auth-sessions.mjs").AuthSessionDirectory,
 *   userDirectory?: import("./users.mjs").UserDirectory,
 *   depositDirectory?: import("./deposits.mjs").DepositDirectory,
 *   withdrawalDirectory?: import("./withdrawals.mjs").WithdrawalDirectory,
 *   quoteDirectory?: import("./quotes.mjs").QuoteDirectory,
 *   exchangeOrderDirectory?: import("./exchange-orders.mjs").ExchangeOrderDirectory,
 *   tradeDirectory?: import("./exchange-orders.mjs").TradeDirectory,
 *   paymentDirectory?: import("./payments.mjs").PaymentDirectory,
 *   cardDirectory?: import("./cards.mjs").CardDirectory,
 *   checkDirectory?: import("./checks.mjs").CheckDirectory,
 *   activityDirectory?: import("./activity.mjs").ActivityDirectory,
 *   operationDirectory?: import("./operations.mjs").OperationDirectory,
 *   depositAddressDirectory?: import("./deposit-addresses.mjs").DepositAddressDirectory,
 *   addressScreeningDirectory?: import("./address-screenings.mjs").AddressScreeningDirectory,
 *   operatorDirectory?: import("./operator.mjs").OperatorDirectory,
 *   store?: import("./store.mjs").CustomerApiStore,
 *   rateLimiter?: import("./rate-limit.mjs").RateLimiter,
 *   clock?: () => number,
 *   logSink?: (line: string) => void,
 *   timer?: () => number
 * }} [dependencies]
 */
export async function startCustomerApi(config, { kycDirectory, walletDirectory, notificationDirectory, kycApplicationDirectory, profileDirectory, supportDirectory, authSessionDirectory, userDirectory, depositDirectory, withdrawalDirectory, quoteDirectory, exchangeOrderDirectory, tradeDirectory, paymentDirectory, cardDirectory, checkDirectory, activityDirectory, operationDirectory, depositAddressDirectory, addressScreeningDirectory, operatorDirectory, store: injectedStore, rateLimiter: injectedRateLimiter, clock, logSink, timer } = {}) {
  // Store selection happens once at construction: the memory backend is the
  // default and reproduces today's behavior, `postgres` requires a valid DSN
  // (validated in loadConfig) and probes its schema before the server
  // listens, so a misconfigured backend fails fast at startup.
  const ownsStore = injectedStore === undefined;
  const store =
    injectedStore ??
    (config.store?.mode === "postgres"
      ? createPostgresStore({ dsn: config.store.dsn })
      : createMemoryStore());
  await store.initialize?.();
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
    authSessionDirectory: authSessionDirectory ?? createSyntheticAuthSessionDirectory(),
    userDirectory: userDirectory ?? createSyntheticUserDirectory(),
    depositDirectory: depositDirectory ?? createSyntheticDepositDirectory(),
    withdrawalDirectory: withdrawalDirectory ?? createSyntheticWithdrawalDirectory(),
    quoteDirectory: quoteDirectory ?? createSyntheticQuoteDirectory(),
    exchangeOrderDirectory: exchangeOrderDirectory ?? createSyntheticExchangeOrderDirectory(),
    tradeDirectory: tradeDirectory ?? createSyntheticTradeDirectory(),
    paymentDirectory: paymentDirectory ?? createSyntheticPaymentDirectory(),
    cardDirectory: cardDirectory ?? createSyntheticCardDirectory(),
    checkDirectory: checkDirectory ?? createSyntheticCheckDirectory(),
    activityDirectory: activityDirectory ?? createSyntheticActivityDirectory(),
    operationDirectory: operationDirectory ?? createSyntheticOperationDirectory(),
    depositAddressDirectory: depositAddressDirectory ?? createSyntheticDepositAddressDirectory(),
    addressScreeningDirectory: addressScreeningDirectory ?? createSyntheticAddressScreeningDirectory(),
    operatorDirectory: operatorDirectory ?? createSyntheticOperatorDirectory(),
    rateLimiter:
      injectedRateLimiter ??
      createStoredRateLimiter({ store, limit: config.rateLimitPerMinute, clock }),
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

  if (ownsStore) {
    server.once("close", () => {
      void store.close().catch(() => undefined);
    });
  }

  const address = server.address();
  if (typeof address !== "object" || address === null || !isLoopbackAddress(address.address)) {
    await new Promise((resolve) => server.close(resolve));
    throw new Error("customer-api must only listen on a loopback address");
  }
  return { server, verifierKind: verifier.kind, address, store };
}

async function main() {
  try {
    const config = loadConfig(process.env);
    const { address, verifierKind, store } = await startCustomerApi(config);
    const host = address.family === "IPv6" ? `[${address.address}]` : address.address;
    console.log(`customer-api (dev-only) listening on http://${host}:${address.port} auth=${verifierKind} store=${store.kind}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "customer-api failed to start");
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
