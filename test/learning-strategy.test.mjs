import assert from "node:assert/strict";
import test from "node:test";

import {
  applyAssessmentToMastery,
  createMasteryProfile,
  upsertMisconception,
  resolveMisconceptions,
} from "../src/learning-strategy.mjs";

const NOW = "2026-08-29T09:00:00.000Z";

function concept() {
  return {
    id: "concept-attention",
    mastery: createMasteryProfile(),
    highestTransferLevel: 0,
    supportLevel: 4,
    misconceptionIds: [],
  };
}

function assessment(overrides = {}) {
  return {
    id: "evidence-1",
    kind: "explanation",
    grade: "correct",
    contaminated: false,
    confidence: 70,
    transferLevel: null,
    supportLevel: 3,
    createdAt: NOW,
    ...overrides,
  };
}

test("an assessment updates only its matching mastery dimension", () => {
  const item = concept();
  applyAssessmentToMastery(item, assessment());

  assert.equal(item.mastery.explanation.level, 2);
  assert.equal(item.mastery.explanation.attempts, 1);
  assert.equal(item.mastery.explanation.correct, 1);
  assert.deepEqual(item.mastery.explanation.evidenceIds, ["evidence-1"]);
  for (const dimension of ["recall", "prediction", "application", "discrimination", "debugging", "integration", "retention"]) {
    assert.equal(item.mastery[dimension].attempts, 0, dimension);
  }
});

test("multiple choice remains weak recognition evidence while transfer advances the ladder", () => {
  const item = concept();
  applyAssessmentToMastery(item, assessment({ id: "recognition", kind: "multiple-choice" }));
  applyAssessmentToMastery(item, assessment({ id: "transfer", kind: "transfer", transferLevel: 3 }));

  assert.equal(item.mastery.recall.level, 1);
  assert.equal(item.mastery.application.level, 3);
  assert.equal(item.highestTransferLevel, 3);
});

test("contaminated evidence changes neither mastery nor support", () => {
  const item = concept();
  applyAssessmentToMastery(item, assessment({ contaminated: true }));
  assert.deepEqual(item.mastery, createMasteryProfile());
  assert.equal(item.supportLevel, 4);
});

test("misconceptions persist, resolve on clean transfer, and count later relapse", () => {
  const state = { misconceptions: {} };
  const item = concept();
  const first = assessment({ id: "miss-1", grade: "incorrect", confidence: 90 });
  const misconception = upsertMisconception(state, item, first, {
    id: "misconception-values",
    statement: "Values choose attention weights instead of carrying the mixed information.",
    counterexample: "Changing only values changes the output but not the attention weights.",
    repair: "Contrast the scoring path with the information path.",
  });

  assert.equal(misconception.status, "active");
  assert.equal(misconception.confidence, 90);
  assert.equal(misconception.occurrences, 1);
  assert.deepEqual(item.misconceptionIds, [misconception.id]);

  resolveMisconceptions(
    state,
    item,
    assessment({ id: "repair-1", kind: "transfer", transferLevel: 2 }),
    [misconception.id],
  );
  assert.equal(misconception.status, "resolved");
  assert.equal(misconception.resolvedAt, NOW);

  upsertMisconception(
    state,
    item,
    assessment({ id: "miss-2", grade: "incorrect", confidence: 80 }),
    { id: misconception.id, statement: misconception.statement },
  );
  assert.equal(misconception.status, "active");
  assert.equal(misconception.relapses, 1);
  assert.equal(misconception.occurrences, 2);
});
