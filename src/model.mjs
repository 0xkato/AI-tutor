import { randomUUID } from "node:crypto";

import {
  bindConceptToSession,
  bindPlanConcepts,
  createConceptForSession,
  knowledgeForSession,
  registerTopic,
} from "./concepts.mjs";
import { LearningError, requireText } from "./errors.mjs";
import { nextFrontier, validatePlan } from "./graph.mjs";
import {
  safeIdentifier,
  safeRelativeVaultPath,
  safeSingleLine,
  safeText,
  validateSourceReference,
} from "./inputs.mjs";
import { parseInstant, SCHEMA_VERSION } from "./schema.mjs";

export { SCHEMA_VERSION };

const TEACHING_CHECKPOINT_KINDS = new Set([
  "multiple-choice",
  "explanation",
  "prediction",
  "transfer",
  "reconstruction",
  "debugging",
]);

function timestamp(now) {
  return parseInstant(now ?? new Date().toISOString(), "event time");
}

export function createInitialState({ now } = {}) {
  const createdAt = timestamp(now);
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    createdAt,
    updatedAt: createdAt,
    activeSessionId: null,
    settings: { vaultDir: "vault" },
    learnerProfile: {
      teachingPhilosophy: "",
      explanationPreferences: "",
      feedbackPreferences: "",
      visualPreferences: "",
      sourcePreferences: "",
      updatedAt: null,
    },
    sessions: {},
    topics: {},
    concepts: {},
    reviews: {},
    reviewCount: 0,
    render: { revision: 0, status: "stale", error: null },
  };
}

export function getActiveSession(state) {
  const id = state.activeSessionId;
  if (!id || !state.sessions[id]) {
    throw new LearningError("No active learning session", "NO_ACTIVE_SESSION");
  }
  return state.sessions[id];
}

export function updateLearnerProfile(state, input = {}) {
  const fields = [
    ["teachingPhilosophy", "teaching philosophy"],
    ["explanationPreferences", "explanation preferences"],
    ["feedbackPreferences", "feedback preferences"],
    ["visualPreferences", "visual preferences"],
    ["sourcePreferences", "source preferences"],
  ];
  const provided = fields.filter(([field]) => input[field] !== undefined);
  if (provided.length === 0) {
    throw new LearningError(
      "At least one learner profile field is required",
      "PROFILE_UPDATE_REQUIRED",
    );
  }

  const changedAt = timestamp(input.now);
  const next = structuredClone(state);
  for (const [field, label] of provided) {
    next.learnerProfile[field] = safeText(input[field], label, {
      allowEmpty: true,
      maxLength: 16_384,
    });
  }
  next.learnerProfile.updatedAt = changedAt;
  next.updatedAt = changedAt;
  return next;
}

export function updateActiveSession(state, update, { now } = {}) {
  const next = structuredClone(state);
  const session = getActiveSession(next);
  update(session, next);
  const changedAt = timestamp(now);
  session.updatedAt = changedAt;
  next.updatedAt = changedAt;
  return next;
}

export function startSession(state, input) {
  if (state.activeSessionId) {
    throw new LearningError("A learning session is already active", "SESSION_ACTIVE");
  }
  const topic = safeSingleLine(input.topic, "topic", { maxLength: 512 });
  const target = safeText(input.target, "target");
  const id = safeIdentifier(input.id ?? randomUUID(), "session id");
  if (state.sessions[id]) {
    throw new LearningError(`Session already exists: ${id}`, "DUPLICATE_SESSION");
  }
  const createdAt = timestamp(input.now);
  const next = structuredClone(state);
  const topicId = safeIdentifier(input.topicId ?? randomUUID(), "topic id");
  registerTopic(next, { id: topicId, name: topic, sessionId: id, now: createdAt });
  const reuseConceptIds = input.reuseConceptIds ?? [];
  if (!Array.isArray(reuseConceptIds)) {
    throw new LearningError("reuseConceptIds must be an array", "INVALID_CONCEPT_IDS");
  }
  next.activeSessionId = id;
  next.updatedAt = createdAt;
  next.sessions[id] = {
    id,
    kind: "learn",
    topic,
    topicId,
    target,
    learnerContext:
      input.context === undefined ? "" : safeText(input.context, "learner context", { allowEmpty: true }),
    phase: "probe",
    createdAt,
    updatedAt: createdAt,
    completedAt: null,
    probeSummary: "",
    admittedGaps: [],
    assessments: [],
    questions: [],
    notes: [],
    conceptIds: [],
    sources: [],
    plan: null,
    frontier: [],
    steps: [],
    activeStepId: null,
    checkpoint: null,
    visuals: [],
    synthesis: "",
    synthesisRequired: true,
    synthesisCheckpoint: null,
    unresolvedGaps: [],
    reviewItems: [],
  };
  for (const conceptId of [...new Set(reuseConceptIds)]) {
    bindConceptToSession(next, next.sessions[id], conceptId);
  }
  return next;
}

