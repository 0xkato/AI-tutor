import assert from "node:assert/strict";
import test from "node:test";

import { recordAssessment } from "../src/assessment.mjs";
import {
  beginTeach,
  closeSession,
  createInitialState,
  finishProbe,
  getActiveSession,
  recordAdmittedGap,
  recordStep,
  setPlan,
  startSession,
} from "../src/model.mjs";
import {
  recordSynthesisAssessment,
  startSynthesis,
} from "../src/synthesis.mjs";

const NOW = "2026-08-24T08:00:00.000Z";

function readyForSynthesis() {
  let state = startSession(createInitialState({ now: NOW }), {
    id: "s1",
    topic: "Durable recovery",
    target: "Explain process memory, durable state, and crash recovery",
    now: NOW,
  });
  state = recordAssessment(state, {
    id: "probe-a1",
    questionId: "probe-q1",
    nodeId: "process-memory",
    stage: "probe",
    kind: "explanation",
    question: "What happens to process memory when its process exits?",
    answer: "The memory owned by that process is released.",
    grade: "correct",
    evidence: "Explained that process-owned memory ends with the process lifetime.",
    now: NOW,
  });
  state = finishProbe(state, {
    summary: "Process lifetime is understood; recovery remains unverified.",
    now: NOW,
  });
  state = setPlan(state, {
    plan: {
      targetNodeId: "crash-recovery",
      nodes: [{ id: "crash-recovery", title: "Crash recovery" }],
      edges: [],
    },
    now: NOW,
  });
  state = beginTeach(state, { now: NOW });
  state = recordStep(state, {
    id: "step-1",
    nodeId: "crash-recovery",
    foundation: "A replacement process starts with a new address space.",
    motivation: "The replacement needs the newest state that survived the crash.",
    explanation: "Recovery reads a durable record and rebuilds new in-memory state from it.",
    checkpointQuestionId: "teach-q1",
    checkpointKind: "transfer",
    checkpointQuestion: "How does a replacement worker recover a committed counter?",
    now: NOW,
  });
  state = recordAssessment(state, {
    id: "teach-a1",
    questionId: "teach-q1",
    nodeId: "crash-recovery",
    stage: "teach",
    kind: "transfer",
    question: "How does a replacement worker recover a committed counter?",
    answer: "It reads the durable counter and initializes its new in-memory value from it.",
    grade: "correct",
    evidence: "Transferred durable reload into a new replacement-worker recovery case.",
    now: NOW,
  });
  return state;
}

function synthesisAttempt(overrides = {}) {
  return {
    id: "synthesis-a1",
    questionId: "synthesis-q1",
    question: "Connect process memory, durable state, and recovery after a crash.",
    answer: "Volatile state dies; durable state survives; the replacement reads it into new memory.",
    grade: "correct",
    evidence: "Connected loss of volatile state, survival of durable bytes, and explicit reload.",
    now: NOW,
    ...overrides,
  };
}

test("a learning session cannot close before its dependency frontier is complete", () => {
  let state = readyForSynthesis();
  state = structuredClone(state);
  state.sessions.s1.frontier = ["crash-recovery"];

  assert.throws(
    () => closeSession(state, { unresolvedGaps: [], now: NOW }),
    (error) => error.code === "PLAN_INCOMPLETE",
  );
});

test("the final synthesis question is durable before an answer exists", () => {
  const state = startSynthesis(readyForSynthesis(), {
    questionId: "synthesis-q1",
    question: "Connect process memory, durable state, and recovery after a crash.",
    now: NOW,
  });

  assert.deepEqual(getActiveSession(state).synthesisCheckpoint, {
    status: "awaiting-answer",
    questionId: "synthesis-q1",
    question: "Connect process memory, durable state, and recovery after a crash.",
    priorQuestionId: null,
    attempts: 0,
    resolvedEvidenceId: null,
    mistakeType: "",
  });
});

