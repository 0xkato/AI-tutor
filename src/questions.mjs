import { createHash, randomUUID } from "node:crypto";

import { LearningError } from "./errors.mjs";
import { safeIdentifier, safeSingleLine, safeText } from "./inputs.mjs";
import { updateActiveSession } from "./model.mjs";
import { parseInstant } from "./schema.mjs";

const STAGES = new Set(["probe", "teach"]);
const MODES = new Set(["single-select", "multi-select"]);
const UNRESOLVED_STATUSES = new Set([
  "awaiting-answer",
  "awaiting-assessment",
  "retry-required",
]);
const ADAPTIVE_PARENT_STATUSES = new Set(["resolved", "gap"]);
const NOTE_TARGETS = new Set(["session", "question", "concept", "step"]);

function timestamp(now) {
  return parseInstant(now ?? new Date().toISOString(), "event time");
}

function uniqueValues(values, label) {
  if (!Array.isArray(values)) {
    throw new LearningError(`${label} must be an array`, "INVALID_INPUT");
  }
  const checked = values.map((value, index) => safeIdentifier(value, `${label}[${index}]`));
  if (new Set(checked).size !== checked.length) {
    throw new LearningError(`${label} contains duplicate values`, "INVALID_INPUT");
  }
  return checked;
}

function normalizeChoices(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 12) {
    throw new LearningError("choices must contain between 2 and 12 options", "INVALID_CHOICES");
  }
  const choices = value.map((choice, index) => {
    if (!choice || typeof choice !== "object" || Array.isArray(choice)) {
      throw new LearningError(`choices[${index}] must be an object`, "INVALID_CHOICES");
    }
    return {
      value: safeIdentifier(choice.value, `choices[${index}].value`),
      label: safeSingleLine(choice.label, `choices[${index}].label`, { maxLength: 1_024 }),
      description:
        choice.description === undefined || choice.description === null
          ? null
          : safeText(choice.description, `choices[${index}].description`, { maxLength: 4_096 }),
    };
  });
  if (new Set(choices.map((choice) => choice.value)).size !== choices.length) {
    throw new LearningError("choice values must be unique", "INVALID_CHOICES");
  }
  return choices;
}

function sameSet(left, right) {
  if (left.length !== right.length) return false;
  const expected = new Set(right);
  return left.every((value) => expected.has(value));
}

function findQuestion(session, questionId) {
  const id = safeIdentifier(questionId, "questionId");
  const question = session.questions.find((candidate) => candidate.id === id);
  if (!question) throw new LearningError(`Question not found: ${id}`, "QUESTION_NOT_FOUND");
  return question;
}

function ensureNoPendingQuestion(session) {
  const pending = session.questions.find((question) => UNRESOLVED_STATUSES.has(question.status));
  if (pending) {
    throw new LearningError(
      `Question ${pending.id} must be resolved before another question starts`,
      "QUESTION_PENDING",
    );
  }
}

export function learnerQuestion(question) {
  const visible = structuredClone(question);
  delete visible.correctChoiceValues;
  delete visible.explanation;
  return visible;
}

export function questionDefinitionDigest(question) {
  const definition = {
    id: question.id,
    stage: question.stage,
    nodeId: question.nodeId,
    kind: question.kind,
    question: question.question,
    mode: question.mode,
    choices: question.choices.map((choice) => ({
      value: choice.value,
      label: choice.label,
      description: choice.description ?? null,
    })),
    correctChoiceValues: [...question.correctChoiceValues].sort(),
    explanation: question.explanation,
    parentQuestionId: question.parentQuestionId ?? null,
    adaptationReason: question.adaptationReason ?? null,
  };
  return createHash("sha256").update(JSON.stringify(definition)).digest("hex");
}

