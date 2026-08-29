#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import { recordAssessment } from "../src/assessment.mjs";
import { checkBackup, createBackup } from "../src/backup.mjs";
import { knowledgeForSession } from "../src/concepts.mjs";
import { doctor } from "../src/doctor.mjs";
import { LearningError } from "../src/errors.mjs";
import { exportLearnerRecord } from "../src/export.mjs";
import { inspectVisual, safeVaultDir } from "../src/inputs.mjs";
import { submitQuestion } from "../src/interactive.mjs";
import {
  buildInterleavedPracticeQueue,
  recommendNextActivity,
} from "../src/learning-strategy.mjs";
import {
  addMaterial,
  addSource,
  addVisual,
  beginTeach,
  closeSession,
  continueSupplementalOnly,
  finishProbe,
  getActiveSession,
  recordSourceCoverage,
  recordStep,
  recordAdmittedGap,
  resolveMaterial,
  setPlan,
  startSession,
  updateLearnerProfile,
} from "../src/model.mjs";
import { commitAndRender, repairRender } from "../src/render.mjs";
import {
  addLearnerNote,
  answerQuestion,
  cancelQuestion,
  learnerQuestion,
  questionDefinitionDigest,
  startQuestion,
} from "../src/questions.mjs";
import { dueReviews, shouldSynthesize } from "../src/retention.mjs";
import {
  closeReviewSession,
  deferReviewItem,
  startReviewCheckpoint,
  startReviewSession,
} from "../src/reviews.mjs";
import { initializeStore, readState } from "../src/store.mjs";
import {
  recordSynthesisAssessment,
  startSynthesis,
} from "../src/synthesis.mjs";

const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const PRODUCT_VERSION = packageJson.version;

const commands = [
  ["init", "Initialize local state and the Obsidian vault"],
  ["profile", "Show the durable cross-session learner profile"],
  ["set-profile", "Update one or more learner teaching preferences"],
  ["start", "Start a learning session from a learner-supplied target"],
  ["record-probe", "Record one diagnostic question and assessment"],
  ["record-admitted-gap", "Record an ungraded probe or active-checkpoint gap"],
  ["start-question", "Persist a selectable or free-response item before showing it"],
  ["pending-question", "Show the unresolved question without its answer key"],
  ["answer-question", "Persist the learner answer, confidence, timing, and optional note"],
  ["submit-question", "Atomically persist an answer, note, and deterministic outcome"],
  ["cancel-question", "Cancel the unresolved question"],
  ["add-note", "Attach a learner note to a session learning object"],
  ["finish-probe", "Finish diagnosis and record the learner map"],
  ["add-material", "Add another or replacement learner-supplied material"],
  ["resolve-material", "Record whether learner-supplied material was usable"],
  ["continue-supplemental-only", "Record the learner's decision to continue without an anchor"],
  ["add-source", "Attach a verified source and supported claim"],
  ["record-source-coverage", "Bind a claim-level source to one dependency node"],
  ["set-plan", "Validate and store a dependency plan"],
  ["begin-teach", "Begin one-step-at-a-time teaching"],
  ["record-step", "Record one motivated teaching step"],
  ["record-assessment", "Record a checkpoint or retention result"],
  ["recommend-next", "Choose the next activity from durable learner evidence"],
  ["practice-plan", "Build an interleaved queue of due retention work"],
  ["start-synthesis", "Persist the whole-system synthesis question"],
  ["record-synthesis", "Record the whole-system synthesis assessment"],
  ["add-visual", "Attach a verified visual artifact"],
  ["doctor", "Diagnose runtime, state, backup, vault, and host discovery"],
  ["backup", "Create a checksummed canonical-state snapshot"],
  ["restore", "Validate a backup before any manual restoration"],
  ["export", "Create a deterministic portable learner record"],
  ["repair-render", "Reconcile the Obsidian projection with canonical state"],
  ["status", "Show the active session"],
  ["context", "Print runner-ready durable context"],
  ["due", "List due retention reviews"],
  ["start-review", "Claim due items and start a retention review"],
  ["start-review-checkpoint", "Persist a retention question before the learner answer"],
  ["defer-review", "Explicitly defer one selected review item"],
  ["close-review", "Close a resolved retention review"],
  ["close", "Close the active session from resolved synthesis evidence"],
];

