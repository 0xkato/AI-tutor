import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { writeState } from "../src/store.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repository, "bin", "learn.mjs");
const DAY_ONE = "2026-08-24T08:00:00.000Z";
const DAY_TWO = "2026-08-25T08:00:00.000Z";

function invoke(root, command, options = [], { ok = true } = {}) {
  const result = spawnSync(process.execPath, [cli, command, ...options, "--root", root], {
    cwd: repository,
    encoding: "utf8",
  });
  if (ok) assert.equal(result.status, 0, `${command}: ${result.stderr || result.stdout}`);
  else assert.notEqual(result.status, 0, `${command} unexpectedly succeeded`);
  return result;
}

function seedDueReview(root, { reviewCount = 0 } = {}) {
  const planPath = path.join(root, "covector-plan.json");
  fs.writeFileSync(planPath, `${JSON.stringify({
    targetNodeId: "covectors",
    nodes: [{ id: "covectors", title: "Covectors" }],
    edges: [],
  }, null, 2)}\n`);
  invoke(root, "init", ["--now", DAY_ONE]);
  invoke(root, "start", [
    "--id", "learn-s1",
    "--topic", "Differential forms",
    "--target", "Build a causal introduction to differential forms",
    "--now", DAY_ONE,
  ]);
  invoke(root, "record-probe", [
    "--id", "probe-a1",
    "--question-id", "probe-q1",
    "--node", "vectors",
    "--kind", "explanation",
    "--question", "Which operations must vectors support?",
    "--answer", "Vector addition and scalar multiplication under the vector-space laws.",
    "--grade", "correct",
    "--evidence", "Named both vector-space operations and tied them to the required laws.",
    "--now", DAY_ONE,
  ]);
  invoke(root, "finish-probe", [
    "--summary", "Vectors are usable; covectors are the first missing prerequisite.",
    "--now", DAY_ONE,
  ]);
  invoke(root, "set-plan", ["--file", planPath, "--now", DAY_ONE]);
  invoke(root, "begin-teach", ["--now", DAY_ONE]);
  invoke(root, "record-step", [
    "--id", "step-1",
    "--node", "covectors",
    "--foundation", "A linear map preserves vector addition and scalar multiplication.",
    "--motivation", "We need an object that measures a directed displacement linearly.",
    "--explanation", "A covector consumes a vector and produces a scalar linearly.",
    "--question-id", "teach-q1",
    "--kind", "transfer",
    "--question", "Describe a linear displacement measurement in a new setting.",
    "--now", DAY_ONE,
  ]);
  invoke(root, "record-assessment", [
    "--id", "teach-a1",
    "--question-id", "teach-q1",
    "--node", "covectors",
    "--stage", "teach",
    "--kind", "transfer",
    "--question", "Describe a linear displacement measurement in a new setting.",
    "--answer", "It maps a vector to a scalar while preserving linear combinations.",
    "--grade", "correct",
    "--evidence", "Transferred the input-output types and linearity to an unfamiliar measurement.",
    "--now", DAY_ONE,
  ]);
  invoke(root, "start-synthesis", [
    "--question-id", "learning-synthesis-q1",
    "--question", "Connect vector structure to a linear scalar measurement.",
    "--now", DAY_ONE,
  ]);
  invoke(root, "record-synthesis", [
    "--id", "learning-synthesis-a1",
    "--question-id", "learning-synthesis-q1",
    "--question", "Connect vector structure to a linear scalar measurement.",
    "--answer", "A covector consumes a vector and returns a scalar while preserving vector addition and scaling.",
    "--grade", "correct",
    "--evidence", "Connected both vector-space operations to the covector's scalar-valued linear action.",
    "--now", DAY_ONE,
  ]);
  invoke(root, "close", [
    "--gap", "Alternating multilinearity remains unresolved.",
    "--now", DAY_ONE,
  ]);

  if (reviewCount !== 0) {
    const statePath = path.join(root, ".adaptive-learning", "state.json");
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    state.reviewCount = reviewCount;
    writeState(root, state);
  }

  const due = JSON.parse(invoke(root, "due", ["--now", DAY_TWO, "--json"]).stdout);
  return due.reviews.find((review) => review.nodeId === "covectors");
}

