import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createInitialState } from "../src/model.mjs";
import { renderSessionNote, renderVault, slugify } from "../src/render.mjs";

const state = createInitialState({ now: "2026-08-24T08:00:00.000Z" });
state.sessions.s1 = {
  id: "s1",
  kind: "learn",
  topic: "Differential Forms",
  topicId: "topic-1",
  target: "Build a causal introduction",
  learnerContext: "Knows basic calculus",
  phase: "teach",
  createdAt: "2026-08-24T08:00:00.000Z",
  updatedAt: "2026-08-24T09:00:00.000Z",
  completedAt: null,
  probeSummary: "Vectors are understood; covectors are the edge.",
  admittedGaps: [
    {
      id: "gap-1",
      nodeId: "forms",
      conceptId: "concept-1",
      statement: "I do not yet understand how covectors lead to differential forms.",
      evidence: "The learner explicitly identified the covector-to-form connection as missing before any assessment question.",
      createdAt: "2026-08-24T08:20:00.000Z",
    },
  ],
  conceptIds: ["concept-1"],
  assessments: [
    {
      id: "a1",
      questionId: "q1",
      nodeId: "vectors",
      conceptId: "concept-1",
      stage: "teach",
      kind: "explanation",
      question: "What operations define a vector?",
      answer: "Vector addition and scalar multiplication.",
      grade: "correct",
      evidence: "Explained vector addition and scalar multiplication causally.",
      mistakeType: "",
      contaminated: false,
      createdAt: "2026-08-24T09:00:00.000Z",
    },
  ],
  sources: [
    {
      id: "source-1",
      title: "Primary reference",
      url: "https://example.test/reference",
      sourceClass: "primary",
      supports: "Definition of a covector",
      verification: "Checked the definition against a second textbook.",
      createdAt: "2026-08-24T08:30:00.000Z",
    },
  ],
  plan: {
    targetNodeId: "forms",
    nodes: [
      { id: "vectors", title: "Vectors" },
      { id: "forms", title: "Differential forms" },
    ],
    edges: [{ from: "vectors", to: "forms", reason: "Generalization" }],
  },
  frontier: ["forms"],
  steps: [
    {
      id: "step-1",
      nodeId: "forms",
      foundation: "A linear functional is defined by linearity.",
      motivation: "We need an object that measures a directed displacement.",
      explanation: "A covector accepts a vector and returns a scalar.",
      checkpointQuestion: "What does a covector consume and produce?",
      createdAt: "2026-08-24T08:45:00.000Z",
    },
  ],
  activeStepId: "step-1",
  visuals: [
    {
      id: "visual-1",
      path: "Assets/covector.svg",
      description: "Level sets and a vector",
      verification: "Labels and orientation inspected against the explanation.",
      createdAt: "2026-08-24T08:50:00.000Z",
    },
  ],
  synthesis: "",
  unresolvedGaps: [],
};
state.activeSessionId = "s1";
state.topics["topic-1"] = {
  id: "topic-1",
  name: "Differential Forms",
  createdAt: "2026-08-24T08:00:00.000Z",
  updatedAt: "2026-08-24T09:00:00.000Z",
  latestSessionId: "s1",
  sessionIds: ["s1"],
  conceptIds: ["concept-1"],
};
state.concepts["concept-1"] = {
  id: "concept-1",
  topicId: "topic-1",
  key: "vectors",
  title: "Vectors",
  status: "developing",
  latestGrade: "correct",
  evidenceIds: ["a1"],
  retry: null,
  reviewId: "review-1",
  sourceSessionIds: ["s1"],
  createdAt: "2026-08-24T08:00:00.000Z",
  updatedAt: "2026-08-24T09:00:00.000Z",
};
state.reviews["review-1"] = {
  id: "review-1",
  conceptId: "concept-1",
  level: 1,
  dueAt: "2026-08-25T08:00:00.000Z",
  completed: 1,
  status: "scheduled",
  updatedAt: "2026-08-24T09:00:00.000Z",
};