const GLOBAL_OPTIONS = ["root", "json", "now", "help"];
const COMMAND_OPTIONS = {
  init: ["vault-dir"],
  profile: [],
  "set-profile": [
    "teaching-philosophy",
    "explanation-preferences",
    "feedback-preferences",
    "visual-preferences",
    "source-preferences",
  ],
  start: ["id", "topic", "target", "context", "topic-id", "reuse-concept", "material"],
  "record-probe": [
    "id",
    "question-id",
    "node",
    "kind",
    "question",
    "answer",
    "grade",
    "evidence",
    "mistake-type",
    "contaminated",
  ],
  "record-admitted-gap": ["id", "question-id", "node", "statement", "evidence"],
  "start-question": [
    "id",
    "stage",
    "node",
    "kind",
    "question",
    "mode",
    "choice",
    "correct",
    "explanation",
    "parent-question-id",
    "adaptation-reason",
    "activity-type",
    "strategy-reason",
    "support-level",
    "transfer-level",
  ],
  "pending-question": [],
  "answer-question": [
    "question-id",
    "response-id",
    "selected",
    "dont-know",
    "note-id",
    "note",
    "text-answer",
    "confidence",
    "response-time-ms",
    "rationale",
  ],
  "submit-question": [
    "question-id",
    "response-id",
    "selected",
    "dont-know",
    "note-id",
    "note",
    "outcome-id",
    "confidence",
    "response-time-ms",
  ],
  "cancel-question": ["question-id"],
  "add-note": ["id", "target-type", "target-id", "body"],
  "finish-probe": ["summary"],
  "add-material": ["id", "reference"],
  "resolve-material": ["material-id", "status", "title", "evidence"],
  "continue-supplemental-only": ["reason"],
  "add-source": [
    "id",
    "title",
    "url",
    "source-class",
    "role",
    "locator",
    "material-id",
    "supports",
    "verification",
  ],
  "record-source-coverage": ["id", "node", "source-id", "summary"],
  "set-plan": ["file"],
  "begin-teach": [],
  "record-step": [
    "id",
    "node",
    "foundation",
    "motivation",
    "explanation",
    "question-id",
    "kind",
    "question",
    "activity-type",
    "strategy-reason",
    "support-level",
    "transfer-level",
  ],
  "record-assessment": [
    "id",
    "question-id",
    "node",
    "stage",
    "kind",
    "question",
    "answer",
    "grade",
    "evidence",
    "mistake-type",
    "contaminated",
    "confidence",
    "response-time-ms",
    "transfer-level",
    "support-level",
    "activity-type",
    "misconception-id",
    "misconception-statement",
    "counterexample",
    "repair",
    "resolve-misconception",
  ],
  "recommend-next": ["node"],
  "practice-plan": [],
  "start-synthesis": ["question-id", "question"],
  "record-synthesis": [
    "id",
    "question-id",
    "question",
    "answer",
    "grade",
    "evidence",
    "mistake-type",
    "contaminated",
  ],
  "add-visual": ["id", "path", "description", "verification"],
  doctor: [],
  backup: ["id"],
  restore: ["backup", "check"],
  export: ["output"],
  "repair-render": [],
  status: [],
  context: [],
  due: [],
  "start-review": ["id", "review"],
  "start-review-checkpoint": ["question-id", "node", "kind", "question"],
  "defer-review": ["review", "reason", "until"],
  "close-review": ["synthesis"],
  close: ["gap"],
};
const BOOLEAN_OPTIONS = new Set(["json", "contaminated", "dont-know", "help", "check"]);
const REPEATABLE_OPTIONS = {
  start: new Set(["reuse-concept", "material"]),
  "start-review": new Set(["review"]),
  "start-question": new Set(["choice", "correct"]),
  "answer-question": new Set(["selected"]),
  "submit-question": new Set(["selected"]),
  "record-assessment": new Set(["resolve-misconception"]),
  close: new Set(["gap"]),
};
const OPTION_DESCRIPTIONS = {
  root: "Learning repository (default: current directory)",
  json: "Emit machine-readable JSON",
  now: "Canonical ISO-8601 event time (optional)",
  help: "Show help for this command",
  "vault-dir": "Relative vault directory inside the learning root",
  "teaching-philosophy": "Learner-authored principles that govern teaching",
  "explanation-preferences": "Preferred explanation structure, pace, and detail",
  "feedback-preferences": "Preferred assessment and correction behavior",
  "visual-preferences": "When and how visuals should support learning",
  "source-preferences": "Preferred research sources and evidence standards",
  id: "Stable record identifier",
  topic: "Learning topic",
  target: "Learner-owned target",
  context: "Relevant learner context",
  "topic-id": "Stable topic identifier",
  "reuse-concept": "Existing concept identifier (repeatable)",
  material: "Learner-supplied source reference (repeatable)",
  reference: "Additional or replacement learning material",
  "question-id": "Stable question identifier",
  node: "Dependency-plan node identifier",
  stage: "Assessment stage",
  kind: "Question or assessment kind",
  question: "Checkpoint question",
  answer: "Learner answer",
  grade: "correct, partial, or incorrect",
  evidence: "Exact assessment evidence",
  "mistake-type": "Specific mistake category",
  contaminated: "Exclude exposed-answer evidence",
  mode: "single-select, multi-select, or free-response",
  choice: "Choice JSON with stable value, label, and optional description (repeatable)",
  correct: "Correct stable choice value (repeatable)",
  explanation: "Post-answer explanation retained by the engine",
  "parent-question-id": "Prior question that caused this adaptive item",
  "adaptation-reason": "Why the prior response led to this item",
  "activity-type": "Adaptive learning activity type",
  "strategy-reason": "Why durable learner evidence selected this activity",
  "support-level": "Scaffold level from 0 (independent) to 4 (fully worked)",
  "transfer-level": "Transfer distance from 0 (near) to 4 (whole system)",
  "response-id": "Stable response identifier",
  selected: "Selected stable choice value (repeatable)",
  "text-answer": "Learner's own words for a free-response item",
  confidence: "Learner confidence from 0 to 100",
  "response-time-ms": "Elapsed response time in milliseconds",
  rationale: "Learner rationale for a productive-failure attempt",
  "dont-know": "Record I don't know instead of a guess",
  "note-id": "Stable optional note identifier",
  note: "Optional note attached to the answered item",
  "outcome-id": "Stable assessment or admitted-gap identifier",
  "misconception-id": "Stable misconception identifier",
  "misconception-statement": "Specific durable misconception expressed by this answer",
  counterexample: "Counterexample that distinguishes the misconception from the mechanism",
  repair: "Mechanism-level correction for the misconception",
  "resolve-misconception": "Misconception repaired by this durable evidence (repeatable)",
  "target-type": "session, question, concept, or step",
  "target-id": "Learning object receiving the note",
  body: "Learner note text",
  summary: "Probe conclusion",
  title: "Source title",
  url: "http(s) URL or local:<reference>",
  "source-class": "Source provenance class",
  role: "Anchor material or supplemental research",
  locator: "Exact timestamp, page, section, heading, or file location",
  "material-id": "Learner-supplied material identifier",
  status: "verified or unavailable",
  "source-id": "Claim-level source identifier",
  supports: "Claim supported by the source",
  verification: "Recorded verification or inspection",
  file: "Input JSON file",
  foundation: "Required foundation",
  motivation: "Why this step matters",
  explanation: "Teaching explanation",
  path: "Relative visual path inside the vault",
  description: "Visual description",
  backup: "Backup identifier",
  check: "Validate only; never mutate canonical state",
  output: "New export directory",
  review: "Review identifier (repeatable for start-review)",
  reason: "Deferral reason",
  until: "Canonical ISO-8601 deferral time",
  synthesis: "Whole-system synthesis",
  gap: "Unresolved gap (repeatable)",
};
const COMMAND_OPTION_DESCRIPTIONS = {
  "add-material": {
    reference: "Additional or replacement learning material",
  },
  "resolve-material": {
    "material-id": "Learner-supplied material identifier",
    status: "verified or unavailable",
    title: "Resolved material title (required when verified)",
    evidence: "Exact material resolution evidence",
  },
  "continue-supplemental-only": {
    reason: "Learner-approved reason for continuing without a verified anchor",
  },
  "add-source": {
    role: "Anchor material or supplemental research",
    locator: "Exact timestamp, page, section, heading, or file location",
    "material-id": "Verified learner material linked by an anchor claim",
  },
  "record-source-coverage": {
    node: "Dependency-plan node supported by the source",
    "source-id": "Claim-level source identifier",
    summary: "Bounded mechanism or claim supported",
  },
  "record-admitted-gap": {
    "question-id": "Exact active checkpoint question identifier (teach, retention, or synthesis)",
    statement: "Learner's exact admitted-gap statement",
    evidence: "Evidence locating the admitted knowledge gap",
  },
  "start-review-checkpoint": {
    "question-id": "Stable review question identifier",
    node: "Selected review concept node identifier",
    kind: "Retention or transfer question kind",
    question: "Exact question shown to the learner",
  },
};

