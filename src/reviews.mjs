import { randomUUID } from "node:crypto";

import {
  bindConceptToSession,
  conceptForNode,
  registerTopic,
} from "./concepts.mjs";
import { LearningError, requireText } from "./errors.mjs";
import { safeIdentifier, safeSingleLine, safeText } from "./inputs.mjs";
import { updateActiveSession } from "./model.mjs";
import {
  advanceReview,
  dueReviews,
  synthesisRequiredForSelection,
} from "./retention.mjs";
import { parseInstant } from "./schema.mjs";

const RESOLUTION_KINDS = new Set([
  "transfer",
  "reconstruction",
  "debugging",
  "synthesis",
  "retention",
]);
const REVIEW_CHECKPOINT_KINDS = new Set([
  "retention",
  "transfer",
  "reconstruction",
  "debugging",
]);
const REVIEW_REPAIR_KINDS = new Set(["transfer", "reconstruction", "debugging"]);

function instant(now) {
  return parseInstant(now ?? new Date().toISOString(), "now");
}

function uniqueReviewIds(reviewIds) {
  if (!Array.isArray(reviewIds) || reviewIds.length === 0) {
    throw new LearningError("At least one due review ID is required", "REVIEW_REQUIRED");
  }
  const ids = reviewIds.map((id) => requireText(id, "review ID"));
  if (new Set(ids).size !== ids.length) {
    throw new LearningError("Review IDs must be unique", "DUPLICATE_REVIEW");
  }
  return ids;
}

export function startReviewSession(state, { id, reviewIds, now } = {}) {
  if (state.activeSessionId) {
    throw new LearningError("A session is already active", "SESSION_ACTIVE");
  }
  const selectedIds = uniqueReviewIds(reviewIds);
  const startedAt = instant(now);
  const dueById = new Map(
    dueReviews(state, { now: startedAt }).map((review) => [review.reviewId, review]),
  );
  const selected = selectedIds.map((reviewId) => {
    const due = dueById.get(reviewId);
    if (!due) {
      throw new LearningError(
        `Review is not currently due and available: ${reviewId}`,
        "REVIEW_NOT_DUE",
      );
    }
    return due;
  });
  const topicIds = new Set(selected.map((review) => review.topicId));
  if (topicIds.size !== 1) {
    throw new LearningError(
      "A review session can only claim concepts from one topic",
      "REVIEW_TOPIC_MISMATCH",
    );
  }
  const sessionId = id ?? randomUUID();
  if (state.sessions[sessionId]) {
    throw new LearningError(`Session already exists: ${sessionId}`, "DUPLICATE_SESSION");
  }

  const next = structuredClone(state);
  const topic = next.topics[selected[0].topicId];
  registerTopic(next, {
    id: topic.id,
    name: topic.name,
    sessionId,
    now: startedAt,
  });
  const session = {
    id: sessionId,
    kind: "review",
    topic: topic.name,
    topicId: topic.id,
    target: `Review ${selected.length} due concept${selected.length === 1 ? "" : "s"}`,
    learnerContext: "",
    phase: "review",
    createdAt: startedAt,
    updatedAt: startedAt,
    completedAt: null,
    probeSummary: "",
    admittedGaps: [],
    assessments: [],
    questions: [],
    notes: [],
    conceptIds: [],
    sources: [],
    plan: null,
    frontier: [],
    steps: [],
    activeStepId: null,
    checkpoint: null,
    visuals: [],
    synthesis: "",
    synthesisRequired: synthesisRequiredForSelection(next, selected),
    synthesisCheckpoint: null,
    unresolvedGaps: [],
    reviewItems: selected.map((review) => ({
      reviewId: review.reviewId,
      conceptId: review.conceptId,
      status: "pending",
      outcomeGrade: null,
      evidenceIds: [],
      deferralReason: null,
      deferredUntil: null,
    })),
  };
  next.sessions[sessionId] = session;
  for (const item of session.reviewItems) {
    bindConceptToSession(next, session, item.conceptId);
    const review = next.reviews[item.reviewId];
    Object.assign(review, {
      status: "claimed",
      claimedBySessionId: sessionId,
      claimedAt: startedAt,
      deferredReason: null,
      updatedAt: startedAt,
    });
  }
  next.activeSessionId = sessionId;
  next.updatedAt = startedAt;
  return next;
}

export function reviewItemForConcept(session, conceptId) {
  return session.reviewItems.find((item) => item.conceptId === conceptId) ?? null;
}

