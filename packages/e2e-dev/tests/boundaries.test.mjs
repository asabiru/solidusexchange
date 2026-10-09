import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { loadServerConfig as loadBackofficeConfig } from "../../../backoffice/.server-dist/server/config.js";
import { loadServerConfig as loadMiniappConfig } from "../../../miniapp/.server-dist/server/config.js";
import {
  backofficeEntry,
  customerApiEntry,
  freePort,
  miniappEntry,
  runToExit,
  startService,
  stopService
} from "./stack.mjs";

// Every dev server must refuse production mode and any non-loopback bind host
// before it opens a listener. Each refusal is paired with a control start of
// the same entry point so a refusal cannot pass for an unrelated reason.

const productionValues = ["production", " Production "];
const exposedHosts = ["0.0.0.0", "192.0.2.10"];

async function services() {
  const devTokenKey = randomBytes(32).toString("hex");
  return [
    {
      name: "customer-api",
      entry: customerApiEntry,
      env: {
        CUSTOMER_API_PORT: "0",
        CUSTOMER_API_DEV_AUTH: "synthetic",
        CUSTOMER_API_DEV_TOKEN_KEY: devTokenKey
      },
      hostVariable: "CUSTOMER_API_HOST",
      ready: /customer-api \(dev-only\) listening on http:\/\/127\.0\.0\.1:\d+/,
      production: /customer-api is dev-only and refuses NODE_ENV=production/,
      exposed: /CUSTOMER_API_HOST must be a loopback address/
    },
    {
      name: "miniapp BFF",
      entry: miniappEntry,
      env: { MINIAPP_BFF_PORT: String(await freePort()) },
      hostVariable: "MINIAPP_BFF_HOST",
      ready: /Mini App dev BFF listening on http:\/\/127\.0\.0\.1:\d+/,
      production: /Mini App dev BFF refused to start: .*refuses NODE_ENV=production/,
      exposed: /Mini App dev BFF refused to start: MINIAPP_BFF_HOST must be a loopback address/
    },
    {
      name: "backoffice BFF",
      entry: backofficeEntry,
      env: { BACKOFFICE_BFF_PORT: String(await freePort()) },
      hostVariable: "BACKOFFICE_BFF_HOST",
      ready: /Backoffice BFF listening on http:\/\/127\.0\.0\.1:\d+/,
      production: /Backoffice BFF refused to start: Backoffice BFF is dev-only and refuses NODE_ENV=production/,
      exposed: /Backoffice BFF refused to start: BACKOFFICE_BFF_HOST must be a loopback address/
    }
  ];
}

function assertRefused(result, pattern, label) {
  assert.equal(result.signal, null, `${label} must exit on its own`);
  assert.equal(result.code, 1, `${label}: ${result.stderr}`);
  assert.match(result.stderr, pattern, label);
  assert.doesNotMatch(result.stdout, /listening/, label);
}

function withEnvironment(values, check) {
  const saved = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  try {
    Object.assign(process.env, values);
    check();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

describe("dev server runtime boundaries", () => {
  it("each server starts on loopback with the dev configuration", async () => {
    for (const service of await services()) {
      const running = await startService(service.entry, service.env, service.ready);
      await stopService(running);
    }
  });

  it("each server exits non-zero under NODE_ENV=production", async () => {
    for (const service of await services()) {
      for (const value of productionValues) {
        const result = await runToExit(service.entry, { ...service.env, NODE_ENV: value });
        assertRefused(result, service.production, `${service.name} NODE_ENV=${value}`);
      }
    }
  });

  it("each server exits non-zero for a non-loopback host", async () => {
    for (const service of await services()) {
      for (const host of exposedHosts) {
        const result = await runToExit(service.entry, { ...service.env, [service.hostVariable]: host });
        assertRefused(result, service.exposed, `${service.name} ${service.hostVariable}=${host}`);
      }
    }
  });

  it("the BFF config loaders throw the specific boundary errors", () => {
    for (const value of productionValues) {
      assert.throws(() => loadMiniappConfig({ NODE_ENV: value }), /refuses NODE_ENV=production/);
      withEnvironment({ NODE_ENV: value }, () => {
        assert.throws(() => loadBackofficeConfig(), /Backoffice BFF is dev-only and refuses NODE_ENV=production/);
      });
    }
    for (const host of exposedHosts) {
      assert.throws(() => loadMiniappConfig({ MINIAPP_BFF_HOST: host }), /MINIAPP_BFF_HOST must be a loopback address/);
      withEnvironment({ NODE_ENV: "development", BACKOFFICE_BFF_HOST: host }, () => {
        assert.throws(() => loadBackofficeConfig(), /BACKOFFICE_BFF_HOST must be a loopback address/);
      });
    }
  });
});
