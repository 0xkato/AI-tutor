import assert from "node:assert/strict";
import test from "node:test";

import { recordAssessment } from "../src/assessment.mjs";
import { conceptForNode } from "../src/concepts.mjs";
import {
  addMaterial,
  addSource,
  addVisual,
  beginTeach,
  closeSession,
  createInitialState,
  finishProbe,
  getActiveSession,
  recordSourceCoverage,
  recordStep,
  resolveMaterial,
  continueSupplementalOnly,
  setPlan,
  startSession,
} from "../src/model.mjs";
import {
  recordSynthesisAssessment,
  startSynthesis,
} from "../src/synthesis.mjs";

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

test("a teaching step persists the selected adaptive strategy", () => {
  let state = setPlan(planned(), { plan: dependencyPlan(), now });
  state = beginTeach(state, { now });
  state = recordStep(state, {
    id: "adaptive-step-1",
    nodeId: "covectors",
    foundation: "A covector is a linear functional.",
    motivation: "It measures a vector along a chosen linear axis.",
    explanation: "A covector consumes one vector and produces one scalar.",
    checkpointQuestionId: "adaptive-step-q1",
    checkpointKind: "transfer",
    checkpointQuestion: "What must a new displacement-measuring object consume and produce?",
    activityType: "faded-example",
    strategyReason: "Prior explanation evidence permits one less scaffold.",
    supportLevel: 2,
    transferLevel: 1,
    now,
  });

  const session = getActiveSession(state);
  assert.equal(session.steps[0].activityType, "faded-example");
  assert.equal(session.steps[0].supportLevel, 2);
  assert.equal(session.steps[0].transferLevel, 1);
  assert.deepEqual(session.activityHistory[0], {
    id: "adaptive-step-1",
    type: "faded-example",
    nodeId: "covectors",
    questionId: "adaptive-step-q1",
    reason: "Prior explanation evidence permits one less scaffold.",
    transferLevel: 1,
    supportLevel: 2,
    createdAt: now,
  });
});

test("an evidence-backed fading step may reinforce a demonstrated node after it leaves the dependency frontier", () => {
  let state = setPlan(planned(), { plan: dependencyPlan(), now });
  state = beginTeach(state, { now });
  const session = getActiveSession(state);
  const concept = conceptForNode(state, session, "covectors");
  concept.status = "developing";
  concept.supportLevel = 2;
  concept.mastery.application.attempts = 1;
  concept.mastery.application.correct = 1;
  concept.mastery.application.level = 2;
  concept.highestTransferLevel = 1;
  session.frontier = [];

  state = recordStep(state, {
    id: "faded-reinforcement-step",
    nodeId: "covectors",
    foundation: "The mechanism transferred once with two remaining support levels.",
    motivation: "The next check should remove one scaffold without changing the mechanism.",
    explanation: "Only the evidence-backed faded scaffold is supplied.",
    checkpointQuestionId: "faded-reinforcement-q1",
    checkpointKind: "transfer",
    checkpointQuestion: "Apply the same mechanism to a changed displacement example.",
    activityType: "faded-example",
    strategyReason: "Prior evidence supports fading the worked example at support level 2.",
    supportLevel: 2,
    transferLevel: null,
    now,
  });

  assert.equal(getActiveSession(state).activeStepId, "faded-reinforcement-step");
});

test("sources require explicit claim support and verification", () => {
  const state = planned();
  assert.throws(
    () => addSource(state, { title: "Source", url: "https://example.test", supports: "A claim", now }),
    /source class is required/,
  );
  assert.throws(
    () => addSource(state, {
      title: "Primary definition",
      url: "https://example.test/covectors",
      sourceClass: "primary",
      supports: "The definition of a covector as a linear functional.",
      verification: "Checked the definition and its assumptions against a second textbook.",
      now,
    }),
    /source locator is required/,
  );

  const next = addSource(state, {
    id: "source-1",
    title: "Primary definition",
    url: "https://example.test/covectors",
    sourceClass: "primary",
    locator: "Heading: Covectors",
    supports: "The definition of a covector as a linear functional.",
    verification: "Checked the definition and its assumptions against a second textbook.",
    now,
  });
  assert.equal(getActiveSession(next).sources[0].sourceClass, "primary");
  assert.equal(getActiveSession(next).sources[0].role, "supplemental");
  assert.equal(getActiveSession(next).sources[0].locator, "Heading: Covectors");
});

