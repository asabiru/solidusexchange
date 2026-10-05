import assert from "node:assert/strict";
import { connect, type AddressInfo } from "node:net";
import { networkInterfaces } from "node:os";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const backofficeRoot = fileURLToPath(new URL("../../", import.meta.url));

function externalIpv4Addresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
}

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    socket.setTimeout(1_000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

describe("Vite dev proxy boundary", () => {
  it("keeps the BFF proxy unreachable from non-loopback clients", async () => {
    const vite = await createServer({
      root: backofficeRoot,
      configFile: `${backofficeRoot}vite.config.ts`,
      logLevel: "silent",
      server: { port: 0, strictPort: false }
    });
    try {
      await vite.listen();
      const address = vite.httpServer?.address() as AddressInfo | null;
      assert.ok(address && typeof address === "object");
      assert.equal(address.address, "127.0.0.1");
      for (const host of externalIpv4Addresses()) {
        assert.equal(await canConnect(host, address.port), false, host);
      }
    } finally {
      await vite.close();
    }
  });
});
