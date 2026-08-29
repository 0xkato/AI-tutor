import { randomUUID } from "node:crypto";

import { LearningError, requireText } from "./errors.mjs";

export const MASTERY_DIMENSIONS = Object.freeze([
  "recall",
  "explanation",
  "prediction",
  "application",
  "discrimination",
  "debugging",
  "integration",
  "retention",
]);

export function createMasteryProfile() {
  return Object.fromEntries(
    MASTERY_DIMENSIONS.map((dimension) => [
      dimension,
      {
        level: 0,
        evidenceIds: [],
        attempts: 0,
        correct: 0,
        lastAssessedAt: null,
      },
    ]),
  );
}

export function dimensionForAssessment(kind) {
  return {
    "multiple-choice": "recall",
    explanation: "explanation",
    prediction: "prediction",
    transfer: "application",
    reconstruction: "recall",
    contrastive: "discrimination",
    debugging: "debugging",
    synthesis: "integration",
    retention: "retention",
  }[kind] ?? null;
}

export function legacySupportLevel(status) {
  return {
    strong: 0,
    developing: 2,
    fragile: 3,
    gap: 4,
    unknown: 4,
  }[status] ?? 4;
}

export function seedMasteryFromAssessments(assessments = []) {
  const mastery = createMasteryProfile();
  let highestTransferLevel = 0;
  for (const assessment of assessments) {
    if (!assessment || assessment.contaminated) continue;
    const dimension = dimensionForAssessment(assessment.kind);
    if (!dimension) continue;
    const record = mastery[dimension];
    record.attempts += 1;
    record.lastAssessedAt = assessment.createdAt;
    if (assessment.grade === "correct") {
      record.correct += 1;
      record.level = Math.max(record.level, assessment.kind === "multiple-choice" ? 1 : 2);
      if (!record.evidenceIds.includes(assessment.id)) record.evidenceIds.push(assessment.id);
      if (assessment.kind === "transfer") {
        highestTransferLevel = Math.max(highestTransferLevel, assessment.transferLevel ?? 1);
      }
    } else if (assessment.grade === "partial") {
      record.level = Math.max(record.level, 1);
      if (!record.evidenceIds.includes(assessment.id)) record.evidenceIds.push(assessment.id);
    }
  }
  return { mastery, highestTransferLevel };
}

function appendUnique(items, value) {
  if (!items.includes(value)) items.push(value);
}

function assessmentMisconceptionIds(assessment) {
  assessment.misconceptionIds ??= [];
  return assessment.misconceptionIds;
}

function durableLevel(assessment) {
  if (assessment.kind === "multiple-choice") return 1;
  if (["transfer", "contrastive"].includes(assessment.kind)) {
    return Math.max(2, assessment.transferLevel ?? 1);
  }
  if (["synthesis", "retention"].includes(assessment.kind)) return 3;
  return 2;
}

export function applyAssessmentToMastery(concept, assessment) {
  if (assessment.contaminated) return concept;
  const dimension = dimensionForAssessment(assessment.kind);
  if (!dimension) return concept;
  const record = concept.mastery[dimension];
  record.attempts += 1;
  record.lastAssessedAt = assessment.createdAt;
  appendUnique(record.evidenceIds, assessment.id);

  if (assessment.grade === "correct") {
    record.correct += 1;
    record.level = Math.max(record.level, durableLevel(assessment));
    if (["transfer", "contrastive"].includes(assessment.kind)) {
      concept.highestTransferLevel = Math.max(
        concept.highestTransferLevel,
        assessment.transferLevel ?? 1,
      );
    }
    if (assessment.kind !== "multiple-choice") {
      const observedSupport = assessment.supportLevel ?? concept.supportLevel;
      concept.supportLevel = Math.min(concept.supportLevel, Math.max(0, observedSupport - 1));
    }
  } else if (assessment.grade === "partial") {
    record.level = Math.max(1, record.level - 1);
  } else {
    record.level = Math.max(0, record.level - 2);
  }
  return concept;
}