test("source-guided sessions preserve and resolve learner-supplied anchor material", () => {
  let state = startSession(createInitialState({ now }), {
    id: "guided-session",
    topic: "Transformers",
    target: "Understand self-attention from the supplied video",
    materials: [{
      id: "material-1",
      reference: "https://www.youtube.com/watch?v=example",
    }],
    now,
  });

  let session = getActiveSession(state);
  assert.deepEqual(session.materials[0], {
    id: "material-1",
    reference: "https://www.youtube.com/watch?v=example",
    kind: "youtube",
    status: "pending",
    title: null,
    resolution: null,
    createdAt: now,
    updatedAt: now,
  });

  state = resolveMaterial(state, {
    materialId: "material-1",
    status: "verified",
    title: "Transformer lesson",
    evidence: "Retrieved the complete video transcript and checked its timestamp order.",
    now,
  });
  session = getActiveSession(state);
  assert.equal(session.materials[0].status, "verified");
  assert.equal(session.materials[0].title, "Transformer lesson");

  assert.throws(
    () => resolveMaterial(state, {
      materialId: "material-1",
      status: "unavailable",
      evidence: "A later attempt failed.",
      now,
    }),
    /already resolved/,
  );
});

test("a local path without a file extension is classified as a repository", () => {
  const state = startSession(createInitialState({ now }), {
    id: "local-repository-session",
    topic: "Repository architecture",
    target: "Understand the supplied codebase",
    materials: [{ id: "material-1", reference: "local:./transformer-repo" }],
    now,
  });

  assert.equal(getActiveSession(state).materials[0].kind, "repository");
});

test("source-guided sessions can add a replacement material before teaching", () => {
  let state = startSession(createInitialState({ now }), {
    id: "guided-session",
    topic: "Transformers",
    target: "Understand attention",
    materials: [{ id: "material-1", reference: "https://example.test/unavailable-video" }],
    now,
  });
  state = resolveMaterial(state, {
    materialId: "material-1",
    status: "unavailable",
    evidence: "The host could not retrieve a transcript or accessible page for this reference.",
    now,
  });
  state = addMaterial(state, {
    id: "material-2",
    reference: "local:notes/attention.md",
    now,
  });

  const session = getActiveSession(state);
  assert.equal(session.materials.length, 2);
  assert.equal(session.materials[1].status, "pending");
  assert.equal(session.sourceGuidance.mode, "anchored");
  assert.throws(
    () => addMaterial(state, { reference: "local:notes/attention.md", now }),
    /duplicate material/i,
  );
});

test("ordinary sessions cannot become source-guided after teaching begins", () => {
  let state = setPlan(planned(), { plan: dependencyPlan(), now });
  state = beginTeach(state, { now });

  assert.throws(
    () => addMaterial(state, { reference: "local:notes/covectors.md", now }),
    /cannot convert.*after teaching/i,
  );
});

