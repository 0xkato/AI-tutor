import assert from "node:assert/strict";
import test from "node:test";

import { recordAssessment } from "../src/assessment.mjs";
import { conceptForNode } from "../src/concepts.mjs";
import {
  beginTeach,
  closeSession,
  createInitialState,
  finishProbe,
  getActiveSession,
  recordStep,
  setPlan,
  startSession,
} from "../src/model.mjs";

const NOW = "2026-08-24T08:00:00.000Z";

function fresh() {
  return startSession(createInitialState({ now: NOW }), {
    id: "s1",
    topic: "Linear maps",
    target: "Understand a linear measurement causally",
    now: NOW,
  });
}

function answer(overrides = {}) {
  return {
    id: "a1",
    questionId: "q1",
    nodeId: "vectors",
    stage: "probe",
    kind: "explanation",
    question: "Which operations must vectors support?",
    answer: "Vector addition and scalar multiplication.",
    grade: "correct",
    evidence: "Named vector addition and scalar multiplication as the defining operations.",
    now: NOW,
    ...overrides,
  };
}

function afterValidProbe() {
  let state = recordAssessment(fresh(), answer());
  state = finishProbe(state, {
    summary: "Vectors are available; linear functionals remain unknown.",
    now: "2026-08-24T08:01:00.000Z",
  });
  return state;
}

function teaching() {
  let state = setPlan(afterValidProbe(), {
    plan: {
      targetNodeId: "linear-functional",
      nodes: [{ id: "linear-functional", title: "Linear functional" }],
      edges: [],
    },
    now: "2026-08-24T08:02:00.000Z",
  });
  state = beginTeach(state, { now: "2026-08-24T08:03:00.000Z" });
  return recordStep(state, {
    id: "step-1",
    nodeId: "linear-functional",
    foundation: "A linear map preserves vector addition and scalar multiplication.",
    motivation: "We need a scalar measurement that respects vector structure.",
    explanation: "A linear functional maps a vector to a scalar linearly.",
    checkpointQuestion: "Apply the vector-to-scalar rule in a new setting.",
    now: "2026-08-24T08:04:00.000Z",
  });
}

function teachingAttempt(overrides = {}) {
  return answer({
    id: "teach-a1",
    questionId: "teach-q1",
    nodeId: "linear-functional",
    stage: "teach",
    kind: "transfer",
    question: "What must a linear temperature sensitivity consume and produce?",
    answer: "It consumes and produces vectors.",
    grade: "incorrect",
    evidence: "Retained the vector input but incorrectly made the output another vector.",
    mistakeType: "output-type",
    now: "2026-08-24T08:05:00.000Z",
    ...overrides,
  });
}

test("assessment stages and session kinds are explicit", () => {
  assert.throws(
    () => recordAssessment(fresh(), answer({ stage: "mystery" })),
    (error) => error.code === "INVALID_STAGE",
  );

  const state = recordAssessment(fresh(), answer());
  assert.throws(
    () => recordAssessment(state, answer({
      id: "retention-a1",
      questionId: "retention-q1",
      stage: "retention",
      kind: "retention",
    })),
    /retention assessments require.*review session/i,
  );

  assert.throws(
    () => recordAssessment(afterValidProbe(), answer({ id: "late-probe" })),
    /probe assessments require the probe phase/i,
  );
});

test("an unresolved retry blocks an unrelated probe question", () => {
  let state = recordAssessment(fresh(), answer({
    grade: "incorrect",
    answer: "Only vector addition.",
    evidence: "Named vector addition but omitted scalar multiplication from the structure.",
    mistakeType: "missing-operation",
  }));

  assert.throws(
    () => recordAssessment(state, answer({
      id: "a2",
      questionId: "q2",
      nodeId: "scalars",
      question: "What operation combines scalars?",
      answer: "Scalar multiplication.",
      evidence: "Answered a different concept while the vector retry remained unresolved.",
    })),
    /retry.*vectors.*before.*scalars/i,
  );
});

test("partial answers escalate through retry to a required new transfer", () => {
  let state = recordAssessment(fresh(), answer({
    grade: "partial",
    answer: "Vector addition, and another operation I cannot name.",
    evidence: "Named vector addition but could not identify scalar multiplication.",
    mistakeType: "missing-operation",
  }));
  state = recordAssessment(state, answer({
    id: "a2",
    grade: "partial",
    answer: "Vector addition and multiplication of vectors.",
    evidence: "The retry still replaced scalar multiplication with an invalid vector product.",
  }));

  const retry = conceptForNode(state, getActiveSession(state), "vectors").retry;
  assert.equal(retry.status, "new-transfer-required");
  assert.equal(retry.attempts, 2);
  assert.equal(retry.answerMayBeTaught, true);
});

