import { randomUUID } from "node:crypto";

import { LearningError, requireText } from "./errors.mjs";
import { nextFrontier } from "./graph.mjs";
import { updateActiveSession } from "./model.mjs";
import { advanceReview } from "./retention.mjs";

const GRADES = new Set(["correct", "partial", "incorrect"]);
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
const DURABLE_KINDS = new Set(["transfer", "reconstruction", "debugging", "synthesis", "retention"]);

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
    createdAt: input.now ?? new Date().toISOString(),
  };
}

function retryFor(session, assessment) {
  const previousMisses = session.assessments.filter(
    (item) =>
      !item.contaminated &&
      item.questionId === assessment.questionId &&
      item.grade === "incorrect",
  ).length;
  const attempts = previousMisses + 1;
  if (attempts === 1) {
    return {
      questionId: assessment.questionId,
      attempts,
      required: true,
      answerMayBeTaught: false,
      requiresNewTransfer: false,
      mistakeType: assessment.mistakeType,
    };
  }
  return {
    questionId: assessment.questionId,
    attempts,
    required: false,
    answerMayBeTaught: true,
    requiresNewTransfer: true,
    mistakeType: assessment.mistakeType,
  };
}

export function recordAssessment(state, input) {
  const assessment = validate(input);
  return updateActiveSession(
    state,
    (session) => {
      if (session.assessments.some((item) => item.id === assessment.id)) {
        throw new LearningError(`Assessment already exists: ${assessment.id}`, "DUPLICATE_ASSESSMENT");
      }
      if (assessment.stage === "probe" && session.phase !== "probe") {
        throw new LearningError("Probe assessments require the probe phase", "INVALID_PHASE");
      }
      if (assessment.stage === "teach") {
        if (session.phase !== "teach" || !session.activeStepId) {
          throw new LearningError("Teaching assessments require an active teaching step", "INVALID_PHASE");
        }
        const step = session.steps.find((item) => item.id === session.activeStepId);
        if (step.nodeId !== assessment.nodeId) {
          throw new LearningError("Assessment node must match the active teaching step", "NODE_MISMATCH");
        }
      }

      if (!assessment.contaminated) {
        const current = session.knowledge[assessment.nodeId] ?? {
          nodeId: assessment.nodeId,
          status: "unknown",
          evidence: [],
          latestGrade: null,
          retry: null,
          review: { level: 0, dueAt: null, completed: 0 },
        };
        current.evidence.push(assessment.id);
        current.latestGrade = assessment.grade;
        if (assessment.grade === "correct") {
          current.status = assessment.kind === "multiple-choice" ? "fragile" : "developing";
          current.retry = null;
        } else if (assessment.grade === "partial") {
          current.status = "fragile";
          current.retry = {
            questionId: assessment.questionId,
            attempts: 1,
            required: true,
            answerMayBeTaught: false,
            requiresNewTransfer: false,
            mistakeType: assessment.mistakeType,
          };
        } else {
          current.status = "gap";
          current.retry = retryFor(session, assessment);
        }
        if (DURABLE_KINDS.has(assessment.kind)) {
          current.review = advanceReview(current.review, {
            grade: assessment.grade,
            kind: assessment.kind,
            now: assessment.createdAt,
          });
          if (current.review.level >= 4 && assessment.grade === "correct") {
            current.status = "strong";
          }
        }
        session.knowledge[assessment.nodeId] = current;

        if (
          assessment.stage === "teach" &&
          assessment.grade === "correct" &&
          DURABLE_KINDS.has(assessment.kind)
        ) {
          session.activeStepId = null;
          session.frontier = nextFrontier(session.plan, session.knowledge);
        }
        if (assessment.kind === "retention") {
          next.reviewCount += 1;
        }
      }

      session.assessments.push(assessment);
    },
    { now: assessment.createdAt },
  );
}