export function upsertMisconception(state, concept, assessment, input = {}) {
  if (assessment.contaminated || !["partial", "incorrect"].includes(assessment.grade)) {
    throw new LearningError(
      "Misconceptions require clean partial or incorrect evidence",
      "INVALID_MISCONCEPTION_EVIDENCE",
    );
  }
  const statement = requireText(input.statement, "misconception statement");
  let misconception = input.id ? state.misconceptions[input.id] : null;
  if (!misconception) {
    misconception = concept.misconceptionIds
      .map((id) => state.misconceptions[id])
      .find((candidate) => candidate?.statement === statement) ?? null;
  }
  if (misconception && misconception.conceptId !== concept.id) {
    throw new LearningError(
      `Misconception ${misconception.id} belongs to a different concept`,
      "MISCONCEPTION_CONCEPT_MISMATCH",
    );
  }

  if (!misconception) {
    const id = input.id ?? randomUUID();
    if (state.misconceptions[id]) {
      throw new LearningError(`Misconception already exists: ${id}`, "DUPLICATE_MISCONCEPTION");
    }
    misconception = {
      id,
      conceptId: concept.id,
      statement,
      status: "active",
      confidence: assessment.confidence ?? 50,
      occurrences: 0,
      relapses: 0,
      counterexample: input.counterexample ? requireText(input.counterexample, "counterexample") : null,
      repair: input.repair ? requireText(input.repair, "repair") : null,
      evidenceIds: [],
      createdAt: assessment.createdAt,
      updatedAt: assessment.createdAt,
      resolvedAt: null,
    };
    state.misconceptions[id] = misconception;
    appendUnique(concept.misconceptionIds, id);
  } else {
    if (misconception.statement !== statement) {
      throw new LearningError(
        `Misconception ${misconception.id} must preserve its original statement`,
        "MISCONCEPTION_IDENTITY_MISMATCH",
      );
    }
    if (misconception.status === "resolved") misconception.relapses += 1;
    misconception.status = "active";
    misconception.resolvedAt = null;
    misconception.confidence = assessment.confidence ?? misconception.confidence;
    if (input.counterexample) misconception.counterexample = requireText(input.counterexample, "counterexample");
    if (input.repair) misconception.repair = requireText(input.repair, "repair");
  }

  misconception.occurrences += 1;
  misconception.updatedAt = assessment.createdAt;
  appendUnique(misconception.evidenceIds, assessment.id);
  appendUnique(assessmentMisconceptionIds(assessment), misconception.id);
  return misconception;
}

export function resolveMisconceptions(state, concept, assessment, ids = []) {
  if (assessment.contaminated || assessment.grade !== "correct") {
    throw new LearningError(
      "Resolving a misconception requires clean correct evidence",
      "INVALID_MISCONCEPTION_EVIDENCE",
    );
  }
  if (["multiple-choice", "explanation", "prediction"].includes(assessment.kind)) {
    throw new LearningError(
      "Resolving a misconception requires durable transfer evidence",
      "DURABLE_EVIDENCE_REQUIRED",
    );
  }
  for (const id of [...new Set(ids)]) {
    const misconception = state.misconceptions[id];
    if (!misconception) {
      throw new LearningError(`Unknown misconception: ${id}`, "MISCONCEPTION_NOT_FOUND");
    }
    if (misconception.conceptId !== concept.id) {
      throw new LearningError(
        `Misconception ${id} belongs to a different concept`,
        "MISCONCEPTION_CONCEPT_MISMATCH",
      );
    }
    misconception.status = "resolved";
    misconception.resolvedAt = assessment.createdAt;
    misconception.updatedAt = assessment.createdAt;
    appendUnique(misconception.evidenceIds, assessment.id);
    appendUnique(assessmentMisconceptionIds(assessment), id);
  }
  return concept;
}

function conceptForNode(state, session, nodeId) {
  return session.conceptIds
    .map((id) => state.concepts[id])
    .find((candidate) => candidate?.key === nodeId) ?? null;
}

