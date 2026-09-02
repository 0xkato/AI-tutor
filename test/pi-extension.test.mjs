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

function harness(responses = {}, options = {}) {
  const commands = new Map();
  const tools = new Map();
  const events = new Map();
  const messages = [];
  const customMessages = [];
  const notifications = [];
  const calls = [];
  const selectedModels = [];
  const pi = {
    on(name, handler) {
      const handlers = events.get(name) ?? [];
      handlers.push(handler);
      events.set(name, handlers);
    },
    registerCommand(name, command) {
      commands.set(name, command);
    },
    registerTool(tool) {
      tools.set(tool.name, tool);
    },
    sendUserMessage(message, options) {
      messages.push({ message, options });
    },
    sendMessage(message, options) {
      customMessages.push({ message, options });
    },
    async setModel(model) {
      selectedModels.push(model);
      return options.setModelResult ?? true;
    },
  };
  const ctx = {
    cwd: options.cwd ?? "/tmp/adaptive-learning-root",
    mode: "tui",
    model: options.currentModel,
    modelRegistry: {
      find(provider, id) {
        return options.models?.find((model) => model.provider === provider && model.id === id);
      },
    },
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
  createAdaptiveLearningExtension({ runCli, cliArgs: options.cliArgs ?? [] })(pi);
  const emit = async (name, event, eventContext = ctx) => {
    for (const handler of events.get(name) ?? []) await handler(event, eventContext);
  };
  return {
    commands,
    tools,
    events,
    messages,
    customMessages,
    notifications,
    calls,
    selectedModels,
    ctx,
    emit,
  };
}

test("Pi extension registers the chat-first learning commands", () => {
  const { commands, tools } = harness();
  assert.deepEqual([...commands.keys()], [
    "teach",
    "teach-restart",
    "teach-from",
    "learn-profile",
    "learn-status",
    "learn-review",
  ]);
  for (const command of commands.values()) {
    assert.equal(typeof command.description, "string");
    assert.equal(typeof command.handler, "function");
  }
  assert.equal(tools.has("adaptive_learning_quiz"), true);
  assert.equal(tools.has("adaptive_learning_resume_question"), true);
  assert.equal(tools.has("adaptive_learning_response"), true);
  assert.equal(tools.has("adaptive_learning_assess_response"), true);
});

test("Pi starts on 5.6 Sol once and restores the learner's later project model choice", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learning-model-"));
  const sol = { provider: "openai-codex", id: "gpt-5.6-sol" };
  const terra = { provider: "openai-codex", id: "gpt-5.6-terra" };
  const legacyDefault = { provider: "openai-codex", id: "gpt-5.5" };
  const options = { cwd: root, models: [sol, terra, legacyDefault], currentModel: legacyDefault };

  const firstLaunch = harness({}, options);
  await firstLaunch.emit("session_start", { type: "session_start", reason: "startup" });
  assert.deepEqual(firstLaunch.selectedModels, [sol]);

  await firstLaunch.emit("model_select", {
    type: "model_select",
    source: "set",
    previousModel: sol,
    model: terra,
  });

  const restarted = harness({}, options);
  await restarted.emit("session_start", { type: "session_start", reason: "startup" });
  assert.deepEqual(restarted.selectedModels, [terra]);
});

test("Pi restores the project model when an ordinary launch resumes a session", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learning-model-"));
  const sol = { provider: "openai-codex", id: "gpt-5.6-sol" };
  const terra = { provider: "openai-codex", id: "gpt-5.6-terra" };

  const resumed = harness({}, {
    cwd: root,
    models: [sol, terra],
    currentModel: terra,
  });
  await resumed.emit("session_start", { type: "session_start", reason: "resume" });
  assert.deepEqual(resumed.selectedModels, [sol]);
});

test("Pi model restoration does not override an explicit CLI model or session selection", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learning-model-"));
  const sol = { provider: "openai-codex", id: "gpt-5.6-sol" };
  const terra = { provider: "openai-codex", id: "gpt-5.6-terra" };

  const explicit = harness({}, {
    cwd: root,
    models: [sol, terra],
    currentModel: terra,
    cliArgs: ["--model", "openai-codex/gpt-5.6-terra"],
  });
  await explicit.emit("session_start", { type: "session_start", reason: "startup" });
  assert.deepEqual(explicit.selectedModels, []);

  const explicitResume = harness({}, {
    cwd: root,
    models: [sol, terra],
    currentModel: terra,
    cliArgs: ["--resume"],
  });
  await explicitResume.emit("session_start", { type: "session_start", reason: "resume" });
  assert.deepEqual(explicitResume.selectedModels, []);
});

