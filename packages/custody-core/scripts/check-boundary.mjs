import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(root, "..", "..");
const policy = JSON.parse(readFileSync(join(root, "custody-policy.json"), "utf8"));
const read = (path) => readFileSync(join(repositoryRoot, path), "utf8");

assert.equal(policy.runtime_boundary, "dev-dry-run");
assert.equal(policy.execution_authority, false);
assert.equal(policy.production_signing_enabled, false);
assert.equal(policy.key_material_allowed, false);
assert(policy.minimum_approvals >= 2);
assert(policy.required_approval_roles.includes("custody_maker"));
assert(policy.required_approval_roles.includes("custody_checker"));
assert(policy.allowed_assets.every(({ network }) =>
  network.endsWith("_TESTNET")
));

const source = read("packages/custody-core/src/unsigned-intent.mjs");
for (const required of [
  "maker and checker must be different humans",
  "intent_digest does not match command and policy",
  "production signing must remain disabled",
  "contains restricted custody material",
  'status: "unsigned_intent_ready"',
  "execution_authority: false"
]) {
  assert(source.includes(required), `Custody source is missing evidence: ${required}`);
}

const tests = read("packages/custody-core/tests/unsigned-intent.test.mjs");
for (const required of [
  "rejects missing maker-checker quorum",
  "rejects the same human as maker and checker",
  "rejects approval evidence bound to another intent",
  "rejects approval evidence after custody policy drift",
  "rejects raw addresses and key material",
  "rejects production execution or signing policy",
  "rejects custody policy containing key material"
]) {
  assert(tests.includes(required), `Custody tests are missing evidence: ${required}`);
}

const readme = read("packages/custody-core/README.md");
for (const required of [
  "No private keys, mnemonic, seed, signature or raw transaction",
  "This package cannot sign or broadcast transactions",
  "D-002 and D-003 remain `Open`"
]) {
  assert(readme.includes(required), `Custody README is missing boundary: ${required}`);
}

const adr = read("Documentation/regulated-core/adr/0003-isolate-custody-signing-boundary.md");
for (const required of [
  "Status: Proposed",
  "No process outside the signer boundary receives private key material",
  "does not authorize production signing"
]) {
  assert(adr.includes(required), `Custody ADR is missing boundary: ${required}`);
}

const workflow = read(".github/workflows/custody-core-ci.yml");
assert(workflow.includes("npm run verify"));
assert(workflow.includes("npm audit --audit-level=moderate"));

console.log("custody-boundary-ok");
