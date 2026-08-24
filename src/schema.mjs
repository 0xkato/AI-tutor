import { LearningError } from "./errors.mjs";
import { validatePlan } from "./graph.mjs";
import { safeRelativeVaultPath, validateSourceReference } from "./inputs.mjs";

export const SCHEMA_VERSION = 2;

const SESSION_PHASES = new Set(["probe", "plan", "teach", "review", "complete"]);
const SESSION_KINDS = new Set(["learn", "review"]);
const GRADES = new Set(["correct", "partial", "incorrect"]);
const ASSESSMENT_STAGES = new Set(["probe", "teach", "retention"]);
const CONCEPT_STATUSES = new Set(["unknown", "fragile", "gap", "developing", "strong"]);
const REVIEW_STATUSES = new Set(["inactive", "scheduled", "claimed", "deferred", "complete"]);
const REVIEW_ITEM_STATUSES = new Set(["pending", "repair-required", "resolved", "deferred"]);
const RETRY_STATUSES = new Set(["retry-required", "new-transfer-required"]);
const CHECKPOINT_STATUSES = new Set([
  "awaiting-answer",
  "retry-required",
  "new-transfer-required",
  "resolved",
]);
const RENDER_STATUSES = new Set(["current", "stale", "failed"]);
const VISUAL_IDENTITY_STATUSES = new Set(["verified", "legacy-unverified"]);

function invalid(message, code = "INVALID_STATE") {
  throw new LearningError(message, code);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(`${label} must be an object`);
  }
  return value;
}