test("Pi automatically advances a graded learning turn instead of stopping at the next-frontier status", async () => {
  const question = {
    id: "teach-token-1",
    nodeId: "token-representations",
    stage: "teach",
    kind: "prediction",
    mode: "free-response",
    question: "Does the same token ID start from the same vector?",
    status: "awaiting-assessment",
    responses: [{
      id: "teach-token-1-response",
      textAnswer: "Yes, because the ID performs the same embedding lookup.",
      dontKnow: false,
    }],
  };
  const h = harness({
    "pending-question": { question },
    "record-assessment": {
      active: { question: { ...question, status: "resolved" } },
    },
    context: {
      session: {
        id: "session-transformers",
        phase: "teach",
        completedAt: null,
        questions: [{ ...question, status: "resolved" }],
        assessments: [{ id: "teach-token-1-assessment" }],
        checkpoint: {
          status: "new-transfer-required",
          nodeId: "token-representations",
          questionId: "teach-token-1",
          priorQuestionId: "teach-token-1",
        },
      },
      retry: [{
        status: "new-transfer-required",
        questionId: "teach-token-1",
        priorQuestionId: "teach-token-1",
        answerMayBeTaught: false,
        requiresNewTransfer: true,
      }],
      dueReviews: [],
      synthesisDue: false,
    },
  });

  await h.tools.get("adaptive_learning_assess_response").execute(
    "assessment-call",
    {
      id: "teach-token-1-assessment",
      questionId: "teach-token-1",
      grade: "correct",
      evidence: "The answer preserves token identity as the fixed embedding lookup.",
    },
    undefined,
    undefined,
    h.ctx,
  );
  await h.emit("agent_settled", { type: "agent_settled" });

  assert.equal(h.customMessages.length, 1);
  assert.equal(h.customMessages[0].message.display, false);
  assert.match(h.customMessages[0].message.content, /new-transfer-required/i);
  assert.match(h.customMessages[0].message.content, /do not end.*next frontier/i);
  assert.deepEqual(h.customMessages[0].options, {
    deliverAs: "followUp",
    triggerTurn: true,
  });
});

test("/teach-restart atomically starts a fresh probe and requires selectable calibration", async () => {
  const h = harness({
    status: {
      active: {
        id: "session-1",
        topic: "Transformers",
        target: "Build a durable transformer mental model",
        phase: "teach",
      },
    },
    restart: {
      active: {
        id: "session-2",
        topic: "Transformers",
        target: "Build a durable transformer mental model",
        phase: "probe",
      },
    },
    context: {
      session: {
        id: "session-2",
        target: "Build a durable transformer mental model",
        phase: "probe",
        questions: [],
        restartedFromSessionId: "session-1",
      },
    },
  });

  await h.commands.get("teach-restart").handler("", h.ctx);

  assert.deepEqual(h.calls.map((call) => call.command), ["status", "restart", "context"]);
  assert.deepEqual(h.calls[1].args, [
    "--reason",
    "The learner explicitly requested a complete restart from the beginning.",
  ]);
  assert.match(h.messages[0].message, /completely fresh probe/i);
  assert.match(h.messages[0].message, /first broad probe must be multiple-choice/i);
  assert.doesNotMatch(h.messages[0].message, /resume/i);
});

test("/teach-from persists an anchor material before dispatching source-guided learning", async () => {
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
    context: ({ calls }) => {
      const start = calls.find((call) => call.command === "start");
      return {
        session: {
          target: state.active.target,
          materials: [{ reference: start.args[start.args.indexOf("--material") + 1] }],
        },
      };
    },
  });

  await h.commands
    .get("teach-from")
    .handler(
      "https://www.youtube.com/watch?v=attention :: Understand self-attention causally",
      h.ctx,
    );

  assert.deepEqual(h.calls.map((call) => call.command), ["status", "init", "start", "context"]);
  assert.deepEqual(h.calls[2], {
    command: "start",
    args: [
      "--topic",
      "Understand self-attention causally",
      "--target",
      "Understand self-attention causally",
      "--material",
      "https://www.youtube.com/watch?v=attention",
    ],
    root: h.ctx.cwd,
  });
  assert.match(h.messages[0].message, /source-guided learning session/i);
  assert.match(h.messages[0].message, /https:\/\/www\.youtube\.com\/watch\?v=attention/);
  assert.match(h.messages[0].message, /Understand self-attention causally/);
  assert.match(h.messages[0].message, /inspect.*material/i);
});

