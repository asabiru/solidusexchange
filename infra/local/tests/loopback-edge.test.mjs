import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";

import { defaultGatewayFromRouteTable, isAllowedPeer, parseRoutes, startEdge } from "../scripts/loopback-edge.mjs";

const ROUTE_TABLE = [
  "Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT",
  "eth0\t0011A8C0\t00000000\t0001\t0\t0\t0\t00FFFFFF\t0\t0\t0",
  "eth0\t00000000\t0111A8C0\t0003\t0\t0\t0\t00000000\t0\t0\t0",
  ""
].join("\n");

test("parses edge routes", () => {
  assert.deepEqual(parseRoutes("8183:4183, 8185:4185"), [
    { listenPort: 8183, targetPort: 4183 },
    { listenPort: 8185, targetPort: 4185 }
  ]);
});

test("rejects malformed, duplicate, identical or empty routes", () => {
  for (const value of ["", undefined, "8183", "8183:4183:1", "0:4183", "8183:0", "70000:4183", "8183:8183", "a:b"]) {
    assert.throws(() => parseRoutes(value), /EDGE_ROUTES/, String(value));
  }
  assert.throws(() => parseRoutes("8183:4183,8183:4184"), /must be unique/);
});

test("reads the default gateway from /proc/net/route", () => {
  assert.equal(defaultGatewayFromRouteTable(ROUTE_TABLE), "192.168.17.1");
  assert.equal(defaultGatewayFromRouteTable(ROUTE_TABLE.split("\n").slice(0, 2).join("\n")), undefined);
});

test("accepts only loopback peers and the bridge gateway", () => {
  assert.equal(isAllowedPeer("127.0.0.1", undefined), true);
  assert.equal(isAllowedPeer("::ffff:127.0.0.1", undefined), true);
  assert.equal(isAllowedPeer("::1", undefined), true);
  assert.equal(isAllowedPeer("192.168.17.1", "192.168.17.1"), true);
  assert.equal(isAllowedPeer("::ffff:192.168.17.1", "192.168.17.1"), true);
  assert.equal(isAllowedPeer("192.168.17.5", "192.168.17.1"), false);
  assert.equal(isAllowedPeer("10.0.0.1", undefined), false);
  assert.equal(isAllowedPeer(undefined, undefined), false);
});

test("forwards bytes from the edge listener to the loopback target", async () => {
  const target = net.createServer((socket) => socket.on("data", (data) => socket.end(`echo:${data}`)));
  await new Promise((resolve) => target.listen(0, "127.0.0.1", resolve));
  const [edge] = await startEdge({
    routes: [{ listenPort: 0, targetPort: target.address().port }],
    gateway: undefined,
    listenHost: "127.0.0.1"
  });
  try {
    const reply = await new Promise((resolve, reject) => {
      const client = net.connect({ host: "127.0.0.1", port: edge.address().port }, () => client.write("ping"));
      let body = "";
      client.on("data", (data) => {
        body += data;
      });
      client.on("end", () => resolve(body));
      client.on("error", reject);
    });
    assert.equal(reply, "echo:ping");
  } finally {
    await new Promise((resolve) => edge.close(resolve));
    await new Promise((resolve) => target.close(resolve));
  }
});

test("fails to start when a listen port is already taken", async () => {
  const blocker = net.createServer();
  await new Promise((resolve) => blocker.listen(0, "127.0.0.1", resolve));
  try {
    await assert.rejects(
      startEdge({ routes: [{ listenPort: blocker.address().port, targetPort: 1 }], listenHost: "127.0.0.1" }),
      /EADDRINUSE/
    );
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
  }
});
