import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createInitialState } from "../src/model.mjs";
import { renderSessionNote, renderVault, slugify } from "../src/render.mjs";

const state = createInitialState({ now: "2026-08-24T08:00:00.000Z" });
state.sessions.s1 = {
  id: "s1",
  topic: "Differential Forms",
  target: "Build a causal introduction",
  learnerContext: "Knows basic calculus",
  phase: "teach",
  createdAt: "2026-08-24T08:00:00.000Z",
  updatedAt: "2026-08-24T09:00:00.000Z",
  completedAt: null,
  probeSummary: "Vectors are understood; covectors are the edge.",
  knowledge: { vectors: { status: "developing", review: { level: 1, dueAt: "2026-08-25T08:00:00.000Z" } } },
  assessments: [
    {
      id: "a1",
      nodeId: "vectors",
      kind: "explanation",
      grade: "correct",
      evidence: "Explained vector addition and scalar multiplication causally.",
      contaminated: false,
    },
  ],
  sources: [
    {
      title: "Primary reference",
      url: "https://example.test/reference",
      sourceClass: "primary",
      supports: "Definition of a covector",
      verification: "Checked the definition against a second textbook.",
    },
  ],
  plan: {
    targetNodeId: "forms",
    nodes: [
      { id: "vectors", title: "Vectors" },
      { id: "forms", title: "Differential forms" },
    ],
    edges: [{ from: "vectors", to: "forms", reason: "Generalization" }],
  },
  steps: [
    {
      id: "step-1",
      nodeId: "forms",
      foundation: "A linear functional is defined by linearity.",
      motivation: "We need an object that measures a directed displacement.",
      explanation: "A covector accepts a vector and returns a scalar.",
      checkpointQuestion: "What does a covector consume and produce?",
    },
  ],
  visuals: [
    {
      path: "Assets/covector.svg",
      description: "Level sets and a vector",
      verification: "Labels and orientation inspected against the explanation.",
    },
  ],
  synthesis: "",
  unresolvedGaps: [],
};
state.activeSessionId = "s1";

test("slugify prevents path traversal and produces stable note names", () => {
  assert.equal(slugify("../Differential Forms"), "differential-forms");
  assert.doesNotMatch(slugify("../../escape"), /\.\.|\//);
});

test("renderSessionNote contains the complete inspectable learning record", () => {
  const note = renderSessionNote(state.sessions.s1);
  for (const expected of [
    "# Differential Forms",
    "Build a causal introduction",
    "Vectors are understood; covectors are the edge.",
    "```mermaid",
    "Definition of a covector",
    "## Teaching steps",
    "A linear functional is defined by linearity.",
    "Correct",
    "![[Assets/covector.svg]]",
    "2026-08-25T08:00:00.000Z",
  ]) {
    assert.match(note, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("renderVault writes home, session, topic, and review notes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-vault-"));
  renderVault(root, state);

  const vault = path.join(root, "vault");
  assert.equal(fs.existsSync(path.join(vault, "Home.md")), true);
  assert.equal(fs.existsSync(path.join(vault, "Sessions", "differential-forms-s1.md")), true);
  assert.equal(fs.existsSync(path.join(vault, "Topics", "differential-forms.md")), true);
  assert.equal(fs.existsSync(path.join(vault, "Reviews.md")), true);
  assert.match(fs.readFileSync(path.join(vault, "Home.md"), "utf8"), /Differential Forms/);
});
