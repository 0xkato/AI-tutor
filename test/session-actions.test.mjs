import assert from "node:assert/strict";
import test from "node:test";

import { recordAssessment } from "../src/assessment.mjs";
import { conceptForNode } from "../src/concepts.mjs";
import {
  addSource,
  addVisual,
  beginTeach,
  closeSession,
  createInitialState,
  finishProbe,
  getActiveSession,
  recordStep,
  setPlan,
  startSession,
} from "../src/model.mjs";

const now = "2026-08-24T08:00:00.000Z";

function planned() {
  let state = startSession(createInitialState({ now }), {
    id: "s1",
    topic: "Differential forms",
    target: "Understand differential forms from first principles",
    context: "Knows basic calculus",
    now,
  });
  state = recordAssessment(state, {
    id: "probe-a1",
    questionId: "probe-q1",
    nodeId: "vectors",
    stage: "probe",
    kind: "explanation",
    question: "What operations define a vector space?",
    answer: "Vector addition and scalar multiplication with their laws.",
    grade: "correct",
    evidence: "Named both defining operations and connected them to the vector-space laws.",
    now,
  });
  state = finishProbe(state, {
    summary: "Vectors are usable; covectors have not been established.",
    now,
  });
  return state;
}

function dependencyPlan() {
  return {
    targetNodeId: "forms",
    nodes: [
      { id: "vectors", title: "Vectors" },
      { id: "covectors", title: "Covectors" },
      { id: "forms", title: "Differential forms" },
    ],
    edges: [
      { from: "vectors", to: "covectors", reason: "Covectors act on vectors" },
      { from: "covectors", to: "forms", reason: "Forms generalize covectors" },
    ],
  };
}

test("setPlan rejects invalid graphs without mutating the session", () => {
  const state = planned();
  const cyclic = dependencyPlan();
  cyclic.edges.push({ from: "forms", to: "vectors", reason: "Cycle" });

  assert.throws(() => setPlan(state, { plan: cyclic, now }), /dependency cycle/);
  assert.equal(getActiveSession(state).plan, null);
  assert.equal(getActiveSession(state).phase, "plan");
});

test("a verified plan is required before teaching begins", () => {
  let state = planned();
  assert.throws(() => beginTeach(state, { now }), /valid dependency plan/);

  state = setPlan(state, { plan: dependencyPlan(), now });
  state = beginTeach(state, { now });
  assert.equal(getActiveSession(state).phase, "teach");
  assert.deepEqual(getActiveSession(state).frontier, ["covectors"]);
});

test("sources require explicit claim support and verification", () => {
  const state = planned();
  assert.throws(
    () => addSource(state, { title: "Source", url: "https://example.test", supports: "A claim", now }),
    /source class is required/,
  );

  const next = addSource(state, {
    id: "source-1",
    title: "Primary definition",
    url: "https://example.test/covectors",
    sourceClass: "primary",
    supports: "The definition of a covector as a linear functional.",
    verification: "Checked the definition and its assumptions against a second textbook.",
    now,
  });
  assert.equal(getActiveSession(next).sources[0].sourceClass, "primary");
});

test("only one teaching step may remain unresolved", () => {
  let state = setPlan(planned(), { plan: dependencyPlan(), now });
  state = beginTeach(state, { now });
  state = recordStep(state, {
    id: "step-1",
    nodeId: "covectors",
    foundation: "A linear map preserves vector addition and scalar multiplication.",
    motivation: "We need an object that measures a directed displacement.",
    explanation: "A covector is a linear map from vectors to scalars.",
    checkpointQuestion: "What does a covector consume and produce?",
    now,
  });

  assert.equal(getActiveSession(state).activeStepId, "step-1");
  assert.throws(
    () => recordStep(state, {
      nodeId: "forms",
      foundation: "Alternation is already defined.",
      motivation: "We need oriented area measurements.",
      explanation: "A two-form consumes two vectors.",
      checkpointQuestion: "What does a two-form consume?",
      now,
    }),
    /checkpoint must be resolved/,
  );
});

test("a successful transfer resolves the step and schedules retention", () => {
  let state = setPlan(planned(), { plan: dependencyPlan(), now });
  state = beginTeach(state, { now });
  state = recordStep(state, {
    id: "step-1",
    nodeId: "covectors",
    foundation: "A linear map preserves the two vector-space operations.",
    motivation: "We need a linear measurement of displacement.",
    explanation: "A covector maps a vector to a scalar linearly.",
    checkpointQuestion: "Apply that definition to a new vector measurement.",
    now,
  });
  state = recordAssessment(state, {
    id: "teach-a1",
    questionId: "teach-q1",
    nodeId: "covectors",
    stage: "teach",
    kind: "transfer",
    question: "What must a new displacement-measuring object consume and produce?",
    answer: "It consumes a vector and produces a scalar while preserving linear combinations.",
    grade: "correct",
    evidence: "Transferred the definition by identifying both the input-output types and linearity condition.",
    now,
  });

  const session = getActiveSession(state);
  const concept = conceptForNode(state, session, "covectors");
  const review = state.reviews[concept.reviewId];
  assert.equal(session.activeStepId, null);
  assert.equal(review.level, 1);
  assert.equal(review.dueAt, "2026-08-25T08:00:00.000Z");
});

test("visuals stay inside the vault and require inspection evidence", () => {
  const state = planned();
  assert.throws(
    () => addVisual(state, { path: "../escape.svg", description: "A diagram", verification: "Inspected all labels.", now }),
    /relative vault path/,
  );
  const next = addVisual(state, {
    id: "visual-1",
    path: "Assets/covector.svg",
    description: "A covector shown as parallel level sets acting on a vector.",
    verification: "Inspected the labels, orientation, and relationship to the explanation.",
    now,
  });
  assert.equal(getActiveSession(next).visuals[0].path, "Assets/covector.svg");
});

test("closeSession persists synthesis and releases the active session", () => {
  let state = setPlan(planned(), { plan: dependencyPlan(), now });
  state = beginTeach(state, { now });
  state = closeSession(state, {
    synthesis: "Vectors support covectors, which provide the linear measurements generalized by forms.",
    unresolvedGaps: ["Exterior derivatives have not been covered."],
    now,
  });

  assert.equal(state.activeSessionId, null);
  assert.equal(state.sessions.s1.phase, "complete");
  assert.match(state.sessions.s1.synthesis, /linear measurements/);
  assert.deepEqual(state.sessions.s1.unresolvedGaps, ["Exterior derivatives have not been covered."]);
});
