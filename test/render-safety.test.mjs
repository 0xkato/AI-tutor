import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { mermaidForPlan } from "../src/graph.mjs";
import {
  headingText,
  listValue,
  markdownLink,
  mermaidLabel,
  obsidianEmbed,
  obsidianLink,
  plainParagraph,
} from "../src/markdown.mjs";
import { createInitialState } from "../src/model.mjs";
import { renderSessionNote, renderVault } from "../src/render.mjs";

function maliciousSession() {
  return {
    id: "session-1",
    kind: "learn",
    topic: "Safe title\n# Injected heading",
    topicId: "topic-1",
    target: "Target\n- injected list",
    learnerContext: "Context <script>alert(1)</script>",
    phase: "teach",
    createdAt: "2026-08-24T08:00:00.000Z",
    updatedAt: "2026-08-24T08:00:00.000Z",
    completedAt: null,
    probeSummary: "Summary\n```evil",
    conceptIds: [],
    assessments: [],
    sources: [],
    plan: {
      targetNodeId: "target-->outside",
      nodes: [
        { id: "start[bad]", title: "Start | bad\nline" },
        { id: "target-->outside", title: "Target \"quoted\"" },
      ],
      edges: [{ from: "start[bad]", to: "target-->outside", reason: "why | now" }],
    },
    frontier: [],
    steps: [],
    activeStepId: null,
    checkpoint: null,
    visuals: [
      {
        id: "visual-1",
        path: "Assets/diagram]]\n# Injected.png",
        description: "diagram",
        verification: "inspected",
        createdAt: "2026-08-24T08:00:00.000Z",
      },
    ],
    synthesis: "",
    synthesisRequired: false,
    unresolvedGaps: [],
    reviewItems: [],
  };
}

test("Markdown helpers neutralize their specific structural contexts", () => {
  assert.doesNotMatch(headingText("Title\n# injected"), /\n/);
  assert.doesNotMatch(plainParagraph("Text\n- injected"), /\n/);
  assert.doesNotMatch(plainParagraph("# injected heading"), /^#/);
  assert.doesNotMatch(plainParagraph("- injected list"), /^-/);
  assert.doesNotMatch(plainParagraph("1. injected list"), /^1\./);
  assert.match(listValue("[label](bad)"), /\\\[label\\\]/);
  assert.doesNotMatch(markdownLink("bad] label", "https://example.test/a_(b)"), /\]\(bad/);
  assert.doesNotMatch(obsidianEmbed("Assets/x]]|alias#heading.png"), /\]\].*\]\]/);
  assert.match(obsidianLink("Sessions/safe", "bad|alias"), /bad&#124;alias/);
  assert.doesNotMatch(mermaidLabel("x\"|\nend"), /\n|\|/);
});

test("rendering rejects dangling symlinks before staging any generated files", (t) => {
  if (process.platform === "win32") t.skip("symlink permissions differ on Windows");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-render-dangling-"));
  const state = createInitialState({ now: "2026-08-24T08:00:00.000Z" });
  const session = maliciousSession();
  session.topic = "Safe title";
  session.target = "Safe target";
  session.learnerContext = "Safe context";
  session.probeSummary = "Safe summary";
  session.visuals = [];
  state.sessions[session.id] = session;
  fs.mkdirSync(path.join(root, "vault"), { recursive: true });
  fs.symlinkSync(path.join(root, "missing-target"), path.join(root, "vault", "Sessions"));

  assert.throws(
    () => renderVault(root, state),
    (error) => error.code === "SYMLINK_TRAVERSAL",
  );
  assert.equal(fs.existsSync(path.join(root, ".adaptive-learning", "render-pending.json")), false);
});

test("Mermaid uses generated node identifiers instead of plan identifiers", () => {
  const diagram = mermaidForPlan(maliciousSession().plan);

  assert.match(diagram, /n0\["/);
  assert.match(diagram, /n0 -->\|"why &#124; now"\| n1/);
  assert.match(diagram, /class n1 target/);
  assert.doesNotMatch(diagram, /start\[bad\]|target-->outside/);
});

test("rendered notes cannot create headings, lists, embeds, or Mermaid edges from input", () => {
  const state = createInitialState({ now: "2026-08-24T08:00:00.000Z" });
  const session = maliciousSession();
  const note = renderSessionNote(state, session);

  assert.doesNotMatch(note, /\n# Injected heading/);
  assert.doesNotMatch(note, /\n- injected list/);
  assert.doesNotMatch(note, /\n```evil/);
  assert.doesNotMatch(note, /start\[bad\]|target-->outside/);
  assert.doesNotMatch(note, /!\[\[Assets\/diagram\]\]/);
});

test("rendering rejects symlink traversal and creates generated notes owner-only", (t) => {
  if (process.platform === "win32") t.skip("symlink permissions differ on Windows");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-render-safety-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-render-outside-"));
  const state = createInitialState({ now: "2026-08-24T08:00:00.000Z" });
  const session = maliciousSession();
  session.topic = "Safe title";
  session.target = "Safe target";
  session.learnerContext = "Safe context";
  session.probeSummary = "Safe summary";
  session.visuals = [];
  state.sessions[session.id] = session;
  fs.mkdirSync(path.join(root, "vault"), { recursive: true });
  fs.symlinkSync(outside, path.join(root, "vault", "Sessions"));

  assert.throws(
    () => renderVault(root, state),
    (error) => error.code === "SYMLINK_TRAVERSAL",
  );
  assert.deepEqual(fs.readdirSync(outside), []);

  fs.unlinkSync(path.join(root, "vault", "Sessions"));
  renderVault(root, state);
  assert.equal(fs.statSync(path.join(root, "vault", "Home.md")).mode & 0o077, 0);
});
