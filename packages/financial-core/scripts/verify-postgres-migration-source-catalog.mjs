import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const expectedSources = [
  [
    "0001_ledger_foundation.sql",
    "e4765a7155cfc6d7eba84c7b9310ba8bc49ee5cfc6c901588bd560f8a39e0315"
  ],
  [
    "0002_ledger_verification_views.sql",
    "58701b1b17cfb8eb6b4636ab9266e7357e0006209a1a95c56af2180ab6582b4c"
  ],
  [
    "0003_ledger_acceptance_seal.sql",
    "b91da31410f56298dca95d5cc9d10fbf0337942ae8b1de807d5c006330d82c75"
  ],
  [
    "0004_ledger_truncate_guard.sql",
    "4710145645cccfe36608d03baa2f84cfa77efd3098a096686fc03025749cc43e"
  ],
  [
    "0005_ledger_trigger_replication_guard.sql",
    "7387c5040b4206096c78b1e1efd0e7a665e11d928abda6f40d084f9cbb1ef19a"
  ],
  [
    "0006_ledger_invariant_replication_guard.sql",
    "29528d9031569ecd4f224302139a11ef10cf37fe5c2fa8d3ba80634051b3cb25"
  ],
  [
    "0007_ledger_replica_reference_guard.sql",
    "a224d30169d82489f4633348e9a11874737a95622f47c4d97bca9a2112fb80d9"
  ],
  [
    "0008_ledger_acceptance_artifact_guard.sql",
    "9c220bce976be1e70845d33cb734af792f81ffe559600106e86572622739237b"
  ],
  [
    "0009_ledger_acceptance_timeline_guard.sql",
    "092dc689f0f03f9b61b91a701ae3af26cca3403f5272bcb6e759265867bd96fb"
  ],
  [
    "0010_ledger_finite_timestamp_guard.sql",
    "d316bbda7a842a584edc2c142314e2761365a12d68889938d851d66fc97bf460"
  ],
  [
    "0011_ledger_migration_sequence_guard.sql",
    "38edd8511b337a53acae0225afe57bba9151fb22c32c0f85689c78b4c7e7747f"
  ]
];

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationDirectory = resolve(process.argv[2] ?? join(root, "migrations"));
const actualNames = readdirSync(migrationDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const expectedNames = expectedSources.map(([name]) => name);

assert.deepStrictEqual(
  actualNames,
  expectedNames,
  "PostgreSQL migration source files differ from canonical manifest"
);

for (const [name, expectedSha256] of expectedSources) {
  const actualSha256 = createHash("sha256")
    .update(readFileSync(join(migrationDirectory, name)))
    .digest("hex");
  assert.equal(
    actualSha256,
    expectedSha256,
    `PostgreSQL migration source digest differs for ${name}`
  );
}

console.log("postgres-migration-source-catalog-ok");
