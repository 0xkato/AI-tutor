import { randomUUID } from "node:crypto";

import {
  conceptForNode,
  createConceptForSession,
  knowledgeForSession,
  recordConceptAssessment,
} from "./concepts.mjs";
import { LearningError, requireText } from "./errors.mjs";
import { nextFrontier } from "./graph.mjs";
import { updateActiveSession } from "./model.mjs";
import { recordReviewAssessment } from "./reviews.mjs";

const GRADES = new Set(["correct", "partial", "incorrect"]);
const STAGES = new Set(["probe", "teach", "retention"]);
const KINDS = new Set([
  "multiple-choice",
  "explanation",
  "prediction",
  "transfer",
  "reconstruction",
  "debugging",
  "synthesis",
  "retention",
]);
const DURABLE_KINDS = new Set([
  "transfer",
  "reconstruction",
  "debugging",
  "synthesis",
  "retention",
]);

function validate(input) {
  if (!GRADES.has(input.grade)) {
    throw new LearningError(
      "grade must be correct, partial, or incorrect",
      "INVALID_GRADE",
    );
  }
  if (input.kind === "clarification") {
    throw new LearningError(
      "Clarifications do not count as assessments",
      "CLARIFICATION_NOT_ASSESSMENT",
    );
  }
  if (!KINDS.has(input.kind)) {
    throw new LearningError(`Unknown assessment kind: ${input.kind}`, "INVALID_KIND");
  }
  const evidence = requireText(input.evidence, "evidence");
  if (evidence.length < 20 || evidence.split(/\s+/).length < 4) {
    throw new LearningError(
      "evidence must identify the exact demonstrated or missing mechanism",
      "WEAK_EVIDENCE",
    );
  }
  return {
    id: input.id ?? randomUUID(),
    questionId: requireText(input.questionId, "questionId"),
    nodeId: requireText(input.nodeId, "nodeId"),
    stage: requireText(input.stage, "stage"),
    kind: input.kind,
    question: requireText(input.question, "question"),
    answer: requireText(input.answer, "answer"),
    grade: input.grade,
    evidence,
    mistakeType: typeof input.mistakeType === "string" ? input.mistakeType.trim() : "",
    contaminated: input.contaminated === true,
    conceptId: null,
    createdAt: input.now ?? new Date().toISOString(),
  };
}

function retryRequired(assessment, attempts = 1) {
  return {
    status: "retry-required",
    questionId: assessment.questionId,
    attempts,
    required: true,
    answerMayBeTaught: false,
    requiresNewTransfer: false,
    priorQuestionId: null,
    mistakeType: assessment.mistakeType,
  };
}

function newTransferRequired(assessment, { attempts, answerMayBeTaught }) {
  return {
    status: "new-transfer-required",
    questionId: assessment.questionId,
    attempts,
    required: false,
    answerMayBeTaught,
    requiresNewTransfer: true,
    priorQuestionId: assessment.questionId,
    mistakeType: assessment.mistakeType,
  };
}

function unresolvedRetry(state, session) {
  const pending = session.conceptIds
    .map((conceptId) => state.concepts[conceptId])
    .filter((concept) => concept?.retry);
  if (pending.length > 1) {
    throw new LearningError("Multiple unresolved retries make the session ambiguous", "INVALID_STATE");
  }
  return pending[0] ?? null;
}

function validateStageForSession(session, assessment) {
  if (!STAGES.has(assessment.stage)) {
    throw new LearningError(`Unknown assessment stage: ${assessment.stage}`, "INVALID_STAGE");
  }
  if (session.kind === "review") {
    if (session.phase !== "review" || assessment.stage !== "retention") {
      throw new LearningError(
        "Review sessions accept only retention assessments",
        "INVALID_STAGE",
      );
    }
    return;
  }
  if (assessment.stage === "retention") {
    throw new LearningError(
      "Retention assessments require an active review session",
      "INVALID_STAGE",
    );
  }
  if (assessment.stage === "probe" && session.phase !== "probe") {
    throw new LearningError("Probe assessments require the probe phase", "INVALID_PHASE");
  }
  if (assessment.stage === "teach" && session.phase !== "teach") {
    throw new LearningError("Teaching assessments require the teaching phase", "INVALID_PHASE");
  }
}

