import assert from "node:assert/strict";
import test from "node:test";

import {
  applyAssessmentToMastery,
  createMasteryProfile,
  recommendNextActivity,
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

function strategyFixture({ targetStatus = "unknown", prerequisiteLevel = 2 } = {}) {
  const prerequisite = {
    ...concept(),
    id: "concept-prerequisite",
    key: "token-representations",
    status: "developing",
    supportLevel: 0,
  };
  prerequisite.mastery.explanation.level = prerequisiteLevel;
  prerequisite.mastery.explanation.attempts = prerequisiteLevel > 0 ? 1 : 0;
  const target = {
    ...concept(),
    id: "concept-target",
    key: "self-attention",
    status: targetStatus,
  };
  return {
    state: {
      concepts: {
        [prerequisite.id]: prerequisite,
        [target.id]: target,
      },
      misconceptions: {},
    },
    session: {
      plan: {
        targetNodeId: "self-attention",
        nodes: [
          { id: "token-representations", title: "Token representations" },
          { id: "self-attention", title: "Self-attention" },
        ],
        edges: [{ from: "token-representations", to: "self-attention", reason: "Attention mixes token representations" }],
      },
      conceptIds: [prerequisite.id, target.id],
      admittedGaps: [],
      checkpointGaps: [],
    },
    prerequisite,
    target,
  };
}

test("an admitted gap always selects teaching before testing", () => {
  const fixture = strategyFixture({ targetStatus: "gap" });
  fixture.session.admittedGaps.push({ nodeId: "self-attention" });

  assert.deepEqual(recommendNextActivity(fixture.state, fixture.session, "self-attention"), {
    type: "worked-example",
    nodeId: "self-attention",
    supportLevel: 4,
    transferLevel: null,
    reason: "The learner admitted a missing foundation, so teach the mechanism before testing it.",
    productiveFailureAllowed: false,
  });
});

test("an active misconception selects a contrastive repair", () => {
  const fixture = strategyFixture({ targetStatus: "fragile" });
  fixture.state.misconceptions["misconception-qkv"] = {
    id: "misconception-qkv",
    conceptId: fixture.target.id,
    status: "active",
  };
  fixture.target.misconceptionIds.push("misconception-qkv");

  const next = recommendNextActivity(fixture.state, fixture.session, "self-attention");
  assert.equal(next.type, "contrastive-case");
  assert.equal(next.transferLevel, 2);
  assert.equal(next.productiveFailureAllowed, false);
  assert.match(next.reason, /active misconception/i);
});

test("worked examples fade one support level at a time before independent transfer", () => {
  const fixture = strategyFixture({ targetStatus: "fragile" });
  fixture.target.supportLevel = 3;
  fixture.target.mastery.explanation.attempts = 1;

  let next = recommendNextActivity(fixture.state, fixture.session, "self-attention");
  assert.equal(next.type, "faded-example");
  assert.equal(next.supportLevel, 3);
  assert.equal(next.transferLevel, null);

  fixture.target.supportLevel = 0;
  fixture.target.mastery.application.attempts = 0;
  next = recommendNextActivity(fixture.state, fixture.session, "self-attention");
  assert.equal(next.type, "transfer-case");
  assert.equal(next.transferLevel, 0);
  fixture.target.mastery.application.attempts = 1;
  fixture.target.highestTransferLevel = 0;
  assert.equal(recommendNextActivity(fixture.state, fixture.session, "self-attention").transferLevel, 1);
  fixture.target.highestTransferLevel = 3;
  assert.equal(recommendNextActivity(fixture.state, fixture.session, "self-attention").transferLevel, 4);
});

test("whole-system integration follows advanced transfer on the target concept", () => {
  const fixture = strategyFixture({ targetStatus: "developing" });
  fixture.target.supportLevel = 0;
  fixture.target.highestTransferLevel = 3;
  fixture.target.mastery.application.level = 3;
  fixture.target.mastery.application.attempts = 4;

  const next = recommendNextActivity(fixture.state, fixture.session, "self-attention");
  assert.equal(next.type, "whole-system-synthesis");
  assert.equal(next.transferLevel, 4);
  assert.match(next.reason, /target concept/i);
});

test("productive failure requires durable prerequisite evidence", () => {
  let fixture = strategyFixture({ prerequisiteLevel: 2 });
  let next = recommendNextActivity(fixture.state, fixture.session, "self-attention");
  assert.equal(next.type, "productive-failure");
  assert.equal(next.productiveFailureAllowed, true);

  fixture = strategyFixture({ prerequisiteLevel: 1 });
  next = recommendNextActivity(fixture.state, fixture.session, "self-attention");
  assert.equal(next.type, "worked-example");
  assert.equal(next.productiveFailureAllowed, false);
  assert.match(next.reason, /prerequisite/i);
});
