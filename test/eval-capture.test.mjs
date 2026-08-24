import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { packageEvalArtifact } from "../scripts/package-eval-artifact.mjs";
import { validateEvalArtifact } from "../scripts/validate-eval-artifact.mjs";
import { createInitialState } from "../src/model.mjs";

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
const scriptFile = fileURLToPath(new URL("../scripts/package-eval-artifact.mjs", import.meta.url));

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-eval-capture-"));
  const sources = path.join(root, "sources");
  const outputParent = path.join(root, "artifacts");
  fs.mkdirSync(sources);
  fs.mkdirSync(outputParent);

  const state = Buffer.from(
    `${JSON.stringify(createInitialState({ now: "2026-08-24T08:00:00.000Z" }), null, 2)}\n`,
  );
  const evidence = {
    transcript: path.join(sources, "host-transcript.md"),
    stateSnapshot: path.join(sources, "live-state.json"),
    sourceLedger: path.join(sources, "sources.json"),
    renderedNote: path.join(sources, "session-note.md"),
  };
  fs.writeFileSync(evidence.transcript, "# Transcript\n\nUnedited live exchange.\n");
  fs.writeFileSync(evidence.stateSnapshot, state);
  fs.writeFileSync(
    evidence.sourceLedger,
    `${JSON.stringify({ formatVersion: 1, sources: [] }, null, 2)}\n`,
  );
  fs.writeFileSync(evidence.renderedNote, "# Session note\n\nFinal generated view.\n");

  const scores = Object.fromEntries(
    dimensions.map((dimension) => [
      dimension,
      { score: 4, evidence: `${dimension} evidence is recorded in the transcript.` },
    ]),
  );
  const draft = {
    formatVersion: 1,
    suiteVersion: "1.0.0",
    scenario: { id: "context-resume", version: 1 },
    host: "codex",
    sessionId: "session-capture-1",
    startedAt: "2026-08-24T08:00:00.000Z",
    completedAt: "2026-08-24T08:30:00.000Z",
    rubric: {
      dimensions: scores,
      deterministicChecks: [
        { name: "canonical-state-valid", passed: true, evidence: "State schema validated." },
      ],
      contaminatedQuestions: [],
      criticalFailures: [],
      humanVerdict: {
        outcome: "pending",
        reviewer: "Pending human review",
        reviewedAt: null,
        rationale: "The frozen package is awaiting independent review.",
      },
    },
  };
  const draftFile = path.join(sources, "artifact-draft.json");
  fs.writeFileSync(draftFile, `${JSON.stringify(draft, null, 2)}\n`);
  return {
    root,
    output: path.join(outputParent, "2026-08-24-codex-context-resume"),
    draft,
    draftFile,
    evidence,
    state,
  };
}

test("packaging freezes byte-exact evidence and emits a structurally valid pending artifact", () => {
  const input = fixture();
  const result = packageEvalArtifact({
    outputDirectory: input.output,
    draft: input.draft,
    evidence: input.evidence,
    capturedAt: "2026-08-24T08:31:00.000Z",
  });

  fs.writeFileSync(input.evidence.stateSnapshot, "later mutation\n");

  const capturedState = fs.readFileSync(path.join(input.output, "state.json"));
  const artifact = JSON.parse(fs.readFileSync(path.join(input.output, "artifact.json"), "utf8"));
  const capture = JSON.parse(fs.readFileSync(path.join(input.output, "capture.json"), "utf8"));
  assert.deepEqual(capturedState, input.state);
  assert.equal(artifact.files.stateSnapshot.bytes, input.state.length);
  assert.equal(artifact.files.stateSnapshot.sha256, sha256(input.state));
  assert.equal(capture.capturedAt, "2026-08-24T08:31:00.000Z");
  assert.equal(capture.files.stateSnapshot.sha256, sha256(input.state));
  assert.equal(result.valid, true);
  assert.equal(result.accepted, false);
  assert.equal(validateEvalArtifact(input.output, { requirePass: false }).valid, true);
});

test("packaging refuses to overwrite an existing artifact directory", () => {
  const input = fixture();
  fs.mkdirSync(input.output);
  fs.writeFileSync(path.join(input.output, "keep.txt"), "keep\n");

  assert.throws(
    () => packageEvalArtifact({
      outputDirectory: input.output,
      draft: input.draft,
      evidence: input.evidence,
    }),
    (error) => error.code === "EVAL_OUTPUT_EXISTS",
  );
  assert.equal(fs.readFileSync(path.join(input.output, "keep.txt"), "utf8"), "keep\n");
});

test("packaging rejects invalid or linked source evidence before creating output", () => {
  const invalid = fixture();
  fs.writeFileSync(invalid.evidence.stateSnapshot, "not json\n");
  assert.throws(
    () => packageEvalArtifact({
      outputDirectory: invalid.output,
      draft: invalid.draft,
      evidence: invalid.evidence,
    }),
    (error) => error.code === "INVALID_STATE_SNAPSHOT",
  );
  assert.equal(fs.existsSync(invalid.output), false);

  const linked = fixture();
  const realTranscript = linked.evidence.transcript;
  const transcriptLink = path.join(path.dirname(realTranscript), "transcript-link.md");
  fs.symlinkSync(realTranscript, transcriptLink);
  linked.evidence.transcript = transcriptLink;
  assert.throws(
    () => packageEvalArtifact({
      outputDirectory: linked.output,
      draft: linked.draft,
      evidence: linked.evidence,
    }),
    (error) => error.code === "INVALID_EVAL_SOURCE",
  );
  assert.equal(fs.existsSync(linked.output), false);
});

test("packaging command freezes the documented evidence arguments", () => {
  const input = fixture();
  const run = spawnSync(
    process.execPath,
    [
      scriptFile,
      "--draft", input.draftFile,
      "--output", input.output,
      "--transcript", input.evidence.transcript,
      "--state", input.evidence.stateSnapshot,
      "--source-ledger", input.evidence.sourceLedger,
      "--rendered-note", input.evidence.renderedNote,
    ],
    { encoding: "utf8" },
  );

  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).valid, true);
  assert.equal(fs.existsSync(path.join(input.output, "capture.json")), true);
});

test("packaging command rejects unknown and duplicate scalar options", () => {
  const unknown = spawnSync(process.execPath, [scriptFile, "--unknown", "value"], {
    encoding: "utf8",
  });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /INVALID_EVAL_OPTION/);

  const input = fixture();
  const duplicate = spawnSync(
    process.execPath,
    [
      scriptFile,
      "--draft", input.draftFile,
      "--draft", input.draftFile,
      "--output", input.output,
      "--transcript", input.evidence.transcript,
      "--state", input.evidence.stateSnapshot,
      "--source-ledger", input.evidence.sourceLedger,
      "--rendered-note", input.evidence.renderedNote,
    ],
    { encoding: "utf8" },
  );
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /INVALID_EVAL_OPTION.*Duplicate option/);
  assert.equal(fs.existsSync(input.output), false);
});