function validateRetryIdentity(session, concept, assessment) {
  if (concept?.retry?.status !== "retry-required") return;

  const original = session.assessments.find(
    (item) =>
      !item.contaminated &&
      item.nodeId === assessment.nodeId &&
      item.questionId === concept.retry.questionId,
  );
  if (!original) {
    throw new LearningError(
      `Retry ${concept.retry.questionId} has no persisted original assessment`,
      "INVALID_STATE",
    );
  }
  if (assessment.question !== original.question || assessment.kind !== original.kind) {
    throw new LearningError(
      `Retry ${concept.retry.questionId} must preserve its original question and kind`,
      "RETRY_IDENTITY_MISMATCH",
    );
  }
}

function validateCheckpointIdentity(session, assessment) {
  if (session.kind !== "review") return;
  const checkpoint = session.checkpoint;
  if (!checkpoint) {
    throw new LearningError(
      "Retention assessment has no persisted review checkpoint",
      "INVALID_CHECKPOINT",
    );
  }
  if (["resolved", "new-transfer-required"].includes(checkpoint.status)) {
    throw new LearningError(
      `Review checkpoint ${checkpoint.questionId} cannot accept an answer while ${checkpoint.status}`,
      "INVALID_CHECKPOINT",
    );
  }
  if (
    assessment.nodeId !== checkpoint.nodeId ||
    assessment.questionId !== checkpoint.questionId ||
    assessment.question !== checkpoint.question ||
    assessment.kind !== checkpoint.kind
  ) {
    throw new LearningError(
      `Review answer must preserve checkpoint question ${checkpoint.questionId} exactly`,
      "CHECKPOINT_IDENTITY_MISMATCH",
    );
  }
  const questionWasContaminated = session.assessments.some(
    (item) =>
      item.contaminated &&
      item.nodeId === checkpoint.nodeId &&
      item.questionId === checkpoint.questionId &&
      item.question === checkpoint.question &&
      item.kind === checkpoint.kind,
  );
  if (!assessment.contaminated && questionWasContaminated) {
    throw new LearningError(
      `Review checkpoint ${checkpoint.questionId} is contaminated and requires a new checkpoint`,
      "CONTAMINATED_QUESTION",
    );
  }
}

function transitionRetry(current, assessment, { durableRequired = false } = {}) {
  if (!current) {
    if (["partial", "incorrect"].includes(assessment.grade)) {
      return retryRequired(assessment);
    }
    if (durableRequired && !DURABLE_KINDS.has(assessment.kind)) {
      return newTransferRequired(assessment, {
        attempts: 0,
        answerMayBeTaught: false,
      });
    }
    return null;
  }

  const status = current.status ??
    (current.requiresNewTransfer ? "new-transfer-required" : "retry-required");
  if (status === "retry-required") {
    if (assessment.questionId !== current.questionId) {
      throw new LearningError(
        `Retry question ${current.questionId} must be resolved before ${assessment.questionId}`,
        "RETRY_REQUIRED",
      );
    }
    if (assessment.grade === "correct") {
      if (durableRequired && !DURABLE_KINDS.has(assessment.kind)) {
        return newTransferRequired(assessment, {
          attempts: current.attempts,
          answerMayBeTaught: false,
        });
      }
      return null;
    }
    return newTransferRequired(assessment, {
      attempts: current.attempts + 1,
      answerMayBeTaught: true,
    });
  }

  const priorQuestionId = current.priorQuestionId ?? current.questionId;
  if (assessment.questionId === priorQuestionId) {
    throw new LearningError(
      `A new transfer question is required after ${priorQuestionId}`,
      "NEW_TRANSFER_REQUIRED",
    );
  }
  if (!DURABLE_KINDS.has(assessment.kind)) {
    throw new LearningError(
      "The repair must be checked with a new durable transfer question",
      "NEW_TRANSFER_REQUIRED",
    );
  }
  if (assessment.grade === "correct") return null;
  return retryRequired(assessment);
}

