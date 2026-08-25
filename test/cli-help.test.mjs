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
    "start-review-checkpoint",
    "defer-review",
    "close-review",
    "close",
  ]) {
    assert.match(result.stdout, new RegExp(`\\b${command}\\b`));
  }
});

test("review-checkpoint help makes the pre-answer persistence contract explicit", () => {
  const commandHelp = spawnSync(
    process.execPath,
    [cli, "start-review-checkpoint", "--help"],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(commandHelp.status, 0, commandHelp.stderr);
  assert.match(commandHelp.stdout, /persist.*retention question.*before.*learner answer/i);
  assert.match(commandHelp.stdout, /--question-id <value>\s+Stable review question identifier/);
  assert.match(commandHelp.stdout, /--node <value>\s+Selected review concept node identifier/);
  assert.match(commandHelp.stdout, /--kind <value>\s+Retention or transfer question kind/);
  assert.match(commandHelp.stdout, /--question <value>\s+Exact question shown to the learner/);
  assert.doesNotMatch(commandHelp.stdout, /undefined/);
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
  assert.equal(version.stdout.trim(), "0.2.0-rc.2");

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

test("admitted-gap help describes ungraded learner evidence without undefined text", () => {
  const commandHelp = spawnSync(
    process.execPath,
    [cli, "record-admitted-gap", "--help"],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(commandHelp.status, 0, commandHelp.stderr);
  assert.match(commandHelp.stdout, /ungraded probe or active-checkpoint gap/i);
  assert.match(commandHelp.stdout, /--question-id <value>\s+Exact active checkpoint question identifier.*synthesis/);
  assert.match(commandHelp.stdout, /--statement <value>\s+Learner's exact admitted-gap statement/);
  assert.match(commandHelp.stdout, /--evidence <value>\s+Evidence locating the admitted knowledge gap/);
  assert.doesNotMatch(commandHelp.stdout, /undefined/);
  assert.doesNotMatch(commandHelp.stdout, /Exact assessment evidence/);
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
