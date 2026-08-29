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
