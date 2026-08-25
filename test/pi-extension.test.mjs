import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createAdaptiveLearningExtension,
  runAdaptiveLearningCli,
} from "../.pi/extensions/adaptive-learning.js";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function harness(responses = {}) {
  const commands = new Map();
  const tools = new Map();
  const messages = [];
  const notifications = [];
  const calls = [];
  const pi = {
    registerCommand(name, command) {
      commands.set(name, command);
    },
    registerTool(tool) {
      tools.set(tool.name, tool);
    },
    sendUserMessage(message, options) {
      messages.push({ message, options });
    },
  };
  const ctx = {
    cwd: "/tmp/adaptive-learning-root",
    isIdle: () => true,
    ui: {
      notify(message, level = "info") {
        notifications.push({ message, level });
      },
    },
  };
  const runCli = (command, args, root) => {
    calls.push({ command, args, root });
    const value = responses[command];
    return typeof value === "function" ? value({ command, args, root, calls }) : value;
  };
  createAdaptiveLearningExtension({ runCli })(pi);
  return { commands, tools, messages, notifications, calls, ctx };
}

test("Pi extension registers the chat-first learning commands", () => {
  const { commands, tools } = harness();
  assert.deepEqual([...commands.keys()], ["teach", "learn-profile", "learn-status", "learn-review"]);
  for (const command of commands.values()) {
    assert.equal(typeof command.description, "string");
    assert.equal(typeof command.handler, "function");
  }
  assert.equal(tools.has("adaptive_learning_quiz"), true);
});

test("/teach creates a new learner-owned target and expands the shared skill", async () => {
  const state = { active: null };
  const h = harness({
    status: () => state,
    init: () => ({ active: null }),
    start: ({ args }) => {
      state.active = {
        topic: args[args.indexOf("--topic") + 1],
        target: args[args.indexOf("--target") + 1],
        phase: "probe",
      };
      return state;
    },
  });

  await h.commands
    .get("teach")
    .handler("Optimization :: Understand why subtracting the gradient lowers loss locally", h.ctx);

  assert.deepEqual(h.calls.map((call) => call.command), ["status", "init", "start", "context"]);
  assert.deepEqual(h.calls[2], {
    command: "start",
    args: [
      "--topic",
      "Optimization",
      "--target",
      "Understand why subtracting the gradient lowers loss locally",
    ],
    root: h.ctx.cwd,
  });
  assert.deepEqual(h.messages, [
    {
      message:
        "/skill:adaptive-learning Start the active learning session from its durable context. The learner supplied this target: Understand why subtracting the gradient lowers loss locally",
      options: { expandPromptTemplates: true },
    },
  ]);
});

test("/learn-profile shows and updates the shared learner-authored preferences", async () => {
  const profile = {
    teachingPhilosophy: "Build causal understanding before recall.",
    explanationPreferences: "One reasoning step at a time.",
    feedbackPreferences: "Assess only the explicit question.",
    visualPreferences: "Use visuals when they clarify relationships.",
    sourcePreferences: "Prefer primary sources.",
    updatedAt: "2026-08-25T08:00:00.000Z",
  };
  const h = harness({
    profile,
    "set-profile": ({ args }) => ({
      ...profile,
      feedbackPreferences: args[args.indexOf("--feedback-preferences") + 1],
    }),
  });

  await h.commands.get("learn-profile").handler("", h.ctx);
  await h.commands
    .get("learn-profile")
    .handler("feedback :: Name the exact correct part and exact missing part.", h.ctx);

  assert.match(h.notifications[0].message, /Build causal understanding/);
  assert.match(h.notifications[1].message, /Learner profile updated/i);
  assert.deepEqual(h.calls, [
    { command: "profile", args: [], root: h.ctx.cwd },
    { command: "profile", args: [], root: h.ctx.cwd },
    {
      command: "set-profile",
      args: [
        "--feedback-preferences",
        "Name the exact correct part and exact missing part.",
      ],
      root: h.ctx.cwd,
    },
  ]);
});

test("/teach resumes an active session without creating or overwriting state", async () => {
  const h = harness({
    status: {
      active: {
        topic: "Gradient descent",
        target: "Explain one update causally",
        phase: "teach",
      },
    },
    context: { session: { id: "session-1" } },
  });

  await h.commands.get("teach").handler("", h.ctx);

  assert.deepEqual(h.calls.map((call) => call.command), ["status", "context"]);
  assert.match(h.messages[0].message, /Resume the active learning session from its durable context/);
  assert.deepEqual(h.messages[0].options, { expandPromptTemplates: true });
});

