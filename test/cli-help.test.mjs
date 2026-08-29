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
    "add-material",
    "resolve-material",
    "continue-supplemental-only",
    "add-source",
    "record-source-coverage",
    "set-plan",
    "begin-teach",
    "record-step",
    "record-assessment",
    "recommend-next",
    "practice-plan",
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

test("adaptive-response help exposes strategy, confidence, and misconception evidence", () => {
  const startHelp = spawnSync(
    process.execPath,
    [cli, "start-question", "--help"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(startHelp.status, 0, startHelp.stderr);
  assert.match(startHelp.stdout, /--mode <value>\s+single-select, multi-select, or free-response/i);
  assert.match(startHelp.stdout, /--activity-type <value>/);
  assert.match(startHelp.stdout, /--support-level <value>/);
  assert.match(startHelp.stdout, /--transfer-level <value>/);

  const answerHelp = spawnSync(
    process.execPath,
    [cli, "answer-question", "--help"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(answerHelp.status, 0, answerHelp.stderr);
  assert.match(answerHelp.stdout, /--text-answer <value>\s+Learner's own words/i);
  assert.match(answerHelp.stdout, /--confidence <value>\s+Learner confidence from 0 to 100/i);
  assert.match(answerHelp.stdout, /--response-time-ms <value>/);

  const assessmentHelp = spawnSync(
    process.execPath,
    [cli, "record-assessment", "--help"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(assessmentHelp.status, 0, assessmentHelp.stderr);
  assert.match(assessmentHelp.stdout, /--misconception-statement <value>/);
  assert.match(assessmentHelp.stdout, /--resolve-misconception <value>.*repeatable/i);
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
  assert.match(commandHelp.stdout, /--material <value>.*repeatable/i);
  assert.doesNotMatch(commandHelp.stdout, /--source-class/);
});

test("source-guided command help exposes material and provenance boundaries", () => {
  const addMaterialHelp = spawnSync(
    process.execPath,
    [cli, "add-material", "--help"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(addMaterialHelp.status, 0, addMaterialHelp.stderr);
  assert.match(addMaterialHelp.stdout, /--reference <value>\s+Additional or replacement learning material/);

  const resolveHelp = spawnSync(
    process.execPath,
    [cli, "resolve-material", "--help"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(resolveHelp.status, 0, resolveHelp.stderr);
  assert.match(resolveHelp.stdout, /--material-id <value>\s+Learner-supplied material identifier/);
  assert.match(resolveHelp.stdout, /--status <value>\s+verified or unavailable/);
  assert.match(resolveHelp.stdout, /--evidence <value>\s+Exact material resolution evidence/);

  const sourceHelp = spawnSync(
    process.execPath,
    [cli, "add-source", "--help"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(sourceHelp.status, 0, sourceHelp.stderr);
  assert.match(sourceHelp.stdout, /--role <value>\s+Anchor material or supplemental research/);
  assert.match(sourceHelp.stdout, /--locator <value>\s+Exact timestamp, page, section, heading, or file location/);
  assert.match(sourceHelp.stdout, /--material-id <value>\s+Verified learner material linked by an anchor claim/);

  const coverageHelp = spawnSync(
    process.execPath,
    [cli, "record-source-coverage", "--help"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(coverageHelp.status, 0, coverageHelp.stderr);
  assert.match(coverageHelp.stdout, /--node <value>\s+Dependency-plan node supported by the source/);
  assert.match(coverageHelp.stdout, /--source-id <value>\s+Claim-level source identifier/);
  assert.match(coverageHelp.stdout, /--summary <value>\s+Bounded mechanism or claim supported/);

  const supplementalHelp = spawnSync(
    process.execPath,
    [cli, "continue-supplemental-only", "--help"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(supplementalHelp.status, 0, supplementalHelp.stderr);
  assert.match(supplementalHelp.stdout, /--reason <value>\s+Learner-approved reason for continuing without a verified anchor/);
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
