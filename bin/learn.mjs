#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import { recordAssessment } from "../src/assessment.mjs";
import { knowledgeForSession } from "../src/concepts.mjs";
import { LearningError } from "../src/errors.mjs";
import {
  addSource,
  addVisual,
  beginTeach,
  closeSession,
  finishProbe,
  getActiveSession,
  recordStep,
  setPlan,
  startSession,
} from "../src/model.mjs";
import { renderVault } from "../src/render.mjs";
import { dueReviews, shouldSynthesize } from "../src/retention.mjs";
import {
  closeReviewSession,
  deferReviewItem,
  startReviewSession,
} from "../src/reviews.mjs";
import { initializeStore, mutateState, readState } from "../src/store.mjs";

const commands = [
  ["init", "Initialize local state and the Obsidian vault"],
  ["start", "Start a learning session from a learner-supplied target"],
  ["record-probe", "Record one diagnostic question and assessment"],
  ["finish-probe", "Finish diagnosis and record the learner map"],
  ["add-source", "Attach a verified source and supported claim"],
  ["set-plan", "Validate and store a dependency plan"],
  ["begin-teach", "Begin one-step-at-a-time teaching"],
  ["record-step", "Record one motivated teaching step"],
  ["record-assessment", "Record a checkpoint or retention result"],
  ["add-visual", "Attach a verified visual artifact"],
  ["status", "Show the active session"],
  ["context", "Print runner-ready durable context"],
  ["due", "List due retention reviews"],
  ["start-review", "Claim due items and start a retention review"],
  ["defer-review", "Explicitly defer one selected review item"],
  ["close-review", "Close a resolved retention review"],
  ["close", "Close the active session with a synthesis"],
];

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
    "",
    "Commands:",
    ...commands.map(([name, description]) => `  ${name.padEnd(19)} ${description}`),
    "",
    "Run commands with explicit named options; use the skill's CLI reference for examples.",
  ];
  return `${lines.join("\n")}\n`;
}

function parseOptions(args) {
  const options = {};
  const booleans = new Set(["json", "contaminated"]);
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      throw new LearningError(`Unexpected positional argument: ${token}`, "INVALID_ARGUMENT");
    }
    const key = token.slice(2);
    let value = true;
    if (!booleans.has(key)) {
      value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new LearningError(`Missing value for --${key}`, "INVALID_ARGUMENT");
      }
      index += 1;
    }
    if (options[key] === undefined) options[key] = value;
    else if (Array.isArray(options[key])) options[key].push(value);
    else options[key] = [options[key], value];
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
    now: last(options, "now"),
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
          reviewItems: (session.reviewItems ?? []).map((item) => ({
            reviewId: item.reviewId,
            conceptId: item.conceptId,
            status: item.status,
          })),
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
    initializeStore(root, { now: last(options, "now") });
    const vaultDir = last(options, "vault-dir");
    const state = mutateState(
      root,
      (current) => {
        if (!vaultDir || vaultDir === current.settings.vaultDir) return current;
        const next = structuredClone(current);
        next.settings.vaultDir = vaultDir;
        next.updatedAt = last(options, "now") ?? new Date().toISOString();
        return next;
      },
      { afterWrite: (next) => renderVault(root, next) },
    );
    return statusFor(state);
  }

  const state = readState(root);
  if (command === "status") return statusFor(state);
  if (command === "due") {
    const reviews = dueReviews(state, { now: last(options, "now") });
    return { reviews, synthesisDue: shouldSynthesize(state, reviews) };
  }
  if (command === "context") {
    const session = getActiveSession(state);
    const reviews = dueReviews(state, { now: last(options, "now") });
    return {
      session,
      retry: retryList(state, session),
      dueReviews: reviews,
      synthesisDue: shouldSynthesize(state, reviews),
    };
  }

  const next = mutateState(root, (current) => {
    if (command === "start") {
      return startSession(current, {
      id: last(options, "id"),
      topic: last(options, "topic"),
      target: last(options, "target"),
      context: last(options, "context"),
      topicId: last(options, "topic-id"),
      reuseConceptIds: all(options, "reuse-concept"),
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
    if (command === "record-probe") {
      return recordAssessment(current, assessmentInput(options, "probe"));
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
      supports: last(options, "supports"),
      verification: last(options, "verification"),
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
      checkpointQuestion: last(options, "question"),
      now: last(options, "now"),
      });
    }
    if (command === "record-assessment") {
      return recordAssessment(current, assessmentInput(options));
    }
    if (command === "add-visual") {
      return addVisual(current, {
      id: last(options, "id"),
      path: last(options, "path"),
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
      synthesis: last(options, "synthesis"),
      unresolvedGaps: all(options, "gap"),
      now: last(options, "now"),
      });
    }
    throw new LearningError(`Unknown command: ${command}`, "UNKNOWN_COMMAND");
  }, { afterWrite: (current) => renderVault(root, current) });
  return statusFor(next);
}

const [command, ...rawOptions] = process.argv.slice(2);

if (!command || command === "--help" || command === "-h" || command === "help") {
  process.stdout.write(help());
  process.exit(0);
}

if (!commands.some(([name]) => name === command)) {
  process.stderr.write(`Unknown command: ${command}. Run with --help.\n`);
  process.exit(1);
}

try {
  const options = parseOptions(rawOptions);
  const root = path.resolve(last(options, "root") ?? process.cwd());
  emit(commandResult(command, options, root), options.json === true);
} catch (error) {
  const code = error instanceof LearningError ? error.code : "UNEXPECTED_ERROR";
  process.stderr.write(`[${code}] ${error.message}\n`);
  process.exit(1);
}