test("anchor claims require verified material while supplemental research stays distinct", () => {
  let state = startSession(createInitialState({ now }), {
    id: "guided-session",
    topic: "Transformers",
    target: "Understand attention",
    materials: [{ id: "material-1", reference: "local:notes/attention.md" }],
    now,
  });

  assert.throws(
    () => addSource(state, {
      id: "anchor-1",
      title: "Attention notes",
      url: "local:notes/attention.md",
      sourceClass: "learner-supplied",
      role: "anchor",
      locator: "Heading: Scaled dot-product attention",
      materialId: "material-1",
      supports: "The query-key comparison produces attention weights.",
      verification: "Matched the heading and surrounding explanation in the supplied notes.",
      now,
    }),
    /verified/,
  );

  state = resolveMaterial(state, {
    materialId: "material-1",
    status: "verified",
    title: "Attention notes",
    evidence: "Opened the local notes and inspected the complete attention section.",
    now,
  });
  state = addSource(state, {
    id: "anchor-1",
    title: "Attention notes",
    url: "local:notes/attention.md",
    sourceClass: "learner-supplied",
    role: "anchor",
    locator: "Heading: Scaled dot-product attention",
    materialId: "material-1",
    supports: "The query-key comparison produces attention weights.",
    verification: "Matched the claim to the exact heading in the supplied notes.",
    now,
  });
  state = addSource(state, {
    id: "supplemental-1",
    title: "Attention Is All You Need",
    url: "https://arxiv.org/abs/1706.03762",
    sourceClass: "primary",
    role: "supplemental",
    locator: "Section 3.2.1",
    supports: "Scaled dot-product attention divides logits by the square root of key dimension.",
    verification: "Checked the equation and definitions in the original paper.",
    now,
  });

  const [anchor, supplemental] = getActiveSession(state).sources;
  assert.equal(anchor.materialId, "material-1");
  assert.equal(anchor.role, "anchor");
  assert.equal(supplemental.materialId, null);
  assert.equal(supplemental.role, "supplemental");
});

test("source-guided teaching requires claim coverage for the exact plan node", () => {
  let state = startSession(createInitialState({ now }), {
    id: "guided-session",
    topic: "Covectors",
    target: "Understand covectors from supplied notes",
    materials: [{ id: "material-1", reference: "local:notes/covectors.md" }],
    now,
  });
  state = recordAssessment(state, {
    id: "probe-a1",
    questionId: "probe-q1",
    nodeId: "vectors",
    stage: "probe",
    kind: "explanation",
    question: "What operations define a vector space?",
    answer: "Vector addition and scalar multiplication.",
    grade: "correct",
    evidence: "Named both defining operations and their role in a vector space.",
    now,
  });
  state = finishProbe(state, {
    summary: "Vectors are established; covectors are the missing mechanism.",
    now,
  });
  state = resolveMaterial(state, {
    materialId: "material-1",
    status: "verified",
    title: "Covector notes",
    evidence: "Opened and inspected the complete local notes file.",
    now,
  });
  state = addSource(state, {
    id: "anchor-1",
    title: "Covector notes",
    url: "local:notes/covectors.md",
    sourceClass: "learner-supplied",
    role: "anchor",
    locator: "Heading: Linear functionals",
    materialId: "material-1",
    supports: "A covector is a linear map from vectors to scalars.",
    verification: "Matched the definition to the supplied heading.",
    now,
  });
  state = setPlan(state, {
    plan: {
      targetNodeId: "covectors",
      nodes: [
        { id: "vectors", title: "Vectors" },
        { id: "covectors", title: "Covectors" },
      ],
      edges: [{ from: "vectors", to: "covectors", reason: "Covectors act on vectors" }],
    },
    now,
  });
  state = beginTeach(state, { now });

  const step = {
    id: "step-1",
    nodeId: "covectors",
    foundation: "A linear map preserves vector addition and scalar multiplication.",
    motivation: "We need an object that measures a vector linearly.",
    explanation: "A covector maps a vector to a scalar linearly.",
    checkpointQuestionId: "step-1-q1",
    checkpointKind: "transfer",
    checkpointQuestion: "What must a covector consume and produce?",
    now,
  };
  assert.throws(() => recordStep(state, step), /source coverage.*covectors/i);

  state = recordSourceCoverage(state, {
    id: "coverage-1",
    nodeId: "covectors",
    sourceId: "anchor-1",
    summary: "The supplied linear-functionals section supports the covector input, output, and linearity mechanism.",
    now,
  });
  state = recordStep(state, step);
  assert.equal(getActiveSession(state).sourceCoverage[0].nodeId, "covectors");
  assert.equal(getActiveSession(state).activeStepId, "step-1");
});