test("a second probe miss can enter the permitted teaching repair", () => {
  let state = recordAssessment(fresh(), answer({
    grade: "incorrect",
    answer: "Only vector addition.",
    evidence: "The first attempt omitted scalar multiplication from the vector-space structure.",
    mistakeType: "missing-operation",
  }));
  state = recordAssessment(state, answer({
    id: "a2",
    grade: "incorrect",
    answer: "Vector addition and multiplication of vectors.",
    evidence: "The bounded retry still replaced scalar multiplication with an invalid vector product.",
  }));

  state = finishProbe(state, {
    summary: "The bounded probe established a gap in the operations defining vector structure.",
    now: "2026-08-24T08:01:00.000Z",
  });
  state = setPlan(state, {
    plan: {
      targetNodeId: "vectors",
      nodes: [{ id: "vectors", title: "Vectors" }],
      edges: [],
    },
    now: "2026-08-24T08:02:00.000Z",
  });
  state = beginTeach(state, { now: "2026-08-24T08:03:00.000Z" });
  state = recordStep(state, {
    id: "repair-step",
    nodeId: "vectors",
    foundation: "The learner already recognizes vector addition.",
    motivation: "Vector addition alone cannot express scaling by field elements.",
    explanation: "Scalar multiplication supplies the missing operation.",
    checkpointQuestion: "Transfer both operations to a new vector-space example.",
    now: "2026-08-24T08:04:00.000Z",
  });

  const session = getActiveSession(state);
  assert.equal(session.phase, "teach");
  assert.equal(session.activeStepId, "repair-step");
  assert.equal(session.checkpoint.status, "awaiting-answer");
  assert.equal(conceptForNode(state, session, "vectors").retry.status, "new-transfer-required");
});

test("a dependency plan cannot omit a diagnosed retry concept", () => {
  let state = recordAssessment(fresh(), answer({
    grade: "incorrect",
    answer: "Only vector addition.",
    evidence: "The first attempt omitted scalar multiplication from the vector-space structure.",
    mistakeType: "missing-operation",
  }));
  state = recordAssessment(state, answer({
    id: "a2",
    grade: "incorrect",
    answer: "Vector addition and multiplication of vectors.",
    evidence: "The bounded retry still replaced scalar multiplication with an invalid vector product.",
  }));
  state = finishProbe(state, {
    summary: "The bounded probe established a gap in the operations defining vector structure.",
    now: "2026-08-24T08:01:00.000Z",
  });

  assert.throws(
    () => setPlan(state, {
      plan: {
        targetNodeId: "linear-functional",
        nodes: [{ id: "linear-functional", title: "Linear functional" }],
        edges: [],
      },
      now: "2026-08-24T08:02:00.000Z",
    }),
    /dependency plan must include diagnosed concept: vectors/i,
  );
  assert.equal(getActiveSession(state).plan, null);
  assert.equal(
    conceptForNode(state, getActiveSession(state), "linear-functional", { required: false }),
    null,
  );
});

test("a teaching checkpoint follows retry, teaching permission, and new transfer states", () => {
  let state = teaching();
  assert.equal(getActiveSession(state).checkpoint.status, "awaiting-answer");

  state = recordAssessment(state, teachingAttempt());
  assert.equal(getActiveSession(state).checkpoint.status, "retry-required");

  state = recordAssessment(state, teachingAttempt({
    id: "teach-a2",
    answer: "It still produces another vector.",
    evidence: "The bounded retry repeated the same incorrect vector-output model.",
    now: "2026-08-24T08:06:00.000Z",
  }));
  assert.equal(getActiveSession(state).checkpoint.status, "new-transfer-required");

  assert.throws(
    () => recordStep(state, {
      id: "step-2",
      nodeId: "linear-functional",
      foundation: "The prior step is not resolved.",
      motivation: "This should not advance yet.",
      explanation: "A new step would bypass required repair.",
      checkpointQuestion: "This question must not open.",
      now: "2026-08-24T08:07:00.000Z",
    }),
    /new transfer|required checkpoint/i,
  );
  assert.throws(
    () => recordAssessment(state, teachingAttempt({
      id: "teach-a3",
      grade: "correct",
      answer: "It maps a vector to a scalar linearly.",
      evidence: "Corrected the mapping only on the already-used question after teaching.",
      now: "2026-08-24T08:08:00.000Z",
    })),
    /new transfer question/i,
  );

  state = recordAssessment(state, teachingAttempt({
    id: "teach-a4",
    questionId: "teach-transfer-q1",
    question: "In a pricing model, what does a linear sensitivity consume and produce?",
    grade: "correct",
    answer: "It consumes a parameter-change vector and produces a scalar price change linearly.",
    evidence: "Transferred the repaired vector-to-scalar rule to a new pricing setting.",
    now: "2026-08-24T08:09:00.000Z",
  }));
  const session = getActiveSession(state);
  assert.equal(session.checkpoint.status, "resolved");
  assert.equal(session.checkpoint.resolvedEvidenceId, "teach-a4");
  assert.equal(session.activeStepId, null);
  assert.equal(conceptForNode(state, session, "linear-functional").retry, null);
});

test("contaminated evidence cannot resolve an awaiting teaching checkpoint", () => {
  const state = recordAssessment(teaching(), teachingAttempt({
    grade: "correct",
    answer: "The answer was exposed before I responded.",
    evidence: "Answer exposure makes this response unusable as checkpoint evidence.",
    contaminated: true,
  }));
  assert.equal(getActiveSession(state).activeStepId, "step-1");
  assert.equal(getActiveSession(state).checkpoint.status, "awaiting-answer");
});

test("a learning session cannot close from probe or plan", () => {
  assert.throws(
    () => closeSession(fresh(), { synthesis: "This cannot close before diagnosis.", now: NOW }),
    /cannot close.*probe/i,
  );
  assert.throws(
    () => closeSession(afterValidProbe(), {
      synthesis: "This cannot close before the teaching phase.",
      now: "2026-08-24T08:02:00.000Z",
    }),
    /cannot close.*plan/i,
  );
});