test("a retention checkpoint persists I don't know as an ungraded repair signal", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-review-gap-"));
  const due = seedDueReview(root);
  invoke(root, "start-review", [
    "--id", "review-gap-s1",
    "--review", due.reviewId,
    "--now", DAY_TWO,
  ]);
  invoke(root, "start-review-checkpoint", [
    "--question-id", "retention-gap-q1",
    "--node", "covectors",
    "--kind", "retention",
    "--question", "What does a covector consume and produce, and what law must it preserve?",
    "--now", "2026-08-25T08:00:01.000Z",
  ]);
  invoke(root, "record-admitted-gap", [
    "--id", "retention-gap-1",
    "--question-id", "retention-gap-q1",
    "--node", "covectors",
    "--statement", "I don't remember the input-output types or the preserved law.",
    "--evidence", "The learner explicitly admitted the missing covector mechanism on the persisted retention checkpoint.",
    "--now", "2026-08-25T08:00:02.000Z",
  ]);

  const state = JSON.parse(
    fs.readFileSync(path.join(root, ".adaptive-learning", "state.json"), "utf8"),
  );
  const session = state.sessions["review-gap-s1"];
  const concept = state.concepts[due.conceptId];

  assert.equal(session.assessments.length, 0);
  assert.equal(session.reviewItems[0].status, "repair-required");
  assert.equal(session.checkpoint.status, "new-transfer-required");
  assert.equal(session.checkpoint.mistakeType, "admitted-gap");
  assert.equal(session.checkpointGaps.length, 1);
  assert.equal(session.checkpointGaps[0].stage, "retention");
  assert.equal(session.checkpointGaps[0].questionId, "retention-gap-q1");
  assert.equal(concept.status, "gap");
  assert.equal(concept.retry.status, "new-transfer-required");
  assert.equal(concept.retry.answerMayBeTaught, true);
  assert.equal(concept.latestGrade, "correct");
});

