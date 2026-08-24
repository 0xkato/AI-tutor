import { LearningError } from "./errors.mjs";
import { validatePlan } from "./graph.mjs";

export const SCHEMA_VERSION = 2;

const SESSION_PHASES = new Set(["probe", "plan", "teach", "review", "complete"]);
const SESSION_KINDS = new Set(["learn", "review"]);
const GRADES = new Set(["correct", "partial", "incorrect"]);
const ASSESSMENT_STAGES = new Set(["probe", "teach", "retention"]);
const CONCEPT_STATUSES = new Set(["unknown", "fragile", "gap", "developing", "strong"]);
const REVIEW_STATUSES = new Set(["inactive", "scheduled", "claimed", "deferred", "complete"]);
const RENDER_STATUSES = new Set(["current", "stale", "failed"]);

function invalid(message, code = "INVALID_STATE") {
  throw new LearningError(message, code);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(`${label} must be an object`);
  }
  return value;
}

function text(value, label, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || (!allowEmpty && value.trim() === "")) {
    invalid(`${label} must be ${allowEmpty ? "a string" : "a non-empty string"}`);
  }
  return value;
}

function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    invalid(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) invalid(`${label} must be an array`);
  return value;
}

function oneOf(value, allowed, label) {
  if (!allowed.has(value)) invalid(`${label} has unsupported value: ${value}`);
  return value;
}

export function parseInstant(value, label) {
  if (typeof value !== "string") {
    throw new LearningError(`${label} must be a canonical ISO instant`, "INVALID_INSTANT");
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new LearningError(`${label} must be a canonical ISO instant`, "INVALID_INSTANT");
  }
  return value;
}

function stateInstant(value, label) {
  try {
    return parseInstant(value, label);
  } catch (error) {
    invalid(error.message);
  }
}

function nullableInstant(value, label) {
  if (value === null) return null;
  return stateInstant(value, label);
}

function uniqueTextArray(value, label) {
  const items = array(value, label).map((item, index) => text(item, `${label}[${index}]`));
  if (new Set(items).size !== items.length) invalid(`${label} contains duplicate IDs`);
  return items;
}

function validateRetry(retry, label) {
  if (retry === null) return;
  object(retry, label);
  text(retry.questionId, `${label}.questionId`);
  integer(retry.attempts, `${label}.attempts`);
  if (typeof retry.required !== "boolean") invalid(`${label}.required must be boolean`);
  if (typeof retry.answerMayBeTaught !== "boolean") {
    invalid(`${label}.answerMayBeTaught must be boolean`);
  }
  if (typeof retry.requiresNewTransfer !== "boolean") {
    invalid(`${label}.requiresNewTransfer must be boolean`);
  }
  text(retry.mistakeType, `${label}.mistakeType`, { allowEmpty: true });
}

function validateAssessment(item, label, globalAssessmentIds) {
  object(item, label);
  text(item.id, `${label}.id`);
  if (globalAssessmentIds.has(item.id)) invalid(`duplicate assessment ID: ${item.id}`);
  globalAssessmentIds.set(item.id, item);
  text(item.questionId, `${label}.questionId`);
  text(item.nodeId, `${label}.nodeId`);
  if (item.conceptId !== null) text(item.conceptId, `${label}.conceptId`);
  oneOf(item.stage, ASSESSMENT_STAGES, `${label}.stage`);
  text(item.kind, `${label}.kind`);
  text(item.question, `${label}.question`);
  text(item.answer, `${label}.answer`);
  oneOf(item.grade, GRADES, `${label}.grade`);
  text(item.evidence, `${label}.evidence`);
  text(item.mistakeType, `${label}.mistakeType`, { allowEmpty: true });
  if (typeof item.contaminated !== "boolean") invalid(`${label}.contaminated must be boolean`);
  stateInstant(item.createdAt, `${label}.createdAt`);
}

