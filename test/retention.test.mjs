import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceReview,
  dueReviews,
  shouldSynthesize,
  synthesisRequiredForSelection,
} from "../src/retention.mjs";
import { buildInterleavedPracticeQueue } from "../src/learning-strategy.mjs";
import { createInitialState } from "../src/model.mjs";

const now = "2026-08-24T08:00:00.000Z";

test("correct transfer evidence advances expanding review intervals", () => {
  let review = { level: 0, dueAt: null, completed: 0 };
  review = advanceReview(review, { grade: "correct", kind: "transfer", now });
  assert.equal(review.level, 1);
  assert.equal(review.dueAt, "2026-08-25T08:00:00.000Z");

  review = advanceReview(review, {
    grade: "correct",
    kind: "retention",
    now: "2026-08-25T08:00:00.000Z",
  });
  assert.equal(review.level, 2);
  assert.equal(review.dueAt, "2026-08-28T08:00:00.000Z");
  assert.equal(review.completed, 2);
  assert.equal(review.stabilityDays, 3);
  assert.equal(review.history.length, 2);
});

test("missing performance metrics preserve the exact neutral interval prior", () => {
  const review = advanceReview(
    { level: 2, dueAt: now, completed: 2, stabilityDays: 3, difficulty: 50, lapses: 0, history: [] },
    { id: "neutral-a1", grade: "correct", kind: "retention", now },
  );
  assert.equal(review.dueAt, "2026-08-31T08:00:00.000Z");
  assert.equal(review.stabilityDays, 7);
  assert.equal(review.difficulty, 50);
});

test("a high-confidence lapse increases difficulty and resets stability", () => {
  const review = advanceReview(
    { level: 4, dueAt: now, completed: 4, stabilityDays: 14, difficulty: 45, lapses: 0, history: [] },
    {
      id: "lapse-a1",
      grade: "incorrect",
      kind: "retention",
      confidence: 95,
      responseTimeMs: 8_000,
      attemptCount: 1,
      supportLevel: 0,
      now,
    },
  );
  assert.equal(review.level, 0);
  assert.equal(review.dueAt, "2026-08-25T08:00:00.000Z");
  assert.equal(review.stabilityDays, 0);
  assert.equal(review.difficulty, 65);
  assert.equal(review.lapses, 1);
  assert.equal(review.history[0].confidence, 95);
});

test("fast confident independent retrieval lengthens the next interval", () => {
  const review = advanceReview(
    { level: 2, dueAt: now, completed: 2, stabilityDays: 3, difficulty: 50, lapses: 0, history: [] },
    {
      id: "fast-a1",
      grade: "correct",
      kind: "retention",
      confidence: 90,
      responseTimeMs: 10_000,
      attemptCount: 1,
      supportLevel: 0,
      now,
    },
  );
  assert.equal(review.dueAt, "2026-09-02T08:00:00.000Z");
  assert.equal(review.stabilityDays, 9);
  assert.equal(review.difficulty, 45);
});

test("slow or supported retrieval shortens the next interval", () => {
  const review = advanceReview(
    { level: 2, dueAt: now, completed: 2, stabilityDays: 3, difficulty: 50, lapses: 0, history: [] },
    {
      id: "supported-a1",
      grade: "correct",
      kind: "retention",
      confidence: 60,
      responseTimeMs: 120_000,
      attemptCount: 2,
      supportLevel: 2,
      now,
    },
  );
  assert.equal(review.dueAt, "2026-08-29T08:00:00.000Z");
  assert.equal(review.stabilityDays, 5);
  assert.equal(review.difficulty, 58);
});

test("partial evidence regresses one level and is due next day", () => {
  const review = advanceReview(
    { level: 4, dueAt: "2026-09-01T08:00:00.000Z", completed: 4 },
    { grade: "partial", kind: "retention", now },
  );
  assert.equal(review.level, 3);
  assert.equal(review.dueAt, "2026-08-25T08:00:00.000Z");
});

test("incorrect evidence resets the review level", () => {
  const review = advanceReview(
    { level: 4, dueAt: "2026-09-01T08:00:00.000Z", completed: 4 },
    { grade: "incorrect", kind: "retention", now },
  );
  assert.equal(review.level, 0);
  assert.equal(review.dueAt, "2026-08-25T08:00:00.000Z");
});