test("a due review is claimed, executed across processes, and persisted once", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-review-"));
  const due = seedDueReview(root);
  assert.ok(due?.reviewId, "seeded concept must produce a stable due review ID");

  invoke(root, "start-review", [
    "--id", "review-s1",
    "--review", due.reviewId,
    "--now", DAY_TWO,
  ]);
  let status = JSON.parse(invoke(root, "status", ["--json"]).stdout);
  assert.equal(status.active.kind, "review");
  assert.deepEqual(status.active.reviewItems, [
    { reviewId: due.reviewId, conceptId: due.conceptId, status: "pending" },
  ]);
  assert.deepEqual(
    JSON.parse(invoke(root, "due", ["--now", DAY_TWO, "--json"]).stdout).reviews,
    [],
    "an atomically claimed review is no longer available in the due queue",
  );

  const unselected = invoke(root, "record-assessment", [
    "--id", "wrong-concept-a1",
    "--question-id", "wrong-concept-q1",
    "--node", "vectors",
    "--stage", "retention",
    "--kind", "transfer",
    "--question", "Apply vector addition in a new example.",
    "--answer", "Add the vectors component by component.",
    "--grade", "correct",
    "--evidence", "This assessment targets a concept that was not selected for the review.",
    "--now", "2026-08-25T08:00:30.000Z",
  ], { ok: false });
  assert.match(unselected.stderr, /not declared in this session/i);

  const earlyClose = invoke(root, "close-review", [
    "--synthesis", "The review has not produced valid evidence yet.",
    "--now", "2026-08-25T08:01:00.000Z",
  ], { ok: false });
  assert.match(earlyClose.stderr, /review items must be resolved or deferred/i);

  const beforeMissingCheckpoint = fs.readFileSync(
    path.join(root, ".adaptive-learning", "state.json"),
    "utf8",
  );
  const missingCheckpoint = invoke(root, "record-assessment", [
    "--id", "retention-without-checkpoint-a1",
    "--question-id", "retention-without-checkpoint-q1",
    "--node", "covectors",
    "--stage", "retention",
    "--kind", "retention",
    "--question", "What does a covector consume and produce?",
    "--answer", "It consumes a vector and produces a scalar.",
    "--grade", "correct",
    "--evidence", "A valid answer cannot count unless its question was persisted first.",
    "--now", "2026-08-25T08:01:30.000Z",
  ], { ok: false });
  assert.match(missingCheckpoint.stderr, /no persisted review checkpoint/i);
  assert.equal(
    fs.readFileSync(path.join(root, ".adaptive-learning", "state.json"), "utf8"),
    beforeMissingCheckpoint,
  );

  invoke(root, "start-review-checkpoint", [
    "--question-id", "retention-q1",
    "--node", "covectors",
    "--kind", "retention",
    "--question", "What does a covector consume and produce?",
    "--now", "2026-08-25T08:02:00.000Z",
  ]);
  const checkpointed = JSON.parse(
    fs.readFileSync(path.join(root, ".adaptive-learning", "state.json"), "utf8"),
  );
  assert.equal(checkpointed.sessions["review-s1"].assessments.length, 0);
  assert.equal(checkpointed.sessions["review-s1"].reviewItems[0].status, "pending");
  assert.equal(checkpointed.concepts[due.conceptId].retry, null);
  assert.deepEqual(checkpointed.sessions["review-s1"].checkpoint, {
    status: "awaiting-answer",
    nodeId: "covectors",
    questionId: "retention-q1",
    question: "What does a covector consume and produce?",
    kind: "retention",
    priorQuestionId: null,
    attempts: 0,
    resolvedEvidenceId: null,
    mistakeType: "",
  });
  status = JSON.parse(invoke(root, "status", ["--json"]).stdout);
  assert.deepEqual(status.active.checkpoint, checkpointed.sessions["review-s1"].checkpoint);

  const beforeActiveDeferral = fs.readFileSync(
    path.join(root, ".adaptive-learning", "state.json"),
    "utf8",
  );
  const activeDeferral = invoke(root, "defer-review", [
    "--review", due.reviewId,
    "--reason", "This must not strand the persisted checkpoint or retry state.",
    "--until", "2026-08-26T08:00:00.000Z",
    "--now", "2026-08-25T08:02:10.000Z",
  ], { ok: false });
  assert.match(activeDeferral.stderr, /cannot be deferred while.*checkpoint.*active/i);
  assert.equal(
    fs.readFileSync(path.join(root, ".adaptive-learning", "state.json"), "utf8"),
    beforeActiveDeferral,
  );

  const checkpointStatePath = path.join(root, ".adaptive-learning", "state.json");
  const beforeInvalidBinding = fs.readFileSync(checkpointStatePath, "utf8");
  const invalidBindingState = JSON.parse(beforeInvalidBinding);
  invalidBindingState.sessions["review-s1"].checkpoint.nodeId = "vectors";
  fs.writeFileSync(checkpointStatePath, `${JSON.stringify(invalidBindingState, null, 2)}\n`);
  const invalidBinding = invoke(root, "status", ["--json"], { ok: false });
  assert.match(invalidBinding.stderr, /checkpoint.*session concept/i);
  fs.writeFileSync(checkpointStatePath, beforeInvalidBinding);

  const beforeSecondCheckpoint = fs.readFileSync(
    path.join(root, ".adaptive-learning", "state.json"),
    "utf8",
  );
  const secondCheckpoint = invoke(root, "start-review-checkpoint", [
    "--question-id", "retention-q2",
    "--node", "covectors",
    "--kind", "transfer",
    "--question", "What does a linear price sensitivity consume and produce?",
    "--now", "2026-08-25T08:02:30.000Z",
  ], { ok: false });
  assert.match(secondCheckpoint.stderr, /checkpoint.*retention-q1.*resolved.*another checkpoint/i);
  assert.equal(
    fs.readFileSync(path.join(root, ".adaptive-learning", "state.json"), "utf8"),
    beforeSecondCheckpoint,
  );

  const beforeMismatch = fs.readFileSync(
    path.join(root, ".adaptive-learning", "state.json"),
    "utf8",
  );
  const mismatch = invoke(root, "record-assessment", [
    "--id", "retention-mismatch-a1",
    "--question-id", "retention-q1",
    "--node", "covectors",
    "--stage", "retention",
    "--kind", "retention",
    "--question", "What does a covector output?",
    "--answer", "It outputs a scalar.",
    "--grade", "correct",
    "--evidence", "The answer is correct but does not preserve the persisted question text.",
    "--now", "2026-08-25T08:03:00.000Z",
  ], { ok: false });
  assert.match(mismatch.stderr, /preserve.*checkpoint question.*retention-q1.*exactly/i);
  assert.equal(
    fs.readFileSync(path.join(root, ".adaptive-learning", "state.json"), "utf8"),
    beforeMismatch,
  );

  invoke(root, "record-assessment", [
    "--id", "retention-a1",
    "--question-id", "retention-q1",
    "--node", "covectors",
    "--stage", "retention",
    "--kind", "retention",
    "--question", "What does a covector consume and produce?",
    "--answer", "It consumes and produces vectors.",
    "--grade", "incorrect",
    "--evidence", "Retained the vector input but incorrectly recalled the output as another vector.",
    "--mistake-type", "output-type",
    "--now", "2026-08-25T08:05:00.000Z",
  ]);
  status = JSON.parse(invoke(root, "status", ["--json"]).stdout);
  assert.equal(status.active.reviewItems[0].status, "repair-required");

  invoke(root, "record-assessment", [
    "--id", "retention-a2",
    "--question-id", "retention-q1",
    "--node", "covectors",
    "--stage", "retention",
    "--kind", "retention",
    "--question", "What does a covector consume and produce?",
    "--answer", "It still consumes and produces vectors.",
    "--grade", "incorrect",
    "--evidence", "The bounded retry repeated the same incorrect vector-output model.",
    "--mistake-type", "output-type",
    "--now", "2026-08-25T08:07:00.000Z",
  ]);

  const beforeReusedRepair = fs.readFileSync(
    path.join(root, ".adaptive-learning", "state.json"),
    "utf8",
  );
  const reusedRepair = invoke(root, "start-review-checkpoint", [
    "--question-id", "retention-q1",
    "--node", "covectors",
    "--kind", "transfer",
    "--question", "Apply the same idea to a price sensitivity.",
    "--now", "2026-08-25T08:07:30.000Z",
  ], { ok: false });
  assert.match(reusedRepair.stderr, /new transfer question.*retention-q1/i);
  assert.equal(
    fs.readFileSync(path.join(root, ".adaptive-learning", "state.json"), "utf8"),
    beforeReusedRepair,
  );

  invoke(root, "start-review-checkpoint", [
    "--question-id", "retention-transfer-q1",
    "--node", "covectors",
    "--kind", "transfer",
    "--question", "In a new pricing example, what must a linear sensitivity consume and produce?",
    "--now", "2026-08-25T08:08:00.000Z",
  ]);

  invoke(root, "record-assessment", [
    "--id", "retention-a3",
    "--question-id", "retention-transfer-q1",
    "--node", "covectors",
    "--stage", "retention",
    "--kind", "transfer",
    "--question", "In a new pricing example, what must a linear sensitivity consume and produce?",
    "--answer", "It consumes a parameter-change vector and produces a scalar price change linearly.",
    "--grade", "correct",
    "--evidence", "After repair, transferred the vector-to-scalar mapping to a new pricing example.",
    "--now", "2026-08-25T08:10:00.000Z",
  ]);
  invoke(root, "close-review", [
    "--synthesis", "The failed recall exposed the output-type gap; a new transfer then restored the causal mapping.",
    "--now", "2026-08-25T08:15:00.000Z",
  ]);

  const state = JSON.parse(
    fs.readFileSync(path.join(root, ".adaptive-learning", "state.json"), "utf8"),
  );
  const reviewSession = state.sessions["review-s1"];
  const concept = state.concepts[due.conceptId];
  const review = state.reviews[due.reviewId];
  assert.equal(reviewSession.phase, "complete");
  assert.equal(reviewSession.reviewItems[0].status, "resolved");
  assert.deepEqual(concept.evidenceIds.slice(-3), ["retention-a1", "retention-a2", "retention-a3"]);
  assert.equal(review.completed, 2, "the review item is completed once, not once per attempt");
  assert.equal(review.level, 0, "the initial failed recall prevents an interval promotion");
  assert.equal(review.dueAt, "2026-08-26T08:15:00.000Z");
  assert.equal(review.status, "scheduled");
  assert.equal(review.claimedBySessionId, null);
  assert.equal(state.reviewCount, 1);

  const beforeInvalidResolution = fs.readFileSync(checkpointStatePath, "utf8");
  const invalidResolutionState = JSON.parse(beforeInvalidResolution);
  invalidResolutionState.sessions["review-s1"].checkpoint.question =
    "A different question was substituted after the assessment.";
  fs.writeFileSync(
    checkpointStatePath,
    `${JSON.stringify(invalidResolutionState, null, 2)}\n`,
  );
  const invalidResolution = invoke(root, "status", ["--json"], { ok: false });
  assert.match(invalidResolution.stderr, /checkpoint has invalid resolved evidence/i);
});