function validateSession(session, key, globalAssessmentIds, globalSourceIds, globalVisualIds) {
  const label = `sessions.${key}`;
  object(session, label);
  if (session.id !== key) invalid(`${label}.id must match its key`);
  oneOf(session.kind, SESSION_KINDS, `${label}.kind`);
  text(session.topic, `${label}.topic`);
  text(session.target, `${label}.target`);
  text(session.learnerContext, `${label}.learnerContext`, { allowEmpty: true });
  oneOf(session.phase, SESSION_PHASES, `${label}.phase`);
  stateInstant(session.createdAt, `${label}.createdAt`);
  stateInstant(session.updatedAt, `${label}.updatedAt`);
  nullableInstant(session.completedAt, `${label}.completedAt`);
  if (session.phase === "complete" && session.completedAt === null) {
    invalid(`${label}.completedAt is required for a complete session`);
  }
  if (session.phase !== "complete" && session.completedAt !== null) {
    invalid(`${label}.completedAt requires the complete phase`);
  }
  text(session.probeSummary, `${label}.probeSummary`, { allowEmpty: true });

  for (const [index, assessment] of array(session.assessments, `${label}.assessments`).entries()) {
    validateAssessment(assessment, `${label}.assessments[${index}]`, globalAssessmentIds);
  }

  for (const [index, source] of array(session.sources, `${label}.sources`).entries()) {
    const sourceLabel = `${label}.sources[${index}]`;
    object(source, sourceLabel);
    text(source.id, `${sourceLabel}.id`);
    if (globalSourceIds.has(source.id)) invalid(`duplicate source ID: ${source.id}`);
    globalSourceIds.add(source.id);
    for (const field of ["title", "url", "sourceClass", "supports", "verification"]) {
      text(source[field], `${sourceLabel}.${field}`);
    }
    stateInstant(source.createdAt, `${sourceLabel}.createdAt`);
  }

  if (session.plan !== null) validatePlan(session.plan);
  uniqueTextArray(session.frontier, `${label}.frontier`);

  const stepIds = new Set();
  for (const [index, step] of array(session.steps, `${label}.steps`).entries()) {
    const stepLabel = `${label}.steps[${index}]`;
    object(step, stepLabel);
    text(step.id, `${stepLabel}.id`);
    if (stepIds.has(step.id)) invalid(`${label}.steps contains duplicate ID: ${step.id}`);
    stepIds.add(step.id);
    for (const field of ["nodeId", "foundation", "motivation", "explanation", "checkpointQuestion"]) {
      text(step[field], `${stepLabel}.${field}`);
    }
    stateInstant(step.createdAt, `${stepLabel}.createdAt`);
  }
  if (session.activeStepId !== null && !stepIds.has(session.activeStepId)) {
    invalid(`${label}.activeStepId references an unknown step`);
  }

  for (const [index, visual] of array(session.visuals, `${label}.visuals`).entries()) {
    const visualLabel = `${label}.visuals[${index}]`;
    object(visual, visualLabel);
    text(visual.id, `${visualLabel}.id`);
    if (globalVisualIds.has(visual.id)) invalid(`duplicate visual ID: ${visual.id}`);
    globalVisualIds.add(visual.id);
    for (const field of ["path", "description", "verification"]) {
      text(visual[field], `${visualLabel}.${field}`);
    }
    stateInstant(visual.createdAt, `${visualLabel}.createdAt`);
  }

  text(session.synthesis, `${label}.synthesis`, { allowEmpty: true });
  array(session.unresolvedGaps, `${label}.unresolvedGaps`).forEach((gap, index) => {
    text(gap, `${label}.unresolvedGaps[${index}]`);
  });
  text(session.topicId, `${label}.topicId`);
  uniqueTextArray(session.conceptIds, `${label}.conceptIds`);
}

function validateTopics(state) {
  for (const [id, topic] of Object.entries(object(state.topics, "topics"))) {
    const label = `topics.${id}`;
    object(topic, label);
    if (topic.id !== id) invalid(`${label}.id must match its key`);
    text(topic.name, `${label}.name`);
    stateInstant(topic.createdAt, `${label}.createdAt`);
    stateInstant(topic.updatedAt, `${label}.updatedAt`);
    for (const sessionId of uniqueTextArray(topic.sessionIds, `${label}.sessionIds`)) {
      if (!state.sessions[sessionId]) invalid(`${label} references unknown session: ${sessionId}`);
      if (state.sessions[sessionId].topicId !== id) {
        invalid(`${label} contains a session assigned to a different topic: ${sessionId}`);
      }
    }
    for (const conceptId of uniqueTextArray(topic.conceptIds, `${label}.conceptIds`)) {
      if (!state.concepts[conceptId]) invalid(`${label} references unknown concept: ${conceptId}`);
      if (state.concepts[conceptId].topicId !== id) {
        invalid(`${label} contains a concept assigned to a different topic: ${conceptId}`);
      }
    }
    if (topic.latestSessionId !== null && !state.sessions[topic.latestSessionId]) {
      invalid(`${label}.latestSessionId references an unknown session`);
    }
  }
}

function validateConcepts(state, allAssessmentIds) {
  for (const [id, concept] of Object.entries(object(state.concepts, "concepts"))) {
    const label = `concepts.${id}`;
    object(concept, label);
    if (concept.id !== id) invalid(`${label}.id must match its key`);
    if (!state.topics[concept.topicId]) invalid(`${label}.topicId references an unknown topic`);
    text(concept.key, `${label}.key`);
    text(concept.title, `${label}.title`);
    oneOf(concept.status, CONCEPT_STATUSES, `${label}.status`);
    if (concept.latestGrade !== null) oneOf(concept.latestGrade, GRADES, `${label}.latestGrade`);
    stateInstant(concept.createdAt, `${label}.createdAt`);
    stateInstant(concept.updatedAt, `${label}.updatedAt`);
    for (const evidenceId of uniqueTextArray(concept.evidenceIds, `${label}.evidenceIds`)) {
      if (!allAssessmentIds.has(evidenceId)) invalid(`${label} references unknown evidence: ${evidenceId}`);
    }
    for (const sessionId of uniqueTextArray(concept.sourceSessionIds, `${label}.sourceSessionIds`)) {
      if (!state.sessions[sessionId]) invalid(`${label} references unknown session: ${sessionId}`);
      if (!state.sessions[sessionId].conceptIds.includes(id)) {
        invalid(`${label} is not bound by source session: ${sessionId}`);
      }
    }
    validateRetry(concept.retry, `${label}.retry`);
    if (concept.reviewId !== null && !state.reviews[concept.reviewId]) {
      invalid(`${label}.reviewId references an unknown review`);
    }
    if (concept.reviewId !== null && state.reviews[concept.reviewId].conceptId !== id) {
      invalid(`${label}.reviewId points to a review for another concept`);
    }
  }
}

