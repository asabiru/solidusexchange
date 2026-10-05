import { parseArgs } from "node:util";

import {
  mintSyntheticCustomerToken,
  SYNTHETIC_TOKEN_MAX_TTL_SECONDS
} from "../src/auth.mjs";
import { loadConfig } from "../src/config.mjs";

try {
  const config = loadConfig(process.env);
  if (config.authMode !== "synthetic-dev") {
    throw new Error("Set CUSTOMER_API_DEV_AUTH=synthetic and CUSTOMER_API_DEV_TOKEN_KEY first");
  }
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      subject: { type: "string", default: "syn_cust_00000001" },
      ttl: { type: "string", default: "900" }
    },
    strict: true,
    allowPositionals: false
  });
  const ttl = Number(values.ttl);
  if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > SYNTHETIC_TOKEN_MAX_TTL_SECONDS) {
    throw new Error(`--ttl must be an integer from 1 to ${SYNTHETIC_TOKEN_MAX_TTL_SECONDS}`);
  }
  const token = mintSyntheticCustomerToken({
    key: config.devTokenKey,
    subject: values.subject,
    expiresAtSeconds: Math.floor(Date.now() / 1000) + ttl
  });
  process.stdout.write(`${token}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Could not mint a synthetic token");
  process.exitCode = 1;
}
