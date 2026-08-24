import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
import { renderVault } from "../src/render.mjs";
import {
  recordSynthesisAssessment,
  startSynthesis,
} from "../src/synthesis.mjs";

const NOW = "2026-08-24T08:00:00.000Z";
const LATER = "2026-08-25T08:00:00.000Z";

function start(state = createInitialState({ now: NOW }), overrides = {}) {
  return startSession(state, {
    id: overrides.id ?? "s1",
    topic: overrides.topic ?? "Optimization",
    target: overrides.target ?? "Understand gradient direction",
    now: overrides.now ?? NOW,
    topicId: overrides.topicId,
    reuseConceptIds: overrides.reuseConceptIds,
  });
}

function assess(state, overrides = {}) {
  return recordAssessment(state, {
    id: overrides.id ?? "a1",
    questionId: overrides.questionId ?? "q1",
    nodeId: "gradient-direction",
    stage: "probe",
    kind: "prediction",
    question: "Which direction lowers the loss locally?",
    answer: overrides.answer ?? "The direction opposite the local increase.",
    grade: overrides.grade ?? "correct",
    evidence:
      overrides.evidence ??
      "Connected the local increase direction to the opposite descent update.",
    now: overrides.now ?? NOW,
  });
}

function closeValidSession(state, now) {
  let next = state;
  const sessionId = getActiveSession(next).id;
  if (getActiveSession(next).assessments.length === 0) {
    next = assess(next, {
      id: `${sessionId}-close-probe`,
      questionId: `${sessionId}-close-question`,
      now,
    });
  }
  next = finishProbe(next, {
    summary: "The opening probe is complete and the remaining target is explicit.",
    now,
  });
  const targetNodeId = `${sessionId}-remaining-target`;
  next = setPlan(next, {
    plan: {
      targetNodeId,
      nodes: [{ id: targetNodeId, title: "Remaining target" }],
      edges: [],
    },
    now,
  });
  next = beginTeach(next, { now });
  next = recordStep(next, {
    id: `${sessionId}-close-step`,
    nodeId: targetNodeId,
    foundation: "Local evidence identifies which nearby changes improve the objective.",
    motivation: "The remaining target must be demonstrated before the session can close.",
    explanation: "A descent update uses the negative local gradient direction.",
    checkpointQuestionId: `${sessionId}-close-transfer-question`,
    checkpointKind: "transfer",
    checkpointQuestion: "Which local direction should a new optimizer use to reduce its objective?",
    now,
  });
  next = recordAssessment(next, {
    id: `${sessionId}-close-transfer`,
    questionId: `${sessionId}-close-transfer-question`,
    nodeId: targetNodeId,
    stage: "teach",
    kind: "transfer",
    question: "Which local direction should a new optimizer use to reduce its objective?",
    answer: "It should update opposite the local gradient.",
    grade: "correct",
    evidence: "Transferred the local gradient direction into a new optimizer setting.",
    now,
  });
  next = startSynthesis(next, {
    questionId: `${sessionId}-close-synthesis-question`,
    question: "Connect local slope evidence to the optimizer's update direction.",
    now,
  });
  next = recordSynthesisAssessment(next, {
    id: `${sessionId}-close-synthesis`,
    questionId: `${sessionId}-close-synthesis-question`,
    question: "Connect local slope evidence to the optimizer's update direction.",
    answer: "The gradient gives the local increase direction, so descent updates in the opposite direction.",
    grade: "correct",
    evidence: "Connected the meaning of the local gradient to the sign of the descent update.",
    now,
  });
  return closeSession(next, {
    now,
  });
}

test("an assessment creates learner-level concept evidence instead of session knowledge", () => {
  const state = assess(start());
  const session = getActiveSession(state);
  const concept = conceptForNode(state, session, "gradient-direction");

  assert.equal(Object.hasOwn(session, "knowledge"), false);
  assert.deepEqual(session.conceptIds, [concept.id]);
  assert.deepEqual(concept.evidenceIds, ["a1"]);
  assert.deepEqual(concept.sourceSessionIds, ["s1"]);
  assert.equal(state.reviews[concept.reviewId].level, 0);
});

test("a later session explicitly reuses prior concept evidence", () => {
  let state = assess(start());
  const firstSession = getActiveSession(state);
  const concept = conceptForNode(state, firstSession, "gradient-direction");
  const topicId = firstSession.topicId;
  state = closeValidSession(state, NOW);
  state = start(state, {
    id: "s2",
    target: "Understand momentum",
    topicId,
    reuseConceptIds: [concept.id],
    now: LATER,
  });

  const secondSession = getActiveSession(state);
  assert.deepEqual(secondSession.conceptIds, [concept.id]);
  assert.deepEqual(state.concepts[concept.id].evidenceIds, ["a1"]);
});

test("new evidence in a later session appends to the reused concept", () => {
  let state = assess(start());
  const firstSession = getActiveSession(state);
  const concept = conceptForNode(state, firstSession, "gradient-direction");
  const topicId = firstSession.topicId;
  state = closeValidSession(state, NOW);
  state = start(state, {
    id: "s2",
    target: "Apply gradient direction again",
    topicId,
    reuseConceptIds: [concept.id],
    now: LATER,
  });
  state = assess(state, { id: "a2", questionId: "q2", now: LATER });

  assert.deepEqual(state.concepts[concept.id].evidenceIds, ["a1", "a2"]);
  assert.deepEqual(state.concepts[concept.id].sourceSessionIds, ["s1", "s2"]);
});

test("reusing a topic identity with a conflicting name is rejected", () => {
  let state = start(undefined, { topicId: "topic-fixed" });
  state = closeValidSession(state, NOW);

  assert.throws(
    () =>
      start(state, {
        id: "s2",
        topic: "A different topic",
        topicId: "topic-fixed",
        now: LATER,
      }),
    /is named Optimization, not A different topic/,
  );
});

test("a concept cannot be reused under a different topic identity", () => {
  let state = assess(start());
  const firstSession = getActiveSession(state);
  const concept = conceptForNode(state, firstSession, "gradient-direction");
  state = closeValidSession(state, NOW);

  assert.throws(
    () =>
      start(state, {
        id: "s2",
        topic: "Momentum",
        reuseConceptIds: [concept.id],
        now: LATER,
      }),
    /belongs to a different topic/,
  );
});

test("topic notes use identity suffixes so colliding slugs do not overwrite", () => {
  let state = start(undefined, { id: "s1", topic: "C++" });
  state = closeValidSession(state, NOW);
  state = start(state, { id: "s2", topic: "C--", now: LATER });
  state = closeValidSession(state, LATER);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-concepts-"));

  renderVault(root, state);

  const topicFiles = fs.readdirSync(path.join(root, "vault", "Topics"));
  assert.equal(topicFiles.length, 2);
  assert.equal(new Set(topicFiles).size, 2);
  assert.equal(topicFiles.every((name) => /^c-[a-z0-9-]+\.md$/.test(name)), true);
});
