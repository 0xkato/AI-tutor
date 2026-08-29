import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repository, "bin", "learn.mjs");

function invoke(root, command, options = []) {
  const result = spawnSync(process.execPath, [cli, command, ...options, "--root", root], {
    cwd: repository,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${command}: ${result.stderr || result.stdout}`);
  return result.stdout;
}

test("complete adaptive session persists evidence, retry state, review, and Obsidian notes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-e2e-"));
  const at = "2026-08-24T08:00:00.000Z";
  const planPath = path.join(repository, "examples", "differential-forms-plan.json");

  invoke(root, "init", ["--now", at]);
  invoke(root, "start", [
    "--id", "s1",
    "--topic", "Differential forms",
    "--target", "Build a causal introduction to differential forms",
    "--context", "Comfortable with basic calculus",
    "--now", at,
  ]);
  invoke(root, "record-probe", [
    "--id", "probe-a1",
    "--question-id", "probe-q1",
    "--node", "vectors",
    "--kind", "explanation",
    "--question", "Which operations must vectors support?",
    "--answer", "Vector addition and scalar multiplication under the vector-space laws.",
    "--grade", "correct",
    "--evidence", "Named both vector-space operations and tied them to the required closure laws.",
    "--now", at,
  ]);
  invoke(root, "finish-probe", [
    "--summary", "Vectors are usable; covectors are the first missing prerequisite.",
    "--now", at,
  ]);
  invoke(root, "add-source", [
    "--id", "source-1",
    "--title", "Primary covector reference",
    "--url", "https://example.test/covectors",
    "--source-class", "primary",
    "--supports", "A covector is a linear functional from vectors to scalars.",
    "--verification", "Definition and assumptions were checked against an independent textbook.",
    "--now", at,
  ]);
  invoke(root, "set-plan", ["--file", planPath, "--now", at]);
  invoke(root, "begin-teach", ["--now", at]);
  invoke(root, "record-step", [
    "--id", "step-1",
    "--node", "covectors",
    "--foundation", "A linear map preserves vector addition and scalar multiplication.",
    "--motivation", "We need an object that measures a directed displacement linearly.",
    "--explanation", "A covector consumes a vector and produces a scalar while preserving linear combinations.",
    "--question-id", "teach-q1",
    "--kind", "transfer",
    "--question", "Describe a new linear displacement-measuring object.",
    "--now", at,
  ]);
  invoke(root, "record-assessment", [
    "--id", "teach-a1",
    "--question-id", "teach-q1",
    "--node", "covectors",
    "--stage", "teach",
    "--kind", "transfer",
    "--question", "Describe a new linear displacement-measuring object.",
    "--answer", "It consumes and returns vectors.",
    "--grade", "incorrect",
    "--evidence", "Correctly identified a vector input but incorrectly made the output another vector.",
    "--mistake-type", "output-type",
    "--now", at,
  ]);

  let status = JSON.parse(invoke(root, "status", ["--json"]));
  assert.equal(status.active.retry[0].answerMayBeTaught, false);
  assert.equal(status.active.activeStepId, "step-1");

  invoke(root, "record-assessment", [
    "--id", "teach-a2",
    "--question-id", "teach-q1",
    "--node", "covectors",
    "--stage", "teach",
    "--kind", "transfer",
    "--question", "Describe a new linear displacement-measuring object.",
    "--answer", "It consumes a vector, produces a scalar, and preserves linear combinations.",
    "--grade", "correct",
    "--evidence", "On the bounded retry, corrected the input-output types and preserved linearity for the same object.",
    "--now", at,
  ]);
  fs.mkdirSync(path.join(root, "vault", "Assets"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "vault", "Assets", "covector.svg"),
    "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>\n",
  );
  invoke(root, "add-visual", [
    "--id", "visual-1",
    "--path", "Assets/covector.svg",
    "--description", "Parallel level sets showing a covector acting on a vector.",
    "--verification", "Inspected labels, arrow direction, and consistency with the teaching explanation.",
    "--now", at,
  ]);
  invoke(root, "record-step", [
    "--id", "step-2",
    "--node", "forms",
    "--foundation", "A covector is a linear scalar-valued measurement of one vector.",
    "--motivation", "We need measurements that consume several vectors with orientation.",
    "--explanation", "A differential form generalizes the measurement to alternating multilinear inputs.",
    "--question-id", "teach-forms-q1",
    "--kind", "transfer",
    "--question", "Describe an oriented area measurement on two displacement vectors.",
    "--now", at,
  ]);
  invoke(root, "record-assessment", [
    "--id", "teach-forms-a1",
    "--question-id", "teach-forms-q1",
    "--node", "forms",
    "--stage", "teach",
    "--kind", "transfer",
    "--question", "Describe an oriented area measurement on two displacement vectors.",
    "--answer", "It consumes two vectors, returns a scalar, is multilinear, and changes sign when inputs swap.",
    "--grade", "correct",
    "--evidence", "Transferred alternating multilinear scalar measurement to an unfamiliar area example.",
    "--now", at,
  ]);
  invoke(root, "start-synthesis", [
    "--question-id", "synthesis-q1",
    "--question", "Connect vectors, covectors, and differential forms in one causal chain.",
    "--now", at,
  ]);
  invoke(root, "record-synthesis", [
    "--id", "synthesis-a1",
    "--question-id", "synthesis-q1",
    "--question", "Connect vectors, covectors, and differential forms in one causal chain.",
    "--answer", "Vectors are inputs to covectors, whose scalar linear measurements generalize to alternating multilinear forms.",
    "--grade", "correct",
    "--evidence", "Connected all planned nodes and preserved their input, output, linearity, and alternation roles.",
    "--now", at,
  ]);
  invoke(root, "close", [
    "--gap", "Alternating multilinearity still needs a later teaching step.",
    "--now", at,
  ]);

  status = JSON.parse(invoke(root, "status", ["--json"]));
  assert.equal(status.active, null);
  const due = JSON.parse(
    invoke(root, "due", ["--now", "2026-08-25T08:00:00.000Z", "--json"]),
  );
  assert.equal(due.reviews.some((item) => item.nodeId === "covectors"), true);

  const state = JSON.parse(
    fs.readFileSync(path.join(root, ".adaptive-learning", "state.json"), "utf8"),
  );
  const session = state.sessions.s1;
  const covectors = session.conceptIds
    .map((conceptId) => state.concepts[conceptId])
    .find((concept) => concept.key === "covectors");
  const review = state.reviews[covectors.reviewId];
  assert.equal(session.phase, "complete");
  assert.equal(session.assessments.length, 5);
  assert.equal(session.synthesisCheckpoint.resolvedEvidenceId, "synthesis-a1");
  assert.match(session.synthesis, /generalize to alternating multilinear forms/);
  assert.equal(covectors.retry, null);
  assert.equal(review.level, 1);
  assert.equal(session.sources[0].verification.includes("independent"), true);
  assert.equal(session.visuals[0].verification.includes("Inspected"), true);

  const sessionFile = fs.readdirSync(path.join(root, "vault", "Sessions"))[0];
  assert.match(sessionFile, /^differential-forms-[a-f0-9]{20}\.md$/);
  const note = fs.readFileSync(path.join(root, "vault", "Sessions", sessionFile), "utf8");
  assert.match(note, /```mermaid/);
  assert.match(note, /Primary covector reference/);
  assert.match(note, /Incorrect — covectors/);
  assert.match(note, /Correct — covectors/);
  assert.match(note, /!\[\[Assets\/covector\.svg\]\]/);
  assert.match(note, /Alternating multilinearity still needs a later teaching step/);
});

