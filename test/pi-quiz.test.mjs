import assert from "node:assert/strict";
import test from "node:test";

import {
  createAdaptiveLearningExtension,
  createQuizController,
  showAdaptiveQuiz,
} from "../.pi/extensions/adaptive-learning.js";

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

function toolHarness(response) {
  const tools = new Map();
  const calls = [];
  const pi = {
    registerCommand() {},
    registerTool(tool) {
      tools.set(tool.name, tool);
    },
    sendUserMessage() {},
  };
  const ctx = {
    cwd: "/tmp/adaptive-learning-root",
    mode: "tui",
    hasUI: true,
    isIdle: () => true,
    ui: { notify() {}, custom() {} },
  };
  const runCli = async (command, args, root, options) => {
    calls.push({ command, args, root, options });
    if (command === "start-question") {
      return { active: { question: { ...question(), status: "awaiting-answer", responses: [] } } };
    }
    if (command === "submit-question") {
      const dontKnow = args.includes("--dont-know");
      const selectedIndex = args.indexOf("--selected");
      const selected = selectedIndex >= 0 ? [args[selectedIndex + 1]] : [];
      const correct = selected.includes("context");
      return {
        active: {
          question: {
            ...question(),
            status: dontKnow ? "gap" : correct ? "resolved" : "retry-required",
            responses: [{
              id: "response-1",
              selectedChoiceValues: selected,
              dontKnow,
              correct,
              noteId: args.includes("--note") ? "response-1-note" : null,
              assessmentId: dontKnow ? null : "response-1-assessment",
            }],
          },
        },
      };
    }
    if (command === "cancel-question") {
      return { active: { question: { ...question(), status: "cancelled" } } };
    }
    throw new Error(`Unexpected command: ${command}`);
  };
  const askQuiz = async ({ submit }) => response === null ? null : submit(response);
  createAdaptiveLearningExtension({ runCli, askQuiz })(pi);
  return { tools, calls, ctx };
}

test("Pi extension registers a dedicated adaptive-learning quiz tool", () => {
  const h = toolHarness({ selectedChoiceValues: ["context"], dontKnow: false });
  const tool = h.tools.get("adaptive_learning_quiz");

  assert.ok(tool);
  assert.equal(tool.label, "Adaptive Learning Quiz");
  assert.equal(typeof tool.execute, "function");
  assert.equal(typeof tool.renderCall, "function");
  assert.match(tool.description, /multiple-choice.*note/i);
});

test("Pi rejects recognition-only retention quizzes before persistence", async () => {
  const h = toolHarness({ selectedChoiceValues: ["context"], dontKnow: false });
  const tool = h.tools.get("adaptive_learning_quiz");

  await assert.rejects(
    () => tool.execute(
      "tool-call-retention",
      question({ stage: "retention" }),
      undefined,
      undefined,
      h.ctx,
    ),
    (error) =>
      error.code === "INVALID_STAGE" &&
      /durable retention/i.test(error.message),
  );
  assert.deepEqual(h.calls, []);
});

test("Pi quiz persists the question, then atomically submits the answer, note, and assessment", async () => {
  const response = {
    selectedChoiceValues: ["context"],
    dontKnow: false,
    note: "This is the step that makes a token contextual.",
  };
  const h = toolHarness(response);
  const result = await h.tools.get("adaptive_learning_quiz").execute(
    "tool-call-1",
    question(),
    undefined,
    undefined,
    h.ctx,
  );

  assert.deepEqual(h.calls.map((call) => call.command), [
    "start-question",
    "submit-question",
  ]);
  const answerArgs = h.calls[1].args;
  assert.deepEqual(answerArgs.slice(answerArgs.indexOf("--selected"), answerArgs.indexOf("--selected") + 2), ["--selected", "context"]);
  assert.equal(answerArgs[answerArgs.indexOf("--note") + 1], response.note);
  assert.match(result.content[0].text, /answered correctly/i);
  assert.equal(result.details.question.status, "resolved");
});

test("Pi propagates tool cancellation to every quiz persistence command", async () => {
  const h = toolHarness({ selectedChoiceValues: ["context"], dontKnow: false });
  const signal = new AbortController().signal;

  await h.tools.get("adaptive_learning_quiz").execute(
    "tool-call-signal",
    question(),
    signal,
    undefined,
    h.ctx,
  );

  assert.equal(h.calls.length, 2);
  assert.ok(h.calls.every((call) => call.options?.signal === signal));
});

