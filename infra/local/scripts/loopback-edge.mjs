// TCP edge for the local dev stack. App containers share this container's
// network namespace and keep listening on 127.0.0.1 only; the edge is the
// single listener on the container interface and forwards to loopback. Docker
// publishes its ports on the host's 127.0.0.1 only (see compose.yaml).
import { readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TARGET_HOST = "127.0.0.1";
const ROUTE = /^([1-9][0-9]{0,4}):([1-9][0-9]{0,4})$/;

export function parseRoutes(text) {
  const routes = String(text ?? "").split(",").map((item) => item.trim()).filter(Boolean).map((item) => {
    const match = item.match(ROUTE);
    const listenPort = Number(match?.[1]);
    const targetPort = Number(match?.[2]);
    if (!match || listenPort > 65_535 || targetPort > 65_535 || listenPort === targetPort) {
      throw new Error(`EDGE_ROUTES entry "${item}" must be <listenPort>:<loopbackTargetPort> with distinct ports`);
    }
    return Object.freeze({ listenPort, targetPort });
  });
  if (routes.length === 0) throw new Error("EDGE_ROUTES must declare at least one route");
  if (new Set(routes.map((route) => route.listenPort)).size !== routes.length) {
    throw new Error("EDGE_ROUTES listen ports must be unique");
  }
  return Object.freeze(routes);
}

export function defaultGatewayFromRouteTable(table) {
  for (const line of String(table).split("\n").slice(1)) {
    const [, destination, gateway] = line.trim().split(/\s+/);
    if (destination === "00000000" && /^[0-9A-Fa-f]{8}$/.test(gateway ?? "")) {
      const value = Number.parseInt(gateway, 16);
      return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, value >>> 24].join(".");
    }
  }
  return undefined;
}

function unmapped(address) {
  return String(address ?? "").replace(/^::ffff:/i, "");
}

export function isAllowedPeer(address, gateway) {
  const peer = unmapped(address);
  if (peer === "::1" || /^127\.(?:[0-9]{1,3}\.){2}[0-9]{1,3}$/.test(peer)) return true;
  return gateway !== undefined && peer === gateway;
}

export function startEdge({ routes, gateway, listenHost = "0.0.0.0", log = () => undefined }) {
  return Promise.all(routes.map(({ listenPort, targetPort }) => new Promise((resolve, reject) => {
    const server = net.createServer((client) => {
      if (!isAllowedPeer(client.remoteAddress, gateway)) {
        log(`rejected peer ${client.remoteAddress} on ${listenPort}`);
        client.destroy();
        return;
      }
      const upstream = net.connect({ host: TARGET_HOST, port: targetPort });
      const close = () => {
        client.destroy();
        upstream.destroy();
      };
      client.on("error", close);
      upstream.on("error", close);
      client.on("close", close);
      upstream.on("close", close);
      client.pipe(upstream);
      upstream.pipe(client);
    });
    server.once("error", reject);
    server.listen(listenPort, listenHost, () => {
      server.off("error", reject);
      resolve(server);
    });
  })));
}

async function main() {
  try {
    const routes = parseRoutes(process.env.EDGE_ROUTES);
    const gateway = defaultGatewayFromRouteTable(readFileSync("/proc/net/route", "utf8"));
    if (gateway === undefined) throw new Error("no default gateway; refusing to guess which peers are host-local");
    await startEdge({ routes, gateway, log: (line) => console.log(line) });
    const summary = routes.map(({ listenPort, targetPort }) => `${listenPort}->${TARGET_HOST}:${targetPort}`).join(", ");
    console.log(`dev-only loopback edge forwarding ${summary}; accepting only loopback and gateway ${gateway}`);
  } catch (error) {
    console.error(`loopback edge refused to start: ${error instanceof Error ? error.message : "invalid configuration"}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
