import { parseArgs } from "node:util";

import {
  mintSyntheticCustomerToken,
  mintSyntheticOperatorToken,
  SYNTHETIC_TOKEN_MAX_TTL_SECONDS
} from "../src/auth.mjs";
import { loadConfig } from "../src/config.mjs";

const AUDIENCES = {
  customer: { mint: mintSyntheticCustomerToken, subject: "syn_cust_00000001" },
  operator: { mint: mintSyntheticOperatorToken, subject: "syn_oper_00000001" }
};

try {
  const config = loadConfig(process.env);
  if (config.authMode !== "synthetic-dev") {
    throw new Error("Set CUSTOMER_API_DEV_AUTH=synthetic and CUSTOMER_API_DEV_TOKEN_KEY first");
  }
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      audience: { type: "string", default: "customer" },
      subject: { type: "string" },
      ttl: { type: "string", default: "900" }
    },
    strict: true,
    allowPositionals: false
  });
  if (!Object.hasOwn(AUDIENCES, values.audience)) {
    throw new Error("--audience must be customer or operator");
  }
  const audience = /** @type {keyof typeof AUDIENCES} */ (values.audience);
  const selected = AUDIENCES[audience];
  // Number() alone would also accept non-decimal integer forms ("0x10", "1e3")
  // and surrounding whitespace; the flag stays canonical like every other
  // parsed field so argv can only name a plain base-10 second count.
  if (!/^[1-9][0-9]*$/u.test(values.ttl)) {
    throw new Error(`--ttl must be an integer from 1 to ${SYNTHETIC_TOKEN_MAX_TTL_SECONDS}`);
  }
  const ttl = Number(values.ttl);
  if (ttl > SYNTHETIC_TOKEN_MAX_TTL_SECONDS) {
    throw new Error(`--ttl must be an integer from 1 to ${SYNTHETIC_TOKEN_MAX_TTL_SECONDS}`);
  }
  const token = selected.mint({
    key: config.devTokenKey,
    subject: values.subject ?? selected.subject,
    expiresAtSeconds: Math.floor(Date.now() / 1000) + ttl
  });
  process.stdout.write(`${token}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Could not mint a synthetic token");
  process.exitCode = 1;
}
