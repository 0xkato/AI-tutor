import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readState } from "../src/store.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repository, "bin", "learn.mjs");
const T0 = "2026-08-25T08:00:00.000Z";
const T1 = "2026-08-25T08:01:00.000Z";
const T2 = "2026-08-25T08:02:00.000Z";

function invoke(root, command, args = []) {
  return spawnSync(process.execPath, [cli, command, ...args, "--root", root, "--json"], {
    cwd: repository,
    encoding: "utf8",
  });
}

function payload(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function initializedRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-question-cli-"));
  payload(invoke(root, "init", ["--now", T0]));
  payload(invoke(root, "start", [
    "--id", "session-1",
    "--topic-id", "topic-1",
    "--topic", "Transformers",
    "--target", "Understand how Transformers process tokens",
    "--now", T0,
  ]));
  return root;
}

function questionArgs() {
  return [
    "--id", "probe-q1",
    "--stage", "probe",
    "--node", "attention",
    "--kind", "multiple-choice",
    "--question", "What does self-attention change for one token?",
    "--mode", "single-select",
    "--choice", JSON.stringify({ value: "position", label: "Only its position number" }),
    "--choice", JSON.stringify({ value: "context", label: "Its representation using other tokens" }),
    "--correct", "context",
    "--explanation", "Self-attention mixes information from other token representations.",
    "--now", T1,
  ];
}

test("CLI persists a question and redacts its key from pending and context output", () => {
  const root = initializedRoot();

  const started = payload(invoke(root, "start-question", questionArgs()));
  assert.equal(started.active.question.status, "awaiting-answer");
  assert.equal("correctChoiceValues" in started.active.question, false);
  assert.equal("explanation" in started.active.question, false);

  const pending = payload(invoke(root, "pending-question"));
  assert.equal(pending.question.id, "probe-q1");
  assert.equal("correctChoiceValues" in pending.question, false);
  assert.equal("explanation" in pending.question, false);

  const context = payload(invoke(root, "context"));
  assert.equal("correctChoiceValues" in context.session.questions[0], false);
  assert.equal("explanation" in context.session.questions[0], false);

  const stored = readState(root).sessions["session-1"].questions[0];
  assert.deepEqual(stored.correctChoiceValues, ["context"]);
  assert.match(stored.explanation, /mixes information/);
});

test("CLI records the selected value and optional note before assessment", () => {
  const root = initializedRoot();
  payload(invoke(root, "start-question", questionArgs()));

  const answered = payload(invoke(root, "answer-question", [
    "--question-id", "probe-q1",
    "--response-id", "response-1",
    "--selected", "context",
    "--note-id", "note-1",
    "--note", "This is where the token representation becomes contextual.",
    "--now", T2,
  ]));

  assert.equal(answered.active.question.status, "awaiting-assessment");
  assert.equal(answered.active.question.responses[0].correct, true);
  assert.equal("correctChoiceValues" in answered.active.question, false);
  const state = readState(root);
  assert.equal(state.sessions["session-1"].notes[0].body, "This is where the token representation becomes contextual.");

  const second = invoke(root, "start-question", [
    ...questionArgs().map((value) => value === "probe-q1" ? "probe-q2" : value),
    "--parent-question-id", "probe-q1",
    "--adaptation-reason", "Correct; test a harder boundary.",
  ]);
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /QUESTION_PENDING/);
});

test("CLI atomically submits a choice, note, and deterministic assessment", () => {
  const root = initializedRoot();
  payload(invoke(root, "start-question", questionArgs()));
  const before = readState(root);

  const submitted = payload(invoke(root, "submit-question", [
    "--question-id", "probe-q1",
    "--response-id", "response-atomic",
    "--selected", "context",
    "--note-id", "note-atomic",
    "--note", "This is where the token representation becomes contextual.",
    "--outcome-id", "assessment-atomic",
    "--now", T2,
  ]));

  assert.equal(submitted.active.question.status, "resolved");
  const state = readState(root);
  assert.equal(state.revision, before.revision + 1);
  assert.equal(state.sessions["session-1"].questions[0].responses[0].assessmentId, "assessment-atomic");
  assert.equal(state.sessions["session-1"].notes[0].id, "note-atomic");
  assert.equal(state.sessions["session-1"].assessments[0].id, "assessment-atomic");
});

test("CLI atomically submits a free-response I don't know and its admitted gap", () => {
  const root = initializedRoot();
  payload(invoke(root, "start-question", [
    "--id", "probe-free-gap",
    "--stage", "probe",
    "--node", "contextual-representation",
    "--kind", "explanation",
    "--question", "Why is a fixed token embedding not the final representation?",
    "--mode", "free-response",
    "--now", T1,
  ]));
  const before = readState(root);

  const submitted = payload(invoke(root, "submit-question", [
    "--question-id", "probe-free-gap",
    "--response-id", "response-free-gap",
    "--dont-know",
    "--note-id", "note-free-gap",
    "--note", "I do not yet understand how context changes the representation.",
    "--outcome-id", "gap-free-atomic",
    "--now", T2,
  ]));

  assert.equal(submitted.active.question.status, "gap");
  const state = readState(root);
  assert.equal(state.revision, before.revision + 1);
  const session = state.sessions["session-1"];
  assert.equal(session.questions[0].responses[0].dontKnow, true);
  assert.equal(session.admittedGaps[0].id, "gap-free-atomic");
  assert.equal(session.assessments.length, 0);
  assert.equal(session.notes[0].id, "note-free-gap");
});

