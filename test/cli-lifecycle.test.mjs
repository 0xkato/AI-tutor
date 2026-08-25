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

test("learner profile commands persist preferences atomically and render them to Obsidian", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-profile-cli-"));
  run(root, "init", "--now", "2026-08-24T08:00:00.000Z");

  const initial = JSON.parse(run(root, "profile", "--json"));
  assert.equal(initial.teachingPhilosophy, "");
  assert.equal(initial.updatedAt, null);

  const updated = JSON.parse(
    run(
      root,
      "set-profile",
      "--teaching-philosophy",
      "Build causal understanding before testing; use transfer rather than repetition.",
      "--explanation-preferences",
      "One motivated reasoning step at a time with exact premises.",
      "--feedback-preferences",
      "Grade only the explicit question and identify the exact missing mechanism.",
      "--visual-preferences",
      "Use a diagram only when it materially clarifies a relationship.",
      "--source-preferences",
      "Prefer primary sources and preserve uncertainty.",
      "--now",
      "2026-08-24T08:01:00.000Z",
      "--json",
    ),
  );
  assert.match(updated.teachingPhilosophy, /causal understanding/);
  assert.equal(updated.updatedAt, "2026-08-24T08:01:00.000Z");

  const state = JSON.parse(
    fs.readFileSync(path.join(root, ".adaptive-learning", "state.json"), "utf8"),
  );
  assert.equal(state.revision, 1);
  assert.deepEqual(JSON.parse(run(root, "profile", "--json")), state.learnerProfile);
  assert.match(fs.readFileSync(path.join(root, "vault", "Profile.md"), "utf8"), /causal understanding/);
  assert.match(fs.readFileSync(path.join(root, "vault", "Home.md"), "utf8"), /\[\[Profile\|Learner profile\]\]/);
});

