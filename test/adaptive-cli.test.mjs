import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readState, writeState } from "../src/store.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repository, "bin", "learn.mjs");
const T0 = "2026-08-29T08:00:00.000Z";

function invoke(root, command, args = []) {
  const result = spawnSync(process.execPath, [cli, command, ...args, "--root", root, "--json"], {
    cwd: repository,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function plannedRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-strategy-cli-"));
  invoke(root, "init", ["--now", T0]);
  invoke(root, "start", [
    "--id", "session-1",
    "--topic-id", "topic-1",
    "--topic", "Transformers",
    "--target", "Understand contextual token representations",
    "--now", T0,
  ]);
  invoke(root, "record-probe", [
    "--id", "probe-a1",
    "--question-id", "probe-q1",
    "--node", "attention",
    "--kind", "explanation",
    "--question", "What changes when a token becomes contextual?",
    "--answer", "Its hidden representation changes using surrounding tokens.",
    "--grade", "correct",
    "--evidence", "The answer distinguishes the stable token identity from its contextual hidden representation.",
    "--now", T0,
  ]);
  invoke(root, "finish-probe", ["--summary", "The representation distinction is usable.", "--now", T0]);
  const plan = path.join(root, "plan.json");
  fs.writeFileSync(plan, JSON.stringify({
    targetNodeId: "attention",
    nodes: [{ id: "attention", title: "Contextual token representations" }],
    edges: [],
  }));
  invoke(root, "set-plan", ["--file", plan, "--now", T0]);
  return root;
}

test("recommend-next exposes the persisted learner-specific activity decision", () => {
  const root = plannedRoot();
  const result = invoke(root, "recommend-next", ["--node", "attention"]);

  assert.equal(result.nodeId, "attention");
  assert.equal(result.type, "faded-example");
  assert.equal(typeof result.reason, "string");
  assert.equal(Number.isInteger(result.supportLevel), true);
});

test("practice-plan exposes an interleaved due-review queue", () => {
  const root = plannedRoot();
  const state = readState(root);
  const concept = Object.values(state.concepts).find((item) => item.key === "attention");
  Object.assign(state.reviews[concept.reviewId], {
    dueAt: "2026-08-30T08:00:00.000Z",
    status: "scheduled",
    updatedAt: T0,
  });
  writeState(root, state);
  const result = invoke(root, "practice-plan", ["--now", "2026-09-30T08:00:00.000Z"]);

  assert.ok(Array.isArray(result.items));
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].position, 1);
  assert.match(result.items[0].activityType, /review/);
  assert.equal(typeof result.synthesisDue, "boolean");
});
