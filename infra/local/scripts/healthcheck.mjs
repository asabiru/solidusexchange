// Container healthcheck: GET a loopback HTTP route or open a loopback TCP port.
import { randomBytes } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TIMEOUT_MS = 3_000;

// customer-api requires a lowercase UUIDv7 X-Request-Id on every request.
export function uuidV7(nowMs = Date.now()) {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(nowMs, 0, 6);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function probeTcp(target, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: target.hostname, port: Number(target.port) });
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      socket.end();
      resolve();
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("tcp healthcheck timed out"));
    });
    socket.once("error", () => reject(new Error("tcp healthcheck failed")));
  });
}

async function probeHttp(target, timeoutMs) {
  let response;
  try {
    response = await fetch(target, {
      headers: { "x-request-id": uuidV7() },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual"
    });
    await response.arrayBuffer();
  } catch {
    throw new Error("http healthcheck failed");
  }
  if (response.status !== 200) throw new Error(`healthcheck status ${response.status}`);
}

export async function probe(text, { timeoutMs = TIMEOUT_MS } = {}) {
  let target;
  try {
    target = new URL(text);
  } catch {
    throw new Error("healthcheck target must be a URL");
  }
  if (target.hostname !== "127.0.0.1") throw new Error("healthcheck targets must be 127.0.0.1");
  if (target.protocol === "tcp:") return probeTcp(target, timeoutMs);
  if (target.protocol === "http:") return probeHttp(target, timeoutMs);
  throw new Error("healthcheck targets must use http: or tcp:");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await probe(process.argv[2] ?? "");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "healthcheck failed");
    process.exitCode = 1;
  }
}