function help() {
  const lines = [
    "Adaptive Learning Agent",
    "",
    "Usage: adaptive-learn <command> [options]",
    "",
    "Global options:",
    "  --root <path>         Learning repository (default: current directory)",
    "  --json                Emit machine-readable JSON",
    "  --now <ISO-8601>      Deterministic event time (optional)",
    "  --version             Print the product version",
    "",
    "Commands:",
    ...commands.map(([name, description]) => `  ${name.padEnd(19)} ${description}`),
    "",
    "Run commands with explicit named options; use the skill's CLI reference for examples.",
  ];
  return `${lines.join("\n")}\n`;
}

function commandHelp(command) {
  const description = commands.find(([name]) => name === command)?.[1] ?? "";
  const optionNames = [...GLOBAL_OPTIONS, ...COMMAND_OPTIONS[command]];
  const lines = [
    `Usage: adaptive-learn ${command} [options]`,
    "",
    description,
    "",
    "Options:",
    ...optionNames.map((name) => {
      const repeatable = REPEATABLE_OPTIONS[command]?.has(name) ?? false;
      const suffix = BOOLEAN_OPTIONS.has(name) ? "" : ` <value>${repeatable ? " ..." : ""}`;
      const optionDescription =
        COMMAND_OPTION_DESCRIPTIONS[command]?.[name] ?? OPTION_DESCRIPTIONS[name];
      return `  --${name}${suffix}`.padEnd(30) + optionDescription;
    }),
  ];
  return `${lines.join("\n")}\n`;
}

