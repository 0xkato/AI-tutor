import assert from "node:assert/strict";
import test from "node:test";

import { createInitialState, startSession } from "../src/model.mjs";
import { parseInstant, validateState } from "../src/schema.mjs";

const NOW = "2026-08-24T08:00:00.000Z";

test("parseInstant accepts only canonical ISO instants", () => {
  assert.equal(parseInstant(NOW, "now"), NOW);
  for (const value of [
    "2026-08-24",
    "2026-08-24T08:00:00Z",
    "2026-08-24T10:00:00.000+02:00",
    "not-a-date",
  ]) {
    assert.throws(
      () => parseInstant(value, "now"),
      (error) => error.code === "INVALID_INSTANT" && /now/.test(error.message),
    );
  }
});

test("validateState accepts and clones a complete version-5 initial state with a learner profile", () => {
  const state = createInitialState({ now: NOW });
  const validated = validateState(state);

  assert.deepEqual(validated, state);
  assert.notEqual(validated, state);
  assert.equal(validated.schemaVersion, 5);
  assert.deepEqual(validated.learnerProfile, {
    teachingPhilosophy: "",
    explanationPreferences: "",
    feedbackPreferences: "",
    visualPreferences: "",
    sourcePreferences: "",
    updatedAt: null,
  });
});

test("validateState additively upgrades sessions created before later session fields", () => {
  let state = createInitialState({ now: NOW });
  state = startSession(state, {
    id: "legacy-v2-session",
    topicId: "legacy-v2-topic",
    topic: "Durable recovery",
    target: "Explain recovery from durable state",
    now: NOW,
  });
  delete state.sessions["legacy-v2-session"].synthesisRequired;
  delete state.sessions["legacy-v2-session"].synthesisCheckpoint;
  delete state.sessions["legacy-v2-session"].admittedGaps;
  delete state.sessions["legacy-v2-session"].questions;
  delete state.sessions["legacy-v2-session"].notes;
  delete state.sessions["legacy-v2-session"].materials;
  delete state.sessions["legacy-v2-session"].sourceCoverage;
  delete state.sessions["legacy-v2-session"].sourceGuidance;

  const validated = validateState(state);
  assert.equal(validated.sessions["legacy-v2-session"].synthesisRequired, false);
  assert.equal(validated.sessions["legacy-v2-session"].synthesisCheckpoint, null);
  assert.deepEqual(validated.sessions["legacy-v2-session"].admittedGaps, []);
  assert.deepEqual(validated.sessions["legacy-v2-session"].checkpointGaps, []);
  assert.deepEqual(validated.sessions["legacy-v2-session"].questions, []);
  assert.deepEqual(validated.sessions["legacy-v2-session"].notes, []);
  assert.deepEqual(validated.sessions["legacy-v2-session"].materials, []);
  assert.deepEqual(validated.sessions["legacy-v2-session"].sourceCoverage, []);
  assert.deepEqual(validated.sessions["legacy-v2-session"].sourceGuidance, {
    mode: "open",
    reason: null,
    updatedAt: NOW,
    history: [],
  });
});

test("validateState defaults source guidance to anchored when materials already exist", () => {
  let state = createInitialState({ now: NOW });
  state = startSession(state, {
    id: "guided-session",
    topic: "Transformers",
    target: "Understand attention",
    materials: [{ id: "material-1", reference: "local:notes/attention.md" }],
    now: NOW,
  });
  delete state.sessions["guided-session"].sourceGuidance;

  const validated = validateState(state);
  assert.deepEqual(validated.sessions["guided-session"].sourceGuidance, {
    mode: "anchored",
    reason: null,
    updatedAt: NOW,
    history: [],
  });
});

test("validateState rejects structurally incomplete version-5 state", () => {
  assert.throws(
    () => validateState({ schemaVersion: 5, sessions: {} }),
    (error) => error.code === "INVALID_STATE" && /createdAt/.test(error.message),
  );
});

test("validateState rejects a missing or malformed learner profile", () => {
  const missing = createInitialState({ now: NOW });
  delete missing.learnerProfile;
  assert.throws(
    () => validateState(missing),
    (error) => error.code === "INVALID_STATE" && /learnerProfile/.test(error.message),
  );

  const malformed = createInitialState({ now: NOW });
  malformed.learnerProfile.teachingPhilosophy = 42;
  assert.throws(
    () => validateState(malformed),
    (error) => error.code === "INVALID_STATE" && /teachingPhilosophy/.test(error.message),
  );
});

test("validateState rejects unsafe vault directories", () => {
  for (const vaultDir of ["/tmp/vault", "../vault", ".", "nested/../vault", "nested\\vault"]) {
    const state = createInitialState({ now: NOW });
    state.settings.vaultDir = vaultDir;

    assert.throws(
      () => validateState(state),
      (error) => error.code === "INVALID_STATE" && /settings\.vaultDir/.test(error.message),
    );
  }
});

test("validateState rejects an active session reference that does not exist", () => {
  const state = createInitialState({ now: NOW });
  state.activeSessionId = "missing";

  assert.throws(
    () => validateState(state),
    (error) => error.code === "INVALID_STATE" && /activeSessionId/.test(error.message),
  );
});

test("validateState rejects unsupported future versions", () => {
  const state = createInitialState({ now: NOW });
  state.schemaVersion = 999;

  assert.throws(
    () => validateState(state),
    (error) => error.code === "UNSUPPORTED_SCHEMA",
  );
});
