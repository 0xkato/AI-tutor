import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  bindConceptToSession,
  bindPlanConcepts,
  knowledgeForSession,
  registerTopic,
} from "./concepts.mjs";
import { LearningError, requireText } from "./errors.mjs";
import { nextFrontier, validatePlan } from "./graph.mjs";
import { SCHEMA_VERSION } from "./schema.mjs";

export { SCHEMA_VERSION };

function timestamp(now) {
  return now ?? new Date().toISOString();
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
  const topic = requireText(input.topic, "topic");
  const target = requireText(input.target, "target");
  const id = input.id ?? randomUUID();
  if (state.sessions[id]) {
    throw new LearningError(`Session already exists: ${id}`, "DUPLICATE_SESSION");
  }
  const createdAt = timestamp(input.now);
  const next = structuredClone(state);
  const topicId = input.topicId ?? randomUUID();
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
    learnerContext: typeof input.context === "string" ? input.context.trim() : "",
    phase: "probe",
    createdAt,
    updatedAt: createdAt,
    completedAt: null,
    probeSummary: "",
    assessments: [],
    conceptIds: [],
    sources: [],
    plan: null,
    frontier: [],
    steps: [],
    activeStepId: null,
    checkpoint: null,
    visuals: [],
    synthesis: "",
    synthesisRequired: false,
    unresolvedGaps: [],
    reviewItems: [],
  };
  for (const conceptId of [...new Set(reuseConceptIds)]) {
    bindConceptToSession(next, next.sessions[id], conceptId);
  }
  return next;
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
      if (validProbeCount === 0) {
        throw new LearningError(
          "Probe requires at least one uncontaminated probe",
          "INSUFFICIENT_PROBE_EVIDENCE",
        );
      }
      const unresolvedRetry = session.conceptIds
        .map((conceptId) => next.concepts[conceptId])
        .find((concept) => concept?.retry);
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
    id: input.id ?? randomUUID(),
    title: requireText(input.title, "source title"),
    url: requireText(input.url, "source url"),
    sourceClass: requireText(input.sourceClass, "source class"),
    supports: requireText(input.supports, "supported claim"),
    verification: requireText(input.verification, "source verification"),
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
  const step = {
    id: input.id ?? randomUUID(),
    nodeId: requireText(input.nodeId, "nodeId"),
    foundation: requireText(input.foundation, "foundation"),
    motivation: requireText(input.motivation, "motivation"),
    explanation: requireText(input.explanation, "explanation"),
    checkpointQuestion: requireText(input.checkpointQuestion, "checkpoint question"),
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
      if (unresolvedRetry) {
        throw new LearningError(
          `A required checkpoint for ${unresolvedRetry.key} must be resolved before another step`,
          "RETRY_REQUIRED",
        );
      }
      if (session.activeStepId) {
        throw new LearningError("The current checkpoint must be resolved before another step", "STEP_UNRESOLVED");
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
        questionId: null,
        priorQuestionId: null,
        attempts: 0,
        resolvedEvidenceId: null,
        mistakeType: "",
      };
    },
    { now: step.createdAt },
  );
}

function relativeVaultPath(value) {
  const visualPath = requireText(value, "visual path").replace(/\\/g, "/");
  const normalized = path.posix.normalize(visualPath);
  if (
    path.posix.isAbsolute(visualPath) ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized !== visualPath
  ) {
    throw new LearningError("visual path must be a normalized relative vault path", "INVALID_VISUAL_PATH");
  }
  return visualPath;
}

export function addVisual(state, input) {
  const visual = {
    id: input.id ?? randomUUID(),
    path: relativeVaultPath(input.path),
    description: requireText(input.description, "visual description"),
    verification: requireText(input.verification, "visual verification"),
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

export function closeSession(state, { synthesis, unresolvedGaps = [], now } = {}) {
  const conclusion = requireText(synthesis, "whole-system synthesis");
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
      session.synthesis = conclusion;
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