function sourceGuidedTeachingState({ materialStatus = "pending" } = {}) {
  let state = startSession(createInitialState({ now }), {
    id: "guided-gate-session",
    topic: "Attention",
    target: "Understand the attention mechanism",
    materials: [{ id: "material-1", reference: "https://example.test/attention" }],
    now,
  });
  state = recordAssessment(state, {
    id: "probe-a1",
    questionId: "probe-q1",
    nodeId: "vectors",
    stage: "probe",
    kind: "explanation",
    question: "What is a vector?",
    answer: "An ordered collection of scalar values.",
    grade: "correct",
    evidence: "Identified the scalar components and their ordered vector representation.",
    now,
  });
  state = finishProbe(state, {
    summary: "Vectors are established; attention is the missing mechanism.",
    now,
  });
  if (materialStatus !== "pending") {
    state = resolveMaterial(state, {
      materialId: "material-1",
      status: materialStatus,
      title: materialStatus === "verified" ? "Attention guide" : undefined,
      evidence: materialStatus === "verified"
        ? "Opened the guide and inspected the complete attention section."
        : "The host could not retrieve the supplied guide after checking the reference.",
      now,
    });
  }
  state = addSource(state, {
    id: "supplemental-1",
    title: "Attention Is All You Need",
    url: "https://arxiv.org/abs/1706.03762",
    sourceClass: "primary",
    role: "supplemental",
    locator: "Section 3.2.1",
    supports: "Attention compares queries and keys to weight values.",
    verification: "Checked the mechanism in the original paper.",
    now,
  });
  state = setPlan(state, {
    plan: {
      targetNodeId: "attention",
      nodes: [{ id: "attention", title: "Attention" }],
      edges: [],
    },
    now,
  });
  state = recordSourceCoverage(state, {
    id: "coverage-1",
    nodeId: "attention",
    sourceId: "supplemental-1",
    summary: "The original paper supports the query-key-value attention mechanism.",
    now,
  });
  return beginTeach(state, { now });
}

function attentionStep() {
  return {
    id: "step-1",
    nodeId: "attention",
    foundation: "A weighted sum can combine information from multiple tokens.",
    motivation: "Each token needs relevant context from other tokens.",
    explanation: "Attention weights values using query-key compatibility.",
    checkpointQuestionId: "step-q1",
    checkpointKind: "transfer",
    checkpointQuestion: "How would a token select relevant context from two other tokens?",
    now,
  };
}

test("pending learner material blocks teaching even when supplemental coverage exists", () => {
  const state = sourceGuidedTeachingState();
  assert.throws(() => recordStep(state, attentionStep()), /material.*unresolved/i);
});

test("unavailable material requires an explicit supplemental-only decision", () => {
  let state = sourceGuidedTeachingState({ materialStatus: "unavailable" });
  assert.throws(() => recordStep(state, attentionStep()), /anchor.*unavailable/i);

  state = continueSupplementalOnly(state, {
    reason: "The learner explicitly chose to continue using verified supplemental research because the supplied guide was inaccessible.",
    now,
  });
  state = recordStep(state, attentionStep());
  assert.equal(getActiveSession(state).sourceGuidance.mode, "supplemental-only");
  assert.equal(getActiveSession(state).activeStepId, "step-1");

  state = addMaterial(state, {
    id: "replacement-after-consent",
    reference: "local:notes/replacement.md",
    now,
  });
  assert.equal(getActiveSession(state).sourceGuidance.mode, "anchored");
  assert.equal(getActiveSession(state).sourceGuidance.reason, null);
  assert.deepEqual(getActiveSession(state).sourceGuidance.history, [
    {
      mode: "supplemental-only",
      reason: "The learner explicitly chose to continue using verified supplemental research because the supplied guide was inaccessible.",
      createdAt: now,
    },
    {
      mode: "anchored",
      reason: "Learner supplied additional material: local:notes/replacement.md",
      createdAt: now,
    },
  ]);
});

