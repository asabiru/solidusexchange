import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const customerApiPort = process.env.MINIAPP_DEV_CUSTOMER_API_PORT ?? "4185";
const devTokenKey = randomBytes(32).toString("hex");

const customerApiEnv = {
  ...process.env,
  CUSTOMER_API_HOST: "127.0.0.1",
  CUSTOMER_API_PORT: customerApiPort,
  CUSTOMER_API_DEV_AUTH: "synthetic",
  CUSTOMER_API_DEV_TOKEN_KEY: devTokenKey
};
const bffEnv = {
  ...process.env,
  MINIAPP_QUOTE_SOURCE: process.env.MINIAPP_QUOTE_SOURCE ?? "provider-simulator",
  MINIAPP_CUSTOMER_API_URL: `http://127.0.0.1:${customerApiPort}`,
  MINIAPP_CUSTOMER_API_DEV_TOKEN_KEY: devTokenKey
};

const processes = [
  spawn("npm", ["--prefix", "../packages/customer-api", "run", "dev"], { stdio: "inherit", env: customerApiEnv }),
  spawn("npm", ["run", "dev:bff"], { stdio: "inherit", env: bffEnv }),
  spawn("npm", ["run", "dev:web"], { stdio: "inherit", env: process.env })
];

let stopping = false;
for (const child of processes) {
  child.on("exit", (code, signal) => {
    if (stopping) return;
    stopping = true;
    for (const other of processes) {
      if (other !== child) other.kill("SIGTERM");
    }
    if (code !== 0 || signal) {
      process.exitCode = 1;
    }
  });
}
