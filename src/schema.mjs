import { LearningError } from "./errors.mjs";
import { validatePlan } from "./graph.mjs";
import { safeRelativeVaultPath, safeVaultDir, validateSourceReference } from "./inputs.mjs";

export const SCHEMA_VERSION = 6;

const SESSION_PHASES = new Set(["probe", "plan", "teach", "review", "complete"]);
const SESSION_KINDS = new Set(["learn", "review"]);
const GRADES = new Set(["correct", "partial", "incorrect"]);
const ASSESSMENT_STAGES = new Set(["probe", "teach", "retention", "synthesis"]);
const QUESTION_STAGES = new Set(["probe", "teach"]);
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
const QUESTION_STATUSES = new Set([
  "awaiting-answer",
  "awaiting-assessment",
  "retry-required",
  "resolved",
  "gap",
  "cancelled",
  "contaminated",
]);
const QUESTION_MODES = new Set(["single-select", "multi-select", "free-response"]);
const FREE_RESPONSE_KINDS = new Set([
  "explanation",
  "prediction",
  "transfer",
  "contrastive",
  "reconstruction",
  "debugging",
]);
const NOTE_TARGET_TYPES = new Set(["session", "question", "concept", "step"]);
const MATERIAL_KINDS = new Set(["youtube", "pdf", "notes", "repository", "web"]);
const MATERIAL_STATUSES = new Set(["pending", "verified", "unavailable"]);
const SOURCE_ROLES = new Set(["anchor", "supplemental"]);
const SOURCE_GUIDANCE_MODES = new Set(["open", "anchored", "supplemental-only"]);
const MASTERY_DIMENSIONS = new Set([
  "recall",
  "explanation",
  "prediction",
  "application",
  "discrimination",
  "debugging",
  "integration",
  "retention",
]);
const MISCONCEPTION_STATUSES = new Set(["active", "repairing", "resolved"]);

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