test("Pi quiz records I don't know as an admitted gap without fabricating an assessment", async () => {
  const h = toolHarness({
    selectedChoiceValues: [],
    dontKnow: true,
    note: "I do not understand what representation is changing.",
  });
  const result = await h.tools.get("adaptive_learning_quiz").execute(
    "tool-call-1",
    question(),
    undefined,
    undefined,
    h.ctx,
  );

  assert.deepEqual(h.calls.map((call) => call.command), [
    "start-question",
    "submit-question",
  ]);
  assert.match(result.content[0].text, /I don't know/i);
  assert.doesNotMatch(result.content[0].text, /correct answer/i);
});

test("Pi quiz cancellation is persisted and answer keys never appear in call rendering", async () => {
  const h = toolHarness(null);
  const tool = h.tools.get("adaptive_learning_quiz");
  const rendered = tool.renderCall(question(), { fg: (_color, value) => value }).render(120).join("\n");

  assert.match(rendered, /What does self-attention/);
  assert.match(rendered, /Only its position number/);
  assert.doesNotMatch(rendered, /correctChoiceValues|context.*correct|mixes information/i);

  const result = await tool.execute("tool-call-1", question(), undefined, undefined, h.ctx);
  assert.deepEqual(h.calls.map((call) => call.command), ["start-question", "cancel-question"]);
  assert.match(result.content[0].text, /cancelled/i);
});

test("quiz controller keeps choices, I don't know, and optional notes on one surface", async () => {
  let submitted = null;
  let completed = null;
  let renders = 0;
  const controller = createQuizController({
    question: question(),
    requestRender: () => { renders += 1; },
    done: (value) => { completed = value; },
    submit: async (value) => {
      submitted = value;
      return {
        status: "resolved",
        responses: [{ ...value, correct: true }],
      };
    },
  });

  const initial = controller.render(100).join("\n");
  assert.match(initial, /1\. Only its position number/);
  assert.match(initial, /2\. Its representation using other tokens/);
  assert.match(initial, /I don't know/);
  assert.match(initial, /Note \(optional\)/);

  controller.handleInput("\t");
  controller.handleInput("Useful note");
  controller.handleInput("\r");
  controller.handleInput("\x1b[B");
  controller.handleInput("\r");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(submitted, {
    selectedChoiceValues: ["context"],
    dontKnow: false,
    note: "Useful note",
  });
  const feedback = controller.render(100).join("\n");
  assert.match(feedback, /Correct/);
  assert.match(feedback, /Self-attention mixes information/);
  assert.ok(renders > 0);

  controller.handleInput("\r");
  assert.equal(completed.status, "resolved");
});

test("Pi quiz navigation uses the injected keybindings for modern arrow input", async () => {
  let controller = null;
  const matchedActions = [];
  const keybindings = {
    matches(data, action) {
      matchedActions.push(action);
      return data === "\x1b[1;1B" && action === "tui.select.down";
    },
  };
  const ctx = {
    mode: "tui",
    hasUI: true,
    ui: {
      custom(factory) {
        return new Promise((resolve) => {
          controller = factory(
            { requestRender() {} },
            {},
            keybindings,
            resolve,
          );
        });
      },
    },
  };

  const quiz = showAdaptiveQuiz({
    ctx,
    question: question(),
    submit: async (response) => ({ status: "resolved", response }),
  });
  controller.handleInput("\x1b[1;1B");
  controller.handleInput("\r");
  await new Promise((resolve) => setImmediate(resolve));
  controller.handleInput("\r");

  const result = await quiz;
  assert.deepEqual(result.response.selectedChoiceValues, ["context"]);
  assert.ok(matchedActions.includes("tui.select.down"));
});

test("quiz controller withholds answer and explanation on a first miss", async () => {
  const controller = createQuizController({
    question: question(),
    requestRender() {},
    done() {},
    submit: async (value) => ({
      status: "retry-required",
      responses: [{ ...value, correct: false }],
    }),
  });

  controller.handleInput("\r");
  await new Promise((resolve) => setImmediate(resolve));
  const feedback = controller.render(100).join("\n");

  assert.match(feedback, /Incorrect.*retry/i);
  assert.doesNotMatch(feedback, /Its representation using other tokens.*correct|Self-attention mixes information/i);
});

test("multi-select choices can be toggled on and back off before submission", async () => {
  let submitted = null;
  const controller = createQuizController({
    question: question({ mode: "multi-select", correctChoiceValues: ["context"] }),
    requestRender() {},
    done() {},
    submit: async (value) => {
      submitted = value;
      return { status: "resolved", responses: [{ ...value, correct: true }] };
    },
  });

  controller.handleInput("\r");
  controller.handleInput("\x1b[B");
  controller.handleInput("\r");
  controller.handleInput("\x1b[A");
  controller.handleInput("\r");
  controller.handleInput("\x1b[B");
  controller.handleInput("\x1b[B");
  controller.handleInput("\x1b[B");
  controller.handleInput("\r");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(submitted, {
    selectedChoiceValues: ["context"],
    dontKnow: false,
  });
});
