import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import tls from "node:tls";
import test from "node:test";

import { createDevTlsMaterial } from "../scripts/x509.mjs";

test("issues a CA and a loopback server certificate that the CA verifies", () => {
  const now = new Date("2026-01-15T12:00:00.000Z");
  const material = createDevTlsMaterial({ now, validityDays: 7 });
  const ca = new X509Certificate(material.caCertificatePem);
  const server = new X509Certificate(material.serverCertificatePem);

  assert.equal(ca.ca, true);
  assert.equal(server.ca, false);
  assert.equal(ca.verify(ca.publicKey), true);
  assert.equal(server.verify(ca.publicKey), true);
  assert.equal(server.checkIssued(ca), true);
  assert.equal(server.checkIP("127.0.0.1"), "127.0.0.1");
  assert.equal(server.checkHost("localhost"), "localhost");
  assert.equal(server.checkIP("10.0.0.1"), undefined);
  assert.equal(server.checkHost("example.com"), undefined);
  assert.match(server.subject, /synthetic/);
  assert.equal(new Date(server.validFrom).getTime(), now.getTime() - 60 * 60 * 1000);
  assert.equal(new Date(server.validTo).getTime(), now.getTime() + 7 * 24 * 60 * 60 * 1000);
  assert.deepEqual(server.keyUsage, ["1.3.6.1.5.5.7.3.1"]);
});

test("every run produces fresh keys and serial numbers", () => {
  const first = createDevTlsMaterial();
  const second = createDevTlsMaterial();
  assert.notEqual(first.serverPrivateKeyPem, second.serverPrivateKeyPem);
  assert.notEqual(
    new X509Certificate(first.caCertificatePem).serialNumber,
    new X509Certificate(second.caCertificatePem).serialNumber
  );
});

test("rejects non-IPv4 subject alternative addresses", () => {
  assert.throws(() => createDevTlsMaterial({ ipAddresses: ["127.0.0.256"] }), /invalid IPv4/);
});

function handshake(material, options) {
  return new Promise((resolve, reject) => {
    const server = tls.createServer({
      cert: material.serverCertificatePem,
      key: material.serverPrivateKeyPem
    }, (socket) => socket.end("ok"));
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const client = tls.connect({ host: "127.0.0.1", port, rejectUnauthorized: true, ...options }, () => {
        client.once("data", (data) => {
          client.end();
          server.close();
          resolve(data.toString());
        });
      });
      client.once("error", (error) => {
        server.close();
        reject(error);
      });
    });
  });
}

test("completes a verified TLS handshake against 127.0.0.1 with only the dev CA trusted", async () => {
  const material = createDevTlsMaterial();
  assert.equal(await handshake(material, { ca: material.caCertificatePem }), "ok");
});

test("fails verification when the dev CA is not trusted", async () => {
  const material = createDevTlsMaterial();
  const other = createDevTlsMaterial();
  await assert.rejects(handshake(material, { ca: other.caCertificatePem }), /certificate/i);
});
