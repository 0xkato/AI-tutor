import { parseInstant } from "./schema.mjs";

const INTERVAL_DAYS = [1, 3, 7, 14, 30, 60];

function plusDays(now, days) {
  const date = new Date(parseInstant(now, "review time"));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export function advanceReview(current = {}, evidence) {
  if (evidence.contaminated === true) return structuredClone(current);
  const initial = {
    level: Number.isInteger(current.level) ? current.level : 0,
    dueAt: current.dueAt ?? null,
    completed: Number.isInteger(current.completed) ? current.completed : 0,
    stabilityDays: Number.isInteger(current.stabilityDays) ? current.stabilityDays : 0,
    difficulty: Number.isInteger(current.difficulty) ? current.difficulty : 50,
    lapses: Number.isInteger(current.lapses) ? current.lapses : 0,
    history: Array.isArray(current.history) ? structuredClone(current.history) : [],
  };

  const now = evidence.now ?? new Date().toISOString();
  const confidence = evidence.confidence ?? null;
  const responseTimeMs = evidence.responseTimeMs ?? null;
  const attemptCount = evidence.attemptCount ?? null;
  const supportLevel = evidence.supportLevel ?? null;
  const evidenceId = evidence.evidenceId ?? evidence.id ?? `legacy-review-${initial.completed + 1}`;
  let level;
  let intervalDays;
  let difficulty = initial.difficulty;
  let lapses = initial.lapses;

  if (evidence.grade === "correct") {
    level = Math.min(initial.level + 1, INTERVAL_DAYS.length);
    const neutralInterval = INTERVAL_DAYS[level - 1];
    let factor = 1;
    if (
      confidence !== null && confidence >= 85 &&
      responseTimeMs !== null && responseTimeMs <= 15_000 &&
      (attemptCount === null || attemptCount === 1) &&
      (supportLevel === null || supportLevel === 0)
    ) {
      factor *= 1.25;
      difficulty -= 5;
    }
    if (responseTimeMs !== null && responseTimeMs >= 90_000) {
      factor *= 0.85;
      difficulty += 3;
    }
    if (attemptCount !== null && attemptCount > 1) {
      factor *= 0.85;
      difficulty += Math.min(9, (attemptCount - 1) * 3);
    }
    if (supportLevel !== null && supportLevel > 0) {
      factor *= 0.95;
      difficulty += supportLevel;
    }
    if (confidence !== null && confidence < 40) {
      factor *= 0.85;
      difficulty += 3;
    }
    intervalDays = Math.max(1, Math.round(neutralInterval * factor));
  } else if (evidence.grade === "partial") {
    level = Math.max(0, initial.level - 1);
    intervalDays = 1;
    lapses += 1;
    difficulty += confidence !== null && confidence >= 80 ? 15 : 5;
  } else if (evidence.grade === "incorrect") {
    level = 0;
    intervalDays = 1;
    lapses += 1;
    difficulty += confidence !== null && confidence >= 80 ? 20 : 10;
  } else {
    throw new TypeError(`Unknown grade: ${evidence.grade}`);
  }

  difficulty = Math.max(0, Math.min(100, difficulty));
  const dueAt = plusDays(now, intervalDays);
  const stabilityDays = evidence.grade === "correct" ? intervalDays : 0;
  const history = [
    ...initial.history,
    {
      evidenceId,
      grade: evidence.grade,
      kind: evidence.kind,
      confidence,
      responseTimeMs,
      attemptCount,
      supportLevel,
      intervalDays,
      stabilityDays,
      difficulty,
      lapses,
      dueAt,
      createdAt: now,
    },
  ];
  return {
    level,
    dueAt,
    completed: initial.completed + 1,
    stabilityDays,
    difficulty,
    lapses,
    history,
  };
}

export function dueReviews(state, { now } = {}) {
  const cutoff = new Date(parseInstant(now ?? new Date().toISOString(), "review cutoff")).getTime();
  const due = [];
  for (const review of Object.values(state.reviews ?? {})) {
    if (!["scheduled", "deferred"].includes(review.status)) continue;
    if (!review.dueAt || new Date(review.dueAt).getTime() > cutoff) continue;
    const concept = state.concepts?.[review.conceptId];
    const topic = state.topics?.[concept?.topicId];
    if (!concept || !topic) continue;
    due.push({
      reviewId: review.id,
      conceptId: concept.id,
      sessionId: concept.sourceSessionIds.at(-1) ?? null,
      topicId: topic.id,
      topic: topic.name,
      nodeId: concept.key,
      status: concept.status,
      dueAt: review.dueAt,
      level: review.level,
    });
  }
  return due.sort(
    (left, right) =>
      new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime() ||
      left.reviewId.localeCompare(right.reviewId),
  );
}

export function synthesisRequiredForSelection(state, selected = []) {
  const selectedCount = selected.length;
  const crossesSeventhReview =
    selectedCount > 0 &&
    Math.floor((state.reviewCount + selectedCount) / 7) > Math.floor(state.reviewCount / 7);
  if (crossesSeventhReview) return true;
  const related = new Map();
  for (const review of selected) {
    const key = review.topicId || review.topic || review.sessionId;
    if (!key) continue;
    related.set(key, (related.get(key) ?? 0) + 1);
  }
  return [...related.values()].some((count) => count >= 3);
}

export function shouldSynthesize(state, due = []) {
  if (state.reviewCount > 0 && state.reviewCount % 7 === 0) return true;
  const related = new Map();
  for (const review of due) {
    const key = review.topicId || review.topic || review.sessionId;
    if (!key) continue;
    related.set(key, (related.get(key) ?? 0) + 1);
  }
  return [...related.values()].some((count) => count >= 3);
}
