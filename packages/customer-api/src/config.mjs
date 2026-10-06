import { DEV_TOKEN_KEY_PATTERN } from "./auth.mjs";
import { LOG_MODES, METRICS_MODES } from "./observability.mjs";

/** @type {readonly string[]} */
export const LOOPBACK_HOSTS = Object.freeze(["127.0.0.1", "::1"]);
const PORT_PATTERN = /^(?:0|[1-9][0-9]{0,4})$/u;
const RATE_LIMIT_PATTERN = /^[1-9][0-9]{0,4}$/u;

/** @param {string} address */
export function isLoopbackAddress(address) {
  return LOOPBACK_HOSTS.includes(address);
}

/** @typedef {ReturnType<typeof loadConfig>} CustomerApiConfig */

/** @param {Readonly<Record<string, string | undefined>>} env */
export function loadConfig(env) {
  if (String(env.NODE_ENV ?? "").trim().toLowerCase() === "production") {
    throw new Error("customer-api is dev-only and refuses NODE_ENV=production");
  }

  const host = env.CUSTOMER_API_HOST ?? "127.0.0.1";
  if (!isLoopbackAddress(host)) {
    throw new Error("CUSTOMER_API_HOST must be a loopback address (127.0.0.1 or ::1)");
  }

  const portText = env.CUSTOMER_API_PORT ?? "8790";
  if (!PORT_PATTERN.test(portText) || Number(portText) > 65_535) {
    throw new Error("CUSTOMER_API_PORT must be an integer from 0 to 65535");
  }

  const rateText = env.CUSTOMER_API_RATE_LIMIT_PER_MINUTE ?? "60";
  if (!RATE_LIMIT_PATTERN.test(rateText)) {
    throw new Error("CUSTOMER_API_RATE_LIMIT_PER_MINUTE must be an integer from 1 to 99999");
  }

  const authMode = env.CUSTOMER_API_DEV_AUTH ?? "";
  const key = env.CUSTOMER_API_DEV_TOKEN_KEY;
  if (authMode !== "" && authMode !== "synthetic") {
    throw new Error('CUSTOMER_API_DEV_AUTH must be unset or "synthetic"');
  }
  if (authMode === "synthetic" && !DEV_TOKEN_KEY_PATTERN.test(key ?? "")) {
    throw new Error("CUSTOMER_API_DEV_TOKEN_KEY must be 64 lowercase hex characters");
  }
  if (authMode === "" && key !== undefined) {
    throw new Error("CUSTOMER_API_DEV_TOKEN_KEY requires CUSTOMER_API_DEV_AUTH=synthetic");
  }

  const log = env.CUSTOMER_API_LOG ?? "off";
  if (!LOG_MODES.includes(log)) {
    throw new Error('CUSTOMER_API_LOG must be unset, "off" or "json"');
  }
  const metrics = env.CUSTOMER_API_METRICS ?? "off";
  if (!METRICS_MODES.includes(metrics)) {
    throw new Error('CUSTOMER_API_METRICS must be unset, "off" or "loopback"');
  }

  return Object.freeze({
    host,
    port: Number(portText),
    rateLimitPerMinute: Number(rateText),
    authMode: authMode === "synthetic" ? "synthetic-dev" : "deny-all",
    devTokenKey: authMode === "synthetic" ? key : null,
    log,
    metrics
  });
}
