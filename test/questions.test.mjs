import assert from "node:assert/strict";
import test from "node:test";

import { recordAssessment } from "../src/assessment.mjs";
import {
  beginTeach,
  createInitialState,
  finishProbe,
  recordAdmittedGap,
  recordStep,
  setPlan,
  startSession,
} from "../src/model.mjs";
import {
  addLearnerNote,
  answerQuestion,
  cancelQuestion,
  learnerQuestion,
  startQuestion,
} from "../src/questions.mjs";
import { validateState } from "../src/schema.mjs";

const T0 = "2026-08-25T08:00:00.000Z";
const T1 = "2026-08-25T08:01:00.000Z";
const T2 = "2026-08-25T08:02:00.000Z";
const T3 = "2026-08-25T08:03:00.000Z";

function fresh() {
  return startSession(createInitialState({ now: T0 }), {
    id: "session-1",
    topicId: "topic-1",
    topic: "Transformers",
    target: "Understand how Transformers process tokens",
    now: T0,
  });
}

function firstQuestion(overrides = {}) {
  return {
    id: "probe-q1",
    stage: "probe",
    nodeId: "attention",
    kind: "multiple-choice",
    question: "What does self-attention change for one token?",
    mode: "single-select",
    choices: [
      { value: "position", label: "Only its position number" },
      { value: "context", label: "Its representation using other tokens" },
      { value: "vocabulary", label: "The vocabulary size" },
    ],
    correctChoiceValues: ["context"],
    explanation: "Self-attention mixes information from other token representations.",
    now: T1,
    ...overrides,
  };
}

test("a pending question is durable and learner-facing output redacts its key", () => {
  const state = startQuestion(fresh(), firstQuestion());
  const stored = state.sessions["session-1"].questions[0];

  assert.equal(stored.status, "awaiting-answer");
  assert.deepEqual(stored.correctChoiceValues, ["context"]);
  assert.deepEqual(stored.responses, []);

  const visible = learnerQuestion(stored);
  assert.equal(visible.question, stored.question);
  assert.deepEqual(visible.choices, stored.choices);
  assert.equal("correctChoiceValues" in visible, false);
  assert.equal("explanation" in visible, false);
});

test("only one unresolved question may exist in a session", () => {
  const state = startQuestion(fresh(), firstQuestion());

  assert.throws(
    () => startQuestion(state, firstQuestion({ id: "probe-q2" })),
    (error) => error.code === "QUESTION_PENDING",
  );
});

test("interactive multiple-choice questions cannot impersonate durable retention evidence", () => {
  assert.throws(
    () => startQuestion(fresh(), firstQuestion({ stage: "retention" })),
    (error) =>
      error.code === "INVALID_STAGE" &&
      /probe or teach/i.test(error.message),
  );
});

test("an interactive question stage must match the active learning phase", () => {
  assert.throws(
    () => startQuestion(fresh(), firstQuestion({ stage: "teach" })),
    (error) => error.code === "INVALID_PHASE" && /teach phase/i.test(error.message),
  );
});

test("state validation rejects a tampered retention-stage interactive question", () => {
  const state = startQuestion(fresh(), firstQuestion());
  state.sessions["session-1"].questions[0].stage = "retention";

  assert.throws(
    () => validateState(state),
    /questions\[0\]\.stage has unsupported value: retention/i,
  );
});

test("a teach-stage question must exactly match the active persisted checkpoint", () => {
  let state = recordAdmittedGap(fresh(), {
    id: "gap-attention",
    nodeId: "attention",
    statement: "I do not yet understand how attention changes a token representation.",
    evidence: "The learner explicitly identified contextual token mixing as the missing mechanism.",
    now: T1,
  });
  state = finishProbe(state, { summary: "Attention is the admitted gap.", now: T2 });
  state = setPlan(state, {
    plan: {
      targetNodeId: "attention",
      nodes: [{ id: "attention", title: "Contextual token mixing" }],
      edges: [],
    },
    now: T2,
  });
  state = beginTeach(state, { now: T2 });
  state = recordStep(state, {
    id: "teach-step-1",
    nodeId: "attention",
    foundation: "Tokens begin with independent representations.",
    motivation: "The model needs each token to use relevant context.",
    explanation: "Self-attention mixes information from other token representations.",
    checkpointQuestionId: "teach-q1",
    checkpointKind: "multiple-choice",
    checkpointQuestion: firstQuestion().question,
    now: T3,
  });

  assert.throws(
    () => startQuestion(state, firstQuestion({ id: "wrong-teach-q", stage: "teach", now: T3 })),
    (error) => error.code === "CHECKPOINT_IDENTITY_MISMATCH",
  );
});

