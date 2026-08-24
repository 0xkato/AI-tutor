import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateEvalArtifact } from "../scripts/validate-eval-artifact.mjs";
import { createInitialState } from "../src/model.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scenariosFile = path.join(repository, "evals", "scenarios.json");
const expectedScenarios = [
  "expert-edge",
  "novice-branches",
  "admitted-gap",
  "ambiguous-target",
  "misconception",
  "retry-repair-transfer",
  "contamination",
  "conflicting-source",
  "context-resume",
  "retention-regression",
  "cross-topic-reuse",
];
const dimensions = [
  "targetFidelity",
  "frontierAccuracy",
  "questionClarity",
  "leakageAvoidance",
  "assessmentAccuracy",
  "sourceSupport",
  "pacing",
  "persistence",
  "synthesis",
];

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function writeEvidence(root, relativePath, contents) {
  const file = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return {
    path: relativePath,
    bytes: Buffer.byteLength(contents),
    sha256: sha256(contents),
  };
}

function completeArtifact(root, overrides = {}) {
  const state = `${JSON.stringify(createInitialState({ now: "2026-08-24T08:00:00.000Z" }), null, 2)}\n`;
  const sourceLedger = `${JSON.stringify({ formatVersion: 1, sources: [] }, null, 2)}\n`;
  const files = {
    transcript: writeEvidence(root, "transcript.md", "# Transcript\n\nLearner and host exchange.\n"),
    stateSnapshot: writeEvidence(root, "state.json", state),
    sourceLedger: writeEvidence(root, "source-ledger.json", sourceLedger),
    renderedNote: writeEvidence(root, "rendered-note.md", "# Learning record\n\nDurable result.\n"),
  };
  const score = Object.fromEntries(
    dimensions.map((dimension) => [dimension, { score: 4, evidence: `${dimension} passed.` }]),
  );
  const artifact = {
    formatVersion: 1,
    suiteVersion: "1.0.0",
    scenario: { id: "expert-edge", version: 1 },
    host: "codex",
    sessionId: "session-eval-1",
    startedAt: "2026-08-24T08:00:00.000Z",
    completedAt: "2026-08-24T08:30:00.000Z",
    files,
    rubric: {
      dimensions: score,
      deterministicChecks: [
        { name: "canonical-state-valid", passed: true, evidence: "State schema validated." },
      ],
      contaminatedQuestions: [],
      criticalFailures: [],
      humanVerdict: {
        outcome: "pass",
        reviewer: "Human reviewer",
        reviewedAt: "2026-08-24T09:00:00.000Z",
        rationale: "The session was useful and trustworthy.",
      },
    },
    ...overrides,
  };
  fs.writeFileSync(path.join(root, "artifact.json"), `${JSON.stringify(artifact, null, 2)}\n`);
  return artifact;
}

test("behavioral suite defines every versioned release scenario", () => {
  const suite = JSON.parse(fs.readFileSync(scenariosFile, "utf8"));
  assert.equal(suite.formatVersion, 1);
  assert.equal(suite.suiteVersion, "1.0.0");
  assert.deepEqual(suite.scenarios.map((scenario) => scenario.id), expectedScenarios);
  for (const scenario of suite.scenarios) {
    assert.equal(scenario.version, 1);
    assert.equal(typeof scenario.target, "string");
    assert.equal(scenario.target.length > 0, true);
    assert.equal(Array.isArray(scenario.requiredBehaviors), true);
    assert.equal(scenario.requiredBehaviors.length > 0, true);
    assert.equal(Array.isArray(scenario.criticalFailures), true);
    assert.equal(scenario.criticalFailures.length > 0, true);
  }
});

test("rubric names every required quality dimension and contamination boundary", () => {
  const rubric = fs.readFileSync(path.join(repository, "evals", "rubric.md"), "utf8");
  for (const dimension of dimensions) assert.match(rubric, new RegExp(`\\b${dimension}\\b`));
  assert.match(rubric, /contaminated question.*excluded.*evidence/is);
  assert.match(rubric, /critical failure/is);
  assert.match(rubric, /human verdict/is);
});

test("complete, hashed, human-adjudicated artifacts validate", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-eval-complete-"));
  completeArtifact(root);

  const result = validateEvalArtifact(root);
  assert.equal(result.valid, true);
  assert.equal(result.accepted, true);
  assert.equal(result.scenarioId, "expert-edge");
  assert.equal(result.host, "codex");
});

