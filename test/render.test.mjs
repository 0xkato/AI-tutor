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
  materials: [
    {
      id: "material-1",
      reference: "https://example.test/reference",
      kind: "web",
      status: "verified",
      title: "Primary reference",
      resolution: "Opened the supplied page and inspected the covector section.",
      createdAt: "2026-08-24T08:25:00.000Z",
      updatedAt: "2026-08-24T08:30:00.000Z",
    },
  ],
  sourceGuidance: {
    mode: "anchored",
    reason: null,
    updatedAt: "2026-08-24T08:30:00.000Z",
    history: [
      {
        mode: "supplemental-only",
        reason: "The learner explicitly chose supplemental research while the original guide was unavailable.",
        createdAt: "2026-08-24T08:28:00.000Z",
      },
      {
        mode: "anchored",
        reason: "Learner supplied an accessible replacement material.",
        createdAt: "2026-08-24T08:30:00.000Z",
      },
    ],
  },
  sources: [
    {
      id: "source-1",
      title: "Primary reference",
      url: "https://example.test/reference",
      sourceClass: "primary",
      supports: "Definition of a covector",
      verification: "Checked the definition against a second textbook.",
      role: "anchor",
      locator: "Section: Linear functionals",
      materialId: "material-1",
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
  sourceCoverage: [
    {
      id: "coverage-1",
      nodeId: "forms",
      sourceId: "source-1",
      summary: "The supplied section supports the covector-to-form foundation used in this node.",
      createdAt: "2026-08-24T08:40:00.000Z",
    },
  ],
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
    "## Supplied learning materials",
    "Opened the supplied page and inspected the covector section.",
    "Source-guidance mode",
    "Anchored",
    "Guidance transition history",
    "learner explicitly chose supplemental research",
    "Anchor",
    "Section: Linear functionals",
    "## Source coverage and understanding",
    "The supplied section supports the covector-to-form foundation used in this node.",
    "Understanding status",
    "Latest learner evidence",
    "Not demonstrated",
    "## Teaching steps",
    "A linear functional is defined by linearity.",
    "Source basis",
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

test("renderSessionNote preserves interactive choices, adaptive links, responses, and learner notes", () => {
  const interactive = structuredClone(state.sessions.s1);
  interactive.questions = [
    {
      id: "probe-attention-q1",
      stage: "probe",
      nodeId: "attention",
      kind: "multiple-choice",
      question: "What does self-attention change for one token?",
      mode: "single-select",
      choices: [
        { value: "position", label: "Only its position number", description: null },
        { value: "context", label: "Its representation using other tokens", description: null },
      ],
      correctChoiceValues: ["context"],
      explanation: "Self-attention mixes information from other token representations.",
      status: "resolved",
      parentQuestionId: null,
      adaptationReason: null,
      responses: [
        {
          id: "response-1",
          selectedChoiceValues: ["context"],
          dontKnow: false,
          correct: true,
          noteId: "note-1",
          assessmentId: "assessment-1",
          createdAt: "2026-08-24T08:25:00.000Z",
        },
      ],
      createdAt: "2026-08-24T08:20:00.000Z",
      cancelledAt: null,
    },
    {
      id: "probe-attention-q2",
      stage: "probe",
      nodeId: "attention-weights",
      kind: "multiple-choice",
      question: "What determines how strongly one token uses another?",
      mode: "single-select",
      choices: [
        { value: "similarity", label: "Query-key compatibility", description: null },
        { value: "alphabet", label: "Alphabetical order", description: null },
      ],
      correctChoiceValues: ["similarity"],
      explanation: "Compatibility scores become attention weights after normalization.",
      status: "awaiting-answer",
      parentQuestionId: "probe-attention-q1",
      adaptationReason: "Correct; test the next harder boundary inside attention.",
      responses: [],
      createdAt: "2026-08-24T08:30:00.000Z",
      cancelledAt: null,
    },
  ];
  interactive.notes = [
    {
      id: "note-1",
      targetType: "question",
      targetId: "probe-attention-q1",
      body: "This is where a token becomes contextual.",
      createdAt: "2026-08-24T08:25:00.000Z",
      updatedAt: "2026-08-24T08:25:00.000Z",
    },
    {
      id: "session-note",
      targetType: "session",
      targetId: "s1",
      body: "Return to query, key, and value roles later.",
      createdAt: "2026-08-24T08:31:00.000Z",
      updatedAt: "2026-08-24T08:31:00.000Z",
    },
  ];

  const note = renderSessionNote(state, interactive);
  for (const expected of [
    "## Questions and learner notes",
    "What does self-attention change for one token?",
    "Its representation using other tokens",
    "Outcome:** Correct",
    "This is where a token becomes contextual.",
    "What determines how strongly one token uses another?",
    "Correct; test the next harder boundary inside attention.",
    "Outcome:** Awaiting answer",
    "## Other learner notes",
    "Return to query, key, and value roles later.",
  ]) {
    assert.match(note, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(note, /correctChoiceValues|\*\*Correct answer:\*\*/);
  assert.doesNotMatch(note, /Compatibility scores become attention weights/);
});

test("renderVault writes home, session, topic, and review notes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-vault-"));
  state.learnerProfile = {
    teachingPhilosophy: "Build causal understanding before recall.",
    explanationPreferences: "One reasoning step at a time.",
    feedbackPreferences: "Assess only the explicit question.",
    visualPreferences: "Use visuals for relationships that prose obscures.",
    sourcePreferences: "Prefer primary sources.",
    updatedAt: "2026-08-24T09:00:00.000Z",
  };
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
  assert.equal(fs.existsSync(path.join(vault, "Profile.md")), true);
  assert.match(fs.readFileSync(path.join(vault, "Home.md"), "utf8"), /Differential Forms/);
  assert.match(fs.readFileSync(path.join(vault, "Home.md"), "utf8"), /Learner profile/);
  assert.match(fs.readFileSync(path.join(vault, "Profile.md"), "utf8"), /Build causal understanding/);
  assert.match(
    fs.readFileSync(path.join(vault, "Topics", topicFiles[0]), "utf8"),
    /Evidence history/,
  );
});

test("an empty learner profile renders built-in defaults as active", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-default-profile-"));
  const initial = createInitialState({ now: "2026-08-25T08:00:00.000Z" });

  renderVault(root, initial);

  const profile = fs.readFileSync(path.join(root, "vault", "Profile.md"), "utf8");
  assert.match(profile, /Built-in default active/i);
  assert.match(profile, /no custom overrides/i);
  assert.doesNotMatch(profile, /Not configured|Not recorded/i);
});
