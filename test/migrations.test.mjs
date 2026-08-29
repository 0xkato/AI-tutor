import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  conceptIdForV1,
  migrateV1ToV2,
  migrateV2ToV3,
  migrateV3ToV4,
  migrateV4ToV5,
  migrateV5ToV6,
} from "../src/migrations.mjs";
import { pathsFor, readState } from "../src/store.mjs";

const CREATED = "2026-08-20T08:00:00.000Z";
const COMPLETED = "2026-08-20T09:00:00.000Z";
const DUE = "2026-08-22T09:00:00.000Z";

function versionOneFixture() {
  return {
    schemaVersion: 1,
    createdAt: CREATED,
    updatedAt: COMPLETED,
    activeSessionId: null,
    settings: { vaultDir: "vault" },
    sessions: {
      s1: {
        id: "s1",
        topic: "Optimization",
        target: "Understand gradient descent",
        learnerContext: "Knows derivatives",
        phase: "complete",
        createdAt: CREATED,
        updatedAt: COMPLETED,
        completedAt: COMPLETED,
        probeSummary: "The derivative foundation is present.",
        assessments: [
          {
            id: "a1",
            questionId: "q1",
            nodeId: "gradient",
            stage: "teach",
            kind: "transfer",
            question: "Predict the update direction.",
            answer: "Move opposite the local increase.",
            grade: "correct",
            evidence: "Correctly connected the derivative sign to the update direction.",
            mistakeType: "",
            contaminated: false,
            createdAt: COMPLETED,
          },
        ],
        knowledge: {
          gradient: {
            nodeId: "gradient",
            status: "developing",
            evidence: ["a1"],
            latestGrade: "correct",
            retry: null,
            review: { level: 1, dueAt: DUE, completed: 1 },
          },
        },
        sources: [],
        plan: {
          targetNodeId: "gradient",
          nodes: [{ id: "gradient", title: "Gradient direction" }],
          edges: [],
        },
        frontier: [],
        steps: [],
        activeStepId: null,
        visuals: [
          {
            id: "visual-1",
            path: "Assets/gradient.svg",
            description: "A local slope diagram.",
            verification: "The learner inspected the axes and arrow direction.",
            createdAt: COMPLETED,
          },
        ],
        synthesis: "The gradient is a local increase direction.",
        unresolvedGaps: [],
      },
    },
    topics: {
      Optimization: {
        topic: "Optimization",
        latestSessionId: "s1",
        updatedAt: COMPLETED,
      },
    },
    reviewCount: 1,
  };
}

test("migrateV1ToV2 deterministically preserves sessions, evidence, and due review", () => {
  const original = versionOneFixture();
  const first = migrateV1ToV2(original);
  const second = migrateV1ToV2(original);
  const conceptId = conceptIdForV1("s1", "gradient");

  assert.deepEqual(first, second);
  assert.equal(first.schemaVersion, 2);
  assert.equal(first.sessions.s1.target, original.sessions.s1.target);
  assert.deepEqual(first.sessions.s1.assessments, [
    { ...original.sessions.s1.assessments[0], conceptId },
  ]);
  assert.deepEqual(first.concepts[conceptId].evidenceIds, ["a1"]);
  assert.equal(first.reviews[first.concepts[conceptId].reviewId].dueAt, DUE);
  assert.deepEqual(first.sessions.s1.visuals[0], {
    ...original.sessions.s1.visuals[0],
    identityStatus: "legacy-unverified",
    bytes: null,
    mediaType: null,
    sha256: null,
  });
  assert.deepEqual(original, versionOneFixture(), "migration must not mutate version 1");
});

test("readState backs up and migrates version-1 state before returning it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-migrate-"));
  const paths = pathsFor(root);
  fs.mkdirSync(paths.dataDir, { recursive: true });
  fs.writeFileSync(paths.state, `${JSON.stringify(versionOneFixture(), null, 2)}\n`);

  const state = readState(root);

  assert.equal(state.schemaVersion, 6);
  assert.equal(JSON.parse(fs.readFileSync(paths.state, "utf8")).schemaVersion, 6);
  const backups = fs.readdirSync(paths.backups);
  assert.equal(backups.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(paths.backups, backups[0]), "utf8")).schemaVersion, 1);
});

test("migrateV2ToV3 deterministically adds empty interaction collections", () => {
  const versionTwo = migrateV1ToV2(versionOneFixture());

  const first = migrateV2ToV3(versionTwo);
  const second = migrateV2ToV3(versionTwo);

  assert.deepEqual(first, second);
  assert.equal(first.schemaVersion, 3);
  assert.deepEqual(first.sessions.s1.questions, []);
  assert.deepEqual(first.sessions.s1.notes, []);
  assert.deepEqual(versionTwo, migrateV1ToV2(versionOneFixture()), "migration must not mutate version 2");
});

test("migrateV3ToV4 deterministically adds an empty cross-session learner profile", () => {
  const versionThree = migrateV2ToV3(migrateV1ToV2(versionOneFixture()));

  const first = migrateV3ToV4(versionThree);
  const second = migrateV3ToV4(versionThree);

  assert.deepEqual(first, second);
  assert.equal(first.schemaVersion, 4);
  assert.deepEqual(first.learnerProfile, {
    teachingPhilosophy: "",
    explanationPreferences: "",
    feedbackPreferences: "",
    visualPreferences: "",
    sourcePreferences: "",
    updatedAt: null,
  });
  assert.deepEqual(
    versionThree,
    migrateV2ToV3(migrateV1ToV2(versionOneFixture())),
    "migration must not mutate version 3",
  );
});

