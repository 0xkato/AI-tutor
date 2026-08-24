import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { conceptIdForV1, migrateV1ToV2 } from "../src/migrations.mjs";
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
        visuals: [],
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
  assert.deepEqual(first.sessions.s1.assessments, original.sessions.s1.assessments);
  assert.deepEqual(first.concepts[conceptId].evidenceIds, ["a1"]);
  assert.equal(first.reviews[first.concepts[conceptId].reviewId].dueAt, DUE);
  assert.deepEqual(original, versionOneFixture(), "migration must not mutate version 1");
});

test("readState backs up and migrates version-1 state before returning it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-migrate-"));
  const paths = pathsFor(root);
  fs.mkdirSync(paths.dataDir, { recursive: true });
  fs.writeFileSync(paths.state, `${JSON.stringify(versionOneFixture(), null, 2)}\n`);

  const state = readState(root);

  assert.equal(state.schemaVersion, 2);
  assert.equal(JSON.parse(fs.readFileSync(paths.state, "utf8")).schemaVersion, 2);
  const backups = fs.readdirSync(paths.backups);
  assert.equal(backups.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(paths.backups, backups[0]), "utf8")).schemaVersion, 1);
});