function validateReviews(state) {
  for (const [id, review] of Object.entries(object(state.reviews, "reviews"))) {
    const label = `reviews.${id}`;
    object(review, label);
    if (review.id !== id) invalid(`${label}.id must match its key`);
    if (!state.concepts[review.conceptId]) invalid(`${label}.conceptId references an unknown concept`);
    if (state.concepts[review.conceptId]?.reviewId !== id) {
      invalid(`${label} is not the canonical review for its concept`);
    }
    integer(review.level, `${label}.level`);
    nullableInstant(review.dueAt, `${label}.dueAt`);
    integer(review.completed, `${label}.completed`);
    oneOf(review.status, REVIEW_STATUSES, `${label}.status`);
    stateInstant(review.updatedAt, `${label}.updatedAt`);
  }
}

export function validateState(value) {
  const state = structuredClone(object(value, "state"));
  if (state.schemaVersion !== SCHEMA_VERSION) {
    invalid(`Unsupported state schema version: ${state.schemaVersion}`, "UNSUPPORTED_SCHEMA");
  }
  stateInstant(state.createdAt, "createdAt");
  stateInstant(state.updatedAt, "updatedAt");
  integer(state.revision, "revision");
  if (state.activeSessionId !== null) text(state.activeSessionId, "activeSessionId");
  object(state.settings, "settings");
  text(state.settings.vaultDir, "settings.vaultDir");
  object(state.sessions, "sessions");
  object(state.concepts, "concepts");
  object(state.reviews, "reviews");
  integer(state.reviewCount, "reviewCount");

  const assessmentIds = new Map();
  const sourceIds = new Set();
  const visualIds = new Set();
  for (const [id, session] of Object.entries(state.sessions)) {
    validateSession(session, id, assessmentIds, sourceIds, visualIds);
  }
  if (state.activeSessionId !== null && !state.sessions[state.activeSessionId]) {
    invalid("activeSessionId references an unknown session");
  }
  if (state.activeSessionId !== null && state.sessions[state.activeSessionId].phase === "complete") {
    invalid("activeSessionId cannot reference a complete session");
  }

  validateReviews(state);
  validateTopics(state);
  validateConcepts(state, assessmentIds);

  object(state.render, "render");
  integer(state.render.revision, "render.revision");
  oneOf(state.render.status, RENDER_STATUSES, "render.status");
  if (state.render.error !== null) text(state.render.error, "render.error");

  for (const [id, session] of Object.entries(state.sessions)) {
    if (!state.topics[session.topicId]) {
      invalid(`sessions.${id}.topicId references an unknown topic`);
    }
    if (!state.topics[session.topicId].sessionIds.includes(id)) {
      invalid(`sessions.${id} is not registered with its topic`);
    }
    for (const conceptId of session.conceptIds) {
      if (!state.concepts[conceptId]) invalid(`sessions.${id} references unknown concept: ${conceptId}`);
      if (state.concepts[conceptId]?.topicId !== session.topicId) {
        invalid(`sessions.${id} references a concept from another topic: ${conceptId}`);
      }
    }
    if (session.plan) {
      for (const node of session.plan.nodes) {
        text(node.conceptId, `sessions.${id}.plan node ${node.id}.conceptId`);
        const concept = state.concepts[node.conceptId];
        if (!concept || !session.conceptIds.includes(node.conceptId) || concept.key !== node.id) {
          invalid(`sessions.${id}.plan node ${node.id} has an invalid concept binding`);
        }
      }
    }
    for (const assessment of session.assessments) {
      if (!assessment.contaminated && assessment.conceptId === null) {
        invalid(`sessions.${id} assessment ${assessment.id} requires a conceptId`);
      }
      if (assessment.conceptId !== null && !state.concepts[assessment.conceptId]) {
        invalid(`sessions.${id} assessment ${assessment.id} references an unknown concept`);
      }
      if (assessment.conceptId !== null && !session.conceptIds.includes(assessment.conceptId)) {
        invalid(`sessions.${id} assessment ${assessment.id} references an unbound concept`);
      }
    }
  }

  for (const concept of Object.values(state.concepts)) {
    for (const evidenceId of concept.evidenceIds) {
      const assessment = assessmentIds.get(evidenceId);
      if (assessment.contaminated || assessment.conceptId !== concept.id) {
        invalid(`concepts.${concept.id} has invalid evidence relationship: ${evidenceId}`);
      }
    }
  }

  return state;
}
