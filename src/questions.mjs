import { createHash, randomUUID } from "node:crypto";

import { LearningError } from "./errors.mjs";
import { safeIdentifier, safeSingleLine, safeText } from "./inputs.mjs";
import { recommendNextActivity } from "./learning-strategy.mjs";
import { getActiveSession, updateActiveSession } from "./model.mjs";
import { parseInstant } from "./schema.mjs";

const STAGES = new Set(["probe", "teach"]);
const MODES = new Set(["single-select", "multi-select", "free-response"]);
const FREE_RESPONSE_KINDS = new Set([
  "explanation",
  "prediction",
  "transfer",
  "contrastive",
  "reconstruction",
  "debugging",
]);
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

function optionalBoundedInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new LearningError(`${label} must be an integer from 0 to ${maximum}`, "INVALID_RESPONSE_METRIC");
  }
  return value;
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

function sameChoices(left, right) {
  return left.length === right.length && left.every((choice, index) => {
    const candidate = right[index];
    return (
      choice.value === candidate.value &&
      choice.label === candidate.label &&
      (choice.description ?? null) === (candidate.description ?? null)
    );
  });
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
  const mode = safeIdentifier(input.mode, "question mode");
  if (!MODES.has(mode)) {
    throw new LearningError(`Unknown question mode: ${mode}`, "INVALID_MODE");
  }
  const isFreeResponse = mode === "free-response";
  if (
    (!isFreeResponse && kind !== "multiple-choice") ||
    (isFreeResponse && !FREE_RESPONSE_KINDS.has(kind))
  ) {
    throw new LearningError(
      isFreeResponse
        ? `Free-response questions do not support kind: ${kind}`
        : "Selectable questions must be multiple-choice",
      "INVALID_KIND",
    );
  }
  const nodeId = safeIdentifier(input.nodeId, "nodeId");
  const question = safeText(input.question, "question");
  const choices = isFreeResponse ? [] : normalizeChoices(input.choices);
  const correctChoiceValues = isFreeResponse
    ? []
    : uniqueValues(input.correctChoiceValues, "correctChoiceValues");
  if (!isFreeResponse) {
    const choiceValues = new Set(choices.map((choice) => choice.value));
    if (
      correctChoiceValues.length === 0 ||
      correctChoiceValues.some((value) => !choiceValues.has(value)) ||
      (mode === "single-select" && correctChoiceValues.length !== 1)
    ) {
      throw new LearningError("correctChoiceValues do not match the question choices and mode", "INVALID_ANSWER_KEY");
    }
  }
  const explanation = isFreeResponse
    ? null
    : safeText(input.explanation, "explanation");
  const activityType = input.activityType === undefined
    ? isFreeResponse ? "free-response" : "multiple-choice"
    : safeSingleLine(input.activityType, "activity type", { maxLength: 128 });
  const strategyReason = input.strategyReason === undefined
    ? "Host-selected question activity."
    : safeText(input.strategyReason, "strategy reason");
  const supportLevel = optionalBoundedInteger(input.supportLevel, "supportLevel", 4);
  const transferLevel = optionalBoundedInteger(input.transferLevel, "transferLevel", 4);
  const createdAt = timestamp(input.now);

  return updateActiveSession(
    state,
    (session, next) => {
      if (session.phase !== stage) {
        throw new LearningError(
          `Interactive ${stage} questions require the ${stage} phase`,
          "INVALID_PHASE",
        );
      }
      const existingQuestion = session.questions.find((candidate) => candidate.id === id);
      const resumingCancelledQuestion =
        existingQuestion?.status === "cancelled" &&
        existingQuestion.responses.length === 0;
      if (existingQuestion && !resumingCancelledQuestion) {
        throw new LearningError(`Question already exists: ${id}`, "DUPLICATE_QUESTION");
      }
      if (stage === "teach") {
        const activeStep = session.steps.find((step) => step.id === session.activeStepId);
        const checkpoint = session.checkpoint;
        if (activityType === "productive-failure") {
          const recommendation = recommendNextActivity(next, session, nodeId);
          if (!recommendation.productiveFailureAllowed || activeStep || checkpoint) {
            throw new LearningError(
              "Productive failure requires durable prerequisites, no admitted gap, and no active teaching checkpoint",
              "PRODUCTIVE_FAILURE_NOT_ALLOWED",
            );
          }
        } else {
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

      if (existingQuestion) {
        const exactReplay =
          existingQuestion.stage === stage &&
          existingQuestion.nodeId === nodeId &&
          existingQuestion.kind === kind &&
          existingQuestion.question === question &&
          existingQuestion.mode === mode &&
          sameChoices(existingQuestion.choices, choices) &&
          sameSet(existingQuestion.correctChoiceValues, correctChoiceValues) &&
          existingQuestion.explanation === explanation &&
          existingQuestion.activityType === activityType &&
          existingQuestion.strategyReason === strategyReason &&
          existingQuestion.supportLevel === supportLevel &&
          existingQuestion.transferLevel === transferLevel &&
          (existingQuestion.parentQuestionId ?? null) === parentQuestionId &&
          (existingQuestion.adaptationReason ?? null) === adaptationReason;
        if (!exactReplay) {
          throw new LearningError(`Question already exists: ${id}`, "DUPLICATE_QUESTION");
        }
        existingQuestion.status = "awaiting-answer";
        existingQuestion.cancelledAt = null;
        return;
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
        activityType,
        strategyReason,
        supportLevel,
        transferLevel,
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

export function materializeTeachingCheckpointQuestion(state, { questionId, now } = {}) {
  const id = safeIdentifier(questionId, "questionId");
  const session = getActiveSession(state);
  if (session.kind !== "learn" || session.phase !== "teach" || !session.activeStepId) {
    throw new LearningError(
      "A materialized teaching question requires an active teaching step",
      "INVALID_CHECKPOINT",
    );
  }
  const step = session.steps.find((candidate) => candidate.id === session.activeStepId);
  const checkpoint = session.checkpoint;
  if (
    !step ||
    !checkpoint ||
    checkpoint.status !== "awaiting-answer" ||
    step.checkpointQuestionId !== id ||
    checkpoint.questionId !== id
  ) {
    throw new LearningError(
      `Teaching checkpoint ${id} is not awaiting learner input`,
      "QUESTION_NOT_RESUMABLE",
    );
  }

  const cancelledQuestion = session.questions.find((question) =>
    question.id === id &&
    question.status === "cancelled" &&
    question.responses.length === 0 &&
    question.stage === "teach" &&
    question.nodeId === step.nodeId &&
    question.kind === step.checkpointKind &&
    question.question === step.checkpointQuestion);
  const usingCancelledDefinition = !step.checkpointDefinition && Boolean(cancelledQuestion);
  const definition = step.checkpointDefinition ?? (cancelledQuestion
    ? {
        mode: cancelledQuestion.mode,
        choices: cancelledQuestion.choices,
        correctChoiceValues: cancelledQuestion.correctChoiceValues,
        explanation: cancelledQuestion.explanation,
        parentQuestionId: cancelledQuestion.parentQuestionId,
        adaptationReason: cancelledQuestion.adaptationReason,
      }
    : null);
  if (step.checkpointKind === "multiple-choice" && !definition) {
    throw new LearningError(
      `Teaching checkpoint ${id} has no persisted selectable definition`,
      "CHECKPOINT_DEFINITION_REQUIRED",
    );
  }
  const eligibleParent = [...session.questions]
    .reverse()
    .find((question) => ADAPTIVE_PARENT_STATUSES.has(question.status)) ?? null;
  const parentQuestionId = definition?.parentQuestionId ?? eligibleParent?.id;
  const adaptationReason = definition?.adaptationReason ?? (eligibleParent ? step.strategyReason : undefined);

  return startQuestion(state, {
    id,
    stage: "teach",
    nodeId: step.nodeId,
    kind: step.checkpointKind,
    question: step.checkpointQuestion,
    mode: definition?.mode ?? "free-response",
    choices: definition?.choices ?? [],
    correctChoiceValues: definition?.correctChoiceValues ?? [],
    explanation: definition?.explanation ?? undefined,
    activityType: usingCancelledDefinition ? cancelledQuestion.activityType : step.activityType,
    strategyReason: usingCancelledDefinition ? cancelledQuestion.strategyReason : step.strategyReason,
    supportLevel: usingCancelledDefinition ? cancelledQuestion.supportLevel : step.supportLevel,
    transferLevel: usingCancelledDefinition ? cancelledQuestion.transferLevel : step.transferLevel,
    ...(parentQuestionId ? { parentQuestionId, adaptationReason } : {}),
    now,
  });
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
      const selectedChoiceValues = uniqueValues(input.selectedChoiceValues ?? [], "selectedChoiceValues");
      const isFreeResponse = question.mode === "free-response";
      const textAnswer = isFreeResponse && !dontKnow
        ? safeText(input.textAnswer, "text answer")
        : null;
      const confidence = optionalBoundedInteger(input.confidence, "confidence", 100);
      const responseTimeMs = optionalBoundedInteger(input.responseTimeMs, "responseTimeMs");
      const choices = new Set(question.choices.map((choice) => choice.value));
      if (selectedChoiceValues.some((value) => !choices.has(value))) {
        throw new LearningError("selectedChoiceValues contain an unknown choice", "INVALID_RESPONSE");
      }
      if (dontKnow && (selectedChoiceValues.length > 0 || input.textAnswer)) {
        throw new LearningError("I don't know cannot include an answer", "INVALID_RESPONSE");
      }
      if (
        !isFreeResponse && !dontKnow &&
        ((question.mode === "single-select" && selectedChoiceValues.length !== 1) ||
          (question.mode === "multi-select" && selectedChoiceValues.length === 0))
      ) {
        throw new LearningError("selected choices do not match the question mode", "INVALID_RESPONSE");
      }
      if (isFreeResponse && selectedChoiceValues.length > 0) {
        throw new LearningError("Free responses cannot include selected choices", "INVALID_RESPONSE");
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

      const response = {
        id: responseId,
        selectedChoiceValues,
        textAnswer,
        dontKnow,
        correct: isFreeResponse ? null : dontKnow ? false : sameSet(selectedChoiceValues, question.correctChoiceValues),
        confidence,
        responseTimeMs,
        noteId,
        assessmentId: null,
        createdAt,
      };
      question.responses.push(response);
      if (!dontKnow && question.activityType === "productive-failure") {
        session.productiveAttempts.push({
          id: response.id,
          nodeId: question.nodeId,
          questionId: question.id,
          prompt: question.question,
          answer: response.textAnswer,
          rationale: input.rationale === undefined
            ? response.textAnswer
            : safeText(input.rationale, "productive attempt rationale"),
          confidence,
          responseTimeMs,
          createdAt,
        });
        question.status = "resolved";
      } else {
        question.status = dontKnow ? "gap" : "awaiting-assessment";
      }
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
  if (question.mode === "free-response") {
    if (assessment.answer !== response.textAnswer) {
      throw new LearningError(
        "Free-response assessment must preserve the persisted learner answer exactly",
        "QUESTION_IDENTITY_MISMATCH",
      );
    }
  } else {
    const expectedGrade = response.correct ? "correct" : "incorrect";
    if (assessment.grade !== expectedGrade) {
      throw new LearningError(
        `Multiple-choice response requires grade ${expectedGrade}`,
        "QUESTION_GRADE_MISMATCH",
      );
    }
  }
  response.assessmentId = assessment.id;
  if (assessment.contaminated) {
    question.status = "contaminated";
  } else {
    question.status = retry?.status === "retry-required" ? "retry-required" : "resolved";
  }
}