test("a verified replacement anchor restores source-guided teaching", () => {
  let state = sourceGuidedTeachingState({ materialStatus: "unavailable" });
  state = addMaterial(state, {
    id: "material-2",
    reference: "local:notes/attention.md",
    now,
  });
  state = resolveMaterial(state, {
    materialId: "material-2",
    status: "verified",
    title: "Attention notes",
    evidence: "Opened the replacement notes and inspected the complete attention section.",
    now,
  });
  state = addSource(state, {
    id: "anchor-2",
    title: "Attention notes",
    url: "local:notes/attention.md",
    sourceClass: "learner-supplied",
    role: "anchor",
    locator: "Heading: Query-key-value attention",
    materialId: "material-2",
    supports: "Attention compares queries and keys to weight values.",
    verification: "Matched the mechanism to the exact heading in the replacement notes.",
    now,
  });
  state = recordSourceCoverage(state, {
    id: "coverage-2",
    nodeId: "attention",
    sourceId: "anchor-2",
    summary: "The replacement anchor directly supports the attention mechanism.",
    now,
  });

  state = recordStep(state, attentionStep());
  assert.equal(getActiveSession(state).sourceGuidance.mode, "anchored");
  assert.equal(getActiveSession(state).activeStepId, "step-1");
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
    checkpointQuestionId: "step-1-q1",
    checkpointKind: "transfer",
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
      checkpointQuestionId: "step-2-q1",
      checkpointKind: "transfer",
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
    checkpointQuestionId: "teach-q1",
    checkpointKind: "transfer",
    checkpointQuestion: "What must a new displacement-measuring object consume and produce?",
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
    bytes: 42,
    mediaType: "image/svg+xml",
    sha256: "a".repeat(64),
    now,
  });
  assert.equal(getActiveSession(next).visuals[0].path, "Assets/covector.svg");
});

test("closeSession persists assessed synthesis and releases the active session", () => {
  let state = setPlan(planned(), {
    plan: {
      targetNodeId: "forms",
      nodes: [{ id: "forms", title: "Differential forms" }],
      edges: [],
    },
    now,
  });
  state = beginTeach(state, { now });
  state = recordStep(state, {
    id: "step-close",
    nodeId: "forms",
    foundation: "A differential form is an alternating multilinear measurement.",
    motivation: "We need a coordinate-independent way to measure oriented infinitesimal inputs.",
    explanation: "A form consumes tangent vectors and returns a scalar multilinearly and alternately.",
    checkpointQuestionId: "teach-close-q1",
    checkpointKind: "transfer",
    checkpointQuestion: "What must an oriented area measurement consume and produce?",
    now,
  });
  state = recordAssessment(state, {
    id: "teach-close-a1",
    questionId: "teach-close-q1",
    nodeId: "forms",
    stage: "teach",
    kind: "transfer",
    question: "What must an oriented area measurement consume and produce?",
    answer: "It consumes two tangent vectors and produces a scalar alternately and bilinearly.",
    grade: "correct",
    evidence: "Transferred the form input-output model to a new oriented area measurement.",
    now,
  });
  state = startSynthesis(state, {
    questionId: "synthesis-close-q1",
    question: "Connect vectors, covector-like measurement, and differential forms.",
    now,
  });
  state = recordSynthesisAssessment(state, {
    id: "synthesis-close-a1",
    questionId: "synthesis-close-q1",
    question: "Connect vectors, covector-like measurement, and differential forms.",
    answer: "Vectors provide inputs, linear scalar measurements motivate covectors, and forms generalize those measurements multilinearly and alternately.",
    grade: "correct",
    evidence: "Connected the input space, scalar measurement role, and multilinear alternating generalization.",
    now,
  });
  state = closeSession(state, {
    unresolvedGaps: ["Exterior derivatives have not been covered."],
    now,
  });

  assert.equal(state.activeSessionId, null);
  assert.equal(state.sessions.s1.phase, "complete");
  assert.match(state.sessions.s1.synthesis, /linear scalar measurements/);
  assert.deepEqual(state.sessions.s1.unresolvedGaps, ["Exterior derivatives have not been covered."]);
});
