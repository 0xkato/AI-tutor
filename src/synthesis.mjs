import { randomUUID } from "node:crypto";

import { LearningError, requireText } from "./errors.mjs";
import { safeIdentifier, safeText } from "./inputs.mjs";
import { updateActiveSession } from "./model.mjs";
import { parseInstant } from "./schema.mjs";

const GRADES = new Set(["correct", "partial", "incorrect"]);
const SYNTHESIS_NODE_ID = "whole-system-synthesis";

function instant(now) {
  return parseInstant(now ?? new Date().toISOString(), "synthesis time");
}

function unresolvedConceptRetry(state, session) {
  return session.conceptIds
    .map((conceptId) => state.concepts[conceptId])
    .find((concept) => concept?.retry);
}

function requireReadySession(session, state) {
  if (session.kind === "review") {
    if (session.phase !== "review") {
      throw new LearningError(
        "Whole-system synthesis requires an active review session",
        "INVALID_PHASE",
      );
    }
    if (!session.synthesisRequired) {
      throw new LearningError(
        "This review session does not require whole-system synthesis",
        "SYNTHESIS_NOT_REQUIRED",
      );
    }
    const unresolved = session.reviewItems.filter(
      (item) => !["resolved", "deferred"].includes(item.status),
    );
    if (unresolved.length > 0) {
      throw new LearningError(
        "All review items must be resolved or deferred before synthesis",
        "REVIEW_ITEMS_UNRESOLVED",
      );
    }
    return;
  }
  if (session.kind !== "learn" || session.phase !== "teach") {
    throw new LearningError(
      "Whole-system synthesis requires an active learning session in the teaching phase",
      "INVALID_PHASE",
    );
  }
  if (session.activeStepId) {
    throw new LearningError(
      "The current teaching checkpoint must be resolved before synthesis",
      "STEP_UNRESOLVED",
    );
  }
  const pending = unresolvedConceptRetry(state, session);
  if (pending) {
    throw new LearningError(
      `A required checkpoint for ${pending.key} must be resolved before synthesis`,
      "RETRY_REQUIRED",
    );
  }
  if (session.frontier.length > 0) {
    throw new LearningError(
      "The dependency plan must be complete before whole-system synthesis",
      "PLAN_INCOMPLETE",
    );
  }
}

export function startSynthesis(state, { questionId, question, now } = {}) {
  const openedAt = instant(now);
  const stableQuestionId = safeIdentifier(questionId, "synthesis question ID");
  const questionText = safeText(question, "synthesis question");
  return updateActiveSession(
    state,
    (session, next) => {
      requireReadySession(session, next);
      const current = session.synthesisCheckpoint;
      if (current && current.status !== "new-transfer-required") {
        const code = current.status === "resolved"
          ? "SYNTHESIS_ALREADY_RESOLVED"
          : "SYNTHESIS_CHECKPOINT_ACTIVE";
        throw new LearningError("A whole-system synthesis checkpoint is already active", code);
      }
      if (current?.status === "new-transfer-required" && stableQuestionId === current.questionId) {
        throw new LearningError(
          `A new synthesis transfer question is required after ${current.questionId}`,
          "SYNTHESIS_NEW_TRANSFER_REQUIRED",
        );
      }
      session.synthesisRequired = true;
      session.synthesisCheckpoint = {
        status: "awaiting-answer",
        questionId: stableQuestionId,
        question: questionText,
        priorQuestionId: current?.questionId ?? null,
        attempts: current?.attempts ?? 0,
        resolvedEvidenceId: null,
        mistakeType: current?.mistakeType ?? "",
      };
    },
    { now: openedAt },
  );
}

function validateAssessment(input) {
  if (!GRADES.has(input.grade)) {
    throw new LearningError(
      "grade must be correct, partial, or incorrect",
      "INVALID_GRADE",
    );
  }
  const evidence = requireText(input.evidence, "evidence");
  if (evidence.length < 20 || evidence.split(/\s+/).length < 4) {
    throw new LearningError(
      "evidence must identify the exact demonstrated or missing mechanism",
      "WEAK_EVIDENCE",
    );
  }
  return {
    id: safeIdentifier(input.id ?? randomUUID(), "synthesis assessment ID"),
    questionId: safeIdentifier(input.questionId, "synthesis question ID"),
    nodeId: SYNTHESIS_NODE_ID,
    stage: "synthesis",
    kind: "synthesis",
    question: safeText(input.question, "synthesis question"),
    answer: safeText(input.answer, "synthesis answer"),
    grade: input.grade,
    evidence,
    mistakeType: typeof input.mistakeType === "string" ? input.mistakeType.trim() : "",
    contaminated: input.contaminated === true,
    conceptId: null,
    createdAt: instant(input.now),
  };
}

export function recordSynthesisAssessment(state, input) {
  const assessment = validateAssessment(input);
  return updateActiveSession(
    state,
    (session, next) => {
      requireReadySession(session, next);
      if (session.assessments.some((item) => item.id === assessment.id)) {
        throw new LearningError(
          `Assessment already exists: ${assessment.id}`,
          "DUPLICATE_ASSESSMENT",
        );
      }
      const checkpoint = session.synthesisCheckpoint;
      if (!checkpoint) {
        throw new LearningError(
          "Start and persist the synthesis question before recording its answer",
          "SYNTHESIS_NOT_STARTED",
        );
      }
      if (checkpoint.status === "new-transfer-required") {
        throw new LearningError(
          `A new synthesis transfer question is required after ${checkpoint.questionId}`,
          "SYNTHESIS_NEW_TRANSFER_REQUIRED",
        );
      }
      if (checkpoint.status === "resolved") {
        throw new LearningError(
          "The whole-system synthesis checkpoint is already resolved",
          "SYNTHESIS_ALREADY_RESOLVED",
        );
      }
      if (
        assessment.questionId !== checkpoint.questionId ||
        assessment.question !== checkpoint.question
      ) {
        const code = checkpoint.status === "retry-required"
          ? "SYNTHESIS_RETRY_REQUIRED"
          : "SYNTHESIS_IDENTITY_MISMATCH";
        throw new LearningError(
          `Synthesis answer must preserve question ${checkpoint.questionId} exactly`,
          code,
        );
      }

      session.assessments.push(assessment);
      if (assessment.contaminated) return;

      if (assessment.grade === "correct") {
        Object.assign(checkpoint, {
          status: "resolved",
          attempts: Math.max(1, checkpoint.attempts),
          resolvedEvidenceId: assessment.id,
          mistakeType: "",
        });
        return;
      }

      if (checkpoint.status === "retry-required") {
        Object.assign(checkpoint, {
          status: "new-transfer-required",
          priorQuestionId: checkpoint.questionId,
          attempts: checkpoint.attempts + 1,
          resolvedEvidenceId: null,
          mistakeType: assessment.mistakeType,
        });
        return;
      }

      Object.assign(checkpoint, {
        status: "retry-required",
        attempts: 1,
        resolvedEvidenceId: null,
        mistakeType: assessment.mistakeType,
      });
    },
    { now: assessment.createdAt },
  );
}