test("validator rejects each missing or tampered evidence file", () => {
  for (const role of ["transcript", "stateSnapshot", "sourceLedger", "renderedNote"]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `adaptive-eval-missing-${role}-`));
    const artifact = completeArtifact(root);
    fs.unlinkSync(path.join(root, artifact.files[role].path));
    assert.throws(
      () => validateEvalArtifact(root),
      (error) => error.code === "MISSING_EVAL_FILE" && error.message.includes(role),
    );
  }

  const tampered = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-eval-tampered-"));
  const artifact = completeArtifact(tampered);
  fs.appendFileSync(path.join(tampered, artifact.files.transcript.path), "changed\n");
  assert.throws(
    () => validateEvalArtifact(tampered),
    (error) => error.code === "EVAL_FILE_MISMATCH",
  );
});

test("validator rejects missing rubric dimensions and human verdicts", () => {
  const missingDimension = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-eval-dimension-"));
  const artifact = completeArtifact(missingDimension);
  delete artifact.rubric.dimensions.pacing;
  fs.writeFileSync(
    path.join(missingDimension, "artifact.json"),
    `${JSON.stringify(artifact, null, 2)}\n`,
  );
  assert.throws(
    () => validateEvalArtifact(missingDimension),
    (error) => error.code === "INVALID_RUBRIC_FIELD" && error.message.includes("pacing"),
  );

  const missingVerdict = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-eval-verdict-"));
  const withoutVerdict = completeArtifact(missingVerdict);
  delete withoutVerdict.rubric.humanVerdict;
  fs.writeFileSync(
    path.join(missingVerdict, "artifact.json"),
    `${JSON.stringify(withoutVerdict, null, 2)}\n`,
  );
  assert.throws(
    () => validateEvalArtifact(missingVerdict),
    (error) => error.code === "INVALID_HUMAN_VERDICT",
  );
});

test("contaminated questions cannot count as successful evidence", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-eval-contaminated-"));
  const artifact = completeArtifact(root);
  artifact.rubric.contaminatedQuestions.push({
    questionId: "q-4",
    reason: "The host revealed the answer.",
    excludedFromEvidence: false,
  });
  fs.writeFileSync(path.join(root, "artifact.json"), `${JSON.stringify(artifact, null, 2)}\n`);

  assert.throws(
    () => validateEvalArtifact(root),
    (error) => error.code === "CONTAMINATED_EVIDENCE",
  );
});

test("failed but complete artifacts remain valid records and block acceptance", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-eval-failed-"));
  const artifact = completeArtifact(root);
  artifact.rubric.criticalFailures.push({
    code: "ANSWER_LEAKAGE",
    description: "The host exposed the answer before the learner's retry.",
    evidence: "Transcript lines 40-45.",
  });
  artifact.rubric.humanVerdict = {
    outcome: "fail",
    reviewer: "Human reviewer",
    reviewedAt: "2026-08-24T09:00:00.000Z",
    rationale: "The session is not trustworthy evidence.",
  };
  fs.writeFileSync(path.join(root, "artifact.json"), `${JSON.stringify(artifact, null, 2)}\n`);

  const record = validateEvalArtifact(root, { requirePass: false });
  assert.equal(record.valid, true);
  assert.equal(record.accepted, false);
  assert.throws(
    () => validateEvalArtifact(root),
    (error) => error.code === "EVAL_NOT_ACCEPTED",
  );
});

test("pending human review remains a valid record but cannot satisfy release acceptance", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-eval-pending-"));
  const artifact = completeArtifact(root);
  artifact.rubric.humanVerdict = {
    outcome: "pending",
    reviewer: "Pending human review",
    reviewedAt: null,
    rationale: "The evidence package is complete and awaiting a human verdict.",
  };
  fs.writeFileSync(path.join(root, "artifact.json"), `${JSON.stringify(artifact, null, 2)}\n`);

  const record = validateEvalArtifact(root, { requirePass: false });
  assert.equal(record.valid, true);
  assert.equal(record.accepted, false);
  assert.throws(
    () => validateEvalArtifact(root),
    (error) => error.code === "EVAL_NOT_ACCEPTED",
  );
});