export function recordAdmittedGap(state, input = {}) {
  const id = safeIdentifier(input.id ?? randomUUID(), "admitted gap id");
  const nodeId = safeSingleLine(input.nodeId, "nodeId", { maxLength: 512 });
  const statement = safeText(input.statement, "admitted gap statement");
  const evidence = safeText(input.evidence, "admitted gap evidence");
  if (evidence.length < 20 || evidence.split(/\s+/).length < 4) {
    throw new LearningError(
      "admitted gap evidence must identify the exact missing mechanism",
      "WEAK_EVIDENCE",
    );
  }
  const createdAt = timestamp(input.now);

  return updateActiveSession(
    state,
    (session, next) => {
      if (session.phase !== "probe") {
        throw new LearningError(
          `Cannot record an admitted gap during ${session.phase}`,
          "INVALID_PHASE",
        );
      }
      const duplicateId = Object.values(next.sessions).some((candidate) =>
        candidate.admittedGaps?.some((gap) => gap.id === id),
      );
      if (duplicateId) {
        throw new LearningError(`Admitted gap already exists: ${id}`, "DUPLICATE_ADMITTED_GAP");
      }
      if (session.admittedGaps.some((gap) => gap.nodeId === nodeId)) {
        throw new LearningError(
          `An admitted gap is already recorded for: ${nodeId}`,
          "DUPLICATE_ADMITTED_GAP",
        );
      }

      const concept = createConceptForSession(next, session, {
        nodeId,
        title: nodeId,
        now: createdAt,
      });
      concept.status = "gap";
      concept.updatedAt = createdAt;
      session.admittedGaps.push({
        id,
        nodeId,
        conceptId: concept.id,
        statement,
        evidence,
        createdAt,
      });
    },
    { now: createdAt },
  );
}

export function finishProbe(state, { summary, now } = {}) {
  const probeSummary = requireText(summary, "probe summary");
  return updateActiveSession(
    state,
    (session, next) => {
      if (session.phase !== "probe") {
        throw new LearningError(`Cannot finish probe during ${session.phase}`, "INVALID_PHASE");
      }
      const validProbeCount = session.assessments.filter(
        (item) => item.stage === "probe" && !item.contaminated,
      ).length;
      if (validProbeCount === 0 && session.admittedGaps.length === 0) {
        throw new LearningError(
          "Probe requires at least one uncontaminated probe or admitted gap",
          "INSUFFICIENT_PROBE_EVIDENCE",
        );
      }
      const unresolvedRetry = session.conceptIds
        .map((conceptId) => next.concepts[conceptId])
        .find((concept) => concept?.retry && !concept.retry.answerMayBeTaught);
      if (unresolvedRetry) {
        throw new LearningError(
          `Probe checkpoint for ${unresolvedRetry.key} must be resolved before planning`,
          "RETRY_REQUIRED",
        );
      }
      session.probeSummary = probeSummary;
      session.phase = "plan";
    },
    { now },
  );
}

export function setPlan(state, { plan, now } = {}) {
  const checked = validatePlan(plan);
  return updateActiveSession(
    state,
    (session, next) => {
      if (session.phase !== "plan") {
        throw new LearningError(`Cannot set a plan during ${session.phase}`, "INVALID_PHASE");
      }
      const plannedNodeIds = new Set(checked.nodes.map((node) => node.id));
      const omittedRetry = session.conceptIds
        .map((conceptId) => next.concepts[conceptId])
        .find((concept) => concept?.retry && !plannedNodeIds.has(concept.key));
      if (omittedRetry) {
        throw new LearningError(
          `Dependency plan must include diagnosed concept: ${omittedRetry.key}`,
          "PLAN_OMITS_DIAGNOSED_CONCEPT",
        );
      }
      const omittedAdmittedGap = session.admittedGaps.find(
        (gap) => !plannedNodeIds.has(gap.nodeId),
      );
      if (omittedAdmittedGap) {
        throw new LearningError(
          `Dependency plan must include admitted gap: ${omittedAdmittedGap.nodeId}`,
          "PLAN_OMITS_DIAGNOSED_CONCEPT",
        );
      }
      session.plan = bindPlanConcepts(next, session, checked, { now });
      session.frontier = nextFrontier(session.plan, knowledgeForSession(next, session));
    },
    { now },
  );
}