export function startReviewCheckpoint(state, input = {}) {
  const nodeId = safeIdentifier(input.nodeId, "nodeId");
  const questionId = safeIdentifier(input.questionId, "checkpoint question ID");
  const kind = safeSingleLine(input.kind, "checkpoint kind", { maxLength: 64 });
  if (!REVIEW_CHECKPOINT_KINDS.has(kind)) {
    throw new LearningError(`Unknown review checkpoint kind: ${kind}`, "INVALID_KIND");
  }
  const question = safeText(input.question, "checkpoint question");
  const openedAt = instant(input.now);

  return updateActiveSession(
    state,
    (session, next) => {
      if (session.kind !== "review" || session.phase !== "review") {
        throw new LearningError(
          "Review checkpoints require an active review session",
          "INVALID_PHASE",
        );
      }
      const concept = conceptForNode(next, session, nodeId);
      const item = reviewItemForConcept(session, concept.id);
      if (!item) {
        throw new LearningError(
          `Concept is not selected for this review: ${concept.id}`,
          "REVIEW_CONCEPT_NOT_SELECTED",
        );
      }
      if (["resolved", "deferred"].includes(item.status)) {
        throw new LearningError(`Review item is already ${item.status}`, "REVIEW_ITEM_CLOSED");
      }

      const current = session.checkpoint;
      const retry = concept.retry;
      const replacingRepair =
        current?.status === "new-transfer-required" &&
        retry?.status === "new-transfer-required" &&
        current.nodeId === nodeId;
      const replacingContaminated =
        ["awaiting-answer", "retry-required"].includes(current?.status) &&
        current.nodeId === nodeId &&
        session.assessments.some(
          (assessment) =>
            assessment.contaminated &&
            assessment.nodeId === current.nodeId &&
            assessment.questionId === current.questionId &&
            assessment.question === current.question &&
            assessment.kind === current.kind,
        );
      const replacingCheckpoint = replacingRepair || replacingContaminated;

      if (current && current.status !== "resolved" && !replacingCheckpoint) {
        throw new LearningError(
          `Review checkpoint ${current.questionId} must be resolved before another checkpoint`,
          "CHECKPOINT_UNRESOLVED",
        );
      }
      if (retry && !replacingRepair && !replacingContaminated) {
        throw new LearningError(
          `A required checkpoint for ${concept.key} must be resolved before another checkpoint`,
          "RETRY_REQUIRED",
        );
      }

      const priorQuestionId = replacingCheckpoint
        ? current.priorQuestionId ?? current.questionId
        : null;
      if (replacingCheckpoint) {
        if (questionId === priorQuestionId) {
          throw new LearningError(
            `A new transfer question is required after ${priorQuestionId}`,
            "NEW_TRANSFER_REQUIRED",
          );
        }
        if (!REVIEW_REPAIR_KINDS.has(kind)) {
          throw new LearningError(
            "Review repair requires a new durable transfer checkpoint",
            "NEW_TRANSFER_REQUIRED",
          );
        }
      }

      if (replacingContaminated && retry) {
        Object.assign(retry, {
          status: "new-transfer-required",
          questionId: current.questionId,
          required: false,
          answerMayBeTaught: true,
          requiresNewTransfer: true,
          priorQuestionId: current.questionId,
        });
      }

      session.checkpoint = {
        status: "awaiting-answer",
        nodeId,
        questionId,
        question,
        kind,
        priorQuestionId,
        attempts: 0,
        resolvedEvidenceId: null,
        mistakeType: "",
      };
    },
    { now: openedAt },
  );
}

export function recordReviewAssessment(state, session, concept, assessment) {
  if (session.kind !== "review" || session.phase !== "review") {
    throw new LearningError("Retention assessments require an active review session", "INVALID_PHASE");
  }
  if (assessment.stage !== "retention") {
    throw new LearningError("Review sessions accept only retention assessments", "INVALID_STAGE");
  }
  const item = reviewItemForConcept(session, concept.id);
  if (!item) {
    throw new LearningError(
      `Concept is not selected for this review: ${concept.id}`,
      "REVIEW_CONCEPT_NOT_SELECTED",
    );
  }
  if (["resolved", "deferred"].includes(item.status)) {
    throw new LearningError(`Review item is already ${item.status}`, "REVIEW_ITEM_CLOSED");
  }
  if (assessment.contaminated) return item;
  if (!item.evidenceIds.includes(assessment.id)) item.evidenceIds.push(assessment.id);
  if (item.outcomeGrade === null) item.outcomeGrade = assessment.grade;
  item.status =
    assessment.grade === "correct" && RESOLUTION_KINDS.has(assessment.kind)
      ? "resolved"
      : "repair-required";
  return item;
}

