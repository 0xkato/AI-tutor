import { createHash } from "node:crypto";

import { LearningError } from "./errors.mjs";
import { SCHEMA_VERSION, validateState } from "./schema.mjs";

function stableId(prefix, ...parts) {
  const digest = createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 20);
  return `${prefix}-${digest}`;
}

export function topicIdForV1(topic) {
  return stableId("topic", topic);
}

export function conceptIdForV1(sessionId, nodeId) {
  return stableId("concept", sessionId, nodeId);
}

function reviewIdForConcept(conceptId) {
  return stableId("review", conceptId);
}

function nodeTitle(session, nodeId) {
  return session.plan?.nodes?.find((node) => node.id === nodeId)?.title ?? nodeId;
}

export function migrateV1ToV2(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LearningError("Version-1 state must be an object", "INVALID_STATE");
  }
  if (value.schemaVersion !== 1) {
    throw new LearningError(`Cannot migrate schema version: ${value.schemaVersion}`, "UNSUPPORTED_SCHEMA");
  }

  const original = structuredClone(value);
  const sessions = {};
  const topics = {};
  const concepts = {};
  const reviews = {};

  for (const session of Object.values(original.sessions ?? {})) {
    const { knowledge: legacyKnowledge = {}, ...sessionWithoutKnowledge } = session;
    const topicId = topicIdForV1(session.topic);
    const conceptIds = [];
    const topic = topics[topicId] ?? {
      id: topicId,
      name: session.topic,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      latestSessionId: null,
      sessionIds: [],
      conceptIds: [],
    };
    topic.sessionIds.push(session.id);
    if (session.updatedAt >= topic.updatedAt) {
      topic.updatedAt = session.updatedAt;
      topic.latestSessionId = session.id;
    }

    const nodeIds = [
      ...new Set([
        ...Object.keys(legacyKnowledge),
        ...(session.plan?.nodes ?? []).map((node) => node.id),
      ]),
    ];
    for (const nodeId of nodeIds) {
      const knowledge = legacyKnowledge[nodeId] ?? {
        status: "unknown",
        latestGrade: null,
        evidence: [],
        retry: null,
        review: { level: 0, dueAt: null, completed: 0 },
      };
      const conceptId = conceptIdForV1(session.id, nodeId);
      const reviewId = reviewIdForConcept(conceptId);
      conceptIds.push(conceptId);
      topic.conceptIds.push(conceptId);
      concepts[conceptId] = {
        id: conceptId,
        topicId,
        key: nodeId,
        title: nodeTitle(session, nodeId),
        status: knowledge.status,
        latestGrade: knowledge.latestGrade,
        evidenceIds: [...knowledge.evidence],
        retry: structuredClone(knowledge.retry),
        reviewId,
        sourceSessionIds: [session.id],
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      };
      reviews[reviewId] = {
        id: reviewId,
        conceptId,
        level: knowledge.review.level,
        dueAt: knowledge.review.dueAt,
        completed: knowledge.review.completed,
        status: knowledge.review.dueAt ? "scheduled" : "inactive",
        updatedAt: session.updatedAt,
      };
    }
    topics[topicId] = topic;
    const conceptByNode = new Map(
      conceptIds.map((conceptId) => [concepts[conceptId].key, conceptId]),
    );
    const plan = session.plan
      ? {
          ...session.plan,
          nodes: session.plan.nodes.map((node) => ({
            ...node,
            conceptId: conceptByNode.get(node.id) ?? null,
          })),
        }
      : null;
    sessions[session.id] = {
      ...sessionWithoutKnowledge,
      kind: "learn",
      topicId,
      conceptIds,
      plan,
      assessments: session.assessments.map((assessment) => ({
        ...assessment,
        conceptId: conceptByNode.get(assessment.nodeId) ?? null,
      })),
    };
  }

  for (const legacyTopic of Object.values(original.topics ?? {})) {
    const topicId = topicIdForV1(legacyTopic.topic);
    if (!topics[topicId]) {
      topics[topicId] = {
        id: topicId,
        name: legacyTopic.topic,
        createdAt: original.createdAt,
        updatedAt: legacyTopic.updatedAt,
        latestSessionId: legacyTopic.latestSessionId ?? null,
        sessionIds: legacyTopic.latestSessionId ? [legacyTopic.latestSessionId] : [],
        conceptIds: [],
      };
    }
  }

  return validateState({
    schemaVersion: SCHEMA_VERSION,
    revision: 1,
    createdAt: original.createdAt,
    updatedAt: original.updatedAt,
    activeSessionId: original.activeSessionId ?? null,
    settings: structuredClone(original.settings ?? { vaultDir: "vault" }),
    sessions,
    topics,
    concepts,
    reviews,
    reviewCount: original.reviewCount ?? 0,
    render: { revision: 0, status: "stale", error: null },
  });
}