function parseOptions(command, args) {
  const options = {};
  const allowed = new Set([...GLOBAL_OPTIONS, ...COMMAND_OPTIONS[command]]);
  const repeatable = REPEATABLE_OPTIONS[command] ?? new Set();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] === "-h" ? "--help" : args[index];
    if (!token.startsWith("--")) {
      throw new LearningError(`Unexpected positional argument: ${token}`, "INVALID_ARGUMENT");
    }
    const key = token.slice(2);
    if (!allowed.has(key)) {
      throw new LearningError(`Unknown option for ${command}: --${key}`, "UNKNOWN_OPTION");
    }
    let value = true;
    if (!BOOLEAN_OPTIONS.has(key)) {
      value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new LearningError(`Missing value for --${key}`, "INVALID_ARGUMENT");
      }
      index += 1;
    }
    if (options[key] === undefined) {
      options[key] = repeatable.has(key) ? [value] : value;
    } else if (repeatable.has(key)) {
      options[key].push(value);
    } else {
      throw new LearningError(`Option may be provided only once: --${key}`, "DUPLICATE_OPTION");
    }
  }
  return options;
}

function last(options, key) {
  const value = options[key];
  return Array.isArray(value) ? value.at(-1) : value;
}

function all(options, key) {
  const value = options[key];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function optionalInteger(options, key, maximum = Number.MAX_SAFE_INTEGER) {
  const raw = last(options, key);
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw)) {
    throw new LearningError(`--${key} must be an integer from 0 to ${maximum}`, "INVALID_ARGUMENT");
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > maximum) {
    throw new LearningError(`--${key} must be an integer from 0 to ${maximum}`, "INVALID_ARGUMENT");
  }
  return value;
}