test("an invalid learner profile update preserves canonical state", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-profile-invalid-"));
  run(root, "init", "--now", "2026-08-24T08:00:00.000Z");
  const before = fs.readFileSync(path.join(root, ".adaptive-learning", "state.json"), "utf8");

  const result = spawnSync(
    process.execPath,
    [cli, "set-profile", "--root", root, "--json"],
    { cwd: repository, encoding: "utf8" },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PROFILE_UPDATE_REQUIRED/);
  assert.equal(fs.readFileSync(path.join(root, ".adaptive-learning", "state.json"), "utf8"), before);
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

test("init rejects an unsafe vault directory before creating canonical state", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-cli-invalid-vault-"));
  const result = spawnSync(
    process.execPath,
    [cli, "init", "--vault-dir", "../outside", "--root", root],
    { cwd: repository, encoding: "utf8" },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[INVALID_VAULT\].*vault directory/i);
  assert.equal(fs.existsSync(path.join(root, ".adaptive-learning", "state.json")), false);
  assert.equal(fs.existsSync(path.join(path.dirname(root), "outside")), false);
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

test("a plain-text teaching checkpoint can persist I don't know without a false assessment", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-teach-gap-cli-"));
  run(root, "init", "--now", "2026-08-25T08:00:00.000Z");
  run(
    root,
    "start",
    "--id",
    "session-teach-gap-cli",
    "--topic",
    "Transformers",
    "--target",
    "Explain how token representations become contextual",
    "--now",
    "2026-08-25T08:01:00.000Z",
  );
  run(
    root,
    "record-admitted-gap",
    "--id",
    "probe-token-representations-gap",
    "--node",
    "token-representations",
    "--statement",
    "I do not yet know how repeated token embeddings can later become different.",
    "--evidence",
    "The learner explicitly identified contextual token representations as the first missing mechanism.",
    "--now",
    "2026-08-25T08:02:00.000Z",
  );
  run(
    root,
    "finish-probe",
    "--summary",
    "Token representations are an admitted gap that must be taught before testing.",
    "--now",
    "2026-08-25T08:03:00.000Z",
  );

  const planPath = path.join(root, "transformers-plan.json");
  fs.writeFileSync(planPath, `${JSON.stringify({
    targetNodeId: "token-representations",
    nodes: [{ id: "token-representations", title: "Token representations" }],
    edges: [],
  }, null, 2)}\n`);
  run(root, "set-plan", "--file", planPath, "--now", "2026-08-25T08:04:00.000Z");
  run(root, "begin-teach", "--now", "2026-08-25T08:05:00.000Z");
  run(
    root,
    "record-step",
    "--id",
    "token-representations-step-1",
    "--node",
    "token-representations",
    "--foundation",
    "A token ID first selects one learned embedding vector.",
    "--motivation",
    "The model still needs surrounding tokens to change what that occurrence represents.",
    "--explanation",
    "Contextual mixing can transform equal initial embeddings into different later representations.",
    "--question-id",
    "token-representations-transfer-1",
    "--kind",
    "transfer",
    "--question",
    "What is initially the same for two occurrences of bank, and what can later differ?",
    "--now",
    "2026-08-25T08:06:00.000Z",
  );

  const statePath = path.join(root, ".adaptive-learning", "state.json");
  const beforeMismatch = fs.readFileSync(statePath, "utf8");
  const mismatch = spawnSync(
    process.execPath,
    [
      cli,
      "record-admitted-gap",
      "--root",
      root,
      "--id",
      "wrong-checkpoint-gap",
      "--question-id",
      "different-question",
      "--node",
      "token-representations",
      "--statement",
      "I don't know this mechanism.",
      "--evidence",
      "This input intentionally uses the wrong persisted checkpoint identity.",
    ],
    { cwd: repository, encoding: "utf8" },
  );
  assert.notEqual(mismatch.status, 0);
  assert.match(mismatch.stderr, /CHECKPOINT_IDENTITY_MISMATCH/);
  assert.equal(fs.readFileSync(statePath, "utf8"), beforeMismatch);

  run(
    root,
    "record-admitted-gap",
    "--id",
    "token-representations-transfer-gap-1",
    "--node",
    "token-representations",
    "--statement",
    "I don't know what remains the same before attention or what can later differ.",
    "--evidence",
    "The learner explicitly selected I don't know for the persisted token-representation transfer checkpoint.",
    "--now",
    "2026-08-25T08:07:00.000Z",
  );

  const state = JSON.parse(
    fs.readFileSync(statePath, "utf8"),
  );
  const session = state.sessions["session-teach-gap-cli"];
  const concept = state.concepts[session.conceptIds[0]];

  assert.equal(session.assessments.length, 0);
  assert.equal(session.checkpointGaps.length, 1);
  assert.deepEqual(session.checkpointGaps[0], {
    id: "token-representations-transfer-gap-1",
    stage: "teach",
    nodeId: "token-representations",
    conceptId: concept.id,
    questionId: "token-representations-transfer-1",
    question: "What is initially the same for two occurrences of bank, and what can later differ?",
    kind: "transfer",
    statement: "I don't know what remains the same before attention or what can later differ.",
    evidence: "The learner explicitly selected I don't know for the persisted token-representation transfer checkpoint.",
    createdAt: "2026-08-25T08:07:00.000Z",
  });
  assert.equal(session.activeStepId, "token-representations-step-1");
  assert.equal(session.checkpoint.status, "new-transfer-required");
  assert.equal(session.checkpoint.priorQuestionId, "token-representations-transfer-1");
  assert.equal(session.checkpoint.mistakeType, "admitted-gap");
  assert.equal(concept.status, "gap");
  assert.equal(concept.retry.status, "new-transfer-required");
  assert.equal(concept.retry.answerMayBeTaught, true);
  assert.equal(concept.retry.requiresNewTransfer, true);
  assert.equal(concept.latestGrade, null);

  const sessionFile = fs.readdirSync(path.join(root, "vault", "Sessions"))[0];
  const rendered = fs.readFileSync(path.join(root, "vault", "Sessions", sessionFile), "utf8");
  assert.match(rendered, /Admitted checkpoint gaps/);
  assert.match(rendered, /I don't know what remains the same before attention/);
});