test("answer and optional note persist atomically before assessment", () => {
  const started = startQuestion(fresh(), firstQuestion());
  const state = answerQuestion(started, {
    questionId: "probe-q1",
    responseId: "response-1",
    selectedChoiceValues: ["context"],
    noteId: "note-1",
    note: "This is the part that lets a token use earlier context.",
    now: T2,
  });
  const session = state.sessions["session-1"];
  const question = session.questions[0];

  assert.equal(question.status, "awaiting-assessment");
  assert.deepEqual(question.responses[0], {
    id: "response-1",
    selectedChoiceValues: ["context"],
    dontKnow: false,
    correct: true,
    noteId: "note-1",
    assessmentId: null,
    createdAt: T2,
  });
  assert.deepEqual(session.notes[0], {
    id: "note-1",
    targetType: "question",
    targetId: "probe-q1",
    body: "This is the part that lets a token use earlier context.",
    createdAt: T2,
    updatedAt: T2,
  });
});

test("I don't know is a separate admitted-gap signal rather than a guessed answer", () => {
  const started = startQuestion(fresh(), firstQuestion());
  const state = answerQuestion(started, {
    questionId: "probe-q1",
    responseId: "response-1",
    dontKnow: true,
    selectedChoiceValues: [],
    noteId: "note-1",
    note: "I know tokens interact, but not what representation changes.",
    now: T2,
  });
  const question = state.sessions["session-1"].questions[0];

  assert.equal(question.status, "gap");
  assert.equal(question.responses[0].dontKnow, true);
  assert.equal(question.responses[0].correct, false);
  assert.deepEqual(question.responses[0].selectedChoiceValues, []);
});

test("a deterministic assessment resolves the response and permits an explained adaptive child", () => {
  let state = startQuestion(fresh(), firstQuestion());
  state = answerQuestion(state, {
    questionId: "probe-q1",
    responseId: "response-1",
    selectedChoiceValues: ["context"],
    now: T2,
  });
  state = recordAssessment(state, {
    id: "assessment-1",
    questionId: "probe-q1",
    nodeId: "attention",
    stage: "probe",
    kind: "multiple-choice",
    question: firstQuestion().question,
    answer: "Its representation using other tokens",
    grade: "correct",
    evidence: "The selected option correctly identifies contextual representation mixing.",
    mistakeType: "",
    now: T3,
  });

  const resolved = state.sessions["session-1"].questions[0];
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.responses[0].assessmentId, "assessment-1");

  assert.throws(
    () => startQuestion(state, firstQuestion({ id: "probe-q2", now: T3 })),
    (error) => error.code === "ADAPTATION_REQUIRED",
  );

  state = startQuestion(
    state,
    firstQuestion({
      id: "probe-q2",
      nodeId: "attention-weights",
      question: "What determines how strongly one token uses another?",
      parentQuestionId: "probe-q1",
      adaptationReason: "Correct; test the next harder boundary inside attention.",
      now: T3,
    }),
  );
  const child = state.sessions["session-1"].questions[1];
  assert.equal(child.parentQuestionId, "probe-q1");
  assert.match(child.adaptationReason, /harder boundary/i);
});

test("a first wrong assessment keeps the same persisted question available for retry", () => {
  let state = startQuestion(fresh(), firstQuestion());
  state = answerQuestion(state, {
    questionId: "probe-q1",
    responseId: "response-1",
    selectedChoiceValues: ["position"],
    now: T2,
  });
  state = recordAssessment(state, {
    id: "assessment-1",
    questionId: "probe-q1",
    nodeId: "attention",
    stage: "probe",
    kind: "multiple-choice",
    question: firstQuestion().question,
    answer: "Only its position number",
    grade: "incorrect",
    evidence: "The selected option confuses position metadata with contextual token mixing.",
    mistakeType: "position-for-context",
    now: T3,
  });

  const question = state.sessions["session-1"].questions[0];
  assert.equal(question.status, "retry-required");
  assert.equal(question.responses[0].assessmentId, "assessment-1");
  assert.equal("correctChoiceValues" in learnerQuestion(question), false);
});