export function beginTeach(state, { now } = {}) {
  return updateActiveSession(
    state,
    (session, next) => {
      if (session.phase !== "plan") {
        throw new LearningError(`Cannot begin teaching during ${session.phase}`, "INVALID_PHASE");
      }
      if (!session.plan) {
        throw new LearningError("Teaching requires a valid dependency plan", "PLAN_REQUIRED");
      }
      session.frontier = nextFrontier(session.plan, knowledgeForSession(next, session));
      if (session.frontier.length === 0) {
        throw new LearningError("The dependency plan has no teachable frontier", "NO_FRONTIER");
      }
      session.phase = "teach";
    },
    { now },
  );
}

export function addSource(state, input) {
  const source = {
    id: safeIdentifier(input.id ?? randomUUID(), "source id"),
    title: safeSingleLine(input.title, "source title", { maxLength: 1_024 }),
    url: validateSourceReference(input.url),
    sourceClass: safeSingleLine(input.sourceClass, "source class", { maxLength: 256 }),
    supports: safeText(input.supports, "supported claim"),
    verification: safeText(input.verification, "source verification"),
    createdAt: timestamp(input.now),
  };
  return updateActiveSession(
    state,
    (session) => {
      if (session.sources.some((item) => item.id === source.id)) {
        throw new LearningError(`Source already exists: ${source.id}`, "DUPLICATE_SOURCE");
      }
      session.sources.push(source);
    },
    { now: source.createdAt },
  );
}

export function recordStep(state, input) {
  const checkpointKind = safeSingleLine(input.checkpointKind, "checkpoint kind", {
    maxLength: 64,
  });
  if (!TEACHING_CHECKPOINT_KINDS.has(checkpointKind)) {
    throw new LearningError(
      `Unknown teaching checkpoint kind: ${checkpointKind}`,
      "INVALID_KIND",
    );
  }
  const step = {
    id: safeIdentifier(input.id ?? randomUUID(), "step id"),
    nodeId: safeIdentifier(input.nodeId, "nodeId"),
    foundation: safeText(input.foundation, "foundation"),
    motivation: safeText(input.motivation, "motivation"),
    explanation: safeText(input.explanation, "explanation"),
    checkpointQuestionId: safeIdentifier(
      input.checkpointQuestionId,
      "checkpoint question ID",
    ),
    checkpointKind,
    checkpointQuestion: safeText(input.checkpointQuestion, "checkpoint question"),
    createdAt: timestamp(input.now),
  };
  return updateActiveSession(
    state,
    (session, next) => {
      if (session.phase !== "teach") {
        throw new LearningError(`Cannot record a teaching step during ${session.phase}`, "INVALID_PHASE");
      }
      const unresolvedRetry = session.conceptIds
        .map((conceptId) => next.concepts[conceptId])
        .find((concept) => concept?.retry);
      const startingProbeRepair =
        !session.activeStepId &&
        unresolvedRetry?.retry?.answerMayBeTaught === true &&
        unresolvedRetry.key === step.nodeId;
      const replacingTeachingCheckpoint =
        session.activeStepId !== null &&
        session.checkpoint?.status === "new-transfer-required" &&
        unresolvedRetry?.retry?.status === "new-transfer-required" &&
        unresolvedRetry.key === step.nodeId;
      const permittedRepair = startingProbeRepair || replacingTeachingCheckpoint;
      if (unresolvedRetry && !permittedRepair) {
        throw new LearningError(
          `A required checkpoint for ${unresolvedRetry.key} must be resolved before another step`,
          "RETRY_REQUIRED",
        );
      }
      if (session.activeStepId && !replacingTeachingCheckpoint) {
        throw new LearningError("The current checkpoint must be resolved before another step", "STEP_UNRESOLVED");
      }
      const priorQuestionId = replacingTeachingCheckpoint
        ? session.checkpoint.priorQuestionId ?? session.checkpoint.questionId
        : null;
      if (priorQuestionId === step.checkpointQuestionId) {
        throw new LearningError(
          `A new transfer question is required after ${priorQuestionId}`,
          "NEW_TRANSFER_REQUIRED",
        );
      }
      if (!session.plan?.nodes.some((node) => node.id === step.nodeId)) {
        throw new LearningError(`Unknown plan node: ${step.nodeId}`, "UNKNOWN_NODE");
      }
      if (!session.frontier.includes(step.nodeId)) {
        throw new LearningError(`Node is not on the teachable frontier: ${step.nodeId}`, "INVALID_FRONTIER");
      }
      if (session.steps.some((item) => item.id === step.id)) {
        throw new LearningError(`Teaching step already exists: ${step.id}`, "DUPLICATE_STEP");
      }
      session.steps.push(step);
      session.activeStepId = step.id;
      session.checkpoint = {
        status: "awaiting-answer",
        nodeId: step.nodeId,
        questionId: step.checkpointQuestionId,
        question: step.checkpointQuestion,
        kind: step.checkpointKind,
        priorQuestionId,
        attempts: 0,
        resolvedEvidenceId: null,
        mistakeType: "",
      };
    },
    { now: step.createdAt },
  );
}