test("CLI supports I don't know, cancellation, and generic learner notes", () => {
  const gapRoot = initializedRoot();
  payload(invoke(gapRoot, "start-question", questionArgs()));
  const gap = payload(invoke(gapRoot, "answer-question", [
    "--question-id", "probe-q1",
    "--response-id", "response-gap",
    "--dont-know",
    "--note-id", "note-gap",
    "--note", "I need the representation part explained first.",
    "--now", T2,
  ]));
  assert.equal(gap.active.question.status, "gap");
  assert.equal(gap.active.question.responses[0].dontKnow, true);

  const note = payload(invoke(gapRoot, "add-note", [
    "--id", "session-note",
    "--target-type", "session",
    "--target-id", "session-1",
    "--body", "Return to query, key, and value roles later.",
    "--now", T2,
  ]));
  assert.equal(note.active.noteCount, 2);

  const cancelledRoot = initializedRoot();
  payload(invoke(cancelledRoot, "start-question", questionArgs()));
  const cancelled = payload(invoke(cancelledRoot, "cancel-question", [
    "--question-id", "probe-q1",
    "--now", T2,
  ]));
  assert.equal(cancelled.active.question.status, "cancelled");
  assert.equal(payload(invoke(cancelledRoot, "pending-question")).question, null);
});

test("question commands reject malformed choices and unsupported options", () => {
  const root = initializedRoot();
  const malformed = invoke(root, "start-question", [
    "--id", "probe-q1",
    "--stage", "probe",
    "--node", "attention",
    "--kind", "multiple-choice",
    "--question", "Question?",
    "--mode", "single-select",
    "--choice", "not-json",
    "--correct", "a",
    "--explanation", "Explanation.",
  ]);
  assert.notEqual(malformed.status, 0);
  assert.match(malformed.stderr, /INVALID_CHOICE/);

  const unknown = invoke(root, "answer-question", ["--unsupported-answer", "A"]);
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /Unknown option/);
});

test("CLI persists a free response, confidence, timing, strategy, and misconception assessment", () => {
  const root = initializedRoot();
  payload(invoke(root, "start-question", [
    "--id", "probe-free-1",
    "--stage", "probe",
    "--node", "attention",
    "--kind", "explanation",
    "--question", "Why can identical token IDs become contextually different?",
    "--mode", "free-response",
    "--activity-type", "contrastive-case",
    "--strategy-reason", "Contrast identical embeddings with contextual representations.",
    "--support-level", "1",
    "--transfer-level", "2",
    "--now", T1,
  ]));

  const answered = payload(invoke(root, "answer-question", [
    "--question-id", "probe-free-1",
    "--response-id", "response-free-1",
    "--text-answer", "Attention changes the token ID itself.",
    "--confidence", "88",
    "--response-time-ms", "42000",
    "--note-id", "note-free-1",
    "--note", "I am unsure whether the ID or representation changes.",
    "--now", T2,
  ]));
  assert.equal(answered.active.question.status, "awaiting-assessment");
  assert.equal(answered.active.question.responses[0].textAnswer, "Attention changes the token ID itself.");
  assert.equal(answered.active.question.responses[0].confidence, 88);
  assert.equal(answered.active.question.responses[0].responseTimeMs, 42000);

  payload(invoke(root, "record-assessment", [
    "--id", "assessment-free-1",
    "--question-id", "probe-free-1",
    "--node", "attention",
    "--stage", "probe",
    "--kind", "explanation",
    "--question", "Why can identical token IDs become contextually different?",
    "--answer", "Attention changes the token ID itself.",
    "--grade", "incorrect",
    "--evidence", "The answer changes the token identity instead of the contextual representation.",
    "--mistake-type", "identity-versus-representation",
    "--misconception-id", "misconception-token-id",
    "--misconception-statement", "Attention changes token IDs rather than contextual representations.",
    "--counterexample", "The token ID stays fixed while hidden states differ across contexts.",
    "--repair", "Separate immutable input identity from context-dependent hidden state.",
    "--now", T2,
  ]));

  const state = readState(root);
  const stored = state.sessions["session-1"].questions[0];
  const assessment = state.sessions["session-1"].assessments[0];
  assert.equal(stored.activityType, "contrastive-case");
  assert.equal(stored.strategyReason, "Contrast identical embeddings with contextual representations.");
  assert.equal(assessment.confidence, 88);
  assert.equal(assessment.responseTimeMs, 42000);
  assert.equal(assessment.transferLevel, 2);
  assert.equal(assessment.supportLevel, 1);
  assert.deepEqual(assessment.misconceptionIds, ["misconception-token-id"]);
  assert.equal(state.misconceptions["misconception-token-id"].status, "active");
});