function text(value, label, { allowEmpty = false, maxLength = 65_536 } = {}) {
  if (typeof value !== "string" || (!allowEmpty && value.trim() === "")) {
    invalid(`${label} must be ${allowEmpty ? "a string" : "a non-empty string"}`);
  }
  if (value.length > maxLength) invalid(`${label} must be at most ${maxLength} characters`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    invalid(`${label} contains a disallowed control character`);
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

function nullableText(value, label) {
  if (value === null) return null;
  return text(value, label);
}

function uniqueTextArray(value, label) {
  const items = array(value, label).map((item, index) => text(item, `${label}[${index}]`));
  if (new Set(items).size !== items.length) invalid(`${label} contains duplicate IDs`);
  return items;
}

function validateRetry(retry, label) {
  if (retry === null) return;
  object(retry, label);
  if (!("status" in retry)) {
    retry.status = retry.requiresNewTransfer ? "new-transfer-required" : "retry-required";
  }
  if (!("priorQuestionId" in retry)) {
    retry.priorQuestionId = retry.requiresNewTransfer ? retry.questionId : null;
  }
  oneOf(retry.status, RETRY_STATUSES, `${label}.status`);
  text(retry.questionId, `${label}.questionId`);
  nullableText(retry.priorQuestionId, `${label}.priorQuestionId`);
  integer(retry.attempts, `${label}.attempts`);
  if (typeof retry.required !== "boolean") invalid(`${label}.required must be boolean`);
  if (typeof retry.answerMayBeTaught !== "boolean") {
    invalid(`${label}.answerMayBeTaught must be boolean`);
  }
  if (typeof retry.requiresNewTransfer !== "boolean") {
    invalid(`${label}.requiresNewTransfer must be boolean`);
  }
  text(retry.mistakeType, `${label}.mistakeType`, { allowEmpty: true });
  if (retry.status === "retry-required") {
    if (!retry.required || retry.requiresNewTransfer || retry.answerMayBeTaught) {
      invalid(`${label} has inconsistent retry-required flags`);
    }
  }
  if (retry.status === "new-transfer-required") {
    if (retry.required || !retry.requiresNewTransfer || retry.priorQuestionId === null) {
      invalid(`${label} has inconsistent new-transfer-required flags`);
    }
  }
}

function validateCheckpoint(checkpoint, label) {
  if (checkpoint === null) return;
  object(checkpoint, label);
  oneOf(checkpoint.status, CHECKPOINT_STATUSES, `${label}.status`);
  text(checkpoint.nodeId, `${label}.nodeId`);
  nullableText(checkpoint.questionId, `${label}.questionId`);
  nullableText(checkpoint.priorQuestionId, `${label}.priorQuestionId`);
  integer(checkpoint.attempts, `${label}.attempts`);
  nullableText(checkpoint.resolvedEvidenceId, `${label}.resolvedEvidenceId`);
  text(checkpoint.mistakeType, `${label}.mistakeType`, { allowEmpty: true });
  if (checkpoint.status === "awaiting-answer" && checkpoint.resolvedEvidenceId !== null) {
    invalid(`${label} cannot have resolved evidence while awaiting an answer`);
  }
  if (checkpoint.status === "retry-required" && checkpoint.questionId === null) {
    invalid(`${label}.questionId is required for a retry`);
  }
  if (
    checkpoint.status === "new-transfer-required" &&
    (checkpoint.questionId === null || checkpoint.priorQuestionId === null)
  ) {
    invalid(`${label} requires the prior question before a new transfer`);
  }
  if (checkpoint.status === "resolved" && checkpoint.resolvedEvidenceId === null) {
    invalid(`${label}.resolvedEvidenceId is required when resolved`);
  }
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
    try {
      validateSourceReference(source.url);
    } catch (error) {
      invalid(`${sourceLabel}.url is invalid: ${error.message}`);
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
  validateCheckpoint(session.checkpoint, `${label}.checkpoint`);
  if (session.activeStepId !== null) {
    const activeStep = session.steps.find((step) => step.id === session.activeStepId);
    if (!session.checkpoint || session.checkpoint.status === "resolved") {
      invalid(`${label}.activeStepId requires an unresolved checkpoint`);
    }
    if (session.checkpoint.nodeId !== activeStep.nodeId) {
      invalid(`${label}.checkpoint must match the active step node`);
    }
  }
  if (
    session.activeStepId === null &&
    session.checkpoint !== null &&
    session.checkpoint.status !== "resolved"
  ) {
    invalid(`${label}.checkpoint cannot remain unresolved without an active step`);
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
    try {
      safeRelativeVaultPath(visual.path);
    } catch (error) {
      invalid(`${visualLabel}.path is invalid: ${error.message}`);
    }
    oneOf(visual.identityStatus, VISUAL_IDENTITY_STATUSES, `${visualLabel}.identityStatus`);
    if (visual.identityStatus === "verified") {
      integer(visual.bytes, `${visualLabel}.bytes`);
      text(visual.mediaType, `${visualLabel}.mediaType`, { maxLength: 256 });
      if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(visual.mediaType)) {
        invalid(`${visualLabel}.mediaType is invalid`);
      }
      if (typeof visual.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(visual.sha256)) {
        invalid(`${visualLabel}.sha256 must be a lowercase SHA-256 digest`);
      }
    } else if (visual.bytes !== null || visual.mediaType !== null || visual.sha256 !== null) {
      invalid(`${visualLabel} legacy identity fields must be null`);
    }
    stateInstant(visual.createdAt, `${visualLabel}.createdAt`);
  }

  text(session.synthesis, `${label}.synthesis`, { allowEmpty: true });
  if (typeof session.synthesisRequired !== "boolean") {
    invalid(`${label}.synthesisRequired must be boolean`);
  }
  array(session.unresolvedGaps, `${label}.unresolvedGaps`).forEach((gap, index) => {
    text(gap, `${label}.unresolvedGaps[${index}]`);
  });
  text(session.topicId, `${label}.topicId`);
  uniqueTextArray(session.conceptIds, `${label}.conceptIds`);

  const reviewIds = new Set();
  for (const [index, item] of array(session.reviewItems, `${label}.reviewItems`).entries()) {
    const itemLabel = `${label}.reviewItems[${index}]`;
    object(item, itemLabel);
    text(item.reviewId, `${itemLabel}.reviewId`);
    if (reviewIds.has(item.reviewId)) invalid(`${label}.reviewItems contains duplicate review IDs`);
    reviewIds.add(item.reviewId);
    text(item.conceptId, `${itemLabel}.conceptId`);
    oneOf(item.status, REVIEW_ITEM_STATUSES, `${itemLabel}.status`);
    if (item.outcomeGrade !== null) oneOf(item.outcomeGrade, GRADES, `${itemLabel}.outcomeGrade`);
    uniqueTextArray(item.evidenceIds, `${itemLabel}.evidenceIds`);
    nullableText(item.deferralReason, `${itemLabel}.deferralReason`);
    nullableInstant(item.deferredUntil, `${itemLabel}.deferredUntil`);
    if (item.status === "resolved" && (item.outcomeGrade === null || item.evidenceIds.length === 0)) {
      invalid(`${itemLabel} requires an outcome grade and evidence when resolved`);
    }
    if (
      item.status === "deferred" &&
      (item.deferralReason === null || item.deferredUntil === null)
    ) {
      invalid(`${itemLabel} requires a reason and future time when deferred`);
    }
  }
  if (session.kind === "learn" && session.reviewItems.length !== 0) {
    invalid(`${label}.reviewItems must be empty for a learning session`);
  }
  if (session.kind === "review") {
    if (session.reviewItems.length === 0) invalid(`${label}.reviewItems is required for a review session`);
    if (!["review", "complete"].includes(session.phase)) {
      invalid(`${label}.phase is invalid for a review session`);
    }
  }
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
    nullableText(review.claimedBySessionId, `${label}.claimedBySessionId`);
    nullableInstant(review.claimedAt, `${label}.claimedAt`);
    nullableText(review.deferredReason, `${label}.deferredReason`);
    if (review.status === "claimed") {
      if (review.claimedBySessionId === null || review.claimedAt === null) {
        invalid(`${label} requires claim ownership and time while claimed`);
      }
    } else if (review.claimedBySessionId !== null || review.claimedAt !== null) {
      invalid(`${label} can only have claim metadata while claimed`);
    }
    if (review.status === "deferred") {
      if (review.dueAt === null || review.deferredReason === null) {
        invalid(`${label} requires a due time and reason while deferred`);
      }
    } else if (review.deferredReason !== null) {
      invalid(`${label} can only have a deferral reason while deferred`);
    }
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
  for (const session of Object.values(state.sessions)) {
    if (!session || typeof session !== "object" || Array.isArray(session)) continue;
    if (!("reviewItems" in session)) session.reviewItems = [];
    if (!("synthesisRequired" in session)) session.synthesisRequired = false;
    if (!("checkpoint" in session)) session.checkpoint = null;
  }
  for (const review of Object.values(state.reviews)) {
    if (!review || typeof review !== "object" || Array.isArray(review)) continue;
    if (!("claimedBySessionId" in review)) review.claimedBySessionId = null;
    if (!("claimedAt" in review)) review.claimedAt = null;
    if (!("deferredReason" in review)) review.deferredReason = null;
  }

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
    if (session.checkpoint?.resolvedEvidenceId) {
      const assessment = assessmentIds.get(session.checkpoint.resolvedEvidenceId);
      if (
        !assessment ||
        assessment.contaminated ||
        assessment.grade !== "correct" ||
        assessment.nodeId !== session.checkpoint.nodeId ||
        !session.assessments.some((candidate) => candidate.id === assessment.id)
      ) {
        invalid(`sessions.${id}.checkpoint has invalid resolved evidence`);
      }
    }
    for (const item of session.reviewItems) {
      const review = state.reviews[item.reviewId];
      if (!review) invalid(`sessions.${id} references unknown review: ${item.reviewId}`);
      if (review.conceptId !== item.conceptId) {
        invalid(`sessions.${id} review item points to the wrong concept: ${item.reviewId}`);
      }
      if (!session.conceptIds.includes(item.conceptId)) {
        invalid(`sessions.${id} review item references an unbound concept: ${item.conceptId}`);
      }
      for (const evidenceId of item.evidenceIds) {
        const assessment = assessmentIds.get(evidenceId);
        if (!assessment || assessment.conceptId !== item.conceptId || assessment.contaminated) {
          invalid(`sessions.${id} review item has invalid evidence: ${evidenceId}`);
        }
        if (!session.assessments.some((candidate) => candidate.id === evidenceId)) {
          invalid(`sessions.${id} review item evidence belongs to another session: ${evidenceId}`);
        }
      }
      if (session.phase === "review" && review.claimedBySessionId !== session.id) {
        invalid(`sessions.${id} does not own its active review claim: ${item.reviewId}`);
      }
    }
  }

  for (const review of Object.values(state.reviews)) {
    if (review.status !== "claimed") continue;
    const session = state.sessions[review.claimedBySessionId];
    if (
      !session ||
      state.activeSessionId !== session.id ||
      session.kind !== "review" ||
      session.phase !== "review" ||
      !session.reviewItems.some((item) => item.reviewId === review.id)
    ) {
      invalid(`reviews.${review.id} has an invalid active claim`);
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