export function startQuestion(state, input = {}) {
  const id = safeIdentifier(input.id ?? randomUUID(), "question id");
  const stage = safeIdentifier(input.stage, "question stage");
  if (!STAGES.has(stage)) {
    throw new LearningError(
      "Interactive multiple-choice questions support probe or teach stages; durable retention uses the review checkpoint lifecycle",
      "INVALID_STAGE",
    );
  }
  const kind = safeIdentifier(input.kind, "question kind");
  if (kind !== "multiple-choice") {
    throw new LearningError("Interactive questions must be multiple-choice", "INVALID_KIND");
  }
  const mode = safeIdentifier(input.mode, "question mode");
  if (!MODES.has(mode)) {
    throw new LearningError(`Unknown question mode: ${mode}`, "INVALID_MODE");
  }
  const nodeId = safeIdentifier(input.nodeId, "nodeId");
  const question = safeText(input.question, "question");
  const choices = normalizeChoices(input.choices);
  const correctChoiceValues = uniqueValues(input.correctChoiceValues, "correctChoiceValues");
  const choiceValues = new Set(choices.map((choice) => choice.value));
  if (
    correctChoiceValues.length === 0 ||
    correctChoiceValues.some((value) => !choiceValues.has(value)) ||
    (mode === "single-select" && correctChoiceValues.length !== 1)
  ) {
    throw new LearningError("correctChoiceValues do not match the question choices and mode", "INVALID_ANSWER_KEY");
  }
  const explanation = safeText(input.explanation, "explanation");
  const createdAt = timestamp(input.now);

  return updateActiveSession(
    state,
    (session) => {
      if (session.phase !== stage) {
        throw new LearningError(
          `Interactive ${stage} questions require the ${stage} phase`,
          "INVALID_PHASE",
        );
      }
      if (session.questions.some((candidate) => candidate.id === id)) {
        throw new LearningError(`Question already exists: ${id}`, "DUPLICATE_QUESTION");
      }
      if (stage === "teach") {
        const activeStep = session.steps.find((step) => step.id === session.activeStepId);
        const checkpoint = session.checkpoint;
        if (
          !activeStep ||
          !checkpoint ||
          activeStep.nodeId !== nodeId ||
          activeStep.checkpointQuestionId !== id ||
          activeStep.checkpointQuestion !== question ||
          activeStep.checkpointKind !== kind ||
          checkpoint.nodeId !== nodeId ||
          checkpoint.questionId !== id ||
          checkpoint.question !== question ||
          checkpoint.kind !== kind ||
          checkpoint.status !== "awaiting-answer"
        ) {
          throw new LearningError(
            "Teach-stage interactive question does not match the active persisted checkpoint",
            "CHECKPOINT_IDENTITY_MISMATCH",
          );
        }
      }
      ensureNoPendingQuestion(session);

      let parentQuestionId = null;
      let adaptationReason = null;
      const hasAdaptiveParent = session.questions.some((candidate) =>
        ADAPTIVE_PARENT_STATUSES.has(candidate.status));
      if (hasAdaptiveParent) {
        if (input.parentQuestionId === undefined || input.adaptationReason === undefined) {
          throw new LearningError(
            "Every question after the first requires parentQuestionId and adaptationReason",
            "ADAPTATION_REQUIRED",
          );
        }
        parentQuestionId = safeIdentifier(input.parentQuestionId, "parentQuestionId");
        adaptationReason = safeText(input.adaptationReason, "adaptationReason");
        const parent = session.questions.find((candidate) => candidate.id === parentQuestionId);
        if (!parent || !ADAPTIVE_PARENT_STATUSES.has(parent.status)) {
          throw new LearningError(
            "A new question requires a resolved parent question from this session",
            "INVALID_PARENT_QUESTION",
          );
        }
      } else if (input.parentQuestionId !== undefined || input.adaptationReason !== undefined) {
        throw new LearningError(
          "A question cannot use a cancelled or contaminated item as its adaptive parent",
          "INVALID_PARENT_QUESTION",
        );
      }

      session.questions.push({
        id,
        stage,
        nodeId,
        kind,
        question,
        mode,
        choices,
        correctChoiceValues,
        explanation,
        status: "awaiting-answer",
        parentQuestionId,
        adaptationReason,
        responses: [],
        createdAt,
        cancelledAt: null,
      });
    },
    { now: createdAt },
  );
}

function noteTargetExists(state, session, targetType, targetId) {
  if (targetType === "session") return targetId === session.id;
  if (targetType === "question") return session.questions.some((question) => question.id === targetId);
  if (targetType === "step") return session.steps.some((step) => step.id === targetId);
  if (targetType === "concept") {
    return session.conceptIds.includes(targetId) && Boolean(state.concepts[targetId]);
  }
  return false;
}

function pushNote(next, session, input, createdAt) {
  const id = safeIdentifier(input.id ?? randomUUID(), "note id");
  const targetType = safeIdentifier(input.targetType, "note target type");
  if (!NOTE_TARGETS.has(targetType)) {
    throw new LearningError(`Unknown note target type: ${targetType}`, "INVALID_NOTE_TARGET");
  }
  const targetId = safeIdentifier(input.targetId, "note target id");
  const body = safeText(input.body, "note body");
  if (session.notes.some((note) => note.id === id)) {
    throw new LearningError(`Note already exists: ${id}`, "DUPLICATE_NOTE");
  }
  if (!noteTargetExists(next, session, targetType, targetId)) {
    throw new LearningError(
      `Note target does not exist in the active session: ${targetType}:${targetId}`,
      "NOTE_TARGET_NOT_FOUND",
    );
  }
  session.notes.push({ id, targetType, targetId, body, createdAt, updatedAt: createdAt });
  return id;
}

