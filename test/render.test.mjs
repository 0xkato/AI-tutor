import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createInitialState } from "../src/model.mjs";
import { createMasteryProfile } from "../src/learning-strategy.mjs";
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

test("human-readable records expose adaptive strategy, mastery, misconceptions, calibration, and scheduling", () => {
  const adaptive = structuredClone(state);
  const session = adaptive.sessions.s1;
  const concept = adaptive.concepts["concept-1"];
  const review = adaptive.reviews["review-1"];
  concept.mastery = createMasteryProfile();
  concept.mastery.explanation = {
    level: 2,
    evidenceIds: ["free-a1"],
    attempts: 2,
    correct: 1,
    lastAssessedAt: "2026-08-24T09:05:00.000Z",
  };
  concept.highestTransferLevel = 2;
  concept.supportLevel = 1;
  concept.misconceptionIds = ["misconception-identity"];
  adaptive.misconceptions = {
    "misconception-identity": {
      id: "misconception-identity",
      conceptId: concept.id,
      statement: "A contextual operation changes the input identity.",
      status: "active",
      confidence: 88,
      occurrences: 2,
      relapses: 1,
      counterexample: "One input identity can produce different hidden states.",
      repair: "Separate identity from context-dependent representation.",
      evidenceIds: ["free-a1"],
      createdAt: "2026-08-24T09:05:00.000Z",
      updatedAt: "2026-08-24T09:05:00.000Z",
      resolvedAt: null,
    },
  };
  Object.assign(review, {
    stabilityDays: 7,
    difficulty: 64,
    lapses: 2,
    history: [{
      evidenceId: "free-a1",
      grade: "incorrect",
      kind: "explanation",
      confidence: 88,
      responseTimeMs: 42000,
      attemptCount: 1,
      supportLevel: 1,
      intervalDays: 1,
      stabilityDays: 0,
      difficulty: 64,
      lapses: 2,
      dueAt: "2026-08-25T08:00:00.000Z",
      createdAt: "2026-08-24T09:05:00.000Z",
    }],
  });
  Object.assign(session.steps[0], {
    activityType: "faded-example",
    strategyReason: "Prior causal explanation permits one less scaffold.",
    supportLevel: 1,
    transferLevel: 2,
  });
  session.activityHistory = [{
    id: "step-1",
    type: "faded-example",
    nodeId: "forms",
    questionId: "free-q1",
    reason: "Prior causal explanation permits one less scaffold.",
    transferLevel: 2,
    supportLevel: 1,
    createdAt: "2026-08-24T08:45:00.000Z",
  }];
  session.productiveAttempts = [{
    id: "productive-1",
    nodeId: "forms",
    questionId: "productive-q1",
    prompt: "Predict how a covector should act before seeing the construction.",
    answer: "It should consume a displacement and return a scalar.",
    rationale: "A measurement needs one direction-dependent numeric output.",
    confidence: 60,
    responseTimeMs: 30000,
    createdAt: "2026-08-24T08:44:00.000Z",
  }];
  session.questions = [{
    id: "free-q1",
    stage: "teach",
    nodeId: "forms",
    kind: "explanation",
    question: "Why does a covector return a scalar?",
    mode: "free-response",
    choices: [],
    correctChoiceValues: [],
    explanation: null,
    activityType: "contrastive-case",
    strategyReason: "An active identity misconception needs contrastive repair.",
    supportLevel: 1,
    transferLevel: 2,
    status: "retry-required",
    parentQuestionId: null,
    adaptationReason: null,
    responses: [{
      id: "free-r1",
      selectedChoiceValues: [],
      textAnswer: "It changes the vector identity.",
      dontKnow: false,
      correct: null,
      confidence: 88,
      responseTimeMs: 42000,
      noteId: null,
      assessmentId: "free-a1",
      createdAt: "2026-08-24T09:05:00.000Z",
    }],
    createdAt: "2026-08-24T09:04:00.000Z",
    cancelledAt: null,
  }];
  session.assessments = [{
    id: "free-a1",
    questionId: "free-q1",
    nodeId: "vectors",
    conceptId: concept.id,
    stage: "teach",
    kind: "explanation",
    question: "Why does a covector return a scalar?",
    answer: "It changes the vector identity.",
    grade: "incorrect",
    evidence: "The answer changes identity instead of explaining the scalar-valued linear measurement.",
    mistakeType: "identity-versus-representation",
    contaminated: false,
    confidence: 88,
    responseTimeMs: 42000,
    transferLevel: 2,
    supportLevel: 1,
    activityType: "contrastive-case",
    misconceptionIds: ["misconception-identity"],
    createdAt: "2026-08-24T09:05:00.000Z",
  }];

  const note = renderSessionNote(adaptive, session);
  const searchable = note.replaceAll("**", "");
  for (const expected of [
    "Activity: Faded example",
    "Strategy reason: Prior causal explanation permits one less scaffold.",
    "Support level: 1",
    "Transfer level: 2",
    "Learner answer: It changes the vector identity.",
    "Confidence: 88%",
    "Response time: 42000 ms",
    "Activity history",
    "Productive-failure attempts",
    "not graded as mastery evidence",
    "Mastery by ability",
    "Explanation: level 2",
    "Active misconceptions",
    "A contextual operation changes the input identity.",
    "Difficulty 64",
    "Lapses 2",
  ]) {
    assert.match(searchable, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
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
