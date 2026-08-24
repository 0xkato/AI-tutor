import { randomUUID } from "node:crypto";

import { LearningError, requireText } from "./errors.mjs";
import { advanceReview } from "./retention.mjs";

const DURABLE_KINDS = new Set(["transfer", "reconstruction", "debugging", "synthesis", "retention"]);

function at(now) {
  return now ?? new Date().toISOString();
}

function appendUnique(items, value) {
  if (!items.includes(value)) items.push(value);
}

export function registerTopic(state, { id, name, sessionId, now } = {}) {
  const topicName = requireText(name, "topic");
  const topicId = id ?? randomUUID();
  const createdAt = at(now);
  const existing = state.topics[topicId];
  if (existing) {
    if (existing.name !== topicName) {
      throw new LearningError(
        `Topic ${topicId} is named ${existing.name}, not ${topicName}`,
        "TOPIC_MISMATCH",
      );
    }
    appendUnique(existing.sessionIds, sessionId);
    existing.latestSessionId = sessionId;
    existing.updatedAt = createdAt;
    return existing;
  }
  const topic = {
    id: topicId,
    name: topicName,
    createdAt,
    updatedAt: createdAt,
    latestSessionId: sessionId,
    sessionIds: [sessionId],
    conceptIds: [],
  };
  state.topics[topicId] = topic;
  return topic;
}

export function bindConceptToSession(state, session, conceptId) {
  const concept = state.concepts[conceptId];
  if (!concept) {
    throw new LearningError(`Unknown concept: ${conceptId}`, "UNKNOWN_CONCEPT");
  }
  if (concept.topicId !== session.topicId) {
    throw new LearningError(
      `Concept ${conceptId} belongs to a different topic`,
      "CONCEPT_TOPIC_MISMATCH",
    );
  }
  const sameKey = session.conceptIds.find(
    (candidateId) => state.concepts[candidateId]?.key === concept.key && candidateId !== conceptId,
  );
  if (sameKey) {
    throw new LearningError(
      `Session already has a different concept for key: ${concept.key}`,
      "CONCEPT_KEY_CONFLICT",
    );
  }
  appendUnique(session.conceptIds, conceptId);
  appendUnique(concept.sourceSessionIds, session.id);
  return concept;
}

export function conceptForNode(state, session, nodeId, { required = true } = {}) {
  const key = requireText(nodeId, "nodeId");
  const matches = session.conceptIds
    .map((id) => state.concepts[id])
    .filter((concept) => concept?.key === key);
  if (matches.length > 1) {
    throw new LearningError(`Multiple concepts are bound to node: ${key}`, "CONCEPT_KEY_CONFLICT");
  }
  if (matches.length === 0 && required) {
    throw new LearningError(`No concept is bound to node: ${key}`, "CONCEPT_NOT_DECLARED");
  }
  return matches[0] ?? null;
}

export function createConceptForSession(state, session, { id, nodeId, title, now } = {}) {
  const key = requireText(nodeId, "nodeId");
  const existing = conceptForNode(state, session, key, { required: false });
  if (existing) return existing;
  const conceptId = id ?? randomUUID();
  if (state.concepts[conceptId]) {
    throw new LearningError(`Concept already exists: ${conceptId}`, "DUPLICATE_CONCEPT");
  }
  const topic = state.topics[session.topicId];
  if (!topic) throw new LearningError("Session topic does not exist", "UNKNOWN_TOPIC");
  const createdAt = at(now);
  const reviewId = randomUUID();
  const concept = {
    id: conceptId,
    topicId: topic.id,
    key,
    title: requireText(title ?? key, "concept title"),
    status: "unknown",
    latestGrade: null,
    evidenceIds: [],
    retry: null,
    reviewId,
    sourceSessionIds: [session.id],
    createdAt,
    updatedAt: createdAt,
  };
  state.concepts[conceptId] = concept;
  state.reviews[reviewId] = {
    id: reviewId,
    conceptId,
    level: 0,
    dueAt: null,
    completed: 0,
    status: "inactive",
    updatedAt: createdAt,
  };
  session.conceptIds.push(conceptId);
  topic.conceptIds.push(conceptId);
  topic.updatedAt = createdAt;
  return concept;
}

export function bindPlanConcepts(state, session, plan, { now } = {}) {
  const nextPlan = structuredClone(plan);
  nextPlan.nodes = nextPlan.nodes.map((node) => {
    let concept;
    if (node.conceptId) {
      concept = bindConceptToSession(state, session, node.conceptId);
      if (concept.key !== node.id) {
        throw new LearningError(
          `Concept ${concept.id} uses key ${concept.key}, not plan node ${node.id}`,
          "CONCEPT_KEY_CONFLICT",
        );
      }
    } else {
      concept =
        conceptForNode(state, session, node.id, { required: false }) ??
        createConceptForSession(state, session, {
          nodeId: node.id,
          title: node.title,
          now,
        });
    }
    return { ...node, conceptId: concept.id };
  });
  return nextPlan;
}

export function knowledgeForSession(state, session) {
  return Object.fromEntries(
    session.conceptIds.map((conceptId) => {
      const concept = state.concepts[conceptId];
      const review = state.reviews[concept.reviewId];
      return [
        concept.key,
        {
          nodeId: concept.key,
          status: concept.status,
          evidence: [...concept.evidenceIds],
          latestGrade: concept.latestGrade,
          retry: structuredClone(concept.retry),
          review: review
            ? { level: review.level, dueAt: review.dueAt, completed: review.completed }
            : { level: 0, dueAt: null, completed: 0 },
        },
      ];
    }),
  );
}

export function recordConceptAssessment(state, session, concept, assessment, retry) {
  appendUnique(concept.evidenceIds, assessment.id);
  appendUnique(concept.sourceSessionIds, session.id);
  concept.latestGrade = assessment.grade;
  concept.retry = retry;
  concept.updatedAt = assessment.createdAt;

  if (assessment.grade === "correct") {
    concept.status = assessment.kind === "multiple-choice" ? "fragile" : "developing";
  } else if (assessment.grade === "partial") {
    concept.status = "fragile";
  } else {
    concept.status = "gap";
  }

  if (DURABLE_KINDS.has(assessment.kind)) {
    const review = state.reviews[concept.reviewId];
    const advanced = advanceReview(review, {
      grade: assessment.grade,
      kind: assessment.kind,
      now: assessment.createdAt,
    });
    Object.assign(review, advanced, {
      status: advanced.dueAt ? "scheduled" : "inactive",
      updatedAt: assessment.createdAt,
    });
    if (review.level >= 4 && assessment.grade === "correct") concept.status = "strong";
  }
  return concept;
}