export function addLearnerNote(state, input = {}) {
  const createdAt = timestamp(input.now);
  return updateActiveSession(
    state,
    (session, next) => {
      pushNote(next, session, input, createdAt);
    },
    { now: createdAt },
  );
}

export function answerQuestion(state, input = {}) {
  const createdAt = timestamp(input.now);
  return updateActiveSession(
    state,
    (session, next) => {
      const question = findQuestion(session, input.questionId);
      if (!["awaiting-answer", "retry-required"].includes(question.status)) {
        throw new LearningError(
          `Question ${question.id} is not accepting an answer`,
          "QUESTION_NOT_ANSWERABLE",
        );
      }
      const responseId = safeIdentifier(input.responseId ?? randomUUID(), "response id");
      if (session.questions.some((candidate) =>
        candidate.responses.some((response) => response.id === responseId))) {
        throw new LearningError(`Response already exists: ${responseId}`, "DUPLICATE_RESPONSE");
      }
      const dontKnow = input.dontKnow === true;
      const selectedChoiceValues = uniqueValues(
        input.selectedChoiceValues ?? [],
        "selectedChoiceValues",
      );
      const choices = new Set(question.choices.map((choice) => choice.value));
      if (selectedChoiceValues.some((value) => !choices.has(value))) {
        throw new LearningError("selectedChoiceValues contain an unknown choice", "INVALID_RESPONSE");
      }
      if (dontKnow && selectedChoiceValues.length > 0) {
        throw new LearningError("I don't know cannot include selected choices", "INVALID_RESPONSE");
      }
      if (
        !dontKnow &&
        ((question.mode === "single-select" && selectedChoiceValues.length !== 1) ||
          (question.mode === "multi-select" && selectedChoiceValues.length === 0))
      ) {
        throw new LearningError("selected choices do not match the question mode", "INVALID_RESPONSE");
      }

      let noteId = null;
      const noteBody = input.note === undefined || input.note === null ? "" : safeText(input.note, "note");
      if (noteBody) {
        noteId = pushNote(
          next,
          session,
          {
            id: input.noteId,
            targetType: "question",
            targetId: question.id,
            body: noteBody,
          },
          createdAt,
        );
      } else if (input.noteId !== undefined) {
        throw new LearningError("noteId requires note text", "INVALID_NOTE");
      }

      question.responses.push({
        id: responseId,
        selectedChoiceValues,
        dontKnow,
        correct: dontKnow ? false : sameSet(selectedChoiceValues, question.correctChoiceValues),
        noteId,
        assessmentId: null,
        createdAt,
      });
      question.status = dontKnow ? "gap" : "awaiting-assessment";
    },
    { now: createdAt },
  );
}

export function cancelQuestion(state, input = {}) {
  const cancelledAt = timestamp(input.now);
  return updateActiveSession(
    state,
    (session) => {
      const question = findQuestion(session, input.questionId);
      if (!["awaiting-answer", "retry-required"].includes(question.status)) {
        throw new LearningError(
          `Question ${question.id} cannot be cancelled from ${question.status}`,
          "QUESTION_NOT_CANCELLABLE",
        );
      }
      question.status = "cancelled";
      question.cancelledAt = cancelledAt;
    },
    { now: cancelledAt },
  );
}

export function bindQuestionAssessment(session, assessment, retry) {
  const question = session.questions.find((candidate) => candidate.id === assessment.questionId);
  if (!question) return;
  if (
    question.question !== assessment.question ||
    question.kind !== assessment.kind ||
    question.stage !== assessment.stage
  ) {
    throw new LearningError(
      `Assessment does not match persisted question ${question.id}`,
      "QUESTION_IDENTITY_MISMATCH",
    );
  }
  if (question.status !== "awaiting-assessment") {
    throw new LearningError(
      `Question ${question.id} is not awaiting assessment`,
      "QUESTION_NOT_AWAITING_ASSESSMENT",
    );
  }
  const response = question.responses.at(-1);
  if (!response || response.dontKnow || response.assessmentId !== null) {
    throw new LearningError(
      `Question ${question.id} has no unassessed response`,
      "QUESTION_RESPONSE_MISSING",
    );
  }
  const expectedGrade = response.correct ? "correct" : "incorrect";
  if (assessment.grade !== expectedGrade) {
    throw new LearningError(
      `Multiple-choice response requires grade ${expectedGrade}`,
      "QUESTION_GRADE_MISMATCH",
    );
  }
  response.assessmentId = assessment.id;
  if (assessment.contaminated) {
    question.status = "contaminated";
  } else {
    question.status = retry?.status === "retry-required" ? "retry-required" : "resolved";
  }
}