export function deferReviewItem(state, { reviewId, reason, until, now } = {}) {
  const deferredAt = instant(now);
  const dueAt = parseInstant(until, "deferred until");
  if (new Date(dueAt).getTime() <= new Date(deferredAt).getTime()) {
    throw new LearningError("Deferred review time must be in the future", "INVALID_DEFERRAL");
  }
  const deferralReason = requireText(reason, "deferral reason");
  return updateActiveSession(
    state,
    (session, next) => {
      if (session.kind !== "review" || session.phase !== "review") {
        throw new LearningError("Deferral requires an active review session", "INVALID_PHASE");
      }
      const item = session.reviewItems.find((candidate) => candidate.reviewId === reviewId);
      if (!item) {
        throw new LearningError(`Review is not selected in this session: ${reviewId}`, "UNKNOWN_REVIEW");
      }
      if (["resolved", "deferred"].includes(item.status)) {
        throw new LearningError(`Review item is already ${item.status}`, "REVIEW_ITEM_CLOSED");
      }
      const concept = next.concepts[item.conceptId];
      const checkpointIsActive =
        session.checkpoint &&
        session.checkpoint.nodeId === concept?.key &&
        session.checkpoint.status !== "resolved";
      if (checkpointIsActive || concept?.retry) {
        throw new LearningError(
          "A review item cannot be deferred while its checkpoint or retry is active",
          "CHECKPOINT_UNRESOLVED",
        );
      }
      item.status = "deferred";
      item.deferralReason = deferralReason;
      item.deferredUntil = dueAt;
    },
    { now: deferredAt },
  );
}

export function closeReviewSession(state, { synthesis, now } = {}) {
  const closedAt = instant(now);
  return updateActiveSession(
    state,
    (session, next) => {
      if (session.kind !== "review" || session.phase !== "review") {
        throw new LearningError("No active review session can be closed", "INVALID_PHASE");
      }
      const unresolved = session.reviewItems.filter(
        (item) => !["resolved", "deferred"].includes(item.status),
      );
      if (unresolved.length > 0) {
        throw new LearningError(
          "All review items must be resolved or deferred before closing",
          "REVIEW_ITEMS_UNRESOLVED",
        );
      }

      let conclusion;
      if (session.synthesisRequired) {
        const checkpoint = session.synthesisCheckpoint;
        if (!checkpoint || checkpoint.status !== "resolved" || !checkpoint.resolvedEvidenceId) {
          throw new LearningError(
            "A clean correct whole-system synthesis assessment is required before closing",
            "SYNTHESIS_UNRESOLVED",
          );
        }
        const synthesisAssessment = session.assessments.find(
          (assessment) => assessment.id === checkpoint.resolvedEvidenceId,
        );
        if (
          !synthesisAssessment ||
          synthesisAssessment.stage !== "synthesis" ||
          synthesisAssessment.kind !== "synthesis" ||
          synthesisAssessment.grade !== "correct" ||
          synthesisAssessment.contaminated
        ) {
          throw new LearningError(
            "The resolved whole-system synthesis evidence is invalid",
            "INVALID_SYNTHESIS_EVIDENCE",
          );
        }
        conclusion = synthesisAssessment.answer;
      } else {
        conclusion = requireText(synthesis, "review synthesis");
      }

      let completed = 0;
      for (const item of session.reviewItems) {
        const review = next.reviews[item.reviewId];
        if (review.status !== "claimed" || review.claimedBySessionId !== session.id) {
          throw new LearningError(
            `Review claim is not owned by this session: ${item.reviewId}`,
            "REVIEW_CLAIM_LOST",
          );
        }
        if (item.status === "resolved") {
          const advanced = advanceReview(review, {
            grade: item.outcomeGrade,
            kind: "retention",
            now: closedAt,
          });
          Object.assign(review, advanced, {
            status: advanced.dueAt ? "scheduled" : "inactive",
            claimedBySessionId: null,
            claimedAt: null,
            deferredReason: null,
            updatedAt: closedAt,
          });
          completed += 1;
        } else {
          Object.assign(review, {
            dueAt: item.deferredUntil,
            status: "deferred",
            claimedBySessionId: null,
            claimedAt: null,
            deferredReason: item.deferralReason,
            updatedAt: closedAt,
          });
        }
      }

      next.reviewCount += completed;
      session.synthesis = conclusion;
      session.unresolvedGaps = session.reviewItems
        .filter((item) => item.status === "deferred")
        .map((item) => item.deferralReason);
      session.completedAt = closedAt;
      session.phase = "complete";
      const topic = next.topics[session.topicId];
      if (!topic) throw new LearningError("Session topic does not exist", "UNKNOWN_TOPIC");
      topic.latestSessionId = session.id;
      topic.updatedAt = closedAt;
      next.activeSessionId = null;
    },
    { now: closedAt },
  );
}