function assessmentInput(options, stage) {
  return {
    id: last(options, "id"),
    questionId: last(options, "question-id"),
    nodeId: last(options, "node"),
    stage: stage ?? last(options, "stage"),
    kind: last(options, "kind"),
    question: last(options, "question"),
    answer: last(options, "answer"),
    grade: last(options, "grade"),
    evidence: last(options, "evidence"),
    mistakeType: last(options, "mistake-type"),
    contaminated: options.contaminated === true,
    confidence: optionalInteger(options, "confidence", 100),
    responseTimeMs: optionalInteger(options, "response-time-ms"),
    transferLevel: optionalInteger(options, "transfer-level", 4),
    supportLevel: optionalInteger(options, "support-level", 4),
    activityType: last(options, "activity-type"),
    misconceptionId: last(options, "misconception-id"),
    misconceptionStatement: last(options, "misconception-statement"),
    counterexample: last(options, "counterexample"),
    repair: last(options, "repair"),
    resolveMisconceptionIds: all(options, "resolve-misconception"),
    now: last(options, "now"),
  };
}

function parseChoice(value, index) {
  try {
    const choice = JSON.parse(value);
    if (!choice || typeof choice !== "object" || Array.isArray(choice)) throw new Error("expected an object");
    return choice;
  } catch (error) {
    throw new LearningError(`Invalid --choice ${index + 1}: ${error.message}`, "INVALID_CHOICE");
  }
}

function publicSession(session) {
  return {
    ...structuredClone(session),
    questions: (session.questions ?? []).map(learnerQuestion),
  };
}

function retryList(state, session) {
  if (!session) return [];
  return Object.values(knowledgeForSession(state, session))
    .map((entry) => entry.retry)
    .filter(Boolean);
}

function statusFor(state) {
  const session = state.activeSessionId ? state.sessions[state.activeSessionId] : null;
  return {
    schemaVersion: state.schemaVersion,
    updatedAt: state.updatedAt,
    sessionCount: Object.keys(state.sessions).length,
    active: session
      ? {
          id: session.id,
          kind: session.kind,
          topic: session.topic,
          target: session.target,
          phase: session.phase,
          frontier: session.frontier ?? [],
          activeStepId: session.activeStepId ?? null,
          retry: retryList(state, session),
          synthesisRequired: session.synthesisRequired ?? false,
          synthesisCheckpoint: session.synthesisCheckpoint ?? null,
          reviewItems: (session.reviewItems ?? []).map((item) => ({
            reviewId: item.reviewId,
            conceptId: item.conceptId,
            status: item.status,
          })),
          checkpoint: session.checkpoint ?? null,
          question: session.questions?.length
            ? learnerQuestion(session.questions.at(-1))
            : null,
          noteCount: session.notes?.length ?? 0,
        }
      : null,
  };
}

