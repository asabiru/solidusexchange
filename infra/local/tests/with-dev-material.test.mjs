import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/with-dev-material.sh", import.meta.url));

async function withDirectory(run) {
  const directory = await mkdtemp(path.join(tmpdir(), "with-dev-material-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function run(directory, args) {
  return execFileSync("sh", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, SOLIDCHANGE_DEV_MATERIAL_DIR: directory },
  });
}

function failure(directory, args) {
  try {
    run(directory, args);
  } catch (error) {
    return { status: error.status, stderr: error.stderr };
  }
  return { status: 0, stderr: "" };
}

test("exports each NAME from its material file and runs the command", async () => {
  await withDirectory(async (directory) => {
    await writeFile(path.join(directory, "token.key"), "abc123\n");
    await writeFile(path.join(directory, "other.key"), "a\nb\n");
    const output = run(directory, [
      "API=@token.key",
      "B=@other.key",
      "--",
      "sh",
      "-c",
      "printf '%s|%s' \"$API\" \"$B\"",
    ]);
    assert.equal(output, "abc123|a\nb");
  });
});

test("arguments after -- are passed through, not parsed as assignments", async () => {
  await withDirectory(async (directory) => {
    await writeFile(path.join(directory, "token.key"), "abc123\n");
    const output = run(directory, [
      "API=@token.key",
      "--",
      "sh",
      "-c",
      "printf '%s-%s' \"$1\" \"$API\"",
      "sh",
      "C=@token.key",
    ]);
    assert.equal(output, "C=@token.key-abc123");
  });
});

test("rejects invalid variable names with status 64", async () => {
  await withDirectory(async (directory) => {
    await writeFile(path.join(directory, "token.key"), "abc123\n");
    for (const arg of ["api=@token.key", "API-KEY=@token.key", "=@token.key"]) {
      const { status, stderr } = failure(directory, [arg, "--", "sh", "-c", "true"]);
      assert.equal(status, 64, arg);
      assert.match(stderr, /invalid variable name/);
    }
    const exported = failure(directory, ["9X=@token.key", "--", "sh", "-c", "true"]);
    assert.notEqual(exported.status, 0);
  });
});

test("rejects material file names outside the volume", async () => {
  await withDirectory(async (directory) => {
    await writeFile(path.join(directory, "token.key"), "abc123\n");
    for (const arg of ["A=@../escape", "A=@a/b", "A=@.hidden", "A=@.", "A=@"]) {
      const { status, stderr } = failure(directory, [arg, "--", "sh", "-c", "true"]);
      assert.equal(status, 64, arg);
      assert.match(stderr, /invalid material file name/);
    }
  });
});

test("requires the NAME=@file form and a command", async () => {
  await withDirectory(async (directory) => {
    await writeFile(path.join(directory, "token.key"), "abc123\n");
    const noAt = failure(directory, ["API=token.key", "--", "sh", "-c", "true"]);
    assert.equal(noAt.status, 64);
    assert.match(noAt.stderr, /expected NAME=@file/);
    const noCommand = failure(directory, ["API=@token.key", "--"]);
    assert.equal(noCommand.status, 64);
    assert.match(noCommand.stderr, /missing command/);
    const bare = failure(directory, ["API=@token.key"]);
    assert.equal(bare.status, 64);
    assert.match(bare.stderr, /missing command/);
  });
});

test("fails closed when the material file does not exist", async () => {
  await withDirectory(async (directory) => {
    const { status } = failure(directory, ["API=@missing.key", "--", "sh", "-c", "true"]);
    assert.equal(status, 1);
  });
});