test("slugify prevents path traversal and produces stable note names", () => {
  assert.equal(slugify("../Differential Forms"), "differential-forms");
  assert.doesNotMatch(slugify("../../escape"), /\.\.|\//);
});

test("renderSessionNote contains the complete inspectable learning record", () => {
  const note = renderSessionNote(state, state.sessions.s1);
  for (const expected of [
    "# Differential Forms",
    "Build a causal introduction",
    "Vectors are understood; covectors are the edge.",
    "## Admitted gaps",
    "Not an assessment",
    "covector-to-form connection as missing",
    "```mermaid",
    "Definition of a covector",
    "## Teaching steps",
    "A linear functional is defined by linearity.",
    "Correct",
    "![[Assets/covector.svg]]",
    "2026-08-25T08:00:00.000Z",
  ]) {
    assert.match(note, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("renderSessionNote exposes an unfinished synthesis checkpoint for recovery", () => {
  const recovering = structuredClone(state.sessions.s1);
  recovering.synthesisRequired = true;
  recovering.synthesisCheckpoint = {
    status: "retry-required",
    questionId: "whole-system-q1",
    question: "Connect covectors to the complete differential-forms target.",
    priorQuestionId: null,
    attempts: 1,
    resolvedEvidenceId: null,
    mistakeType: "missing-alternation",
  };

  const note = renderSessionNote(state, recovering);
  for (const expected of [
    "Synthesis checkpoint",
    "Retry required",
    "whole-system-q1",
    "Connect covectors to the complete differential-forms target.",
    "Attempts:** 1",
    "missing-alternation",
  ]) {
    assert.match(note, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("renderSessionNote exposes the active review question before any answer", () => {
  const reviewing = structuredClone(state.sessions.s1);
  reviewing.kind = "review";
  reviewing.phase = "review";
  reviewing.assessments = [];
  reviewing.steps = [];
  reviewing.activeStepId = null;
  reviewing.checkpoint = {
    status: "awaiting-answer",
    nodeId: "vectors",
    questionId: "review-vectors-q1",
    question: "In a new navigation example, what must a displacement measurement consume and produce?",
    kind: "transfer",
    priorQuestionId: null,
    attempts: 0,
    resolvedEvidenceId: null,
    mistakeType: "",
  };
  reviewing.reviewItems = [
    {
      reviewId: "review-1",
      conceptId: "concept-1",
      status: "pending",
      outcomeGrade: null,
      evidenceIds: [],
      deferralReason: null,
      deferredUntil: null,
    },
  ];

  const note = renderSessionNote(state, reviewing);
  for (const expected of [
    "Active review checkpoint",
    "Awaiting answer",
    "review-vectors-q1",
    "navigation example",
    "Kind:** transfer",
    "Node:** `vectors`",
    "No assessments recorded",
  ]) {
    assert.match(note, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("renderVault writes home, session, topic, and review notes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-vault-"));
  renderVault(root, state);

  const vault = path.join(root, "vault");
  assert.equal(fs.existsSync(path.join(vault, "Home.md")), true);
  const sessionFiles = fs.readdirSync(path.join(vault, "Sessions"));
  assert.equal(sessionFiles.length, 1);
  assert.match(sessionFiles[0], /^differential-forms-[a-f0-9]{20}\.md$/);
  const topicFiles = fs.readdirSync(path.join(vault, "Topics"));
  assert.equal(topicFiles.length, 1);
  assert.match(topicFiles[0], /^differential-forms-[a-f0-9]{20}\.md$/);
  assert.equal(fs.existsSync(path.join(vault, "Reviews.md")), true);
  assert.match(fs.readFileSync(path.join(vault, "Home.md"), "utf8"), /Differential Forms/);
  assert.match(
    fs.readFileSync(path.join(vault, "Topics", topicFiles[0]), "utf8"),
    /Evidence history/,
  );
});