test("an event older than the current durable state is rejected without mutation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-event-time-"));
  const due = seedDueReview(root);

  invoke(root, "start-review", [
    "--id", "review-time-guard",
    "--review", due.reviewId,
    "--now", DAY_TWO,
  ]);
  invoke(root, "start-review-checkpoint", [
    "--question-id", "retention-stale-time-q1",
    "--node", "covectors",
    "--kind", "retention",
    "--question", "What does a covector consume and produce?",
    "--now", "2026-08-25T08:01:00.000Z",
  ]);
  const statePath = path.join(root, ".adaptive-learning", "state.json");
  const before = JSON.parse(fs.readFileSync(statePath, "utf8"));

  const result = invoke(root, "record-assessment", [
    "--id", "retention-stale-time-a1",
    "--question-id", "retention-stale-time-q1",
    "--node", "covectors",
    "--stage", "retention",
    "--kind", "retention",
    "--question", "What does a covector consume and produce?",
    "--answer", "It consumes and produces vectors.",
    "--grade", "incorrect",
    "--evidence", "This otherwise-valid assessment carries an event time older than the current state.",
    "--mistake-type", "output-type",
    "--now", DAY_ONE,
  ], { ok: false });

  assert.match(result.stderr, /event time cannot be earlier than current state time/i);
  assert.deepEqual(JSON.parse(fs.readFileSync(statePath, "utf8")), before);
});

