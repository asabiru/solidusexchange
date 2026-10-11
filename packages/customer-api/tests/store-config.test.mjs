import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../src/config.mjs";
import { startCustomerApi } from "../src/server.mjs";
import { request, stopServer } from "./http-client.mjs";

test("the store backend defaults to memory with no DSN", () => {
  for (const env of [{}, { CUSTOMER_API_STORE: "memory" }]) {
    const config = loadConfig(env);
    assert.equal(config.store.mode, "memory");
    assert.equal(config.store.dsn, null);
  }
});

test("postgres mode requires a valid PostgreSQL DSN", () => {
  for (const env of [
    { CUSTOMER_API_STORE: "postgres" },
    { CUSTOMER_API_STORE: "postgres", CUSTOMER_API_STORE_DSN: "" },
    { CUSTOMER_API_STORE: "postgres", CUSTOMER_API_STORE_DSN: "not a url" },
    { CUSTOMER_API_STORE: "postgres", CUSTOMER_API_STORE_DSN: "mysql://127.0.0.1/db" },
    { CUSTOMER_API_STORE: "postgres", CUSTOMER_API_STORE_DSN: "http://127.0.0.1/db" }
  ]) {
    assert.throws(() => loadConfig(env), /CUSTOMER_API_STORE_DSN/u, JSON.stringify(env));
  }
});

test("postgres mode accepts postgres and postgresql URLs", () => {
  for (const dsn of [
    "postgres://u:p@127.0.0.1:5432/db",
    "postgresql://u:p@127.0.0.1:5432/db"
  ]) {
    const config = loadConfig({ CUSTOMER_API_STORE: "postgres", CUSTOMER_API_STORE_DSN: dsn });
    assert.equal(config.store.mode, "postgres");
    assert.equal(config.store.dsn, dsn);
  }
});

test("a DSN without postgres mode is a configuration error", () => {
  for (const env of [
    { CUSTOMER_API_STORE_DSN: "postgres://u:p@127.0.0.1:5432/db" },
    { CUSTOMER_API_STORE: "memory", CUSTOMER_API_STORE_DSN: "postgres://u:p@127.0.0.1:5432/db" }
  ]) {
    assert.throws(() => loadConfig(env), /CUSTOMER_API_STORE_DSN requires/u, JSON.stringify(env));
  }
});

test("unknown store modes fail closed", () => {
  for (const mode of ["file", "redis", "production", "POSTGRES"]) {
    assert.throws(() => loadConfig({ CUSTOMER_API_STORE: mode }), /CUSTOMER_API_STORE must be/u, mode);
  }
});

test("startCustomerApi serves requests through the injected store's consume", async (t) => {
  const calls = [];
  const store = {
    kind: "memory",
    consumeRateLimit(command) {
      calls.push(command.key);
      return { allowed: true };
    },
    async close() {}
  };
  const config = loadConfig({ CUSTOMER_API_PORT: "0" });
  const { server, address } = await startCustomerApi(config, { store });
  t.after(() => stopServer(server));
  const response = await request(address.port, {
    path: "/api/v1/customer/session",
    headers: [
      ["X-Request-Id", "018f3f8a-6a36-7bd8-86e0-b59cd575d55a"],
      ["X-Client-Version", "1.0.0"],
      ["X-Platform", "web"]
    ]
  });
  assert.equal(response.status, 401);
  assert.deepEqual(calls, ["127.0.0.0/8"]);
});

test("startCustomerApi fails fast when the injected store cannot initialize", async () => {
  const store = {
    kind: "postgresql",
    async initialize() {
      throw new Error("customer-api store is unavailable");
    },
    consumeRateLimit() {
      return { allowed: true };
    },
    async close() {}
  };
  const config = loadConfig({ CUSTOMER_API_PORT: "0" });
  await assert.rejects(() => startCustomerApi(config, { store }), /store is unavailable/u);
});
