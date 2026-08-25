import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createAdaptiveLearningExtension,
  runAdaptiveLearningCli,
} from "../.pi/extensions/adaptive-learning.js";
import { readState } from "../src/store.mjs";

function fakePi() {
  const registered = { tools: new Map(), commands: new Map() };
  return {
    registered,
    api: {
      registerTool(tool) {
        registered.tools.set(tool.name, tool);
      },
      registerCommand(name, command) {
        registered.commands.set(name, command);
      },
    },
  };
}

function question(overrides = {}) {
  return {
    id: "probe-q1",
    stage: "probe",
    nodeId: "attention",
    kind: "multiple-choice",
    question: "What does self-attention change for one token?",
    mode: "single-select",
    choices: [
      { value: "position", label: "Only its position number" },
      { value: "context", label: "Its representation using other tokens" },
    ],
    correctChoiceValues: ["context"],
    explanation: "Self-attention mixes information from other token representations.",
    ...overrides,
  };
}

test("real Pi quiz path persists graded choice, learner notes, and adaptive gap to Obsidian", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learning-interactive-acceptance-"));
  await runAdaptiveLearningCli("init", [], root);
  await runAdaptiveLearningCli(
    "start",
    ["--id", "session-1", "--topic", "Transformers", "--target", "Understand Transformers"],
    root,
  );

  const pi = fakePi();
  createAdaptiveLearningExtension({
    askQuiz: async ({ question: item, submit }) => {
      if (item.id === "probe-q1") {
        return submit({
          selectedChoiceValues: ["context"],
          dontKnow: false,
          note: "A token representation becomes contextual here.",
        });
      }
      return submit({
        selectedChoiceValues: [],
        dontKnow: true,
        note: "I need query, key, and value roles taught before this boundary.",
      });
    },
  })(pi.api);

  const tool = pi.registered.tools.get("adaptive_learning_quiz");
  assert.ok(tool);
  const ctx = {
    cwd: root,
    mode: "tui",
    hasUI: true,
    ui: { custom() { throw new Error("Injected acceptance quiz should handle input"); } },
  };

  const first = await tool.execute("call-1", question(), undefined, undefined, ctx);
  assert.match(first.content[0].text, /answered correctly/i);

  const secondQuestion = question({
    id: "probe-q2",
    nodeId: "query-key-value",
    question: "Which learned object decides what this token is looking for?",
    choices: [
      { value: "query", label: "Its query" },
      { value: "value", label: "Its value" },
    ],
    correctChoiceValues: ["query"],
    explanation: "The query represents what the current token is looking for.",
    parentQuestionId: "probe-q1",
    adaptationReason: "The contextual-representation probe passed; test the mechanism inside attention.",
  });
  const second = await tool.execute("call-2", secondQuestion, undefined, undefined, ctx);
  assert.match(second.content[0].text, /I don't know/i);

  const state = readState(root);
  const session = state.sessions["session-1"];
  assert.equal(session.questions.length, 2);
  assert.equal(session.questions[0].status, "resolved");
  assert.equal(session.questions[0].responses[0].correct, true);
  assert.equal(session.questions[0].responses[0].assessmentId !== null, true);
  assert.equal(session.questions[1].status, "gap");
  assert.equal(session.questions[1].parentQuestionId, "probe-q1");
  assert.match(session.questions[1].adaptationReason, /test the mechanism/i);
  assert.equal(session.questions[1].responses[0].dontKnow, true);
  assert.deepEqual(
    session.notes.map((note) => note.body),
    [
      "A token representation becomes contextual here.",
      "I need query, key, and value roles taught before this boundary.",
    ],
  );
  assert.equal(session.assessments.length, 1);
  assert.equal(session.admittedGaps.length, 1);

  const sessionFile = fs.readdirSync(path.join(root, "vault", "Sessions"))[0];
  const rendered = fs.readFileSync(path.join(root, "vault", "Sessions", sessionFile), "utf8");
  assert.match(rendered, /What does self-attention change for one token\?/);
  assert.match(rendered, /A token representation becomes contextual here\./);
  assert.match(rendered, /Which learned object decides what this token is looking for\?/);
  assert.match(rendered, /\*\*Parent question:\*\* `probe-q1`/);
  assert.match(rendered, /I need query, key, and value roles taught/);
});