test("questions can be cancelled and notes can target sessions, concepts, or steps", () => {
  let state = startQuestion(fresh(), firstQuestion());
  state = cancelQuestion(state, { questionId: "probe-q1", now: T2 });
  assert.equal(state.sessions["session-1"].questions[0].status, "cancelled");

  assert.throws(
    () => startQuestion(state, firstQuestion({
      id: "probe-q2",
      parentQuestionId: "probe-q1",
      adaptationReason: "Continue after cancellation.",
      now: T3,
    })),
    (error) => error.code === "INVALID_PARENT_QUESTION",
  );

  state = startQuestion(state, firstQuestion({ id: "probe-q2", now: T3 }));
  assert.equal(state.sessions["session-1"].questions[1].parentQuestionId, null);

  state = cancelQuestion(state, { questionId: "probe-q2", now: T3 });

  state = addLearnerNote(state, {
    id: "session-note",
    targetType: "session",
    targetId: "session-1",
    body: "Come back to the difference between attention weights and values.",
    now: T3,
  });
  assert.equal(state.sessions["session-1"].notes[0].targetType, "session");

  assert.throws(
    () => addLearnerNote(state, {
      id: "bad-note",
      targetType: "concept",
      targetId: "missing-concept",
      body: "This target does not exist.",
      now: T3,
    }),
    (error) => error.code === "NOTE_TARGET_NOT_FOUND",
  );
});

test("a contaminated interactive answer is discarded as an adaptive parent", () => {
  let state = startQuestion(fresh(), firstQuestion());
  state = answerQuestion(state, {
    questionId: "probe-q1",
    responseId: "response-1",
    selectedChoiceValues: ["context"],
    now: T2,
  });
  state = recordAssessment(state, {
    id: "assessment-contaminated",
    questionId: "probe-q1",
    nodeId: "attention",
    stage: "probe",
    kind: "multiple-choice",
    question: firstQuestion().question,
    answer: "Its representation using other tokens",
    grade: "correct",
    evidence: "The answer was exposed, so this selection cannot count as learning evidence.",
    contaminated: true,
    now: T3,
  });

  assert.equal(state.sessions["session-1"].questions[0].status, "contaminated");
  assert.throws(
    () => startQuestion(state, firstQuestion({
      id: "probe-q2",
      parentQuestionId: "probe-q1",
      adaptationReason: "Continue from exposed evidence.",
      now: T3,
    })),
    (error) => error.code === "INVALID_PARENT_QUESTION",
  );

  state = startQuestion(state, firstQuestion({ id: "probe-q2", now: T3 }));
  assert.equal(state.sessions["session-1"].questions[1].parentQuestionId, null);
});

test("question status must agree with whether its bound assessment was contaminated", () => {
  let resolved = startQuestion(fresh(), firstQuestion());
  resolved = answerQuestion(resolved, {
    questionId: "probe-q1",
    responseId: "response-resolved",
    selectedChoiceValues: ["context"],
    now: T2,
  });
  resolved = recordAssessment(resolved, {
    id: "assessment-resolved",
    questionId: "probe-q1",
    nodeId: "attention",
    stage: "probe",
    kind: "multiple-choice",
    question: firstQuestion().question,
    answer: "Its representation using other tokens",
    grade: "correct",
    evidence: "The selected option identifies contextual token mixing.",
    mistakeType: "",
    now: T3,
  });
  resolved.sessions["session-1"].questions[0].status = "contaminated";
  assert.throws(() => validateState(resolved), /status does not match assessment contamination/i);

  let contaminated = startQuestion(fresh(), firstQuestion());
  contaminated = answerQuestion(contaminated, {
    questionId: "probe-q1",
    responseId: "response-contaminated",
    selectedChoiceValues: ["context"],
    now: T2,
  });
  contaminated = recordAssessment(contaminated, {
    id: "assessment-contaminated-status",
    questionId: "probe-q1",
    nodeId: "attention",
    stage: "probe",
    kind: "multiple-choice",
    question: firstQuestion().question,
    answer: "Its representation using other tokens",
    grade: "correct",
    evidence: "The answer was exposed before selection, so it cannot count.",
    mistakeType: "",
    contaminated: true,
    now: T3,
  });
  contaminated.sessions["session-1"].questions[0].status = "resolved";
  assert.throws(() => validateState(contaminated), /status does not match assessment contamination/i);
});
