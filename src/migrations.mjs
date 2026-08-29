import { createHash } from "node:crypto";

import { LearningError } from "./errors.mjs";
import { legacySupportLevel, seedMasteryFromAssessments } from "./learning-strategy.mjs";
import { validateState } from "./schema.mjs";

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
        claimedBySessionId: null,
        claimedAt: null,
        deferredReason: null,
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
      admittedGaps: [],
      reviewItems: [],
      synthesisRequired: false,
      checkpoint: null,
      plan,
      assessments: session.assessments.map((assessment) => ({
        ...assessment,
        conceptId: conceptByNode.get(assessment.nodeId) ?? null,
      })),
      visuals: session.visuals.map((visual) => ({
        ...visual,
        identityStatus: "legacy-unverified",
        bytes: null,
        mediaType: null,
        sha256: null,
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

  return {
    schemaVersion: 2,
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
  };
}

export function migrateV2ToV3(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LearningError("Version-2 state must be an object", "INVALID_STATE");
  }
  if (value.schemaVersion !== 2) {
    throw new LearningError(`Cannot migrate schema version: ${value.schemaVersion}`, "UNSUPPORTED_SCHEMA");
  }

  const next = structuredClone(value);
  next.schemaVersion = 3;
  next.revision = (next.revision ?? 0) + 1;
  next.render = { revision: next.render?.revision ?? 0, status: "stale", error: null };
  for (const session of Object.values(next.sessions ?? {})) {
    session.questions = [];
    session.notes = [];
  }
  return next;
}

export function migrateV3ToV4(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LearningError("Version-3 state must be an object", "INVALID_STATE");
  }
  if (value.schemaVersion !== 3) {
    throw new LearningError(`Cannot migrate schema version: ${value.schemaVersion}`, "UNSUPPORTED_SCHEMA");
  }

  const next = structuredClone(value);
  next.schemaVersion = 4;
  next.revision = (next.revision ?? 0) + 1;
  next.learnerProfile = {
    teachingPhilosophy: "",
    explanationPreferences: "",
    feedbackPreferences: "",
    visualPreferences: "",
    sourcePreferences: "",
    updatedAt: null,
  };
  next.render = { revision: next.render?.revision ?? 0, status: "stale", error: null };
  return next;
}

export function migrateV4ToV5(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LearningError("Version-4 state must be an object", "INVALID_STATE");
  }
  if (value.schemaVersion !== 4) {
    throw new LearningError(`Cannot migrate schema version: ${value.schemaVersion}`, "UNSUPPORTED_SCHEMA");
  }

  const next = structuredClone(value);
  next.schemaVersion = 5;
  next.revision = (next.revision ?? 0) + 1;
  next.render = { revision: next.render?.revision ?? 0, status: "stale", error: null };
  for (const session of Object.values(next.sessions ?? {})) {
    session.materials = [];
    session.sourceCoverage = [];
    session.sourceGuidance = {
      mode: "open",
      reason: null,
      updatedAt: session.updatedAt,
      history: [],
    };
    for (const source of session.sources ?? []) {
      source.role = "supplemental";
      source.locator = "Whole source";
      source.materialId = null;
    }
  }
  return next;
}

export function migrateV5ToV6(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LearningError("Version-5 state must be an object", "INVALID_STATE");
  }
  if (value.schemaVersion !== 5) {
    throw new LearningError(`Cannot migrate schema version: ${value.schemaVersion}`, "UNSUPPORTED_SCHEMA");
  }

  const next = structuredClone(value);
  next.schemaVersion = 6;
  next.revision = (next.revision ?? 0) + 1;
  next.misconceptions = {};
  next.render = { revision: next.render?.revision ?? 0, status: "stale", error: null };

  const assessments = new Map();
  for (const session of Object.values(next.sessions ?? {})) {
    session.activityHistory = [];
    session.productiveAttempts = [];
    for (const assessment of session.assessments ?? []) {
      assessment.confidence = null;
      assessment.responseTimeMs = null;
      assessment.transferLevel = assessment.kind === "transfer" ? 1 : null;
      assessment.supportLevel = null;
      assessment.activityType = "assessment";
      assessment.misconceptionIds = [];
      assessments.set(assessment.id, assessment);
    }
  }

  for (const concept of Object.values(next.concepts ?? {})) {
    const conceptAssessments = (concept.evidenceIds ?? [])
      .map((id) => assessments.get(id))
      .filter(Boolean);
    const seeded = seedMasteryFromAssessments(conceptAssessments);
    concept.mastery = seeded.mastery;
    concept.highestTransferLevel = seeded.highestTransferLevel;
    concept.supportLevel = legacySupportLevel(concept.status);
    concept.misconceptionIds = [];
  }

  for (const review of Object.values(next.reviews ?? {})) {
    review.stabilityDays = 0;
    review.difficulty = 50;
    review.lapses = 0;
    review.history = [];
  }

  return validateState(next);
}
