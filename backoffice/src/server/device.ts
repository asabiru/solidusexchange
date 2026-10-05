import { createHash, randomUUID } from "node:crypto";

const deviceIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isDeviceId(value: unknown): value is string {
  return typeof value === "string" && deviceIdPattern.test(value);
}

export function createDeviceId(): string {
  return randomUUID();
}

export function deviceDigest(deviceId: string): string {
  return createHash("sha256")
    .update(`solidchange-operator-device:v1:${deviceId}`)
    .digest("hex");
}
