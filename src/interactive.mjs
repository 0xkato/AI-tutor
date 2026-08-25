import { recordAssessment } from "./assessment.mjs";
import { conceptForNode } from "./concepts.mjs";
import { LearningError } from "./errors.mjs";
import { getActiveSession, recordAdmittedGap, updateActiveSession } from "./model.mjs";
import { answerQuestion } from "./questions.mjs";

function persistedQuestion(state, questionId) {
  const session = getActiveSession(state);
  const question = session.questions.find((candidate) => candidate.id === questionId);
  if (!question) {
    throw new LearningError(`Question not found: ${questionId}`, "QUESTION_NOT_FOUND");
  }
  return question;
}

function selectedAnswer(question, response) {
  const labels = new Map(question.choices.map((choice) => [choice.value, choice.label]));
  return response.selectedChoiceValues.map((value) => labels.get(value) ?? value).join(", ");
}

function recordTeachingGap(state, questionId, now) {
  return updateActiveSession(
    state,
    (session, next) => {
      if (session.phase !== "teach" || session.activeStepId === null) {
        throw new LearningError(
          "A teach-stage admitted gap requires an active teaching checkpoint",
          "INVALID_PHASE",
        );
      }
      const question = session.questions.find((candidate) => candidate.id === questionId);
      const step = session.steps.find((candidate) => candidate.id === session.activeStepId);
      const checkpoint = session.checkpoint;
      if (
        !question ||
        question.status !== "gap" ||
        question.stage !== "teach" ||
        !step ||
        !checkpoint ||
        step.nodeId !== question.nodeId ||
        step.checkpointQuestionId !== question.id ||
        step.checkpointQuestion !== question.question ||
        step.checkpointKind !== question.kind ||
        checkpoint.nodeId !== question.nodeId ||
        checkpoint.questionId !== question.id ||
        checkpoint.question !== question.question ||
        checkpoint.kind !== question.kind
      ) {
        throw new LearningError(
          "Teach-stage admitted gap does not match the active teaching checkpoint",
          "CHECKPOINT_IDENTITY_MISMATCH",
        );
      }

      const concept = conceptForNode(next, session, question.nodeId);
      const attempts = concept.retry?.attempts ?? 0;
      concept.status = "gap";
      concept.retry = {
        status: "new-transfer-required",
        questionId: question.id,
        attempts,
        required: false,
        answerMayBeTaught: true,
        requiresNewTransfer: true,
        priorQuestionId: question.id,
        mistakeType: "admitted-gap",
      };
      concept.updatedAt = now;
      Object.assign(checkpoint, {
        status: "new-transfer-required",
        questionId: question.id,
        priorQuestionId: question.id,
        attempts,
        resolvedEvidenceId: null,
        mistakeType: "admitted-gap",
      });
    },
    { now },
  );
}

export function submitQuestion(state, input = {}) {
  const answered = answerQuestion(state, input);
  const question = persistedQuestion(answered, input.questionId);
  const response = question.responses.at(-1);

  if (response.dontKnow) {
    if (question.stage === "teach") {
      return recordTeachingGap(answered, question.id, response.createdAt);
    }
    return recordAdmittedGap(answered, {
      id: input.outcomeId,
      nodeId: question.nodeId,
      statement: input.note || "I don't know this mechanism yet.",
      evidence: `The learner selected I don't know on persisted diagnostic question ${question.id}.`,
      now: input.now,
    });
  }

  return recordAssessment(answered, {
    id: input.outcomeId,
    questionId: question.id,
    nodeId: question.nodeId,
    stage: question.stage,
    kind: question.kind,
    question: question.question,
    answer: selectedAnswer(question, response),
    grade: response.correct ? "correct" : "incorrect",
    evidence: response.correct
      ? "The selected option matches the persisted deterministic multiple-choice key."
      : "The selected option does not match the persisted deterministic multiple-choice key.",
    mistakeType: response.correct ? "" : "multiple-choice-selection",
    now: input.now,
  });
}
