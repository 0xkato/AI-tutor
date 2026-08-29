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