test("a selected review can be explicitly deferred with a reason and stable ID", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-defer-"));
  const due = seedDueReview(root);
  const deferredUntil = "2026-08-28T08:00:00.000Z";

  invoke(root, "start-review", [
    "--id", "review-deferred",
    "--review", due.reviewId,
    "--now", DAY_TWO,
  ]);
  invoke(root, "defer-review", [
    "--review", due.reviewId,
    "--reason", "The learner is missing the prerequisite example needed for a valid check.",
    "--until", deferredUntil,
    "--now", "2026-08-25T08:05:00.000Z",
  ]);
  invoke(root, "close-review", [
    "--synthesis", "No mastery evidence was recorded; the selected review was explicitly deferred.",
    "--now", "2026-08-25T08:10:00.000Z",
  ]);

  const state = JSON.parse(
    fs.readFileSync(path.join(root, ".adaptive-learning", "state.json"), "utf8"),
  );
  const review = state.reviews[due.reviewId];
  assert.equal(state.sessions["review-deferred"].reviewItems[0].status, "deferred");
  assert.equal(review.status, "deferred");
  assert.equal(review.dueAt, deferredUntil);
  assert.match(review.deferredReason, /missing the prerequisite example/i);
  assert.equal(review.completed, 1, "deferral does not count as a completed review");
  assert.equal(state.reviewCount, 0);
  assert.deepEqual(
    JSON.parse(invoke(root, "due", ["--now", deferredUntil, "--json"]).stdout).reviews.map(
      (item) => item.reviewId,
    ),
    [due.reviewId],
  );
});