function emit(payload, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  if (typeof payload === "string") process.stdout.write(`${payload}\n`);
  else process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function readJsonFile(file) {
  const location = path.resolve(file);
  try {
    return JSON.parse(fs.readFileSync(location, "utf8"));
  } catch (error) {
    throw new LearningError(`Could not read JSON file ${location}: ${error.message}`, "INVALID_JSON_FILE");
  }
}

function commandResult(command, options, root) {
  if (command === "init") {
    const requestedVaultDir = last(options, "vault-dir");
    const vaultDir = requestedVaultDir === undefined ? null : safeVaultDir(requestedVaultDir);
    const initial = initializeStore(root, { now: last(options, "now") });
    if (vaultDir && vaultDir !== initial.settings.vaultDir) {
      const outcome = commitAndRender(root, (current) => {
        const next = structuredClone(current);
        next.settings.vaultDir = vaultDir;
        next.updatedAt = last(options, "now") ?? new Date().toISOString();
        return next;
      });
      if (!outcome.render.ok) {
        return {
          ok: false,
          stateCommitted: outcome.stateCommitted,
          stateRevision: outcome.stateRevision,
          render: outcome.render,
        };
      }
      return statusFor(outcome.state);
    }
    const rendered = repairRender(root);
    if (!rendered.ok) {
      return {
        ok: false,
        stateCommitted: true,
        stateRevision: initial.revision,
        render: rendered,
      };
    }
    return statusFor(initial);
  }

  if (command === "doctor") return doctor(root);
  if (command === "backup") {
    return createBackup(root, { id: last(options, "id"), now: last(options, "now") });
  }
  if (command === "restore") {
    if (options.check !== true) {
      throw new LearningError("restore requires --check; automatic restoration is not enabled", "RESTORE_CHECK_REQUIRED");
    }
    const checked = checkBackup(root, last(options, "backup"));
    return { valid: checked.valid, id: checked.id, manifest: checked.manifest };
  }
  if (command === "export") {
    return exportLearnerRecord(root, last(options, "output"));
  }

  const state = readState(root);
  if (command === "repair-render") return repairRender(root);
  if (command === "profile") return structuredClone(state.learnerProfile);
  if (command === "status") return statusFor(state);
  if (command === "pending-question") {
    const session = getActiveSession(state);
    const question = [...(session.questions ?? [])]
      .reverse()
      .find((candidate) => ["awaiting-answer", "awaiting-assessment", "retry-required"].includes(candidate.status));
    return {
      question: question ? learnerQuestion(question) : null,
      definitionDigest: question ? questionDefinitionDigest(question) : null,
    };
  }
  if (command === "due") {
    const reviews = dueReviews(state, { now: last(options, "now") });
    return { reviews, synthesisDue: shouldSynthesize(state, reviews) };
  }
  if (command === "recommend-next") {
    const session = getActiveSession(state);
    return recommendNextActivity(state, session, last(options, "node"));
  }
  if (command === "practice-plan") {
    const reviews = dueReviews(state, { now: last(options, "now") });
    return {
      items: buildInterleavedPracticeQueue(state, reviews),
      synthesisDue: shouldSynthesize(state, reviews),
    };
  }
  if (command === "context") {
    const session = getActiveSession(state);
    const reviews = dueReviews(state, { now: last(options, "now") });
    return {
      learnerProfile: structuredClone(state.learnerProfile),
      session: publicSession(session),
      retry: retryList(state, session),
      dueReviews: reviews,
      synthesisDue: shouldSynthesize(state, reviews),
    };
  }

  const outcome = commitAndRender(root, (current) => {
    if (command === "set-profile") {
      return updateLearnerProfile(current, {
        teachingPhilosophy: last(options, "teaching-philosophy"),
        explanationPreferences: last(options, "explanation-preferences"),
        feedbackPreferences: last(options, "feedback-preferences"),
        visualPreferences: last(options, "visual-preferences"),
        sourcePreferences: last(options, "source-preferences"),
        now: last(options, "now"),
      });
    }
    if (command === "start") {
      return startSession(current, {
      id: last(options, "id"),
      topic: last(options, "topic"),
      target: last(options, "target"),
      context: last(options, "context"),
      topicId: last(options, "topic-id"),
      reuseConceptIds: all(options, "reuse-concept"),
      materials: all(options, "material"),
      now: last(options, "now"),
      });
    }
    if (command === "add-material") {
      return addMaterial(current, {
        id: last(options, "id"),
        reference: last(options, "reference"),
        now: last(options, "now"),
      });
    }
    if (command === "resolve-material") {
      return resolveMaterial(current, {
        materialId: last(options, "material-id"),
        status: last(options, "status"),
        title: last(options, "title"),
        evidence: last(options, "evidence"),
        now: last(options, "now"),
      });
    }
    if (command === "continue-supplemental-only") {
      return continueSupplementalOnly(current, {
        reason: last(options, "reason"),
        now: last(options, "now"),
      });
    }
    if (command === "start-review") {
      return startReviewSession(current, {
        id: last(options, "id"),
        reviewIds: all(options, "review"),
        now: last(options, "now"),
      });
    }
    if (command === "start-review-checkpoint") {
      return startReviewCheckpoint(current, {
        questionId: last(options, "question-id"),
        nodeId: last(options, "node"),
        kind: last(options, "kind"),
        question: last(options, "question"),
        now: last(options, "now"),
      });
    }
    if (command === "record-probe") {
      return recordAssessment(current, assessmentInput(options, "probe"));
    }
    if (command === "record-admitted-gap") {
      return recordAdmittedGap(current, {
        id: last(options, "id"),
        questionId: last(options, "question-id"),
        nodeId: last(options, "node"),
        statement: last(options, "statement"),
        evidence: last(options, "evidence"),
        now: last(options, "now"),
      });
    }
    if (command === "start-question") {
      return startQuestion(current, {
        id: last(options, "id"),
        stage: last(options, "stage"),
        nodeId: last(options, "node"),
        kind: last(options, "kind"),
        question: last(options, "question"),
        mode: last(options, "mode"),
        choices: all(options, "choice").map(parseChoice),
        correctChoiceValues: all(options, "correct"),
        explanation: last(options, "explanation"),
        parentQuestionId: last(options, "parent-question-id"),
        adaptationReason: last(options, "adaptation-reason"),
        activityType: last(options, "activity-type"),
        strategyReason: last(options, "strategy-reason"),
        supportLevel: optionalInteger(options, "support-level", 4),
        transferLevel: optionalInteger(options, "transfer-level", 4),
        now: last(options, "now"),
      });
    }
    if (command === "answer-question") {
      return answerQuestion(current, {
        questionId: last(options, "question-id"),
        responseId: last(options, "response-id"),
        selectedChoiceValues: all(options, "selected"),
        textAnswer: last(options, "text-answer"),
        dontKnow: options["dont-know"] === true,
        confidence: optionalInteger(options, "confidence", 100),
        responseTimeMs: optionalInteger(options, "response-time-ms"),
        rationale: last(options, "rationale"),
        noteId: last(options, "note-id"),
        note: last(options, "note"),
        now: last(options, "now"),
      });
    }
    if (command === "submit-question") {
      return submitQuestion(current, {
        questionId: last(options, "question-id"),
        responseId: last(options, "response-id"),
        selectedChoiceValues: all(options, "selected"),
        dontKnow: options["dont-know"] === true,
        confidence: optionalInteger(options, "confidence", 100),
        responseTimeMs: optionalInteger(options, "response-time-ms"),
        noteId: last(options, "note-id"),
        note: last(options, "note"),
        outcomeId: last(options, "outcome-id"),
        now: last(options, "now"),
      });
    }
    if (command === "cancel-question") {
      return cancelQuestion(current, {
        questionId: last(options, "question-id"),
        now: last(options, "now"),
      });
    }
    if (command === "add-note") {
      return addLearnerNote(current, {
        id: last(options, "id"),
        targetType: last(options, "target-type"),
        targetId: last(options, "target-id"),
        body: last(options, "body"),
        now: last(options, "now"),
      });
    }
    if (command === "finish-probe") {
      return finishProbe(current, {
      summary: last(options, "summary"),
      now: last(options, "now"),
      });
    }
    if (command === "add-source") {
      return addSource(current, {
      id: last(options, "id"),
      title: last(options, "title"),
      url: last(options, "url"),
      sourceClass: last(options, "source-class"),
      role: last(options, "role"),
      locator: last(options, "locator"),
      materialId: last(options, "material-id"),
      supports: last(options, "supports"),
      verification: last(options, "verification"),
      now: last(options, "now"),
      });
    }
    if (command === "record-source-coverage") {
      return recordSourceCoverage(current, {
        id: last(options, "id"),
        nodeId: last(options, "node"),
        sourceId: last(options, "source-id"),
        summary: last(options, "summary"),
        now: last(options, "now"),
      });
    }
    if (command === "set-plan") {
      return setPlan(current, {
      plan: readJsonFile(last(options, "file")),
      now: last(options, "now"),
      });
    }
    if (command === "begin-teach") {
      return beginTeach(current, { now: last(options, "now") });
    }
    if (command === "record-step") {
      return recordStep(current, {
      id: last(options, "id"),
      nodeId: last(options, "node"),
      foundation: last(options, "foundation"),
      motivation: last(options, "motivation"),
      explanation: last(options, "explanation"),
      checkpointQuestionId: last(options, "question-id"),
      checkpointKind: last(options, "kind"),
      checkpointQuestion: last(options, "question"),
      activityType: last(options, "activity-type"),
      strategyReason: last(options, "strategy-reason"),
      supportLevel: optionalInteger(options, "support-level", 4),
      transferLevel: optionalInteger(options, "transfer-level", 4),
      now: last(options, "now"),
      });
    }
    if (command === "record-assessment") {
      return recordAssessment(current, assessmentInput(options));
    }
    if (command === "start-synthesis") {
      return startSynthesis(current, {
        questionId: last(options, "question-id"),
        question: last(options, "question"),
        now: last(options, "now"),
      });
    }
    if (command === "record-synthesis") {
      return recordSynthesisAssessment(current, {
        id: last(options, "id"),
        questionId: last(options, "question-id"),
        question: last(options, "question"),
        answer: last(options, "answer"),
        grade: last(options, "grade"),
        evidence: last(options, "evidence"),
        mistakeType: last(options, "mistake-type"),
        contaminated: options.contaminated === true,
        now: last(options, "now"),
      });
    }
    if (command === "add-visual") {
      const inspected = inspectVisual(root, current, last(options, "path"));
      return addVisual(current, {
      id: last(options, "id"),
      ...inspected,
      description: last(options, "description"),
      verification: last(options, "verification"),
      now: last(options, "now"),
      });
    }
    if (command === "defer-review") {
      return deferReviewItem(current, {
        reviewId: last(options, "review"),
        reason: last(options, "reason"),
        until: last(options, "until"),
        now: last(options, "now"),
      });
    }
    if (command === "close-review") {
      return closeReviewSession(current, {
        synthesis: last(options, "synthesis"),
        now: last(options, "now"),
      });
    }
    if (command === "close") {
      return closeSession(current, {
      unresolvedGaps: all(options, "gap"),
      now: last(options, "now"),
      });
    }
    throw new LearningError(`Unknown command: ${command}`, "UNKNOWN_COMMAND");
  });
  if (!outcome.render.ok) {
    return {
      ok: false,
      stateCommitted: outcome.stateCommitted,
      stateRevision: outcome.stateRevision,
      render: outcome.render,
    };
  }
  if (command === "set-profile") return structuredClone(outcome.state.learnerProfile);
  return statusFor(outcome.state);
}

const [command, ...rawOptions] = process.argv.slice(2);

if (!command || command === "--help" || command === "-h" || command === "help") {
  process.stdout.write(help());
  process.exit(0);
}

if (command === "--version" || command === "-V" || command === "version") {
  process.stdout.write(`${PRODUCT_VERSION}\n`);
  process.exit(0);
}

if (!commands.some(([name]) => name === command)) {
  process.stderr.write(`Unknown command: ${command}. Run with --help.\n`);
  process.exit(1);
}

try {
  const options = parseOptions(command, rawOptions);
  if (options.help === true) {
    process.stdout.write(commandHelp(command));
    process.exit(0);
  }
  const root = path.resolve(last(options, "root") ?? process.cwd());
  const result = commandResult(command, options, root);
  emit(result, options.json === true);
  if (result?.ok === false) process.exitCode = 1;
} catch (error) {
  const code = error instanceof LearningError ? error.code : "UNEXPECTED_ERROR";
  process.stderr.write(`[${code}] ${error.message}\n`);
  process.exit(1);
}
