const INTERVAL_DAYS = [1, 3, 7, 14, 30, 60];

function plusDays(now, days) {
  const date = new Date(now);
  if (Number.isNaN(date.getTime())) throw new TypeError(`Invalid time: ${now}`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export function advanceReview(current = {}, evidence) {
  const initial = {
    level: Number.isInteger(current.level) ? current.level : 0,
    dueAt: current.dueAt ?? null,
    completed: Number.isInteger(current.completed) ? current.completed : 0,
  };
  if (evidence.contaminated === true) return structuredClone(initial);

  const now = evidence.now ?? new Date().toISOString();
  if (evidence.grade === "correct") {
    const level = Math.min(initial.level + 1, INTERVAL_DAYS.length);
    return {
      level,
      dueAt: plusDays(now, INTERVAL_DAYS[level - 1]),
      completed: initial.completed + 1,
    };
  }
  if (evidence.grade === "partial") {
    return {
      level: Math.max(0, initial.level - 1),
      dueAt: plusDays(now, 1),
      completed: initial.completed + 1,
    };
  }
  if (evidence.grade === "incorrect") {
    return { level: 0, dueAt: plusDays(now, 1), completed: initial.completed + 1 };
  }
  throw new TypeError(`Unknown grade: ${evidence.grade}`);
}

export function dueReviews(state, { now } = {}) {
  const cutoff = new Date(now ?? new Date().toISOString()).getTime();
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
