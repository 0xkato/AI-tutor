import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "bin", "learn.mjs");

test("help lists the complete learning-session lifecycle", () => {
  const result = spawnSync(process.execPath, [cli, "--help"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  for (const command of [
    "init",
    "start",
    "record-probe",
    "finish-probe",
    "add-source",
    "set-plan",
    "begin-teach",
    "record-step",
    "record-assessment",
    "add-visual",
    "status",
    "context",
    "due",
    "start-review",
    "defer-review",
    "close-review",
    "close",
  ]) {
    assert.match(result.stdout, new RegExp(`\\b${command}\\b`));
  }
});

test("unknown commands fail with a useful error", () => {
  const result = spawnSync(process.execPath, [cli, "invent"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown command: invent/);
  assert.match(result.stderr, /--help/);
});