function updateTeachingCheckpoint(session, assessment, retry) {
  const checkpoint = session.checkpoint;
  if (!checkpoint || checkpoint.nodeId !== assessment.nodeId) {
    throw new LearningError("Teaching assessment has no matching checkpoint", "INVALID_CHECKPOINT");
  }
  if (retry) {
    Object.assign(checkpoint, {
      status: retry.status,
      questionId: retry.questionId,
      priorQuestionId: retry.priorQuestionId,
      attempts: retry.attempts,
      resolvedEvidenceId: null,
      mistakeType: retry.mistakeType,
    });
    return false;
  }
  Object.assign(checkpoint, {
    status: "resolved",
    questionId: assessment.questionId,
    attempts: Math.max(checkpoint.attempts, 1),
    resolvedEvidenceId: assessment.id,
    mistakeType: "",
  });
  return true;
}

export function recordAssessment(state, input) {
  const assessment = validate(input);
  return updateActiveSession(
    state,
    (session, next) => {
      if (session.assessments.some((item) => item.id === assessment.id)) {
        throw new LearningError(`Assessment already exists: ${assessment.id}`, "DUPLICATE_ASSESSMENT");
      }
      validateStageForSession(session, assessment);
      if (assessment.stage === "teach") {
        if (session.phase !== "teach" || !session.activeStepId) {
          throw new LearningError("Teaching assessments require an active teaching step", "INVALID_PHASE");
        }
        const step = session.steps.find((item) => item.id === session.activeStepId);
        if (step.nodeId !== assessment.nodeId) {
          throw new LearningError("Assessment node must match the active teaching step", "NODE_MISMATCH");
        }
        if (
          step.checkpointQuestionId !== undefined &&
          step.checkpointQuestionId !== null &&
          (
            assessment.questionId !== step.checkpointQuestionId ||
            assessment.question !== step.checkpointQuestion ||
            assessment.kind !== step.checkpointKind
          )
        ) {
          throw new LearningError(
            `Teaching answer must preserve checkpoint question ${step.checkpointQuestionId} exactly`,
            "CHECKPOINT_IDENTITY_MISMATCH",
          );
        }
      }
      const pendingConcept = unresolvedRetry(next, session);
      if (pendingConcept && pendingConcept.key !== assessment.nodeId) {
        throw new LearningError(
          `Retry ${pendingConcept.key} before assessing ${assessment.nodeId}`,
          "RETRY_REQUIRED",
        );
      }

      let concept = conceptForNode(next, session, assessment.nodeId, { required: false });
      if (!concept && !assessment.contaminated && assessment.stage === "probe") {
        concept = createConceptForSession(next, session, {
          nodeId: assessment.nodeId,
          title: assessment.nodeId,
          now: assessment.createdAt,
        });
      }
      if (!concept && !assessment.contaminated) {
        throw new LearningError(
          `Assessment concept is not declared in this session: ${assessment.nodeId}`,
          "CONCEPT_NOT_DECLARED",
        );
      }
      assessment.conceptId = concept?.id ?? null;
      validateCheckpointIdentity(session, assessment);

      if (!assessment.contaminated) {
        validateRetryIdentity(session, concept, assessment);
        const retry = transitionRetry(concept.retry, assessment, {
          durableRequired: assessment.stage !== "probe",
        });
        if (session.kind === "review") {
          recordReviewAssessment(next, session, concept, assessment);
          recordConceptAssessment(next, session, concept, assessment, retry, {
            scheduleReview: false,
          });
          updateTeachingCheckpoint(session, assessment, retry);
        } else {
          recordConceptAssessment(next, session, concept, assessment, retry);
        }

        if (assessment.stage === "teach") {
          const resolved = updateTeachingCheckpoint(session, assessment, retry);
          if (resolved) {
            session.activeStepId = null;
            session.frontier = nextFrontier(session.plan, knowledgeForSession(next, session));
          }
        }
      }

      session.assessments.push(assessment);
    },
    { now: assessment.createdAt },
  );
}