test("a contaminated review question can be replaced without creating evidence", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-contaminated-review-"));
  const due = seedDueReview(root);

  invoke(root, "start-review", [
    "--id", "review-contaminated",
    "--review", due.reviewId,
    "--now", DAY_TWO,
  ]);
  invoke(root, "start-review-checkpoint", [
    "--question-id", "retention-contaminated-q1",
    "--node", "covectors",
    "--kind", "retention",
    "--question", "What does a covector consume and produce?",
    "--now", "2026-08-25T08:01:00.000Z",
  ]);
  invoke(root, "record-assessment", [
    "--id", "retention-contaminated-a1",
    "--question-id", "retention-contaminated-q1",
    "--node", "covectors",
    "--stage", "retention",
    "--kind", "retention",
    "--question", "What does a covector consume and produce?",
    "--answer", "The answer was exposed before this response.",
    "--grade", "correct",
    "--evidence", "The answer exposure invalidates this response as learning evidence.",
    "--contaminated",
    "--now", "2026-08-25T08:02:00.000Z",
  ]);

  const beforeReusingContaminatedQuestion = fs.readFileSync(
    path.join(root, ".adaptive-learning", "state.json"),
    "utf8",
  );
  const reusedContaminatedQuestion = invoke(root, "record-assessment", [
    "--id", "retention-contaminated-a2",
    "--question-id", "retention-contaminated-q1",
    "--node", "covectors",
    "--stage", "retention",
    "--kind", "retention",
    "--question", "What does a covector consume and produce?",
    "--answer", "It consumes a vector and produces a scalar.",
    "--grade", "correct",
    "--evidence", "This answer cannot count because the persisted question was already contaminated.",
    "--now", "2026-08-25T08:02:30.000Z",
  ], { ok: false });
  assert.match(reusedContaminatedQuestion.stderr, /contaminated.*new.*checkpoint/i);
  assert.equal(
    fs.readFileSync(path.join(root, ".adaptive-learning", "state.json"), "utf8"),
    beforeReusingContaminatedQuestion,
  );

  invoke(root, "start-review-checkpoint", [
    "--question-id", "retention-clean-transfer-q1",
    "--node", "covectors",
    "--kind", "transfer",
    "--question", "In a pricing example, what must a linear sensitivity consume and produce?",
    "--now", "2026-08-25T08:03:00.000Z",
  ]);

  const state = JSON.parse(
    fs.readFileSync(path.join(root, ".adaptive-learning", "state.json"), "utf8"),
  );
  const session = state.sessions["review-contaminated"];
  assert.equal(session.assessments.length, 1);
  assert.equal(session.assessments[0].contaminated, true);
  assert.equal(session.reviewItems[0].status, "pending");
  assert.deepEqual(session.reviewItems[0].evidenceIds, []);
  assert.equal(state.concepts[due.conceptId].retry, null);
  assert.deepEqual(session.checkpoint, {
    status: "awaiting-answer",
    nodeId: "covectors",
    questionId: "retention-clean-transfer-q1",
    question: "In a pricing example, what must a linear sensitivity consume and produce?",
    kind: "transfer",
    priorQuestionId: "retention-contaminated-q1",
    attempts: 0,
    resolvedEvidenceId: null,
    mistakeType: "",
  });
});

