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
  materializeTeachingCheckpointQuestion,
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

function freeQuestion(overrides = {}) {
  return {
    id: "free-q1",
    stage: "probe",
    nodeId: "attention",
    kind: "explanation",
    question: "Explain how self-attention changes one token representation.",
    mode: "free-response",
    activityType: "free-response",
    strategyReason: "Recognition is insufficient; collect the learner's causal model.",
    supportLevel: 0,
    transferLevel: 1,
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

test("a free response is persisted with confidence and timing before assessment", () => {
  let state = startQuestion(fresh(), freeQuestion());
  let stored = state.sessions["session-1"].questions[0];
  assert.equal(stored.mode, "free-response");
  assert.deepEqual(stored.choices, []);
  assert.deepEqual(stored.correctChoiceValues, []);
  assert.equal(stored.activityType, "free-response");

  assert.throws(
    () => recordAssessment(state, {
      id: "too-early-a1",
      questionId: "free-q1",
      nodeId: "attention",
      stage: "probe",
      kind: "explanation",
      question: freeQuestion().question,
      answer: "It mixes contextual information.",
      grade: "partial",
      evidence: "The answer names contextual mixing but omits how relevance controls it.",
      now: T2,
    }),
    /not awaiting assessment/i,
  );

  state = answerQuestion(state, {
    questionId: "free-q1",
    responseId: "free-r1",
    textAnswer: "It compares the token with other tokens, then mixes their information by relevance.",
    confidence: 75,
    responseTimeMs: 42_000,
    note: "I am less certain about whether queries compare directly with values.",
    now: T2,
  });
  stored = state.sessions["session-1"].questions[0];
  assert.equal(stored.status, "awaiting-assessment");
  assert.equal(stored.responses[0].textAnswer, "It compares the token with other tokens, then mixes their information by relevance.");
  assert.equal(stored.responses[0].confidence, 75);
  assert.equal(stored.responses[0].responseTimeMs, 42_000);
  assert.equal(stored.responses[0].correct, null);

  state = recordAssessment(state, {
    id: "free-a1",
    questionId: "free-q1",
    nodeId: "attention",
    stage: "probe",
    kind: "explanation",
    question: freeQuestion().question,
    answer: stored.responses[0].textAnswer,
    grade: "partial",
    evidence: "Correctly described relevance-weighted mixing but did not separate query-key scoring from values.",
    mistakeType: "score-versus-content",
    now: T3,
  });
  const assessment = state.sessions["session-1"].assessments[0];
  assert.equal(assessment.confidence, 75);
  assert.equal(assessment.responseTimeMs, 42_000);
  assert.equal(state.sessions["session-1"].questions[0].status, "retry-required");
  assert.doesNotThrow(() => validateState(state));
});

test("a guarded productive-failure response is stored as an ungraded attempt", () => {
  let state = recordAssessment(fresh(), {
    id: "prerequisite-a1",
    questionId: "prerequisite-q1",
    nodeId: "token-representations",
    stage: "probe",
    kind: "explanation",
    question: "What does a token embedding represent before contextual mixing?",
    answer: "A learned vector associated with that token ID.",
    grade: "correct",
    evidence: "Explained that the initial vector is learned from token identity before contextual mixing.",
    now: T1,
  });
  state = finishProbe(state, {
    summary: "Token representations are established; self-attention is the next target.",
    now: T2,
  });
  state = setPlan(state, {
    plan: {
      targetNodeId: "self-attention",
      nodes: [
        { id: "token-representations", title: "Token representations" },
        { id: "self-attention", title: "Self-attention" },
      ],
      edges: [{ from: "token-representations", to: "self-attention", reason: "Attention mixes token representations" }],
    },
    now: T2,
  });
  state = beginTeach(state, { now: T2 });
  state = startQuestion(state, freeQuestion({
    id: "productive-q1",
    stage: "teach",
    nodeId: "self-attention",
    kind: "prediction",
    question: "Before being taught the mechanism, predict how a token could choose relevant context.",
    activityType: "productive-failure",
    strategyReason: "Prerequisites are durable and the target has not been attempted.",
    transferLevel: 0,
    now: T3,
  }));
  state = answerQuestion(state, {
    questionId: "productive-q1",
    responseId: "productive-r1",
    textAnswer: "Perhaps it learns a score for each other token and averages their vectors.",
    confidence: 35,
    responseTimeMs: 55_000,
    now: T3,
  });

  const session = state.sessions["session-1"];
  assert.equal(session.questions.at(-1).status, "resolved");
  assert.equal(session.questions.at(-1).responses[0].assessmentId, null);
  assert.equal(session.productiveAttempts.length, 1);
  assert.equal(session.productiveAttempts[0].answer, "Perhaps it learns a score for each other token and averages their vectors.");
  assert.equal(session.assessments.length, 1, "the productive attempt adds no grade");
  assert.doesNotThrow(() => validateState(state));
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
    checkpointMode: "single-select",
    checkpointChoices: firstQuestion().choices,
    checkpointCorrectChoiceValues: firstQuestion().correctChoiceValues,
    checkpointExplanation: firstQuestion().explanation,
    now: T3,
  });

  assert.throws(
    () => startQuestion(state, firstQuestion({ id: "wrong-teach-q", stage: "teach", now: T3 })),
    (error) => error.code === "CHECKPOINT_IDENTITY_MISMATCH",
  );

  const exact = firstQuestion({ id: "teach-q1", stage: "teach", now: T3 });
  state = startQuestion(state, exact);
  state = cancelQuestion(state, { questionId: exact.id, now: T3 });
  state.sessions["session-1"].steps[0].checkpointDefinition = null;
  state = materializeTeachingCheckpointQuestion(state, { questionId: exact.id, now: T3 });
  assert.equal(state.sessions["session-1"].questions[0].status, "awaiting-answer");
});

