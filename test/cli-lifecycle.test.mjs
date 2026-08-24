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

test("an admitted gap can complete diagnosis without creating a false assessment or retry", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-admitted-gap-"));
  run(root, "init", "--now", "2026-08-24T12:59:00.000Z");
  run(
    root,
    "start",
    "--id",
    "session-admitted-gap",
    "--topic",
    "Gradient accumulation",
    "--target",
    "Explain why shared branch contributions add",
    "--context",
    "The learner explicitly says this mechanism is not understood",
    "--now",
    "2026-08-24T13:00:00.000Z",
  );

  run(
    root,
    "record-admitted-gap",
    "--id",
    "gap-shared-branches",
    "--node",
    "shared-gradient-accumulation",
    "--statement",
    "I understand the chain rule but not why contributions from multiple downstream uses add.",
    "--evidence",
    "The learner explicitly identified shared-branch accumulation as the missing causal connection before any mechanism question was asked.",
    "--now",
    "2026-08-24T13:00:00.001Z",
  );
  run(
    root,
    "finish-probe",
    "--summary",
    "The chain rule is the demonstrated foundation; shared-gradient-accumulation is an admitted gap that must be taught before testing.",
    "--now",
    "2026-08-24T13:00:00.002Z",
  );

  const state = JSON.parse(
    fs.readFileSync(path.join(root, ".adaptive-learning", "state.json"), "utf8"),
  );
  const session = state.sessions["session-admitted-gap"];
  const [gap] = session.admittedGaps;
  const concept = state.concepts[gap.conceptId];

  assert.equal(session.phase, "plan");
  assert.deepEqual(session.assessments, []);
  assert.equal(session.admittedGaps.length, 1);
  assert.equal(gap.id, "gap-shared-branches");
  assert.equal(gap.nodeId, "shared-gradient-accumulation");
  assert.equal(concept.status, "gap");
  assert.equal(concept.latestGrade, null);
  assert.deepEqual(concept.evidenceIds, []);
  assert.equal(concept.retry, null);
  assert.equal(state.reviews[concept.reviewId].status, "inactive");
});