test("/teach-from normalizes a local path and adds another guide to the same target", async () => {
  const created = harness({
    status: { active: null },
    init: { active: null },
    start: { active: { target: "Understand attention", phase: "probe" } },
    context: {
      session: {
        target: "Understand attention",
        materials: [{ reference: "local:./notes/attention.md" }],
      },
    },
  });
  await created.commands
    .get("teach-from")
    .handler("./notes/attention.md :: Understand attention", created.ctx);
  assert.deepEqual(
    created.calls.find((call) => call.command === "start").args.slice(-2),
    ["--material", "local:./notes/attention.md"],
  );

  const activeMaterials = [{ reference: "local:./notes/attention.md" }];
  const active = harness({
    status: {
      active: { target: "Understand attention", phase: "teach" },
    },
    context: () => ({
      session: {
        target: "Understand attention",
        materials: activeMaterials,
      },
    }),
    "add-material": ({ args }) => {
      activeMaterials.push({ reference: args[args.indexOf("--reference") + 1] });
      return { active: true };
    },
  });
  await active.commands
    .get("teach-from")
    .handler("./other.md :: Understand attention", active.ctx);
  assert.deepEqual(active.calls.map((call) => call.command), [
    "status",
    "context",
    "add-material",
    "context",
  ]);
  assert.deepEqual(active.calls[2].args, ["--reference", "local:./other.md"]);
  assert.match(active.messages[0].message, /inspect unresolved material/i);
  assert.match(active.messages[0].message, /local:\.\/other\.md/);

  const conflictingTarget = harness({
    status: { active: { target: "Understand attention", phase: "teach" } },
    context: {
      session: {
        target: "Understand attention",
        materials: [{ reference: "local:./notes/attention.md" }],
      },
    },
  });
  await conflictingTarget.commands
    .get("teach-from")
    .handler("./other.md :: Understand optimization", conflictingTarget.ctx);
  assert.equal(conflictingTarget.messages.length, 0);
  assert.match(conflictingTarget.notifications[0].message, /different active target/i);
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

test("/learn-profile presents empty overrides as active built-in defaults", async () => {
  const h = harness({
    profile: {
      teachingPhilosophy: "",
      explanationPreferences: "",
      feedbackPreferences: "",
      visualPreferences: "",
      sourcePreferences: "",
      updatedAt: null,
    },
  });

  await h.commands.get("learn-profile").handler("", h.ctx);

  assert.match(h.notifications[0].message, /Teaching: Built-in default active/i);
  assert.match(h.notifications[0].message, /Sources: Built-in default active/i);
  assert.doesNotMatch(h.notifications[0].message, /Not configured/i);
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

test("/teach tells Pi to reopen the exact pending question instead of recreating it", async () => {
  const h = harness({
    status: {
      active: {
        topic: "Transformers",
        target: "Build a durable transformer mental model",
        phase: "probe",
      },
    },
    context: {
      session: {
        id: "session-1",
        questions: [{
          id: "transformers-fresh-probe-1",
          status: "awaiting-answer",
        }],
      },
    },
  });

  await h.commands.get("teach").handler("", h.ctx);

  assert.match(h.messages[0].message, /adaptive_learning_resume_question/);
  assert.match(h.messages[0].message, /transformers-fresh-probe-1/);
  assert.match(h.messages[0].message, /do not recreate/i);
});

test("/teach routes an answered free response to assessment instead of trying to reopen it", async () => {
  const h = harness({
    status: {
      active: {
        kind: "learn",
        topic: "Transformers",
        target: "Build a durable transformer mental model",
        phase: "teach",
      },
    },
    context: {
      session: {
        id: "session-1",
        questions: [{
          id: "transformers-own-words-1",
          status: "awaiting-assessment",
          mode: "free-response",
          responses: [{ textAnswer: "Attention changes the representation using context." }],
        }],
      },
    },
  });

  await h.commands.get("teach").handler("", h.ctx);

  assert.match(h.messages[0].message, /adaptive_learning_assess_response/);
  assert.match(h.messages[0].message, /transformers-own-words-1/);
  assert.match(h.messages[0].message, /exact persisted.*response/i);
  assert.doesNotMatch(h.messages[0].message, /adaptive_learning_resume_question/);
});

test("/teach reopens a checkpoint that was persisted before its question record existed", async () => {
  const h = harness({
    status: {
      active: {
        kind: "learn",
        topic: "Transformers",
        target: "Build a durable transformer mental model",
        phase: "teach",
      },
    },
    context: {
      session: {
        id: "session-1",
        questions: [],
        activeStepId: "teach-step-1",
        checkpoint: {
          status: "awaiting-answer",
          questionId: "teach-checkpoint-1",
        },
      },
    },
  });

  await h.commands.get("teach").handler("", h.ctx);

  assert.match(h.messages[0].message, /adaptive_learning_resume_question/);
  assert.match(h.messages[0].message, /teach-checkpoint-1/);
  assert.match(h.messages[0].message, /materialize.*or.*resume/i);
});

test("/teach-from preserves exact checkpoint continuation ahead of generic source inspection", async () => {
  const h = harness({
    status: {
      active: {
        kind: "learn",
        target: "Understand attention",
        phase: "teach",
      },
    },
    context: {
      session: {
        target: "Understand attention",
        materials: [{ reference: "local:./notes/attention.md", status: "verified" }],
        questions: [{
          id: "source-response-1",
          status: "awaiting-assessment",
          mode: "free-response",
          responses: [{ textAnswer: "Queries are compared with keys." }],
        }],
      },
    },
  });

  await h.commands.get("teach-from").handler("", h.ctx);

  assert.match(h.messages[0].message, /adaptive_learning_assess_response/);
  assert.match(h.messages[0].message, /source-response-1/);
  assert.match(h.messages[0].message, /local:\.\/notes\/attention\.md/);
  assert.doesNotMatch(h.messages[0].message, /inspect unresolved material before teaching/i);
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

test("status and review commands refuse to start retention work over an active learning session", async () => {
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
  assert.match(h.notifications[1].message, /active learning session.*finish or close/i);
  assert.equal(h.messages.length, 0);
  assert.deepEqual(h.calls, [
    { command: "status", args: [], root: h.ctx.cwd },
    { command: "status", args: [], root: h.ctx.cwd },
  ]);

  const source = fs.readFileSync(
    path.join(repository, ".pi", "extensions", "adaptive-learning.js"),
    "utf8",
  );
  assert.match(source, /spawn\(executable, \[selectedCliPath, command, \.\.\.args/);
  assert.doesNotMatch(source, /spawnSync|shell\s*:\s*true|execSync|import\s*\{[^}]*\bexec\b/);
});

test("/learn-review resumes an already claimed review checkpoint instead of querying due work", async () => {
  const h = harness({
    status: {
      active: {
        id: "review-session-1",
        kind: "review",
        topic: "Transformers",
        target: "Retention review",
        phase: "review",
      },
    },
    context: {
      session: {
        id: "review-session-1",
        kind: "review",
        phase: "review",
        checkpoint: {
          status: "awaiting-answer",
          questionId: "retention-q1",
          question: "Explain why causal masking is required.",
          nodeId: "causal-masking",
        },
        questions: [],
      },
    },
  });

  await h.commands.get("learn-review").handler("", h.ctx);

  assert.deepEqual(h.calls.map((call) => call.command), ["status", "context"]);
  assert.match(h.messages[0].message, /already claimed.*review/i);
  assert.match(h.messages[0].message, /retention-q1/);
  assert.match(h.messages[0].message, /do not call.*start-review|do not start.*review/i);
});

test("/learn-review resumes an active review synthesis checkpoint before concept review state", async () => {
  const h = harness({
    status: {
      active: {
        id: "review-session-2",
        kind: "review",
        topic: "Transformers",
        target: "Retention review",
        phase: "review",
      },
    },
    context: {
      session: {
        id: "review-session-2",
        kind: "review",
        phase: "review",
        checkpoint: { status: "resolved", questionId: "retention-q1" },
        synthesisCheckpoint: {
          status: "retry-required",
          questionId: "review-synthesis-q1",
          question: "Connect masking, attention, and next-token prediction.",
        },
        questions: [],
      },
    },
  });

  await h.commands.get("learn-review").handler("", h.ctx);

  assert.deepEqual(h.calls.map((call) => call.command), ["status", "context"]);
  assert.match(h.messages[0].message, /synthesis checkpoint review-synthesis-q1/i);
  assert.match(h.messages[0].message, /do not call due or start-review again/i);
});

test("/learn-review starts due work only when no session is active", async () => {
  const h = harness({
    status: { active: null },
    due: {
      reviews: [{ topic: "Gradient descent", nodeId: "local-slope" }],
      synthesisDue: false,
    },
  });

  await h.commands.get("learn-review").handler("", h.ctx);

  assert.deepEqual(h.calls.map((call) => call.command), ["status", "due"]);
  assert.deepEqual(h.messages[0], {
    message:
      "/skill:adaptive-learning Run the 1 due retention review from durable context. Preserve the assessment and retry rules.",
    options: { expandPromptTemplates: true },
  });
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