test("a contaminated bounded retry can move to a new transfer checkpoint", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-contaminated-retry-"));
  const due = seedDueReview(root);

  invoke(root, "start-review", [
    "--id", "review-contaminated-retry",
    "--review", due.reviewId,
    "--now", DAY_TWO,
  ]);
  invoke(root, "start-review-checkpoint", [
    "--question-id", "retention-contaminated-retry-q1",
    "--node", "covectors",
    "--kind", "retention",
    "--question", "What does a covector consume and produce?",
    "--now", "2026-08-25T08:01:00.000Z",
  ]);
  invoke(root, "record-assessment", [
    "--id", "retention-contaminated-retry-a1",
    "--question-id", "retention-contaminated-retry-q1",
    "--node", "covectors",
    "--stage", "retention",
    "--kind", "retention",
    "--question", "What does a covector consume and produce?",
    "--answer", "It consumes a scalar and produces a vector.",
    "--grade", "incorrect",
    "--evidence", "The answer reversed the covector input and output types.",
    "--mistake-type", "type-direction",
    "--now", "2026-08-25T08:02:00.000Z",
  ]);
  invoke(root, "record-assessment", [
    "--id", "retention-contaminated-retry-a2",
    "--question-id", "retention-contaminated-retry-q1",
    "--node", "covectors",
    "--stage", "retention",
    "--kind", "retention",
    "--question", "What does a covector consume and produce?",
    "--answer", "The retry answer was exposed before the learner could respond.",
    "--grade", "correct",
    "--evidence", "The exposed retry is retained only as a contaminated audit record.",
    "--contaminated",
    "--now", "2026-08-25T08:03:00.000Z",
  ]);

  invoke(root, "start-review-checkpoint", [
    "--question-id", "retention-after-contamination-q1",
    "--node", "covectors",
    "--kind", "transfer",
    "--question", "In a pricing example, what must a linear sensitivity consume and produce?",
    "--now", "2026-08-25T08:04:00.000Z",
  ]);
  invoke(root, "record-assessment", [
    "--id", "retention-after-contamination-a1",
    "--question-id", "retention-after-contamination-q1",
    "--node", "covectors",
    "--stage", "retention",
    "--kind", "transfer",
    "--question", "In a pricing example, what must a linear sensitivity consume and produce?",
    "--answer", "It consumes a displacement vector and produces the scalar price change.",
    "--grade", "correct",
    "--evidence", "The new transfer correctly preserved the input and output types.",
    "--now", "2026-08-25T08:05:00.000Z",
  ]);

  const state = JSON.parse(
    fs.readFileSync(path.join(root, ".adaptive-learning", "state.json"), "utf8"),
  );
  const session = state.sessions["review-contaminated-retry"];
  assert.equal(session.reviewItems[0].status, "resolved");
  assert.deepEqual(session.reviewItems[0].evidenceIds, [
    "retention-contaminated-retry-a1",
    "retention-after-contamination-a1",
  ]);
  assert.equal(state.concepts[due.conceptId].retry, null);
  assert.equal(session.checkpoint.status, "resolved");
  assert.equal(session.checkpoint.priorQuestionId, "retention-contaminated-retry-q1");
});

