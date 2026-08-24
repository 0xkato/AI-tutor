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
    "record-admitted-gap",
    "finish-probe",
    "add-source",
    "set-plan",
    "begin-teach",
    "record-step",
    "record-assessment",
    "start-synthesis",
    "record-synthesis",
    "add-visual",
    "doctor",
    "backup",
    "restore",
    "export",
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

test("version and command-specific help are available without reading state", () => {
  const version = spawnSync(process.execPath, [cli, "--version"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), "0.1.0");

  const commandHelp = spawnSync(process.execPath, [cli, "start", "--help"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(commandHelp.status, 0, commandHelp.stderr);
  assert.match(commandHelp.stdout, /Usage: adaptive-learn start/);
  assert.match(commandHelp.stdout, /--topic/);
  assert.match(commandHelp.stdout, /--target/);
  assert.doesNotMatch(commandHelp.stdout, /--source-class/);
});

test("commands reject unknown options and duplicate scalar options", () => {
  const root = path.join(repoRoot, ".does-not-need-to-exist");
  const unknown = spawnSync(process.execPath, [cli, "status", "--root", root, "--bogus", "x"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /\[UNKNOWN_OPTION\].*--bogus/);

  const duplicate = spawnSync(
    process.execPath,
    [cli, "status", "--root", root, "--root", root],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /\[DUPLICATE_OPTION\].*--root/);

  const commandScalar = spawnSync(
    process.execPath,
    [cli, "defer-review", "--root", root, "--review", "one", "--review", "two"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(commandScalar.status, 1);
  assert.match(commandScalar.stderr, /\[DUPLICATE_OPTION\].*--review/);

  const repeatable = spawnSync(
    process.execPath,
    [cli, "close", "--root", root, "--gap", "one", "--gap", "two"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(repeatable.status, 1);
  assert.doesNotMatch(repeatable.stderr, /DUPLICATE_OPTION/);
});
