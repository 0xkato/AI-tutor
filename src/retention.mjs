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
  for (const session of Object.values(state.sessions ?? {})) {
    for (const [nodeId, knowledge] of Object.entries(session.knowledge ?? {})) {
      const dueAt = knowledge.review?.dueAt;
      if (dueAt && new Date(dueAt).getTime() <= cutoff) {
        due.push({
          sessionId: session.id,
          topic: session.topic,
          nodeId,
          status: knowledge.status,
          dueAt,
          level: knowledge.review.level ?? 0,
        });
      }
    }
  }
  return due.sort(
    (left, right) =>
      new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime() ||
      left.sessionId.localeCompare(right.sessionId) ||
      left.nodeId.localeCompare(right.nodeId),
  );
}

export function shouldSynthesize(state, due = []) {
  if (state.reviewCount > 0 && state.reviewCount % 7 === 0) return true;
  const related = new Map();
  for (const review of due) {
    const key = review.topic || review.sessionId;
    if (!key) continue;
    related.set(key, (related.get(key) ?? 0) + 1);
  }
  return [...related.values()].some((count) => count >= 3);
}