function admittedGapForNode(session, nodeId) {
  return [...(session.admittedGaps ?? []), ...(session.checkpointGaps ?? [])]
    .some((gap) => gap.nodeId === nodeId);
}

function hasDurableEvidence(concept) {
  if (!concept || !["developing", "strong"].includes(concept.status)) return false;
  return MASTERY_DIMENSIONS
    .filter((dimension) => dimension !== "recall")
    .some((dimension) => concept.mastery[dimension].level >= 2);
}

function recommendation(type, nodeId, reason, {
  supportLevel = null,
  transferLevel = null,
  productiveFailureAllowed = false,
} = {}) {
  return {
    type,
    nodeId,
    supportLevel,
    transferLevel,
    reason,
    productiveFailureAllowed,
  };
}

export function recommendNextActivity(state, session, nodeId) {
  const concept = conceptForNode(state, session, nodeId);
  if (!concept) {
    throw new LearningError(`No concept is bound to node: ${nodeId}`, "CONCEPT_NOT_DECLARED");
  }
  const node = session.plan?.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new LearningError(`Unknown plan node: ${nodeId}`, "UNKNOWN_NODE");

  if (
    concept.status === "gap" ||
    admittedGapForNode(session, nodeId) ||
    concept.retry?.mistakeType === "admitted-gap"
  ) {
    return recommendation(
      "worked-example",
      nodeId,
      "The learner admitted a missing foundation, so teach the mechanism before testing it.",
      { supportLevel: 4 },
    );
  }

  const activeMisconception = concept.misconceptionIds
    .map((id) => state.misconceptions[id])
    .find((candidate) => candidate?.status === "active");
  if (activeMisconception) {
    return recommendation(
      "contrastive-case",
      nodeId,
      `An active misconception (${activeMisconception.id}) needs a contrastive case before ordinary practice.`,
      { supportLevel: Math.min(concept.supportLevel, 2), transferLevel: 2 },
    );
  }

  const attempts = Object.values(concept.mastery)
    .reduce((total, dimension) => total + dimension.attempts, 0);
  if (concept.supportLevel > 0 && attempts > 0) {
    return recommendation(
      "faded-example",
      nodeId,
      `Prior evidence supports fading the worked example at support level ${concept.supportLevel}.`,
      { supportLevel: concept.supportLevel },
    );
  }

  if (
    nodeId === session.plan.targetNodeId &&
    concept.mastery.application.level >= 3 &&
    concept.highestTransferLevel >= 3
  ) {
    return recommendation(
      "whole-system-synthesis",
      nodeId,
      "The target concept has advanced transfer evidence, so test whole-system integration.",
      { supportLevel: 0, transferLevel: 4 },
    );
  }

  const prerequisiteIds = session.plan.edges
    .filter((edge) => edge.to === nodeId)
    .map((edge) => edge.from);
  const prerequisitesReady = prerequisiteIds.every((id) =>
    hasDurableEvidence(conceptForNode(state, session, id)),
  );
  const neverAttempted = attempts === 0;
  if (neverAttempted && prerequisitesReady) {
    return recommendation(
      "productive-failure",
      nodeId,
      "Every prerequisite has durable evidence, so one bounded independent attempt can expose the learner's current model.",
      { supportLevel: 0, transferLevel: 0, productiveFailureAllowed: true },
    );
  }
  if (neverAttempted) {
    return recommendation(
      "worked-example",
      nodeId,
      "A prerequisite lacks durable evidence, so scaffold the mechanism before an independent attempt.",
      { supportLevel: 4 },
    );
  }

  const applicationAttempts = concept.mastery.application.attempts;
  const transferLevel = applicationAttempts === 0
    ? 0
    : Math.min(4, concept.highestTransferLevel + 1);
  return recommendation(
    "transfer-case",
    nodeId,
    `Independent practice should advance to transfer level ${transferLevel}.`,
    { supportLevel: 0, transferLevel },
  );
}