test("migrateV4ToV5 deterministically adds source-guided provenance fields", () => {
  const versionFour = migrateV3ToV4(migrateV2ToV3(migrateV1ToV2(versionOneFixture())));
  versionFour.sessions.s1.sources = [{
    id: "source-1",
    title: "Optimization text",
    url: "https://example.test/optimization",
    sourceClass: "secondary",
    supports: "A local description of gradient descent.",
    verification: "Checked the cited section against the stored session claim.",
    createdAt: COMPLETED,
  }];

  const first = migrateV4ToV5(versionFour);
  const second = migrateV4ToV5(versionFour);

  assert.deepEqual(first, second);
  assert.equal(first.schemaVersion, 5);
  assert.deepEqual(first.sessions.s1.materials, []);
  assert.deepEqual(first.sessions.s1.sourceCoverage, []);
  assert.deepEqual(first.sessions.s1.sourceGuidance, {
    mode: "open",
    reason: null,
    updatedAt: first.sessions.s1.updatedAt,
    history: [],
  });
  assert.deepEqual(first.sessions.s1.sources[0], {
    ...versionFour.sessions.s1.sources[0],
    role: "supplemental",
    locator: "Whole source",
    materialId: null,
  });
  assert.equal(versionFour.schemaVersion, 4, "migration must not mutate version 4");
  assert.equal("role" in versionFour.sessions.s1.sources[0], false);
});

test("migrateV5ToV6 deterministically derives adaptive evidence without losing assessments", () => {
  const versionFive = migrateV4ToV5(
    migrateV3ToV4(migrateV2ToV3(migrateV1ToV2(versionOneFixture()))),
  );

  const first = migrateV5ToV6(versionFive);
  const second = migrateV5ToV6(versionFive);
  const conceptId = conceptIdForV1("s1", "gradient");
  const concept = first.concepts[conceptId];
  const review = first.reviews[concept.reviewId];

  assert.deepEqual(first, second);
  assert.equal(first.schemaVersion, 6);
  assert.deepEqual(first.misconceptions, {});
  assert.deepEqual(first.sessions.s1.activityHistory, []);
  assert.deepEqual(first.sessions.s1.productiveAttempts, []);
  assert.equal(concept.mastery.application.level, 2);
  assert.deepEqual(concept.mastery.application.evidenceIds, ["a1"]);
  assert.equal(concept.highestTransferLevel, 1);
  assert.equal(concept.supportLevel, 2);
  assert.deepEqual(concept.misconceptionIds, []);
  assert.deepEqual(review.history, []);
  assert.equal(review.stabilityDays, 0);
  assert.equal(review.difficulty, 50);
  assert.equal(review.lapses, 0);
  assert.equal(versionFive.schemaVersion, 5, "migration must not mutate version 5");
});

test("readState backs up and migrates version-4 state before returning it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-migrate-v4-"));
  const paths = pathsFor(root);
  const versionFour = migrateV3ToV4(migrateV2ToV3(migrateV1ToV2(versionOneFixture())));
  fs.mkdirSync(paths.dataDir, { recursive: true });
  fs.writeFileSync(paths.state, `${JSON.stringify(versionFour, null, 2)}\n`);

  const state = readState(root);

  assert.equal(state.schemaVersion, 6);
  assert.deepEqual(state.sessions.s1.materials, []);
  assert.deepEqual(state.sessions.s1.sourceCoverage, []);
  assert.equal(state.sessions.s1.sourceGuidance.mode, "open");
  const backups = fs.readdirSync(paths.backups);
  assert.equal(backups.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(paths.backups, backups[0]), "utf8")).schemaVersion, 4);
});

test("readState backs up and migrates version-2 state before returning it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-migrate-v2-"));
  const paths = pathsFor(root);
  const versionTwo = migrateV1ToV2(versionOneFixture());
  fs.mkdirSync(paths.dataDir, { recursive: true });
  fs.writeFileSync(paths.state, `${JSON.stringify(versionTwo, null, 2)}\n`);

  const state = readState(root);

  assert.equal(state.schemaVersion, 6);
  assert.deepEqual(state.sessions.s1.questions, []);
  assert.deepEqual(state.sessions.s1.notes, []);
  const backups = fs.readdirSync(paths.backups);
  assert.equal(backups.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(paths.backups, backups[0]), "utf8")).schemaVersion, 2);
});

test("readState backs up and migrates version-3 state before returning it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-migrate-v3-"));
  const paths = pathsFor(root);
  const versionThree = migrateV2ToV3(migrateV1ToV2(versionOneFixture()));
  fs.mkdirSync(paths.dataDir, { recursive: true });
  fs.writeFileSync(paths.state, `${JSON.stringify(versionThree, null, 2)}\n`);

  const state = readState(root);

  assert.equal(state.schemaVersion, 6);
  assert.deepEqual(state.learnerProfile, {
    teachingPhilosophy: "",
    explanationPreferences: "",
    feedbackPreferences: "",
    visualPreferences: "",
    sourcePreferences: "",
    updatedAt: null,
  });
  const backups = fs.readdirSync(paths.backups);
  assert.equal(backups.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(paths.backups, backups[0]), "utf8")).schemaVersion, 3);
});
