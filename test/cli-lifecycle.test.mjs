import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repository, "bin", "learn.mjs");

function run(root, ...args) {
  const result = spawnSync(process.execPath, [cli, ...args, "--root", root], {
    cwd: repository,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

test("independent CLI invocations initialize, mutate, render, and resume state", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-cli-"));
  run(root, "init", "--now", "2026-08-24T08:00:00.000Z");
  run(
    root,
    "start",
    "--id",
    "session-1",
    "--topic",
    "Gradient descent",
    "--target",
    "Understand one parameter update causally",
    "--context",
    "Knows derivatives",
    "--now",
    "2026-08-24T08:01:00.000Z",
  );

  const status = JSON.parse(run(root, "status", "--json"));
  assert.equal(status.active.id, "session-1");
  assert.equal(status.active.phase, "probe");
  assert.equal(status.active.target, "Understand one parameter update causally");
  assert.equal(fs.existsSync(path.join(root, ".adaptive-learning", "state.json")), true);
  assert.equal(fs.existsSync(path.join(root, "vault", "Home.md")), true);
  assert.match(
    fs.readdirSync(path.join(root, "vault", "Sessions"))[0],
    /^gradient-descent-[a-f0-9]{20}\.md$/,
  );
});

test("CLI failures preserve state and return structured error text", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-cli-error-"));
  run(root, "init");
  run(
    root,
    "start",
    "--id",
    "session-1",
    "--topic",
    "Vectors",
    "--target",
    "Understand vectors",
  );
  const before = fs.readFileSync(path.join(root, ".adaptive-learning", "state.json"), "utf8");
  const result = spawnSync(
    process.execPath,
    [cli, "finish-probe", "--summary", "No evidence", "--root", root],
    { cwd: repository, encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /INSUFFICIENT_PROBE_EVIDENCE/);
  assert.equal(fs.readFileSync(path.join(root, ".adaptive-learning", "state.json"), "utf8"), before);
});