test("a required review synthesis is assessed before the review can close", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-review-synthesis-"));
  const due = seedDueReview(root, { reviewCount: 6 });

  invoke(root, "start-review", [
    "--id", "review-synthesis",
    "--review", due.reviewId,
    "--now", DAY_TWO,
  ]);
  invoke(root, "start-review-checkpoint", [
    "--question-id", "retention-synthesis-q1",
    "--node", "covectors",
    "--kind", "retention",
    "--question", "What structure does a covector preserve while producing what output?",
    "--now", "2026-08-25T08:02:00.000Z",
  ]);
  invoke(root, "record-assessment", [
    "--id", "retention-synthesis-a1",
    "--question-id", "retention-synthesis-q1",
    "--node", "covectors",
    "--stage", "retention",
    "--kind", "retention",
    "--question", "What structure does a covector preserve while producing what output?",
    "--answer", "It preserves linear combinations of vectors and produces a scalar.",
    "--grade", "correct",
    "--evidence", "Reconstructed the vector-to-scalar mapping and both required linearity operations.",
    "--now", "2026-08-25T08:05:00.000Z",
  ]);

  const earlyClose = invoke(root, "close-review", [
    "--synthesis", "This unassessed summary must not satisfy a required synthesis.",
    "--now", "2026-08-25T08:06:00.000Z",
  ], { ok: false });
  assert.match(earlyClose.stderr, /synthesis assessment is required/i);

  invoke(root, "start-synthesis", [
    "--question-id", "review-whole-system-q1",
    "--question", "Connect the retained vector operations to the covector's input and output.",
    "--now", "2026-08-25T08:07:00.000Z",
  ]);
  invoke(root, "record-admitted-gap", [
    "--id", "review-whole-system-gap-1",
    "--question-id", "review-whole-system-q1",
    "--node", "covectors",
    "--statement", "I don't know how both vector operations constrain the covector output.",
    "--evidence", "The learner localized the whole-system gap to the covector linearity mechanism.",
    "--now", "2026-08-25T08:07:10.000Z",
  ]);
  invoke(root, "start-review-checkpoint", [
    "--question-id", "review-synthesis-repair-q1",
    "--node", "covectors",
    "--kind", "transfer",
    "--question", "How must a linear price sensitivity respond when two displacement vectors are added?",
    "--now", "2026-08-25T08:07:20.000Z",
  ]);
  invoke(root, "record-assessment", [
    "--id", "review-synthesis-repair-a1",
    "--question-id", "review-synthesis-repair-q1",
    "--node", "covectors",
    "--stage", "retention",
    "--kind", "transfer",
    "--question", "How must a linear price sensitivity respond when two displacement vectors are added?",
    "--answer", "Its scalar response to the sum must equal the sum of its scalar responses.",
    "--grade", "correct",
    "--evidence", "Transferred additivity to a new scalar-valued price-sensitivity example.",
    "--now", "2026-08-25T08:07:30.000Z",
  ]);
  invoke(root, "start-synthesis", [
    "--question-id", "review-whole-system-transfer-q1",
    "--question", "Connect vector addition and scaling to a linear risk sensitivity's scalar output.",
    "--now", "2026-08-25T08:07:40.000Z",
  ]);
  invoke(root, "record-synthesis", [
    "--id", "review-whole-system-a1",
    "--question-id", "review-whole-system-transfer-q1",
    "--question", "Connect vector addition and scaling to a linear risk sensitivity's scalar output.",
    "--answer", "A covector accepts vectors, returns scalars, and preserves vector addition and scalar multiplication.",
    "--grade", "correct",
    "--evidence", "Connected the retained input-output model to both operations that linearity preserves.",
    "--now", "2026-08-25T08:08:00.000Z",
  ]);
  invoke(root, "close-review", ["--now", "2026-08-25T08:10:00.000Z"]);

  const state = JSON.parse(
    fs.readFileSync(path.join(root, ".adaptive-learning", "state.json"), "utf8"),
  );
  const session = state.sessions["review-synthesis"];
  assert.equal(session.synthesisCheckpoint.resolvedEvidenceId, "review-whole-system-a1");
  assert.equal(session.checkpointGaps[0].stage, "synthesis");
  assert.equal(session.checkpointGaps[0].questionId, "review-whole-system-q1");
  assert.equal(
    session.synthesis,
    "A covector accepts vectors, returns scalars, and preserves vector addition and scalar multiplication.",
  );
  assert.equal(state.reviewCount, 7);
});