test("complete source-guided session preserves its anchor, coverage, and separate understanding evidence", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-source-e2e-"));
  const at = "2026-08-29T08:00:00.000Z";
  const planPath = path.join(root, "attention-plan.json");
  fs.writeFileSync(planPath, JSON.stringify({
    targetNodeId: "attention",
    nodes: [{ id: "attention", title: "Self-attention" }],
    edges: [],
  }));

  invoke(root, "init", ["--now", at]);
  invoke(root, "start", [
    "--id", "guided-1",
    "--topic", "Transformers",
    "--target", "Understand self-attention from the supplied lesson",
    "--material", "https://www.youtube.com/watch?v=example",
    "--now", at,
  ]);

  const materialId = JSON.parse(
    fs.readFileSync(path.join(root, ".adaptive-learning", "state.json"), "utf8"),
  ).sessions["guided-1"].materials[0].id;
  invoke(root, "resolve-material", [
    "--material-id", materialId,
    "--status", "verified",
    "--title", "Supplied self-attention lesson",
    "--evidence", "Retrieved the complete transcript and checked timestamp order.",
    "--now", at,
  ]);
  invoke(root, "record-probe", [
    "--id", "probe-a1",
    "--question-id", "probe-q1",
    "--node", "token-representations",
    "--kind", "explanation",
    "--question", "What information does one token representation contain before attention?",
    "--answer", "Its learned token embedding and position information.",
    "--grade", "correct",
    "--evidence", "Distinguished initial token identity and position from later contextual mixing.",
    "--now", at,
  ]);
  invoke(root, "finish-probe", [
    "--summary", "Token representations are usable; attention is the first missing mechanism.",
    "--now", at,
  ]);
  invoke(root, "add-source", [
    "--id", "anchor-attention",
    "--title", "Supplied self-attention lesson",
    "--url", "https://www.youtube.com/watch?v=example",
    "--source-class", "learner-supplied",
    "--role", "anchor",
    "--locator", "08:12-09:05",
    "--material-id", materialId,
    "--supports", "Query-key scores determine how value vectors are mixed.",
    "--verification", "Matched the claim to the cited transcript segment.",
    "--now", at,
  ]);
  invoke(root, "set-plan", ["--file", planPath, "--now", at]);
  invoke(root, "record-source-coverage", [
    "--id", "coverage-attention",
    "--node", "attention",
    "--source-id", "anchor-attention",
    "--summary", "The timestamped segment supports the query-key scoring and value-mixing mechanism.",
    "--now", at,
  ]);
  invoke(root, "begin-teach", ["--now", at]);
  invoke(root, "record-step", [
    "--id", "step-attention",
    "--node", "attention",
    "--foundation", "Each token has a representation that can be compared with other token representations.",
    "--motivation", "A token needs a content-dependent way to select relevant context.",
    "--explanation", "Queries compare with keys to weight the value vectors mixed into the token's new representation.",
    "--question-id", "teach-attention-q1",
    "--kind", "transfer",
    "--question", "Explain how one token can selectively use two other tokens in a new sentence.",
    "--now", at,
  ]);
  invoke(root, "record-assessment", [
    "--id", "teach-attention-a1",
    "--question-id", "teach-attention-q1",
    "--node", "attention",
    "--stage", "teach",
    "--kind", "transfer",
    "--question", "Explain how one token can selectively use two other tokens in a new sentence.",
    "--answer", "Its query scores both keys, normalizes those scores, and uses the weights to mix both values.",
    "--grade", "correct",
    "--evidence", "Transferred query-key scoring and weighted value mixing to an unfamiliar sequence.",
    "--now", at,
  ]);
  invoke(root, "start-synthesis", [
    "--question-id", "synthesis-q1",
    "--question", "Connect token representations, query-key scores, and value mixing.",
    "--now", at,
  ]);
  invoke(root, "record-synthesis", [
    "--id", "synthesis-a1",
    "--question-id", "synthesis-q1",
    "--question", "Connect token representations, query-key scores, and value mixing.",
    "--answer", "A token's query scores other keys and the normalized scores weight their values to form contextual information.",
    "--grade", "correct",
    "--evidence", "Connected the complete source-supported mechanism without relying on recognition.",
    "--now", at,
  ]);
  invoke(root, "close", ["--now", at]);

  const state = JSON.parse(
    fs.readFileSync(path.join(root, ".adaptive-learning", "state.json"), "utf8"),
  );
  const session = state.sessions["guided-1"];
  assert.equal(session.phase, "complete");
  assert.equal(session.materials[0].status, "verified");
  assert.equal(session.sources[0].role, "anchor");
  assert.equal(session.sources[0].locator, "08:12-09:05");
  assert.equal(session.sourceCoverage[0].nodeId, "attention");
  assert.equal(session.assessments.some((item) => item.id === "teach-attention-a1"), true);

  const sessionFile = fs.readdirSync(path.join(root, "vault", "Sessions"))[0];
  const note = fs.readFileSync(path.join(root, "vault", "Sessions", sessionFile), "utf8");
  assert.match(note, /Supplied learning materials/);
  assert.match(note, /08:12-09:05/);
  assert.match(note, /Source coverage and understanding/);
  assert.match(note, /Transferred query-key scoring and weighted value mixing/);
});