test("contaminated evidence does not change a review schedule", () => {
  const initial = { level: 2, dueAt: "2026-08-27T08:00:00.000Z", completed: 2 };
  const review = advanceReview(initial, {
    grade: "correct",
    kind: "transfer",
    contaminated: true,
    now,
  });
  assert.deepEqual(review, initial);
});

test("dueReviews returns due nodes in chronological order", () => {
  const state = createInitialState({ now });
  state.sessions.s1 = { id: "s1" };
  state.topics.t1 = { id: "t1", name: "Topic" };
  for (const [key, dueAt] of [
    ["later", "2026-08-24T07:00:00.000Z"],
    ["first", "2026-08-23T07:00:00.000Z"],
    ["future", "2026-08-25T07:00:00.000Z"],
  ]) {
    state.concepts[`c-${key}`] = {
      id: `c-${key}`,
      topicId: "t1",
      key,
      title: key,
      status: "developing",
      reviewId: `r-${key}`,
      sourceSessionIds: ["s1"],
    };
    state.reviews[`r-${key}`] = {
      id: `r-${key}`,
      conceptId: `c-${key}`,
      level: 1,
      dueAt,
      completed: 1,
      status: "scheduled",
    };
  }
  assert.deepEqual(
    dueReviews(state, { now }).map((item) => item.nodeId),
    ["first", "later"],
  );
});

test("practice queue interleaves topics and prioritizes active misconceptions", () => {
  const due = [
    { reviewId: "r-a1", conceptId: "c-a1", topicId: "a", dueAt: "2026-08-20T08:00:00.000Z" },
    { reviewId: "r-a2", conceptId: "c-a2", topicId: "a", dueAt: "2026-08-21T08:00:00.000Z" },
    { reviewId: "r-b1", conceptId: "c-b1", topicId: "b", dueAt: "2026-08-22T08:00:00.000Z" },
  ];
  const state = {
    concepts: {
      "c-a1": { id: "c-a1", misconceptionIds: [] },
      "c-a2": { id: "c-a2", misconceptionIds: ["m-a2"] },
      "c-b1": { id: "c-b1", misconceptionIds: [] },
    },
    misconceptions: { "m-a2": { id: "m-a2", status: "active" } },
  };

  const queue = buildInterleavedPracticeQueue(state, due);
  assert.deepEqual(queue.map((item) => item.reviewId), ["r-a2", "r-b1", "r-a1"]);
  assert.equal(queue[0].activityType, "contrastive-review");
  assert.equal(queue[1].activityType, "retrieval-review");
  assert.deepEqual(queue.map((item) => item.position), [1, 2, 3]);
});

test("a review selection predicts the seventh-review and related-concept synthesis gates", () => {
  assert.equal(
    synthesisRequiredForSelection({ reviewCount: 6 }, [{ topicId: "calculus" }]),
    true,
  );
  assert.equal(
    synthesisRequiredForSelection(
      { reviewCount: 1 },
      [{ topicId: "calculus" }, { topicId: "calculus" }, { topicId: "calculus" }],
    ),
    true,
  );
  assert.equal(
    synthesisRequiredForSelection(
      { reviewCount: 1 },
      [{ topicId: "calculus" }, { topicId: "algebra" }, { topicId: "probability" }],
    ),
    false,
  );
});

test("synthesis is due after seven reviews or three related simultaneous nodes", () => {
  assert.equal(shouldSynthesize({ reviewCount: 7 }, []), true);
  assert.equal(
    shouldSynthesize(
      { reviewCount: 2 },
      ["one", "two", "three"].map((nodeId) => ({ sessionId: "s1", topic: "Calculus", nodeId })),
    ),
    true,
  );
  assert.equal(
    shouldSynthesize({ reviewCount: 2 }, [
      { sessionId: "s1", topic: "Calculus", nodeId: "one" },
      { sessionId: "s2", topic: "Linear algebra", nodeId: "two" },
      { sessionId: "s3", topic: "Probability", nodeId: "three" },
    ]),
    false,
  );
  assert.equal(
    shouldSynthesize(
      { reviewCount: 2 },
      ["one", "two"].map((nodeId) => ({ sessionId: "s1", topic: "Calculus", nodeId })),
    ),
    false,
  );
});
