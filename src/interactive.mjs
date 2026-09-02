import { recordAssessment } from "./assessment.mjs";
import { LearningError } from "./errors.mjs";
import { getActiveSession, recordAdmittedGap } from "./model.mjs";
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

export function submitQuestion(state, input = {}) {
  const answered = answerQuestion(state, input);
  const question = persistedQuestion(answered, input.questionId);
  const response = question.responses.at(-1);

  if (question.mode === "free-response" && !response.dontKnow) {
    throw new LearningError(
      "Free responses require an explicit host assessment after the answer is persisted",
      "EXPLICIT_ASSESSMENT_REQUIRED",
    );
  }

  if (response.dontKnow) {
    return recordAdmittedGap(answered, {
      id: input.outcomeId,
      nodeId: question.nodeId,
      questionId: question.id,
      statement: input.note || "I don't know this mechanism yet.",
      evidence: `The learner selected I don't know on persisted ${question.stage} question ${question.id}.`,
      now: response.createdAt,
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
