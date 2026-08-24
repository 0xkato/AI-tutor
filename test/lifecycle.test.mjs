import assert from "node:assert/strict";
import test from "node:test";

import {
  createInitialState,
  finishProbe,
  getActiveSession,
  startSession,
} from "../src/model.mjs";
import { recordAssessment } from "../src/assessment.mjs";

const now = "2026-08-24T08:00:00.000Z";

function start() {
  return startSession(createInitialState({ now }), {
    id: "session-1",
    topic: "Differential forms",
    target: "A solid introduction to differential forms",
    context: "Comfortable with basic calculus",
    now,
  });
}

test("startSession persists the learner target and enters probe", () => {
  const state = start();
  const session = getActiveSession(state);

  assert.equal(state.activeSessionId, "session-1");
  assert.equal(session.phase, "probe");
  assert.equal(session.target, "A solid introduction to differential forms");
  assert.equal(session.learnerContext, "Comfortable with basic calculus");
});

test("a second active session is rejected", () => {
  const state = start();

  assert.throws(
    () => startSession(state, { topic: "Other", target: "Other target", now }),
    /A learning session is already active/,
  );
});

test("finishProbe requires evidence and then enters plan", () => {
  let state = start();
  assert.throws(
    () => finishProbe(state, { summary: "No evidence yet", now }),
    /at least one uncontaminated probe/,
  );

  state = recordAssessment(state, {
    id: "assessment-1",
    questionId: "probe-1",
    nodeId: "vector-calculus",
    stage: "probe",
    kind: "explanation",
    question: "Explain what a line integral accumulates.",
    answer: "It accumulates a field contribution along a path.",
    grade: "correct",
    evidence: "Correctly connected the field, path, and accumulated contribution.",
    now,
  });
  state = finishProbe(state, {
    summary: "Vector-calculus foundations are present; covectors are unknown.",
    now,
  });

  assert.equal(getActiveSession(state).phase, "plan");
  assert.match(getActiveSession(state).probeSummary, /covectors are unknown/);
});
