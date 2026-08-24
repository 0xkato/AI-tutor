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
    "--question", "What does this object consume and produce, and what law must it preserve?",
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
  invoke(root, "close", [
    "--synthesis", "Vectors are inputs to covectors, whose scalar linear measurements are generalized by forms.",
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
  assert.equal(session.assessments.length, 3);
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