function boundedInteger(value, label, maximum) {
  integer(value, label);
  if (value > maximum) invalid(`${label} must be at most ${maximum}`);
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

function validateLearnerProfile(profile) {
  const value = object(profile, "learnerProfile");
  text(value.teachingPhilosophy, "learnerProfile.teachingPhilosophy", { allowEmpty: true });
  text(value.explanationPreferences, "learnerProfile.explanationPreferences", { allowEmpty: true });
  text(value.feedbackPreferences, "learnerProfile.feedbackPreferences", { allowEmpty: true });
  text(value.visualPreferences, "learnerProfile.visualPreferences", { allowEmpty: true });
  text(value.sourcePreferences, "learnerProfile.sourcePreferences", { allowEmpty: true });
  nullableInstant(value.updatedAt, "learnerProfile.updatedAt");
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
  nullableText(checkpoint.question, `${label}.question`);
  nullableText(checkpoint.kind, `${label}.kind`);
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

function validateSynthesisCheckpoint(checkpoint, label) {
  if (checkpoint === null) return;
  object(checkpoint, label);
  oneOf(checkpoint.status, CHECKPOINT_STATUSES, `${label}.status`);
  text(checkpoint.questionId, `${label}.questionId`);
  text(checkpoint.question, `${label}.question`);
  nullableText(checkpoint.priorQuestionId, `${label}.priorQuestionId`);
  integer(checkpoint.attempts, `${label}.attempts`);
  nullableText(checkpoint.resolvedEvidenceId, `${label}.resolvedEvidenceId`);
  text(checkpoint.mistakeType, `${label}.mistakeType`, { allowEmpty: true });
  if (checkpoint.status === "resolved" && checkpoint.resolvedEvidenceId === null) {
    invalid(`${label}.resolvedEvidenceId is required when resolved`);
  }
  if (checkpoint.status !== "resolved" && checkpoint.resolvedEvidenceId !== null) {
    invalid(`${label}.resolvedEvidenceId requires a resolved checkpoint`);
  }
  if (checkpoint.status === "new-transfer-required" && checkpoint.priorQuestionId === null) {
    invalid(`${label}.priorQuestionId is required before a new transfer`);
  }
}

function validateCheckpointDefinition(definition, checkpointKind, label) {
  if (definition === null) return;
  object(definition, label);
  oneOf(definition.mode, QUESTION_MODES, `${label}.mode`);
  const isFreeResponse = definition.mode === "free-response";
  if (
    (isFreeResponse && checkpointKind === "multiple-choice") ||
    (!isFreeResponse && checkpointKind !== "multiple-choice")
  ) {
    invalid(`${label}.mode is incompatible with checkpoint kind ${checkpointKind}`);
  }
  const choices = array(definition.choices, `${label}.choices`);
  const choiceValues = new Set();
  if (isFreeResponse && choices.length !== 0) invalid(`${label}.choices must be empty for free response`);
  if (!isFreeResponse && (choices.length < 2 || choices.length > 12)) {
    invalid(`${label}.choices must contain 2 to 12 items`);
  }
  for (const [index, choice] of choices.entries()) {
    const choiceLabel = `${label}.choices[${index}]`;
    object(choice, choiceLabel);
    text(choice.value, `${choiceLabel}.value`);
    text(choice.label, `${choiceLabel}.label`);
    nullableText(choice.description, `${choiceLabel}.description`);
    if (choiceValues.has(choice.value)) invalid(`${label}.choices contains duplicate values`);
    choiceValues.add(choice.value);
  }
  const correctValues = uniqueTextArray(
    definition.correctChoiceValues,
    `${label}.correctChoiceValues`,
  );
  if (isFreeResponse && correctValues.length !== 0) {
    invalid(`${label}.correctChoiceValues must be empty for free response`);
  }
  if (!isFreeResponse && (
    correctValues.length === 0 ||
    correctValues.some((value) => !choiceValues.has(value)) ||
    (definition.mode === "single-select" && correctValues.length !== 1)
  )) {
    invalid(`${label}.correctChoiceValues do not match the choices and mode`);
  }
  if (isFreeResponse) nullableText(definition.explanation, `${label}.explanation`);
  else text(definition.explanation, `${label}.explanation`);
  nullableText(definition.parentQuestionId, `${label}.parentQuestionId`);
  nullableText(definition.adaptationReason, `${label}.adaptationReason`);
  if ((definition.parentQuestionId === null) !== (definition.adaptationReason === null)) {
    invalid(`${label} parentQuestionId and adaptationReason must be supplied together`);
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
  if (item.confidence !== null) boundedInteger(item.confidence, `${label}.confidence`, 100);
  if (item.responseTimeMs !== null) integer(item.responseTimeMs, `${label}.responseTimeMs`);
  if (item.transferLevel !== null) boundedInteger(item.transferLevel, `${label}.transferLevel`, 4);
  if (item.supportLevel !== null) boundedInteger(item.supportLevel, `${label}.supportLevel`, 4);
  text(item.activityType, `${label}.activityType`);
  uniqueTextArray(item.misconceptionIds, `${label}.misconceptionIds`);
  stateInstant(item.createdAt, `${label}.createdAt`);
}

function equalTextSets(left, right) {
  if (left.length !== right.length) return false;
  const expected = new Set(right);
  return left.every((value) => expected.has(value));
}

function validateQuestion(item, label, questionIds, responseIds) {
  object(item, label);
  text(item.id, `${label}.id`);
  if (questionIds.has(item.id)) invalid(`duplicate question ID: ${item.id}`);
  questionIds.add(item.id);
  oneOf(item.stage, QUESTION_STAGES, `${label}.stage`);
  text(item.nodeId, `${label}.nodeId`);
  text(item.kind, `${label}.kind`);
  text(item.question, `${label}.question`);
  oneOf(item.mode, QUESTION_MODES, `${label}.mode`);
  const isFreeResponse = item.mode === "free-response";
  if (
    (!isFreeResponse && item.kind !== "multiple-choice") ||
    (isFreeResponse && !FREE_RESPONSE_KINDS.has(item.kind))
  ) {
    invalid(`${label}.kind is incompatible with ${item.mode}`);
  }
  text(item.activityType, `${label}.activityType`);
  text(item.strategyReason, `${label}.strategyReason`);
  if (item.supportLevel !== null) boundedInteger(item.supportLevel, `${label}.supportLevel`, 4);
  if (item.transferLevel !== null) boundedInteger(item.transferLevel, `${label}.transferLevel`, 4);

  const choiceValues = new Set();
  const choices = array(item.choices, `${label}.choices`);
  if (isFreeResponse && choices.length !== 0) invalid(`${label}.choices must be empty for free response`);
  if (!isFreeResponse && (choices.length < 2 || choices.length > 12)) {
    invalid(`${label}.choices must contain 2 to 12 items`);
  }
  for (const [index, choice] of choices.entries()) {
    const choiceLabel = `${label}.choices[${index}]`;
    object(choice, choiceLabel);
    text(choice.value, `${choiceLabel}.value`);
    text(choice.label, `${choiceLabel}.label`);
    nullableText(choice.description, `${choiceLabel}.description`);
    if (choiceValues.has(choice.value)) invalid(`${label}.choices contains duplicate values`);
    choiceValues.add(choice.value);
  }
  const correctValues = uniqueTextArray(item.correctChoiceValues, `${label}.correctChoiceValues`);
  if (isFreeResponse && correctValues.length !== 0) {
    invalid(`${label}.correctChoiceValues must be empty for free response`);
  }
  if (!isFreeResponse && (
    correctValues.length === 0 ||
    correctValues.some((value) => !choiceValues.has(value)) ||
    (item.mode === "single-select" && correctValues.length !== 1)
  )) {
    invalid(`${label}.correctChoiceValues do not match the choices and mode`);
  }
  if (isFreeResponse) nullableText(item.explanation, `${label}.explanation`);
  else text(item.explanation, `${label}.explanation`);
  oneOf(item.status, QUESTION_STATUSES, `${label}.status`);
  nullableText(item.parentQuestionId, `${label}.parentQuestionId`);
  nullableText(item.adaptationReason, `${label}.adaptationReason`);
  stateInstant(item.createdAt, `${label}.createdAt`);
  nullableInstant(item.cancelledAt, `${label}.cancelledAt`);

  const responses = array(item.responses, `${label}.responses`);
  for (const [index, response] of responses.entries()) {
    const responseLabel = `${label}.responses[${index}]`;
    object(response, responseLabel);
    text(response.id, `${responseLabel}.id`);
    if (responseIds.has(response.id)) invalid(`duplicate response ID: ${response.id}`);
    responseIds.add(response.id);
    const selected = uniqueTextArray(
      response.selectedChoiceValues,
      `${responseLabel}.selectedChoiceValues`,
    );
    if (selected.some((value) => !choiceValues.has(value))) {
      invalid(`${responseLabel} references an unknown choice`);
    }
    nullableText(response.textAnswer, `${responseLabel}.textAnswer`);
    if (typeof response.dontKnow !== "boolean") invalid(`${responseLabel}.dontKnow must be boolean`);
    if (isFreeResponse) {
      if (response.correct !== null) invalid(`${responseLabel}.correct must be null for free response`);
    } else if (typeof response.correct !== "boolean") {
      invalid(`${responseLabel}.correct must be boolean`);
    }
    if (response.confidence !== null) boundedInteger(response.confidence, `${responseLabel}.confidence`, 100);
    if (response.responseTimeMs !== null) integer(response.responseTimeMs, `${responseLabel}.responseTimeMs`);
    nullableText(response.noteId, `${responseLabel}.noteId`);
    nullableText(response.assessmentId, `${responseLabel}.assessmentId`);
    stateInstant(response.createdAt, `${responseLabel}.createdAt`);
    if (response.dontKnow && (selected.length !== 0 || response.textAnswer !== null)) {
      invalid(`${responseLabel} cannot include an answer with I don't know`);
    }
    if (
      !isFreeResponse && !response.dontKnow &&
      ((item.mode === "single-select" && selected.length !== 1) ||
        (item.mode === "multi-select" && selected.length === 0))
    ) {
      invalid(`${responseLabel} selections do not match the question mode`);
    }
    if (isFreeResponse) {
      if (!response.dontKnow && response.textAnswer === null) {
        invalid(`${responseLabel}.textAnswer is required for free response`);
      }
      if (selected.length !== 0) invalid(`${responseLabel} cannot select choices for free response`);
    } else {
      if (response.textAnswer !== null) invalid(`${responseLabel}.textAnswer requires free response`);
      const computedCorrect = !response.dontKnow && equalTextSets(selected, correctValues);
      if (response.correct !== computedCorrect) invalid(`${responseLabel}.correct is inconsistent`);
    }
  }

  const latest = responses.at(-1) ?? null;
  if (item.status === "awaiting-answer" && responses.length !== 0) {
    invalid(`${label} cannot have responses while awaiting its first answer`);
  }
  if (
    item.status === "awaiting-assessment" &&
    (!latest || latest.dontKnow || latest.assessmentId !== null)
  ) {
    invalid(`${label} requires an unassessed response while awaiting assessment`);
  }
  if (
    item.status === "retry-required" &&
    (!latest || latest.dontKnow || (!isFreeResponse && latest.correct) || latest.assessmentId === null)
  ) {
    invalid(`${label} requires an assessed incorrect response for retry`);
  }
  if (
    ["resolved", "contaminated"].includes(item.status) &&
    (
      !latest ||
      latest.dontKnow ||
      (latest.assessmentId === null && item.activityType !== "productive-failure")
    )
  ) {
    invalid(`${label} requires an assessed response when ${item.status}`);
  }
  if (item.status === "gap" && (!latest || !latest.dontKnow || latest.assessmentId !== null)) {
    invalid(`${label} requires an ungraded I don't know response for a gap`);
  }
  if (item.status === "cancelled" && item.cancelledAt === null) {
    invalid(`${label}.cancelledAt is required when cancelled`);
  }
  if (item.status !== "cancelled" && item.cancelledAt !== null) {
    invalid(`${label}.cancelledAt requires cancelled status`);
  }
}

function validateSession(
  session,
  key,
  globalAssessmentIds,
  globalAdmittedGapIds,
  globalMaterialIds,
  globalSourceIds,
  globalCoverageIds,
  globalVisualIds,
) {
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
  if (!("restartedAt" in session)) session.restartedAt = null;
  if (!("restartReason" in session)) session.restartReason = null;
  if (!("replacedBySessionId" in session)) session.replacedBySessionId = null;
  if (!("restartedFromSessionId" in session)) session.restartedFromSessionId = null;
  nullableInstant(session.restartedAt, `${label}.restartedAt`);
  nullableText(session.restartReason, `${label}.restartReason`);
  nullableText(session.replacedBySessionId, `${label}.replacedBySessionId`);
  nullableText(session.restartedFromSessionId, `${label}.restartedFromSessionId`);
  if (session.phase === "complete" && session.completedAt === null) {
    invalid(`${label}.completedAt is required for a complete session`);
  }
  if (session.phase !== "complete" && session.completedAt !== null) {
    invalid(`${label}.completedAt requires the complete phase`);
  }
  if (
    session.restartedAt === null &&
    (session.restartReason !== null || session.replacedBySessionId !== null)
  ) {
    invalid(`${label}.restart metadata requires restartedAt`);
  }
  if (
    session.restartedAt !== null &&
    (session.restartReason === null || session.replacedBySessionId === null)
  ) {
    invalid(`${label}.restartedAt requires a reason and replacement session`);
  }
  if (session.restartedAt !== null && session.completedAt !== null) {
    invalid(`${label} cannot be both completed and restarted`);
  }
  text(session.probeSummary, `${label}.probeSummary`, { allowEmpty: true });

  for (const [index, activity] of array(session.activityHistory, `${label}.activityHistory`).entries()) {
    const activityLabel = `${label}.activityHistory[${index}]`;
    object(activity, activityLabel);
    text(activity.id, `${activityLabel}.id`);
    text(activity.type, `${activityLabel}.type`);
    text(activity.nodeId, `${activityLabel}.nodeId`);
    nullableText(activity.questionId, `${activityLabel}.questionId`);
    text(activity.reason, `${activityLabel}.reason`);
    if (activity.transferLevel !== null) {
      boundedInteger(activity.transferLevel, `${activityLabel}.transferLevel`, 4);
    }
    if (activity.supportLevel !== null) {
      boundedInteger(activity.supportLevel, `${activityLabel}.supportLevel`, 4);
    }
    stateInstant(activity.createdAt, `${activityLabel}.createdAt`);
  }

  for (const [index, attempt] of array(session.productiveAttempts, `${label}.productiveAttempts`).entries()) {
    const attemptLabel = `${label}.productiveAttempts[${index}]`;
    object(attempt, attemptLabel);
    text(attempt.id, `${attemptLabel}.id`);
    text(attempt.nodeId, `${attemptLabel}.nodeId`);
    text(attempt.questionId, `${attemptLabel}.questionId`);
    text(attempt.prompt, `${attemptLabel}.prompt`);
    text(attempt.answer, `${attemptLabel}.answer`);
    text(attempt.rationale, `${attemptLabel}.rationale`);
    if (attempt.confidence !== null) {
      boundedInteger(attempt.confidence, `${attemptLabel}.confidence`, 100);
    }
    if (attempt.responseTimeMs !== null) {
      integer(attempt.responseTimeMs, `${attemptLabel}.responseTimeMs`);
    }
    stateInstant(attempt.createdAt, `${attemptLabel}.createdAt`);
  }

  const admittedGapNodes = new Set();
  for (const [index, gap] of array(session.admittedGaps, `${label}.admittedGaps`).entries()) {
    const gapLabel = `${label}.admittedGaps[${index}]`;
    object(gap, gapLabel);
    text(gap.id, `${gapLabel}.id`);
    if (globalAdmittedGapIds.has(gap.id)) invalid(`duplicate admitted gap ID: ${gap.id}`);
    globalAdmittedGapIds.add(gap.id);
    text(gap.nodeId, `${gapLabel}.nodeId`);
    if (admittedGapNodes.has(gap.nodeId)) {
      invalid(`${label}.admittedGaps contains duplicate node: ${gap.nodeId}`);
    }
    admittedGapNodes.add(gap.nodeId);
    text(gap.conceptId, `${gapLabel}.conceptId`);
    text(gap.statement, `${gapLabel}.statement`);
    text(gap.evidence, `${gapLabel}.evidence`);
    stateInstant(gap.createdAt, `${gapLabel}.createdAt`);
  }

  for (const [index, gap] of array(session.checkpointGaps, `${label}.checkpointGaps`).entries()) {
    const gapLabel = `${label}.checkpointGaps[${index}]`;
    object(gap, gapLabel);
    text(gap.id, `${gapLabel}.id`);
    if (globalAdmittedGapIds.has(gap.id)) invalid(`duplicate admitted gap ID: ${gap.id}`);
    globalAdmittedGapIds.add(gap.id);
    oneOf(gap.stage, new Set(["teach", "retention", "synthesis"]), `${gapLabel}.stage`);
    text(gap.nodeId, `${gapLabel}.nodeId`);
    text(gap.conceptId, `${gapLabel}.conceptId`);
    text(gap.questionId, `${gapLabel}.questionId`);
    text(gap.question, `${gapLabel}.question`);
    text(gap.kind, `${gapLabel}.kind`);
    text(gap.statement, `${gapLabel}.statement`);
    text(gap.evidence, `${gapLabel}.evidence`);
    stateInstant(gap.createdAt, `${gapLabel}.createdAt`);
    if (
      (session.kind === "learn" && !["teach", "synthesis"].includes(gap.stage)) ||
      (session.kind === "review" && !["retention", "synthesis"].includes(gap.stage))
    ) {
      invalid(`${gapLabel}.stage does not match the session kind`);
    }
  }

  for (const [index, assessment] of array(session.assessments, `${label}.assessments`).entries()) {
    validateAssessment(assessment, `${label}.assessments[${index}]`, globalAssessmentIds);
  }

  const questionIds = new Set();
  const responseIds = new Set();
  for (const [index, question] of array(session.questions, `${label}.questions`).entries()) {
    validateQuestion(question, `${label}.questions[${index}]`, questionIds, responseIds);
  }
  if (
    session.questions.filter((question) =>
      ["awaiting-answer", "awaiting-assessment", "retry-required"].includes(question.status),
    ).length > 1
  ) {
    invalid(`${label}.questions contains multiple unresolved questions`);
  }

  const materialById = new Map();
  for (const [index, material] of array(session.materials, `${label}.materials`).entries()) {
    const materialLabel = `${label}.materials[${index}]`;
    object(material, materialLabel);
    text(material.id, `${materialLabel}.id`);
    if (globalMaterialIds.has(material.id)) invalid(`duplicate material ID: ${material.id}`);
    globalMaterialIds.add(material.id);
    if (materialById.has(material.id)) invalid(`${label}.materials contains duplicate ID: ${material.id}`);
    materialById.set(material.id, material);
    try {
      validateSourceReference(material.reference);
    } catch (error) {
      invalid(`${materialLabel}.reference is invalid: ${error.message}`);
    }
    oneOf(material.kind, MATERIAL_KINDS, `${materialLabel}.kind`);
    oneOf(material.status, MATERIAL_STATUSES, `${materialLabel}.status`);
    nullableText(material.title, `${materialLabel}.title`);
    nullableText(material.resolution, `${materialLabel}.resolution`);
    stateInstant(material.createdAt, `${materialLabel}.createdAt`);
    stateInstant(material.updatedAt, `${materialLabel}.updatedAt`);
    if (material.status === "pending" && (material.title !== null || material.resolution !== null)) {
      invalid(`${materialLabel} cannot contain resolution data while pending`);
    }
    if (material.status === "verified" && (material.title === null || material.resolution === null)) {
      invalid(`${materialLabel} requires a title and resolution when verified`);
    }
    if (material.status === "unavailable" && material.resolution === null) {
      invalid(`${materialLabel}.resolution is required when unavailable`);
    }
  }

  object(session.sourceGuidance, `${label}.sourceGuidance`);
  oneOf(
    session.sourceGuidance.mode,
    SOURCE_GUIDANCE_MODES,
    `${label}.sourceGuidance.mode`,
  );
  nullableText(session.sourceGuidance.reason, `${label}.sourceGuidance.reason`);
  stateInstant(session.sourceGuidance.updatedAt, `${label}.sourceGuidance.updatedAt`);
  for (const [index, entry] of array(
    session.sourceGuidance.history,
    `${label}.sourceGuidance.history`,
  ).entries()) {
    const entryLabel = `${label}.sourceGuidance.history[${index}]`;
    object(entry, entryLabel);
    oneOf(entry.mode, SOURCE_GUIDANCE_MODES, `${entryLabel}.mode`);
    nullableText(entry.reason, `${entryLabel}.reason`);
    stateInstant(entry.createdAt, `${entryLabel}.createdAt`);
    if (entry.mode === "supplemental-only" && entry.reason === null) {
      invalid(`${entryLabel}.reason is required for supplemental-only mode`);
    }
  }
  if (session.materials.length === 0 && session.sourceGuidance.mode !== "open") {
    invalid(`${label}.sourceGuidance must be open when no learner materials exist`);
  }
  if (session.materials.length > 0 && session.sourceGuidance.mode === "open") {
    invalid(`${label}.sourceGuidance cannot be open when learner materials exist`);
  }
  if (
    session.sourceGuidance.mode === "supplemental-only" &&
    (session.sourceGuidance.reason === null ||
      session.materials.some((material) => material.status !== "unavailable"))
  ) {
    invalid(
      `${label}.sourceGuidance supplemental-only mode requires a reason and only unavailable materials`,
    );
  }
  if (
    session.sourceGuidance.mode !== "supplemental-only" &&
    session.sourceGuidance.reason !== null
  ) {
    invalid(`${label}.sourceGuidance reason requires supplemental-only mode`);
  }

  const localSourceIds = new Set();
  for (const [index, source] of array(session.sources, `${label}.sources`).entries()) {
    const sourceLabel = `${label}.sources[${index}]`;
    object(source, sourceLabel);
    text(source.id, `${sourceLabel}.id`);
    if (globalSourceIds.has(source.id)) invalid(`duplicate source ID: ${source.id}`);
    globalSourceIds.add(source.id);
    localSourceIds.add(source.id);
    for (const field of ["title", "url", "sourceClass", "supports", "verification"]) {
      text(source[field], `${sourceLabel}.${field}`);
    }
    oneOf(source.role, SOURCE_ROLES, `${sourceLabel}.role`);
    text(source.locator, `${sourceLabel}.locator`);
    nullableText(source.materialId, `${sourceLabel}.materialId`);
    try {
      validateSourceReference(source.url);
    } catch (error) {
      invalid(`${sourceLabel}.url is invalid: ${error.message}`);
    }
    stateInstant(source.createdAt, `${sourceLabel}.createdAt`);
    if (source.role === "anchor") {
      const material = materialById.get(source.materialId);
      if (!material || material.status !== "verified" || material.reference !== source.url) {
        invalid(`${sourceLabel} must reference matching verified anchor material`);
      }
    } else if (source.materialId !== null) {
      invalid(`${sourceLabel}.materialId is only allowed for anchor sources`);
    }
  }

  if (session.plan !== null) validatePlan(session.plan);
  const planNodeIds = new Set(session.plan?.nodes?.map((node) => node.id) ?? []);
  const coveragePairs = new Set();
  for (const [index, coverage] of array(session.sourceCoverage, `${label}.sourceCoverage`).entries()) {
    const coverageLabel = `${label}.sourceCoverage[${index}]`;
    object(coverage, coverageLabel);
    text(coverage.id, `${coverageLabel}.id`);
    if (globalCoverageIds.has(coverage.id)) invalid(`duplicate source coverage ID: ${coverage.id}`);
    globalCoverageIds.add(coverage.id);
    text(coverage.nodeId, `${coverageLabel}.nodeId`);
    text(coverage.sourceId, `${coverageLabel}.sourceId`);
    text(coverage.summary, `${coverageLabel}.summary`);
    stateInstant(coverage.createdAt, `${coverageLabel}.createdAt`);
    if (!planNodeIds.has(coverage.nodeId)) {
      invalid(`${coverageLabel}.nodeId references a missing plan node`);
    }
    if (!localSourceIds.has(coverage.sourceId)) {
      invalid(`${coverageLabel}.sourceId references an unknown session source`);
    }
    const pair = `${coverage.nodeId}\u0000${coverage.sourceId}`;
    if (coveragePairs.has(pair)) invalid(`${label}.sourceCoverage contains a duplicate node-source pair`);
    coveragePairs.add(pair);
  }
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
    nullableText(step.checkpointQuestionId, `${stepLabel}.checkpointQuestionId`);
    nullableText(step.checkpointKind, `${stepLabel}.checkpointKind`);
    validateCheckpointDefinition(
      step.checkpointDefinition,
      step.checkpointKind,
      `${stepLabel}.checkpointDefinition`,
    );
    text(step.activityType, `${stepLabel}.activityType`);
    text(step.strategyReason, `${stepLabel}.strategyReason`);
    if (step.supportLevel !== null) boundedInteger(step.supportLevel, `${stepLabel}.supportLevel`, 4);
    if (step.transferLevel !== null) boundedInteger(step.transferLevel, `${stepLabel}.transferLevel`, 4);
    stateInstant(step.createdAt, `${stepLabel}.createdAt`);
  }
  if (session.activeStepId !== null && !stepIds.has(session.activeStepId)) {
    invalid(`${label}.activeStepId references an unknown step`);
  }

  const noteIds = new Set();
  for (const [index, note] of array(session.notes, `${label}.notes`).entries()) {
    const noteLabel = `${label}.notes[${index}]`;
    object(note, noteLabel);
    text(note.id, `${noteLabel}.id`);
    if (noteIds.has(note.id)) invalid(`${label}.notes contains duplicate ID: ${note.id}`);
    noteIds.add(note.id);
    oneOf(note.targetType, NOTE_TARGET_TYPES, `${noteLabel}.targetType`);
    text(note.targetId, `${noteLabel}.targetId`);
    text(note.body, `${noteLabel}.body`);
    stateInstant(note.createdAt, `${noteLabel}.createdAt`);
    stateInstant(note.updatedAt, `${noteLabel}.updatedAt`);
    const targetExists =
      (note.targetType === "session" && note.targetId === session.id) ||
      (note.targetType === "question" && questionIds.has(note.targetId)) ||
      (note.targetType === "step" && stepIds.has(note.targetId)) ||
      (note.targetType === "concept" && session.conceptIds.includes(note.targetId));
    if (!targetExists) invalid(`${noteLabel} references an unknown session target`);
  }

  for (const [index, question] of session.questions.entries()) {
    const questionLabel = `${label}.questions[${index}]`;
    const eligibleParents = session.questions
      .slice(0, index)
      .filter((candidate) => ["resolved", "gap"].includes(candidate.status));
    if (eligibleParents.length === 0) {
      if (question.parentQuestionId !== null || question.adaptationReason !== null) {
        invalid(`${questionLabel} has no eligible adaptive parent`);
      }
    } else {
      const parentIndex = session.questions.findIndex(
        (candidate) => candidate.id === question.parentQuestionId,
      );
      const parent = parentIndex < 0 ? null : session.questions[parentIndex];
      if (
        parentIndex < 0 ||
        parentIndex >= index ||
        !["resolved", "gap"].includes(parent?.status) ||
        question.adaptationReason === null
      ) {
        invalid(`${questionLabel} requires an earlier adaptive parent and reason`);
      }
    }
    for (const response of question.responses) {
      if (response.noteId !== null && !noteIds.has(response.noteId)) {
        invalid(`${questionLabel} response references an unknown note`);
      }
      if (response.noteId !== null) {
        const note = session.notes.find((candidate) => candidate.id === response.noteId);
        if (note?.targetType !== "question" || note.targetId !== question.id) {
          invalid(`${questionLabel} response note is bound to a different target`);
        }
      }
      if (response.assessmentId !== null) {
        const assessment = globalAssessmentIds.get(response.assessmentId);
        if (
          !assessment ||
          assessment.questionId !== question.id ||
          assessment.question !== question.question ||
          assessment.kind !== question.kind ||
          assessment.stage !== question.stage
        ) {
          invalid(`${questionLabel} response references an incompatible assessment`);
        }
        if (question.mode === "free-response") {
          if (assessment.answer !== response.textAnswer) {
            invalid(`${questionLabel} assessment does not preserve the free response`);
          }
        } else {
          const expectedGrade = response.correct ? "correct" : "incorrect";
          if (assessment.grade !== expectedGrade) {
            invalid(`${questionLabel} response has an inconsistent assessment grade`);
          }
        }
        if (
          response === question.responses.at(-1) &&
          ["retry-required", "resolved", "contaminated"].includes(question.status) &&
          assessment.contaminated !== (question.status === "contaminated")
        ) {
          invalid(`${questionLabel} status does not match assessment contamination`);
        }
      }
    }
  }
  validateCheckpoint(session.checkpoint, `${label}.checkpoint`);
  validateSynthesisCheckpoint(session.synthesisCheckpoint, `${label}.synthesisCheckpoint`);
  if (session.activeStepId !== null) {
    const activeStep = session.steps.find((step) => step.id === session.activeStepId);
    if (!session.checkpoint || session.checkpoint.status === "resolved") {
      invalid(`${label}.activeStepId requires an unresolved checkpoint`);
    }
    if (session.checkpoint.nodeId !== activeStep.nodeId) {
      invalid(`${label}.checkpoint must match the active step node`);
    }
    if (
      activeStep.checkpointQuestionId !== null &&
      (
        session.checkpoint.questionId !== activeStep.checkpointQuestionId ||
        session.checkpoint.question !== activeStep.checkpointQuestion ||
        session.checkpoint.kind !== activeStep.checkpointKind
      )
    ) {
      invalid(`${label}.checkpoint must match the active step question identity`);
    }
  }
  if (
    session.kind === "learn" &&
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
    if (session.activeStepId !== null || session.steps.length !== 0) {
      invalid(`${label} cannot contain teaching steps during a review session`);
    }
    if (session.admittedGaps.length !== 0) {
      invalid(`${label}.admittedGaps must be empty for a review session`);
    }
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
    const mastery = object(concept.mastery, `${label}.mastery`);
    if (
      Object.keys(mastery).length !== MASTERY_DIMENSIONS.size ||
      [...MASTERY_DIMENSIONS].some((dimension) => !(dimension in mastery))
    ) {
      invalid(`${label}.mastery must contain every mastery dimension exactly once`);
    }
    for (const dimension of MASTERY_DIMENSIONS) {
      const record = object(mastery[dimension], `${label}.mastery.${dimension}`);
      boundedInteger(record.level, `${label}.mastery.${dimension}.level`, 4);
      integer(record.attempts, `${label}.mastery.${dimension}.attempts`);
      integer(record.correct, `${label}.mastery.${dimension}.correct`);
      if (record.correct > record.attempts) {
        invalid(`${label}.mastery.${dimension}.correct cannot exceed attempts`);
      }
      nullableInstant(record.lastAssessedAt, `${label}.mastery.${dimension}.lastAssessedAt`);
      for (const evidenceId of uniqueTextArray(
        record.evidenceIds,
        `${label}.mastery.${dimension}.evidenceIds`,
      )) {
        if (!allAssessmentIds.has(evidenceId)) {
          invalid(`${label}.mastery.${dimension} references unknown evidence: ${evidenceId}`);
        }
      }
    }
    boundedInteger(concept.highestTransferLevel, `${label}.highestTransferLevel`, 4);
    boundedInteger(concept.supportLevel, `${label}.supportLevel`, 4);
    uniqueTextArray(concept.misconceptionIds, `${label}.misconceptionIds`);
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
    integer(review.stabilityDays, `${label}.stabilityDays`);
    boundedInteger(review.difficulty, `${label}.difficulty`, 100);
    integer(review.lapses, `${label}.lapses`);
    array(review.history, `${label}.history`).forEach((entry, index) => {
      const entryLabel = `${label}.history[${index}]`;
      object(entry, entryLabel);
      text(entry.evidenceId, `${entryLabel}.evidenceId`);
      oneOf(entry.grade, GRADES, `${entryLabel}.grade`);
      text(entry.kind, `${entryLabel}.kind`);
      if (entry.confidence !== null) boundedInteger(entry.confidence, `${entryLabel}.confidence`, 100);
      if (entry.responseTimeMs !== null) integer(entry.responseTimeMs, `${entryLabel}.responseTimeMs`);
      if (entry.attemptCount !== null) integer(entry.attemptCount, `${entryLabel}.attemptCount`);
      if (entry.supportLevel !== null) boundedInteger(entry.supportLevel, `${entryLabel}.supportLevel`, 4);
      integer(entry.intervalDays, `${entryLabel}.intervalDays`);
      integer(entry.stabilityDays, `${entryLabel}.stabilityDays`);
      boundedInteger(entry.difficulty, `${entryLabel}.difficulty`, 100);
      integer(entry.lapses, `${entryLabel}.lapses`);
      nullableInstant(entry.dueAt, `${entryLabel}.dueAt`);
      stateInstant(entry.createdAt, `${entryLabel}.createdAt`);
    });
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
  try {
    safeVaultDir(state.settings.vaultDir, "settings.vaultDir");
  } catch (error) {
    invalid(error.message);
  }
  validateLearnerProfile(state.learnerProfile);
  object(state.sessions, "sessions");
  object(state.concepts, "concepts");
  object(state.misconceptions, "misconceptions");
  object(state.reviews, "reviews");
  integer(state.reviewCount, "reviewCount");
  for (const session of Object.values(state.sessions)) {
    if (!session || typeof session !== "object" || Array.isArray(session)) continue;
    if (!("reviewItems" in session)) session.reviewItems = [];
    if (!("admittedGaps" in session)) session.admittedGaps = [];
    if (!("checkpointGaps" in session)) session.checkpointGaps = [];
    if (!("questions" in session)) session.questions = [];
    if (!("notes" in session)) session.notes = [];
    if (!("activityHistory" in session)) session.activityHistory = [];
    if (!("productiveAttempts" in session)) session.productiveAttempts = [];
    if (!("materials" in session)) session.materials = [];
    if (!("sourceCoverage" in session)) session.sourceCoverage = [];
    if (!("sourceGuidance" in session)) {
      session.sourceGuidance = {
        mode: session.materials.length > 0 ? "anchored" : "open",
        reason: null,
        updatedAt: session.updatedAt,
        history: [],
      };
    }
    if (
      session.sourceGuidance &&
      typeof session.sourceGuidance === "object" &&
      !Array.isArray(session.sourceGuidance) &&
      !("history" in session.sourceGuidance)
    ) {
      session.sourceGuidance.history = [];
    }
    if (!("synthesisRequired" in session)) session.synthesisRequired = false;
    if (!("checkpoint" in session)) session.checkpoint = null;
    if (!("synthesisCheckpoint" in session)) session.synthesisCheckpoint = null;
    if (session.checkpoint && typeof session.checkpoint === "object") {
      if (!("question" in session.checkpoint)) session.checkpoint.question = null;
      if (!("kind" in session.checkpoint)) session.checkpoint.kind = null;
    }
    if (Array.isArray(session.steps)) {
      for (const step of session.steps) {
        if (!step || typeof step !== "object" || Array.isArray(step)) continue;
        if (!("checkpointQuestionId" in step)) step.checkpointQuestionId = null;
        if (!("checkpointKind" in step)) step.checkpointKind = null;
        if (!("checkpointDefinition" in step)) step.checkpointDefinition = null;
        if (!("activityType" in step)) step.activityType = "guided-explanation";
        if (!("strategyReason" in step)) step.strategyReason = "Legacy teaching activity.";
        if (!("supportLevel" in step)) step.supportLevel = null;
        if (!("transferLevel" in step)) step.transferLevel = null;
      }
    }
    if (Array.isArray(session.sources)) {
      for (const source of session.sources) {
        if (!source || typeof source !== "object" || Array.isArray(source)) continue;
        if (!("role" in source)) source.role = "supplemental";
        if (!("locator" in source)) source.locator = "Whole source";
        if (!("materialId" in source)) source.materialId = null;
      }
    }
    if (Array.isArray(session.assessments)) {
      for (const assessment of session.assessments) {
        if (!assessment || typeof assessment !== "object" || Array.isArray(assessment)) continue;
        if (!("confidence" in assessment)) assessment.confidence = null;
        if (!("responseTimeMs" in assessment)) assessment.responseTimeMs = null;
        if (!("transferLevel" in assessment)) assessment.transferLevel = null;
        if (!("supportLevel" in assessment)) assessment.supportLevel = null;
        if (!("activityType" in assessment)) assessment.activityType = "assessment";
        if (!("misconceptionIds" in assessment)) assessment.misconceptionIds = [];
      }
    }
    if (Array.isArray(session.questions)) {
      for (const question of session.questions) {
        if (!question || typeof question !== "object" || Array.isArray(question)) continue;
        if (!("activityType" in question)) question.activityType = "multiple-choice";
        if (!("strategyReason" in question)) question.strategyReason = "Legacy question activity.";
        if (!("supportLevel" in question)) question.supportLevel = null;
        if (!("transferLevel" in question)) question.transferLevel = null;
        if (Array.isArray(question.responses)) {
          for (const response of question.responses) {
            if (!response || typeof response !== "object" || Array.isArray(response)) continue;
            if (!("textAnswer" in response)) response.textAnswer = null;
            if (!("confidence" in response)) response.confidence = null;
            if (!("responseTimeMs" in response)) response.responseTimeMs = null;
          }
        }
      }
    }
  }
  for (const concept of Object.values(state.concepts)) {
    if (!concept || typeof concept !== "object" || Array.isArray(concept)) continue;
    if (!("mastery" in concept)) {
      invalid(`concepts.${concept.id ?? "unknown"}.mastery is required`);
    }
    if (!("highestTransferLevel" in concept)) concept.highestTransferLevel = 0;
    if (!("supportLevel" in concept)) concept.supportLevel = 4;
    if (!("misconceptionIds" in concept)) concept.misconceptionIds = [];
  }
  for (const review of Object.values(state.reviews)) {
    if (!review || typeof review !== "object" || Array.isArray(review)) continue;
    if (!("claimedBySessionId" in review)) review.claimedBySessionId = null;
    if (!("claimedAt" in review)) review.claimedAt = null;
    if (!("deferredReason" in review)) review.deferredReason = null;
    if (!("stabilityDays" in review)) review.stabilityDays = 0;
    if (!("difficulty" in review)) review.difficulty = 50;
    if (!("lapses" in review)) review.lapses = 0;
    if (!("history" in review)) review.history = [];
    if (Array.isArray(review.history)) {
      for (const entry of review.history) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        if (!("kind" in entry)) entry.kind = "retention";
        if (!("confidence" in entry)) entry.confidence = null;
        if (!("responseTimeMs" in entry)) entry.responseTimeMs = null;
        if (!("attemptCount" in entry)) entry.attemptCount = null;
        if (!("supportLevel" in entry)) entry.supportLevel = null;
        if (!("stabilityDays" in entry)) entry.stabilityDays = entry.intervalDays ?? 0;
        if (!("difficulty" in entry)) entry.difficulty = review.difficulty;
        if (!("lapses" in entry)) entry.lapses = review.lapses;
      }
    }
  }

  const assessmentIds = new Map();
  const admittedGapIds = new Set();
  const materialIds = new Set();
  const sourceIds = new Set();
  const coverageIds = new Set();
  const visualIds = new Set();
  for (const [id, session] of Object.entries(state.sessions)) {
    validateSession(
      session,
      id,
      assessmentIds,
      admittedGapIds,
      materialIds,
      sourceIds,
      coverageIds,
      visualIds,
    );
  }
  for (const [id, session] of Object.entries(state.sessions)) {
    if (session.replacedBySessionId !== null) {
      const replacement = state.sessions[session.replacedBySessionId];
      if (!replacement || replacement.restartedFromSessionId !== id) {
        invalid(`sessions.${id}.replacedBySessionId must reference its restart successor`);
      }
    }
    if (session.restartedFromSessionId !== null) {
      const predecessor = state.sessions[session.restartedFromSessionId];
      if (!predecessor || predecessor.replacedBySessionId !== id) {
        invalid(`sessions.${id}.restartedFromSessionId must reference its restart predecessor`);
      }
    }
  }
  if (state.activeSessionId !== null && !state.sessions[state.activeSessionId]) {
    invalid("activeSessionId references an unknown session");
  }
  if (state.activeSessionId !== null && state.sessions[state.activeSessionId].phase === "complete") {
    invalid("activeSessionId cannot reference a complete session");
  }
  if (state.activeSessionId !== null && state.sessions[state.activeSessionId].restartedAt !== null) {
    invalid("activeSessionId cannot reference a restarted session");
  }

  validateReviews(state);
  validateTopics(state);
  validateConcepts(state, assessmentIds);

  for (const [id, misconception] of Object.entries(state.misconceptions)) {
    const label = `misconceptions.${id}`;
    object(misconception, label);
    if (misconception.id !== id) invalid(`${label}.id must match its key`);
    if (!state.concepts[misconception.conceptId]) {
      invalid(`${label}.conceptId references an unknown concept`);
    }
    text(misconception.statement, `${label}.statement`);
    oneOf(misconception.status, MISCONCEPTION_STATUSES, `${label}.status`);
    boundedInteger(misconception.confidence, `${label}.confidence`, 100);
    integer(misconception.occurrences, `${label}.occurrences`);
    integer(misconception.relapses, `${label}.relapses`);
    nullableText(misconception.counterexample, `${label}.counterexample`);
    nullableText(misconception.repair, `${label}.repair`);
    uniqueTextArray(misconception.evidenceIds, `${label}.evidenceIds`);
    stateInstant(misconception.createdAt, `${label}.createdAt`);
    stateInstant(misconception.updatedAt, `${label}.updatedAt`);
    nullableInstant(misconception.resolvedAt, `${label}.resolvedAt`);
    if (misconception.status === "resolved" && misconception.resolvedAt === null) {
      invalid(`${label}.resolvedAt is required when resolved`);
    }
    if (!state.concepts[misconception.conceptId].misconceptionIds.includes(id)) {
      invalid(`${label} is not referenced by its concept`);
    }
  }

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
    if (session.checkpoint) {
      const checkpointConcept = session.conceptIds
        .map((conceptId) => state.concepts[conceptId])
        .find((concept) => concept?.key === session.checkpoint.nodeId);
      if (!checkpointConcept) {
        invalid(`sessions.${id}.checkpoint is not bound to a session concept`);
      }
      if (
        session.kind === "review" &&
        !session.reviewItems.some((item) => item.conceptId === checkpointConcept.id)
      ) {
        invalid(`sessions.${id}.checkpoint does not match a selected review item`);
      }
      if (session.kind === "review") {
        text(session.checkpoint.questionId, `sessions.${id}.checkpoint.questionId`);
        text(session.checkpoint.question, `sessions.${id}.checkpoint.question`);
        text(session.checkpoint.kind, `sessions.${id}.checkpoint.kind`);
      }
    }
    for (const gap of session.admittedGaps) {
      const concept = state.concepts[gap.conceptId];
      if (
        !concept ||
        !session.conceptIds.includes(gap.conceptId) ||
        concept.key !== gap.nodeId ||
        concept.topicId !== session.topicId
      ) {
        invalid(`sessions.${id} admitted gap ${gap.id} has an invalid concept binding`);
      }
    }
    for (const gap of session.checkpointGaps) {
      const concept = state.concepts[gap.conceptId];
      if (
        !concept ||
        !session.conceptIds.includes(gap.conceptId) ||
        concept.key !== gap.nodeId ||
        concept.topicId !== session.topicId
      ) {
        invalid(`sessions.${id} checkpoint gap ${gap.id} has an invalid concept binding`);
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
      if (
        !assessment.contaminated &&
        assessment.conceptId === null &&
        assessment.stage !== "synthesis"
      ) {
        invalid(`sessions.${id} assessment ${assessment.id} requires a conceptId`);
      }
      if (assessment.stage === "synthesis" && assessment.conceptId !== null) {
        invalid(`sessions.${id} synthesis assessment ${assessment.id} cannot bind a concept`);
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
      const checkpointConcept = session.conceptIds
        .map((conceptId) => state.concepts[conceptId])
        .find((concept) => concept?.key === session.checkpoint.nodeId);
      if (
        !assessment ||
        assessment.contaminated ||
        assessment.grade !== "correct" ||
        assessment.nodeId !== session.checkpoint.nodeId ||
        assessment.conceptId !== checkpointConcept?.id ||
        assessment.questionId !== session.checkpoint.questionId ||
        assessment.question !== session.checkpoint.question ||
        assessment.kind !== session.checkpoint.kind ||
        assessment.stage !== (session.kind === "review" ? "retention" : "teach") ||
        !session.assessments.some((candidate) => candidate.id === assessment.id)
      ) {
        invalid(`sessions.${id}.checkpoint has invalid resolved evidence`);
      }
    }
    if (session.synthesisCheckpoint?.resolvedEvidenceId) {
      const assessment = assessmentIds.get(session.synthesisCheckpoint.resolvedEvidenceId);
      if (
        !assessment ||
        assessment.contaminated ||
        assessment.grade !== "correct" ||
        assessment.stage !== "synthesis" ||
        assessment.kind !== "synthesis" ||
        assessment.questionId !== session.synthesisCheckpoint.questionId ||
        assessment.question !== session.synthesisCheckpoint.question ||
        !session.assessments.some((candidate) => candidate.id === assessment.id)
      ) {
        invalid(`sessions.${id}.synthesisCheckpoint has invalid resolved evidence`);
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
