import assert from "node:assert/strict";
import test from "node:test";

import { recordAssessment } from "../src/assessment.mjs";
import { conceptForNode } from "../src/concepts.mjs";
import { createInitialState, getActiveSession, startSession } from "../src/model.mjs";

const now = "2026-08-24T08:00:00.000Z";

function fresh() {
  return startSession(createInitialState({ now }), {
    id: "session-1",
    topic: "Gradient descent",
    target: "Understand one parameter update causally",
    now,
  });
}

function attempt(overrides = {}) {
  return {
    id: "assessment-1",
    questionId: "q-loss-direction",
    nodeId: "gradient-direction",
    stage: "probe",
    kind: "prediction",
    question: "If this weight increases the loss locally, which way should descent update it?",
    answer: "Upward.",
    grade: "incorrect",
    evidence: "The answer moved in the local loss-increasing direction.",
    mistakeType: "direction-sign",
    now,
    ...overrides,
  };
}

test("assessment accepts only the three explicit grades", () => {
  assert.throws(
    () => recordAssessment(fresh(), attempt({ grade: "mostly-correct" })),
    /grade must be correct, partial, or incorrect/,
  );
});

test("assessment requires exact evidence rather than a bare label", () => {
  assert.throws(
    () => recordAssessment(fresh(), attempt({ evidence: "Wrong" })),
    /evidence must identify the exact demonstrated or missing mechanism/,
  );
});

test("the first miss opens a retry without authorizing the answer", () => {
  const state = recordAssessment(fresh(), attempt());
  const concept = conceptForNode(state, getActiveSession(state), "gradient-direction");

  assert.equal(concept.retry.questionId, "q-loss-direction");
  assert.equal(concept.retry.attempts, 1);
  assert.equal(concept.retry.required, true);
  assert.equal(concept.retry.answerMayBeTaught, false);
});

test("a second genuine miss permits teaching but still requires a new transfer question", () => {
  let state = recordAssessment(fresh(), attempt());
  state = recordAssessment(
    state,
    attempt({
      id: "assessment-2",
      answer: "I still think it moves upward.",
      evidence: "The second attempt repeated the same direction error after bounded feedback.",
    }),
  );
  const retry = conceptForNode(
    state,
    getActiveSession(state),
    "gradient-direction",
  ).retry;

  assert.equal(retry.attempts, 2);
  assert.equal(retry.required, false);
  assert.equal(retry.answerMayBeTaught, true);
  assert.equal(retry.requiresNewTransfer, true);
});

test("contaminated questions are logged but excluded from knowledge evidence", () => {
  const state = recordAssessment(
    fresh(),
    attempt({
      contaminated: true,
      grade: "correct",
      answer: "The assistant already exposed the answer.",
      evidence: "Recognition followed answer exposure and cannot demonstrate understanding.",
    }),
  );
  const session = getActiveSession(state);

  assert.equal(session.assessments.length, 1);
  assert.equal(session.assessments[0].contaminated, true);
  assert.equal(conceptForNode(state, session, "gradient-direction", { required: false }), null);
});

test("clarification cannot be recorded as a graded assessment", () => {
  assert.throws(
    () => recordAssessment(fresh(), attempt({ kind: "clarification" })),
    /Clarifications do not count as assessments/,
  );
});
