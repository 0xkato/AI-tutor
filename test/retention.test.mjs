import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceReview,
  dueReviews,
  shouldSynthesize,
} from "../src/retention.mjs";
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
    };
  }
  assert.deepEqual(
    dueReviews(state, { now }).map((item) => item.nodeId),
    ["first", "later"],
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