test("/teach refuses ambiguity instead of replacing a different active target", async () => {
  const h = harness({
    status: {
      active: {
        topic: "Gradient descent",
        target: "Explain one update causally",
        phase: "teach",
      },
    },
  });

  await h.commands.get("teach").handler("Bayesian inference", h.ctx);

  assert.deepEqual(h.calls.map((call) => call.command), ["status"]);
  assert.equal(h.messages.length, 0);
  assert.match(h.notifications[0].message, /different active target/i);
  assert.equal(h.notifications[0].level, "warning");
});

test("status and due review commands expose durable state without shell interpolation", async () => {
  const h = harness({
    status: {
      active: {
        topic: "Gradient descent",
        target: "Explain one update causally",
        phase: "teach",
        frontier: ["local-slope"],
      },
    },
    due: {
      reviews: [{ topic: "Gradient descent", nodeId: "local-slope" }],
      synthesisDue: false,
    },
  });

  await h.commands.get("learn-status").handler("", h.ctx);
  await h.commands.get("learn-review").handler("", h.ctx);

  assert.match(h.notifications[0].message, /Gradient descent.*teach.*local-slope/i);
  assert.deepEqual(h.messages[0], {
    message:
      "/skill:adaptive-learning Run the 1 due retention review from durable context. Preserve the assessment and retry rules.",
    options: { expandPromptTemplates: true },
  });
  assert.deepEqual(h.calls, [
    { command: "status", args: [], root: h.ctx.cwd },
    { command: "due", args: [], root: h.ctx.cwd },
  ]);

  const source = fs.readFileSync(
    path.join(repository, ".pi", "extensions", "adaptive-learning.js"),
    "utf8",
  );
  assert.match(source, /spawn\(executable, \[selectedCliPath, command, \.\.\.args/);
  assert.doesNotMatch(source, /spawnSync|shell\s*:\s*true|execSync|import\s*\{[^}]*\bexec\b/);
});

test("command handlers await asynchronous CLI state before dispatching the skill", async () => {
  const h = harness({
    status: async () => ({ active: null }),
    init: async () => ({ active: null }),
    start: async () => ({
      active: { topic: "Vectors", target: "Explain vector addition causally", phase: "probe" },
    }),
  });

  await h.commands.get("teach").handler("Vectors :: Explain vector addition causally", h.ctx);

  assert.deepEqual(h.calls.map((call) => call.command), ["status", "init", "start", "context"]);
  assert.equal(h.messages.length, 1);
  assert.match(h.messages[0].message, /Explain vector addition causally/);
});

test("committed state render failures are surfaced as repair warnings", async () => {
  const h = harness({
    status: async () => {
      const error = new Error(
        "State revision 7 was committed, but Obsidian rendering failed. Run repair-render before continuing.",
      );
      error.code = "RENDER_FAILED";
      error.stateCommitted = true;
      error.stateRevision = 7;
      error.repair = { command: "repair-render", root: h.ctx.cwd };
      throw error;
    },
  });

  await h.commands.get("teach").handler("Vectors", h.ctx);

  assert.equal(h.notifications.length, 1);
  assert.equal(h.notifications[0].level, "warning");
  assert.match(h.notifications[0].message, /revision 7 was committed/i);
  assert.match(h.notifications[0].message, /repair-render/i);
  assert.equal(h.messages.length, 0);
});

test("commands fail safely when idle state or retention work is missing", async () => {
  const empty = harness({ status: { active: null }, due: { reviews: [], synthesisDue: false } });
  await empty.commands.get("teach").handler("", empty.ctx);
  await empty.commands.get("learn-review").handler("", empty.ctx);
  assert.match(empty.notifications[0].message, /Usage: \/teach/i);
  assert.match(empty.notifications[1].message, /No retention reviews are due/i);
  assert.equal(empty.messages.length, 0);

  const busy = harness({ status: { active: null } });
  busy.ctx.isIdle = () => false;
  await busy.commands.get("teach").handler("Vectors", busy.ctx);
  assert.match(busy.notifications[0].message, /busy/i);
  assert.equal(busy.calls.length, 0);
});

test("Pi adapter's real runner creates and resumes canonical CLI state", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-pi-"));
  await assert.rejects(
    runAdaptiveLearningCli("status", [], root),
    (error) => error.code === "STATE_NOT_INITIALIZED",
  );

  await runAdaptiveLearningCli("init", [], root);
  await runAdaptiveLearningCli(
    "start",
    ["--topic", "Vectors", "--target", "Explain vector addition causally"],
    root,
  );
  const status = await runAdaptiveLearningCli("status", [], root);

  assert.equal(status.active.topic, "Vectors");
  assert.equal(status.active.target, "Explain vector addition causally");
  assert.equal(status.active.phase, "probe");
  assert.equal(fs.existsSync(path.join(root, "vault", "Home.md")), true);
});