export function addVisual(state, input) {
  const visualPath = safeRelativeVaultPath(input.path);
  if (!Number.isSafeInteger(input.bytes) || input.bytes < 0) {
    throw new LearningError("visual bytes must be a non-negative safe integer", "INVALID_VISUAL_IDENTITY");
  }
  const mediaType = safeSingleLine(input.mediaType, "visual media type", { maxLength: 256 });
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(mediaType)) {
    throw new LearningError("visual media type is invalid", "INVALID_VISUAL_IDENTITY");
  }
  if (typeof input.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(input.sha256)) {
    throw new LearningError("visual sha256 must be a lowercase SHA-256 digest", "INVALID_VISUAL_IDENTITY");
  }
  const visual = {
    id: safeIdentifier(input.id ?? randomUUID(), "visual id"),
    path: visualPath,
    description: safeText(input.description, "visual description"),
    verification: safeText(input.verification, "visual verification"),
    identityStatus: "verified",
    bytes: input.bytes,
    mediaType,
    sha256: input.sha256,
    createdAt: timestamp(input.now),
  };
  return updateActiveSession(
    state,
    (session) => {
      if (session.visuals.some((item) => item.id === visual.id || item.path === visual.path)) {
        throw new LearningError(`Visual already exists: ${visual.path}`, "DUPLICATE_VISUAL");
      }
      session.visuals.push(visual);
    },
    { now: visual.createdAt },
  );
}

export function closeSession(state, { unresolvedGaps = [], now } = {}) {
  if (!Array.isArray(unresolvedGaps) || unresolvedGaps.some((gap) => typeof gap !== "string" || !gap.trim())) {
    throw new LearningError("unresolvedGaps must be an array of non-empty strings", "INVALID_GAPS");
  }
  const closedAt = timestamp(now);
  return updateActiveSession(
    state,
    (session, next) => {
      if (session.kind !== "learn") {
        throw new LearningError("Review sessions must use close-review", "INVALID_SESSION_KIND");
      }
      if (session.phase !== "teach") {
        throw new LearningError(
          `Cannot close a learning session during ${session.phase}`,
          "INVALID_PHASE",
        );
      }
      if (session.activeStepId) {
        throw new LearningError("The current checkpoint must be resolved before closing", "STEP_UNRESOLVED");
      }
      const unresolvedRetry = session.conceptIds
        .map((conceptId) => next.concepts[conceptId])
        .find((concept) => concept?.retry);
      if (unresolvedRetry) {
        throw new LearningError(
          `A required checkpoint for ${unresolvedRetry.key} must be resolved before closing`,
          "RETRY_REQUIRED",
        );
      }
      if (session.frontier.length > 0) {
        throw new LearningError(
          "The dependency plan must be complete before closing",
          "PLAN_INCOMPLETE",
        );
      }
      const checkpoint = session.synthesisCheckpoint;
      if (!checkpoint || checkpoint.status !== "resolved" || !checkpoint.resolvedEvidenceId) {
        throw new LearningError(
          "A clean correct whole-system synthesis assessment is required before closing",
          "SYNTHESIS_UNRESOLVED",
        );
      }
      const synthesisAssessment = session.assessments.find(
        (assessment) => assessment.id === checkpoint.resolvedEvidenceId,
      );
      if (
        !synthesisAssessment ||
        synthesisAssessment.stage !== "synthesis" ||
        synthesisAssessment.kind !== "synthesis" ||
        synthesisAssessment.grade !== "correct" ||
        synthesisAssessment.contaminated
      ) {
        throw new LearningError(
          "The resolved whole-system synthesis evidence is invalid",
          "INVALID_SYNTHESIS_EVIDENCE",
        );
      }
      session.synthesis = synthesisAssessment.answer;
      session.unresolvedGaps = unresolvedGaps.map((gap) => gap.trim());
      session.completedAt = closedAt;
      session.phase = "complete";
      const topic = next.topics[session.topicId];
      if (!topic) throw new LearningError("Session topic does not exist", "UNKNOWN_TOPIC");
      topic.latestSessionId = session.id;
      topic.updatedAt = closedAt;
      next.activeSessionId = null;
    },
    { now: closedAt },
  );
}