test("Pi retries the exact persisted question without trying to create it again", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learning-interactive-retry-"));
  await runAdaptiveLearningCli("init", [], root);
  await runAdaptiveLearningCli(
    "start",
    ["--id", "session-retry", "--topic", "Transformers", "--target", "Understand attention"],
    root,
  );

  let attempts = 0;
  const pi = fakePi();
  createAdaptiveLearningExtension({
    askQuiz: async ({ submit }) => {
      attempts += 1;
      return submit({ selectedChoiceValues: ["position"], dontKnow: false });
    },
  })(pi.api);
  const tool = pi.registered.tools.get("adaptive_learning_quiz");
  const ctx = {
    cwd: root,
    mode: "tui",
    hasUI: true,
    ui: { custom() { throw new Error("Injected acceptance quiz should handle input"); } },
  };

  const first = await tool.execute("retry-call-1", question(), undefined, undefined, ctx);
  assert.match(first.content[0].text, /withheld.*retry/i);

  const second = await tool.execute("retry-call-2", question(), undefined, undefined, ctx);
  assert.match(second.content[0].text, /permits teaching/i);
  assert.doesNotMatch(second.content[0].text, /withheld.*retry/i);
  assert.equal(attempts, 2);

  const state = readState(root);
  const persisted = state.sessions["session-retry"].questions[0];
  assert.equal(persisted.responses.length, 2);
  assert.equal(persisted.status, "resolved");
  assert.equal(state.sessions["session-retry"].assessments.length, 2);
});

test("Pi rejects a retry whose hidden answer key or explanation changed", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learning-interactive-identity-"));
  await runAdaptiveLearningCli("init", [], root);
  await runAdaptiveLearningCli(
    "start",
    ["--id", "session-identity", "--topic", "Transformers", "--target", "Understand attention"],
    root,
  );

  const pi = fakePi();
  createAdaptiveLearningExtension({
    askQuiz: async ({ submit }) => submit({
      selectedChoiceValues: ["position"],
      dontKnow: false,
    }),
  })(pi.api);
  const tool = pi.registered.tools.get("adaptive_learning_quiz");
  const ctx = {
    cwd: root,
    mode: "tui",
    hasUI: true,
    ui: { custom() { throw new Error("Injected acceptance quiz should handle input"); } },
  };

  await tool.execute("identity-call-1", question(), undefined, undefined, ctx);
  await assert.rejects(
    () => tool.execute(
      "identity-call-2",
      question({
        correctChoiceValues: ["position"],
        explanation: "Changed after the learner's first attempt.",
      }),
      undefined,
      undefined,
      ctx,
    ),
    (error) => error.code === "DUPLICATE_QUESTION",
  );

  const state = readState(root);
  assert.equal(state.sessions["session-identity"].questions[0].responses.length, 1);
  assert.deepEqual(state.sessions["session-identity"].questions[0].correctChoiceValues, ["context"]);
});

test("a teach-stage I don't know opens a new-transfer repair without a false assessment", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learning-interactive-teach-gap-"));
  const planPath = path.join(root, "plan.json");
  fs.writeFileSync(planPath, `${JSON.stringify({
    targetNodeId: "query-key-value",
    nodes: [{ id: "query-key-value", title: "Query, key, and value roles" }],
    edges: [],
  }, null, 2)}\n`);
  await runAdaptiveLearningCli("init", [], root);
  await runAdaptiveLearningCli(
    "start",
    ["--id", "session-teach-gap", "--topic", "Transformers", "--target", "Understand attention"],
    root,
  );

  const pi = fakePi();
  createAdaptiveLearningExtension({
    askQuiz: async ({ submit }) => submit({ selectedChoiceValues: [], dontKnow: true }),
  })(pi.api);
  const tool = pi.registered.tools.get("adaptive_learning_quiz");
  const ctx = {
    cwd: root,
    mode: "tui",
    hasUI: true,
    ui: { custom() { throw new Error("Injected acceptance quiz should handle input"); } },
  };

  await tool.execute("teach-gap-probe", question({
    id: "probe-gap",
    nodeId: "query-key-value",
    question: "Which object represents what the current token is looking for?",
    choices: [
      { value: "query", label: "Its query" },
      { value: "value", label: "Its value" },
    ],
    correctChoiceValues: ["query"],
    explanation: "The query represents what the current token is looking for.",
  }), undefined, undefined, ctx);
  await runAdaptiveLearningCli("finish-probe", ["--summary", "Query, key, and value roles are the first admitted gap."], root);
  await runAdaptiveLearningCli("set-plan", ["--file", planPath], root);
  await runAdaptiveLearningCli("begin-teach", [], root);
  const teachQuestion = "After projection, which object states what this token seeks?";
  await runAdaptiveLearningCli("record-step", [
    "--id", "teach-step-1",
    "--node", "query-key-value",
    "--foundation", "Each token representation is projected into learned vectors.",
    "--motivation", "Attention needs separate roles for matching and carrying information.",
    "--explanation", "The query states what the current token seeks; keys advertise matches and values carry content.",
    "--question-id", "teach-q1",
    "--kind", "multiple-choice",
    "--question", teachQuestion,
  ], root);

  const result = await tool.execute("teach-gap-question", question({
    id: "teach-q1",
    stage: "teach",
    nodeId: "query-key-value",
    question: teachQuestion,
    choices: [
      { value: "query", label: "Its query" },
      { value: "value", label: "Its value" },
    ],
    correctChoiceValues: ["query"],
    explanation: "The query states what the current token seeks.",
    parentQuestionId: "probe-gap",
    adaptationReason: "The probe exposed this mechanism as an admitted gap, so it was taught before checking it.",
  }), undefined, undefined, ctx);
  assert.match(result.content[0].text, /I don't know/i);

  const state = readState(root);
  const session = state.sessions["session-teach-gap"];
  const concept = state.concepts[session.conceptIds[0]];
  assert.equal(session.questions[1].status, "gap");
  assert.equal(session.assessments.length, 0);
  assert.equal(concept.retry.status, "new-transfer-required");
  assert.equal(concept.retry.answerMayBeTaught, true);
  assert.equal(session.checkpoint.status, "new-transfer-required");

  await runAdaptiveLearningCli("record-step", [
    "--id", "teach-step-transfer",
    "--node", "query-key-value",
    "--foundation", "Queries seek, keys advertise, and values carry content.",
    "--motivation", "Recognition did not establish that the roles can be transferred.",
    "--explanation", "A new scenario must require identifying matching and carried content.",
    "--question-id", "teach-transfer-q1",
    "--kind", "transfer",
    "--question", "In a search analogy, which representation is the request and which carries the retrieved content?",
  ], root);
});

