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
import { startQuestion } from "../src/questions.mjs";

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
    checkpointQuestionId: "teach-q1",
    checkpointKind: "transfer",
    checkpointQuestion: "What must a linear temperature sensitivity consume and produce?",
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

test("productive failure is rejected for an admitted knowledge gap", () => {
  let state = recordAssessment(fresh(), answer({
    grade: "incorrect",
    answer: "Only vector addition.",
    evidence: "The learner omitted scalar multiplication from the vector-space structure.",
    mistakeType: "admitted-gap",
  }));
  state = recordAssessment(state, answer({
    id: "a2",
    grade: "incorrect",
    answer: "Vector addition and vector multiplication.",
    evidence: "The retry still replaced scalar multiplication with an invalid vector product.",
  }));
  state = finishProbe(state, {
    summary: "Vector operations are an established gap and must be taught.",
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

  assert.throws(
    () => startQuestion(state, {
      id: "invalid-productive-q1",
      stage: "teach",
      nodeId: "vectors",
      kind: "prediction",
      question: "Invent the missing vector-space operation before it is taught.",
      mode: "free-response",
      activityType: "productive-failure",
      strategyReason: "Attempt the admitted gap independently.",
      supportLevel: 0,
      transferLevel: 0,
      now: "2026-08-24T08:04:00.000Z",
    }),
    (error) => error.code === "PRODUCTIVE_FAILURE_NOT_ALLOWED",
  );
});

test("a teaching question identity is durable before its answer and cannot be replaced", () => {
  const state = teaching();
  const session = getActiveSession(state);
  const step = session.steps.find((item) => item.id === "step-1");

  assert.equal(step.checkpointQuestionId, "teach-q1");
  assert.equal(step.checkpointKind, "transfer");
  assert.equal(session.checkpoint.questionId, "teach-q1");
  assert.equal(session.checkpoint.question, step.checkpointQuestion);
  assert.equal(session.checkpoint.kind, "transfer");
  assert.throws(
    () => recordAssessment(state, teachingAttempt({ questionId: "replacement-q1" })),
    (error) => error.code === "CHECKPOINT_IDENTITY_MISMATCH",
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
    checkpointQuestionId: "repair-transfer-q1",
    checkpointKind: "transfer",
    checkpointQuestion: "Transfer both operations to a new vector-space example.",
    now: "2026-08-24T08:04:00.000Z",
  });

  const session = getActiveSession(state);
  assert.equal(session.phase, "teach");
  assert.equal(session.activeStepId, "repair-step");
  assert.equal(session.checkpoint.status, "awaiting-answer");
  assert.equal(conceptForNode(state, session, "vectors").retry.status, "new-transfer-required");
});

test("a correct teaching multiple-choice answer can advance to a new durable transfer checkpoint", () => {
  let state = setPlan(afterValidProbe(), {
    plan: {
      targetNodeId: "linear-functional",
      nodes: [{ id: "linear-functional", title: "Linear functional" }],
      edges: [],
    },
    now: "2026-08-24T08:02:00.000Z",
  });
  state = beginTeach(state, { now: "2026-08-24T08:03:00.000Z" });
  state = recordStep(state, {
    id: "recognition-step",
    nodeId: "linear-functional",
    foundation: "A linear map preserves vector addition and scalar multiplication.",
    motivation: "We need a scalar measurement that respects vector structure.",
    explanation: "A linear functional maps a vector to a scalar linearly.",
    checkpointQuestionId: "recognition-q1",
    checkpointKind: "multiple-choice",
    checkpointQuestion: "Which output type does a linear functional produce?",
    now: "2026-08-24T08:04:00.000Z",
  });
  state = recordAssessment(state, {
    id: "recognition-a1",
    questionId: "recognition-q1",
    nodeId: "linear-functional",
    stage: "teach",
    kind: "multiple-choice",
    question: "Which output type does a linear functional produce?",
    answer: "A scalar",
    grade: "correct",
    evidence: "Selected the scalar output rather than another vector output.",
    mistakeType: "",
    now: "2026-08-24T08:05:00.000Z",
  });

  const concept = conceptForNode(state, getActiveSession(state), "linear-functional");
  assert.equal(concept.retry.status, "new-transfer-required");
  assert.equal(concept.retry.answerMayBeTaught, false);
  state = recordStep(state, {
    id: "durable-transfer-step",
    nodeId: "linear-functional",
    foundation: "The learner already recognized that the output is scalar.",
    motivation: "Recognition alone does not establish transfer to a new setting.",
    explanation: "Use the same input-output relationship in an unfamiliar measurement scenario.",
    checkpointQuestionId: "durable-transfer-q1",
    checkpointKind: "transfer",
    checkpointQuestion: "What must a linear temperature sensitivity consume and produce?",
    now: "2026-08-24T08:06:00.000Z",
  });

  assert.equal(getActiveSession(state).checkpoint.status, "awaiting-answer");
  assert.equal(getActiveSession(state).checkpoint.questionId, "durable-transfer-q1");
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
    () => recordAssessment(state, teachingAttempt({
      id: "teach-a3",
      grade: "correct",
      answer: "It maps a vector to a scalar linearly.",
      evidence: "Corrected the mapping only on the already-used question after teaching.",
      now: "2026-08-24T08:08:00.000Z",
    })),
    (error) => ["CHECKPOINT_IDENTITY_MISMATCH", "NEW_TRANSFER_REQUIRED"].includes(error.code),
  );
  assert.throws(
    () => recordStep(state, {
      id: "invalid-repair-step",
      nodeId: "linear-functional",
      foundation: "The prior question has already received two misses.",
      motivation: "Repeating it would not provide new transfer evidence.",
      explanation: "A replacement checkpoint must use a new question identity.",
      checkpointQuestionId: "teach-q1",
      checkpointKind: "transfer",
      checkpointQuestion: "What must a linear temperature sensitivity consume and produce?",
      now: "2026-08-24T08:07:00.000Z",
    }),
    (error) => error.code === "NEW_TRANSFER_REQUIRED",
  );

  state = recordStep(state, {
    id: "repair-step-2",
    nodeId: "linear-functional",
    foundation: "The learner retains that a linear map preserves vector structure.",
    motivation: "The prior attempts confused the output type, so the rule needs a new setting.",
    explanation: "A linear functional consumes a vector and produces one scalar linearly.",
    checkpointQuestionId: "teach-transfer-q1",
    checkpointKind: "transfer",
    checkpointQuestion: "In a pricing model, what does a linear sensitivity consume and produce?",
    now: "2026-08-24T08:08:00.000Z",
  });
  let session = getActiveSession(state);
  assert.equal(session.activeStepId, "repair-step-2");
  assert.equal(session.checkpoint.status, "awaiting-answer");
  assert.equal(session.checkpoint.questionId, "teach-transfer-q1");
  assert.equal(session.checkpoint.priorQuestionId, "teach-q1");

  state = recordAssessment(state, teachingAttempt({
    id: "teach-a4",
    questionId: "teach-transfer-q1",
    question: "In a pricing model, what does a linear sensitivity consume and produce?",
    grade: "correct",
    answer: "It consumes a parameter-change vector and produces a scalar price change linearly.",
    evidence: "Transferred the repaired vector-to-scalar rule to a new pricing setting.",
    now: "2026-08-24T08:09:00.000Z",
  }));
  session = getActiveSession(state);
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