test("an admitted synthesis gap reopens the exact concept without a false assessment", () => {
  let state = startSynthesis(readyForSynthesis(), {
    questionId: "synthesis-q1",
    question: "Connect process memory, durable state, and recovery after a crash.",
    now: NOW,
  });
  state = recordAdmittedGap(state, {
    id: "synthesis-gap-1",
    questionId: "synthesis-q1",
    nodeId: "crash-recovery",
    statement: "I don't know how the durable record reconnects to replacement-process memory.",
    evidence: "The learner localized the synthesis gap to the durable reload step after a crash.",
    now: "2026-08-24T08:01:00.000Z",
  });

  const session = getActiveSession(state);
  const concept = state.concepts[session.conceptIds.find(
    (conceptId) => state.concepts[conceptId].key === "crash-recovery",
  )];
  assert.equal(session.assessments.length, 2);
  assert.equal(session.synthesisCheckpoint.status, "new-transfer-required");
  assert.equal(session.synthesisCheckpoint.priorQuestionId, "synthesis-q1");
  assert.equal(session.checkpointGaps.length, 1);
  assert.equal(session.checkpointGaps[0].stage, "synthesis");
  assert.equal(session.checkpointGaps[0].questionId, "synthesis-q1");
  assert.equal(concept.status, "gap");
  assert.equal(concept.retry.status, "new-transfer-required");
  assert.equal(concept.retry.answerMayBeTaught, true);
  assert.deepEqual(session.frontier, ["crash-recovery"]);

  state = recordStep(state, {
    id: "synthesis-gap-repair-step",
    nodeId: "crash-recovery",
    foundation: "A durable record survives the process that wrote it.",
    motivation: "A replacement process has empty volatile memory and must reconstruct state.",
    explanation: "The replacement explicitly reads the durable record and initializes new memory from it.",
    checkpointQuestionId: "synthesis-gap-transfer-q1",
    checkpointKind: "transfer",
    checkpointQuestion: "How does a replacement cache recover an acknowledged value after its process crashes?",
    now: "2026-08-24T08:02:00.000Z",
  });
  state = recordAssessment(state, {
    id: "synthesis-gap-transfer-a1",
    questionId: "synthesis-gap-transfer-q1",
    nodeId: "crash-recovery",
    stage: "teach",
    kind: "transfer",
    question: "How does a replacement cache recover an acknowledged value after its process crashes?",
    answer: "It reads the acknowledged value from durable storage into the replacement process's new memory.",
    grade: "correct",
    evidence: "Transferred durable reload into a new replacement-cache recovery scenario.",
    now: "2026-08-24T08:03:00.000Z",
  });
  state = startSynthesis(state, {
    questionId: "synthesis-transfer-q1",
    question: "A worker crashes after persisting one update and keeping another only in memory. What recovers?",
    now: "2026-08-24T08:04:00.000Z",
  });
  assert.equal(getActiveSession(state).synthesisCheckpoint.status, "awaiting-answer");
  assert.equal(getActiveSession(state).synthesisCheckpoint.priorQuestionId, "synthesis-q1");
});

test("close derives the whole-system synthesis from a clean correct assessment", () => {
  let state = startSynthesis(readyForSynthesis(), {
    questionId: "synthesis-q1",
    question: "Connect process memory, durable state, and recovery after a crash.",
    now: NOW,
  });
  state = recordSynthesisAssessment(state, synthesisAttempt());

  const active = getActiveSession(state);
  assert.equal(active.synthesisCheckpoint.status, "resolved");
  assert.equal(active.synthesisCheckpoint.resolvedEvidenceId, "synthesis-a1");
  assert.equal(active.assessments.at(-1).stage, "synthesis");
  assert.equal(active.assessments.at(-1).conceptId, null);

  state = closeSession(state, { unresolvedGaps: [], now: NOW });
  assert.equal(state.activeSessionId, null);
  assert.equal(
    state.sessions.s1.synthesis,
    "Volatile state dies; durable state survives; the replacement reads it into new memory.",
  );
});

test("synthesis follows same-question retry, teaching permission, and new-transfer rules", () => {
  let state = startSynthesis(readyForSynthesis(), {
    questionId: "synthesis-q1",
    question: "Connect process memory, durable state, and recovery after a crash.",
    now: NOW,
  });
  state = recordSynthesisAssessment(state, synthesisAttempt({
    grade: "incorrect",
    answer: "The replacement inherits the old process memory.",
    evidence: "Incorrectly claimed that a replacement process inherits the crashed address space.",
    mistakeType: "process-inheritance",
  }));
  assert.equal(getActiveSession(state).synthesisCheckpoint.status, "retry-required");

  assert.throws(
    () => recordSynthesisAssessment(state, synthesisAttempt({
      id: "synthesis-a2",
      questionId: "different-question",
    })),
    (error) => error.code === "SYNTHESIS_RETRY_REQUIRED",
  );

  state = recordSynthesisAssessment(state, synthesisAttempt({
    id: "synthesis-a2",
    grade: "incorrect",
    answer: "The replacement still inherits the old process memory.",
    evidence: "The bounded retry repeated the same process-memory inheritance error.",
    mistakeType: "process-inheritance",
  }));
  assert.equal(getActiveSession(state).synthesisCheckpoint.status, "new-transfer-required");

  assert.throws(
    () => recordSynthesisAssessment(state, synthesisAttempt({ id: "synthesis-a3" })),
    (error) => error.code === "SYNTHESIS_NEW_TRANSFER_REQUIRED",
  );

  state = startSynthesis(state, {
    questionId: "synthesis-transfer-q1",
    question: "A game server crashes after one checkpointed level and one memory-only level. What recovers?",
    now: NOW,
  });
  state = recordSynthesisAssessment(state, synthesisAttempt({
    id: "synthesis-a4",
    questionId: "synthesis-transfer-q1",
    question: "A game server crashes after one checkpointed level and one memory-only level. What recovers?",
    answer: "Only the checkpointed level survives; the replacement reads it into its new process memory.",
    evidence: "Transferred the complete survival and reload chain to a new game-server example.",
  }));
  assert.equal(getActiveSession(state).synthesisCheckpoint.status, "resolved");
});

test("contaminated synthesis evidence cannot resolve the final checkpoint", () => {
  let state = startSynthesis(readyForSynthesis(), {
    questionId: "synthesis-q1",
    question: "Connect process memory, durable state, and recovery after a crash.",
    now: NOW,
  });
  state = recordSynthesisAssessment(state, synthesisAttempt({
    contaminated: true,
    evidence: "The answer was exposed before the learner responded, so it cannot prove synthesis.",
  }));

  assert.equal(getActiveSession(state).synthesisCheckpoint.status, "awaiting-answer");
  assert.throws(
    () => closeSession(state, { unresolvedGaps: [], now: NOW }),
    (error) => error.code === "SYNTHESIS_UNRESOLVED",
  );
});