test("a cancelled teach checkpoint can resume only with the exact persisted question", () => {
  let state = recordAdmittedGap(fresh(), {
    id: "gap-attention-resume",
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
  const checkpointQuestion = "Explain why contextual mixing is needed.";
  state = recordStep(state, {
    id: "teach-step-resume",
    nodeId: "attention",
    foundation: "Tokens begin with independent representations.",
    motivation: "The model needs each token to use relevant context.",
    explanation: "Self-attention mixes information from other token representations.",
    checkpointQuestionId: "teach-free-resume",
    checkpointKind: "explanation",
    checkpointQuestion,
    activityType: "worked-example",
    strategyReason: "A missing foundation needs a worked example.",
    supportLevel: 4,
    now: T3,
  });
  const params = {
    id: "teach-free-resume",
    stage: "teach",
    nodeId: "attention",
    kind: "explanation",
    question: checkpointQuestion,
    mode: "free-response",
    activityType: "worked-example",
    strategyReason: "A missing foundation needs a worked example.",
    supportLevel: 4,
    now: T3,
  };

  state = startQuestion(state, params);
  state = cancelQuestion(state, { questionId: params.id, now: T3 });
  state = materializeTeachingCheckpointQuestion(state, { questionId: params.id, now: T3 });

  let question = state.sessions["session-1"].questions[0];
  assert.equal(state.sessions["session-1"].questions.length, 1);
  assert.equal(question.status, "awaiting-answer");
  assert.equal(question.cancelledAt, null);

  state = cancelQuestion(state, { questionId: params.id, now: T3 });
  assert.throws(
    () => startQuestion(state, { ...params, activityType: "contrastive-case" }),
    (error) => error.code === "DUPLICATE_QUESTION",
  );
});

test("a cancelled probe can resume only with the exact persisted question", () => {
  const params = firstQuestion();
  let state = startQuestion(fresh(), params);
  state = cancelQuestion(state, { questionId: params.id, now: T2 });
  state = startQuestion(state, params);

  let question = state.sessions["session-1"].questions[0];
  assert.equal(state.sessions["session-1"].questions.length, 1);
  assert.equal(question.status, "awaiting-answer");
  assert.equal(question.cancelledAt, null);

  state = cancelQuestion(state, { questionId: params.id, now: T3 });
  assert.throws(
    () => startQuestion(state, { ...params, explanation: "A different hidden definition." }),
    (error) => error.code === "DUPLICATE_QUESTION",
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
    textAnswer: null,
    dontKnow: false,
    correct: true,
    confidence: null,
    responseTimeMs: null,
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