test("a teach-stage first miss can retry the exact persisted question", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learning-interactive-teach-retry-"));
  const planPath = path.join(root, "plan.json");
  fs.writeFileSync(planPath, `${JSON.stringify({
    targetNodeId: "query-key-value",
    nodes: [{ id: "query-key-value", title: "Query, key, and value roles" }],
    edges: [],
  }, null, 2)}\n`);
  await runAdaptiveLearningCli("init", [], root);
  await runAdaptiveLearningCli(
    "start",
    ["--id", "session-teach-retry", "--topic", "Transformers", "--target", "Understand attention"],
    root,
  );

  let phase = "probe";
  const pi = fakePi();
  createAdaptiveLearningExtension({
    askQuiz: async ({ submit }) => phase === "probe"
      ? submit({ selectedChoiceValues: [], dontKnow: true })
      : submit({ selectedChoiceValues: ["value"], dontKnow: false }),
  })(pi.api);
  const tool = pi.registered.tools.get("adaptive_learning_quiz");
  const ctx = {
    cwd: root,
    mode: "tui",
    hasUI: true,
    ui: { custom() { throw new Error("Injected acceptance quiz should handle input"); } },
  };
  const probeQuestion = question({
    id: "probe-gap",
    nodeId: "query-key-value",
    question: "Which object represents what the current token is looking for?",
    choices: [
      { value: "query", label: "Its query" },
      { value: "value", label: "Its value" },
    ],
    correctChoiceValues: ["query"],
    explanation: "The query represents what the current token is looking for.",
  });
  await tool.execute("teach-retry-probe", probeQuestion, undefined, undefined, ctx);
  await runAdaptiveLearningCli("finish-probe", ["--summary", "Query, key, and value roles are the first admitted gap."], root);
  await runAdaptiveLearningCli("set-plan", ["--file", planPath], root);
  await runAdaptiveLearningCli("begin-teach", [], root);
  const prompt = "After projection, which object states what this token seeks?";
  await runAdaptiveLearningCli("record-step", [
    "--id", "teach-step-retry",
    "--node", "query-key-value",
    "--foundation", "Each token representation is projected into learned vectors.",
    "--motivation", "Attention needs separate roles for matching and carrying information.",
    "--explanation", "The query states what the current token seeks; keys advertise matches and values carry content.",
    "--question-id", "teach-retry-q1",
    "--kind", "multiple-choice",
    "--question", prompt,
  ], root);
  phase = "teach";
  const teachQuestion = question({
    id: "teach-retry-q1",
    stage: "teach",
    nodeId: "query-key-value",
    question: prompt,
    choices: [
      { value: "query", label: "Its query" },
      { value: "value", label: "Its value" },
    ],
    correctChoiceValues: ["query"],
    explanation: "The query states what the current token seeks.",
    parentQuestionId: "probe-gap",
    adaptationReason: "The probe exposed this mechanism as an admitted gap, so it was taught before checking it.",
  });

  const first = await tool.execute("teach-retry-1", teachQuestion, undefined, undefined, ctx);
  assert.match(first.content[0].text, /withheld.*retry/i);
  const second = await tool.execute("teach-retry-2", teachQuestion, undefined, undefined, ctx);
  assert.match(second.content[0].text, /permits teaching/i);

  const state = readState(root);
  const persisted = state.sessions["session-teach-retry"].questions[1];
  assert.equal(persisted.responses.length, 2);
  assert.equal(persisted.status, "resolved");
});
