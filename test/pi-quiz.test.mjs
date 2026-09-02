import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import {
  createAdaptiveLearningExtension,
  createQuizController,
  createResponseController,
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
    if (command === "pending-question") return { question: null, definitionDigest: null };
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

function pendingQuestionHarness({ response, pending = question(), submitted } = {}) {
  const tools = new Map();
  const calls = [];
  let presented = null;
  const visiblePending = {
    ...pending,
    status: "awaiting-answer",
    responses: [],
  };
  delete visiblePending.correctChoiceValues;
  delete visiblePending.explanation;
  const saved = submitted ?? {
    ...pending,
    status: "resolved",
    responses: [{
      id: "response-resumed-1",
      selectedChoiceValues: ["context"],
      dontKnow: false,
      correct: true,
    }],
  };
  const pi = {
    registerCommand() {},
    registerTool(tool) { tools.set(tool.name, tool); },
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
    if (command === "pending-question") {
      return { question: visiblePending, definitionDigest: "stored-definition" };
    }
    if (command === "start-question") {
      const error = new Error(`Question already exists: ${pending.id}`);
      error.code = "DUPLICATE_QUESTION";
      throw error;
    }
    if (command === "submit-question") return { active: { question: saved } };
    if (command === "answer-question") return { active: { question: saved } };
    if (command === "cancel-question") {
      return { active: { question: { ...saved, status: "cancelled", responses: [] } } };
    }
    throw new Error(`Unexpected command: ${command}`);
  };
  const askQuiz = async ({ question: shown, submit }) => {
    presented = shown;
    return submit(response ?? { selectedChoiceValues: ["context"], dontKnow: false });
  };
  createAdaptiveLearningExtension({ runCli, askQuiz })(pi);
  return { tools, calls, ctx, presented: () => presented };
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

test("Pi resumes a pending multiple-choice question from stored visible state", async () => {
  const h = pendingQuestionHarness();
  const tool = h.tools.get("adaptive_learning_resume_question");

  assert.ok(tool, "a first-class pending-question presentation tool must be registered");
  const result = await tool.execute(
    "tool-call-resume",
    { questionId: "probe-q1" },
    undefined,
    undefined,
    h.ctx,
  );

  assert.deepEqual(h.calls.map((call) => call.command), ["pending-question", "submit-question"]);
  assert.equal(h.presented().id, "probe-q1");
  assert.equal(h.presented().explanation, undefined);
  assert.match(result.content[0].text, /answered correctly/i);
});

test("Pi create-shaped quiz calls delegate to the stored pending definition", async () => {
  const h = pendingQuestionHarness();
  const replay = question({
    explanation: "The model regenerated this hidden field after relaunch.",
  });

  const result = await h.tools.get("adaptive_learning_quiz").execute(
    "tool-call-replayed-create",
    replay,
    undefined,
    undefined,
    h.ctx,
  );

  assert.deepEqual(h.calls.map((call) => call.command), ["pending-question", "submit-question"]);
  assert.equal(h.presented().explanation, undefined);
  assert.match(result.content[0].text, /answered correctly/i);
});

test("Pi refuses a visibly different create request while another question is pending", async () => {
  const h = pendingQuestionHarness();
  let shown = false;
  h.ctx.ui.custom = () => { shown = true; };

  await assert.rejects(
    () => h.tools.get("adaptive_learning_quiz").execute(
      "tool-call-conflict",
      question({ question: "A different question under the same identity" }),
      undefined,
      undefined,
      h.ctx,
    ),
    (error) => error.code === "QUESTION_PENDING",
  );

  assert.deepEqual(h.calls.map((call) => call.command), ["pending-question"]);
  assert.equal(shown, false);
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
    "pending-question",
    "start-question",
    "submit-question",
  ]);
  const answerArgs = h.calls[2].args;
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

  assert.equal(h.calls.length, 3);
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
    "pending-question",
    "start-question",
    "submit-question",
  ]);
  assert.match(result.content[0].text, /I don't know/i);
  assert.doesNotMatch(result.content[0].text, /correct answer/i);
});

test("closing a newly persisted Pi quiz pauses it without discarding durable input state", async () => {
  const h = toolHarness(null);
  const tool = h.tools.get("adaptive_learning_quiz");
  const rendered = tool.renderCall(question(), { fg: (_color, value) => value }).render(120).join("\n");

  assert.match(rendered, /Opening native adaptive-learning quiz/i);
  assert.match(rendered, /What does self-attention/);
  assert.match(rendered, /2 options/);
  assert.doesNotMatch(rendered, /1\. |2\. |Only its position number|Its representation using other tokens/);
  assert.doesNotMatch(rendered, /correctChoiceValues|context.*correct|mixes information/i);

  const result = await tool.execute("tool-call-1", question(), undefined, undefined, h.ctx);
  assert.deepEqual(h.calls.map((call) => call.command), ["pending-question", "start-question"]);
  assert.match(result.content[0].text, /closed without an answer.*remains persisted/is);
  assert.equal(result.details.question.status, "awaiting-answer");
});

test("Pi resume tool opens the persisted question through the native selectable menu", async () => {
  const tools = new Map();
  const calls = [];
  let controller = null;
  let customCalls = 0;
  const pending = {
    ...question(),
    status: "awaiting-answer",
    responses: [],
  };
  delete pending.correctChoiceValues;
  delete pending.explanation;
  const saved = {
    ...question(),
    status: "resolved",
    responses: [{
      id: "native-menu-response",
      selectedChoiceValues: ["context"],
      dontKnow: false,
      correct: true,
    }],
  };
  const pi = {
    registerCommand() {},
    registerTool(tool) { tools.set(tool.name, tool); },
    sendUserMessage() {},
  };
  const runCli = async (command, args) => {
    calls.push({ command, args });
    if (command === "pending-question") {
      return { question: pending, definitionDigest: "stored-definition" };
    }
    if (command === "submit-question") return { active: { question: saved } };
    throw new Error(`Unexpected command: ${command}`);
  };
  const ctx = {
    cwd: "/tmp/adaptive-learning-root",
    mode: "tui",
    hasUI: true,
    ui: {
      custom(factory) {
        customCalls += 1;
        return new Promise((resolve) => {
          controller = factory(
            { requestRender() {} },
            {},
            { matches() { return false; } },
            resolve,
          );
        });
      },
    },
  };
  createAdaptiveLearningExtension({ runCli })(pi);

  const resultPromise = tools.get("adaptive_learning_resume_question").execute(
    "native-menu-resume",
    { questionId: "probe-q1" },
    undefined,
    undefined,
    ctx,
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(customCalls, 1, "resume must invoke Pi's ctx.ui.custom menu surface");
  const visibleMenu = controller.render(100).join("\n");
  assert.match(visibleMenu, /QUESTION/);
  assert.match(visibleMenu, /CHOICES/);
  assert.match(visibleMenu, /> 1\. Only its position number/);
  assert.match(visibleMenu, /Up\/Down move · Enter answer/);

  controller.handleInput("\x1b[B");
  controller.handleInput("\r");
  await new Promise((resolve) => setImmediate(resolve));
  controller.handleInput("\r");
  const result = await resultPromise;

  assert.deepEqual(calls.map((call) => call.command), ["pending-question", "submit-question"]);
  assert.match(result.content[0].text, /answered correctly/i);
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

test("a resumed quiz reveals feedback from the persisted submission result", async () => {
  let controller;
  controller = createQuizController({
    question: {
      ...question(),
      correctChoiceValues: undefined,
      explanation: undefined,
    },
    requestRender() {},
    done() {},
    submit: async (value) => ({
      ...question({ explanation: "Stored explanation from canonical state." }),
      status: "resolved",
      responses: [{ ...value, correct: true }],
    }),
  });

  controller.handleInput("\x1b[B");
  controller.handleInput("\r");
  await new Promise((resolve) => setImmediate(resolve));

  assert.match(controller.render(100).join("\n"), /Stored explanation from canonical state/);
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

test("multiple-choice confidence is captured before feedback", async () => {
  let submitted = null;
  const controller = createQuizController({
    question: question(),
    requestRender() {},
    done() {},
    submit: async (value) => {
      submitted = value;
      return { status: "resolved", responses: [{ ...value, correct: true }] };
    },
  });

  assert.match(controller.render(100).join("\n"), /Confidence 0-100/);
  controller.handleInput("\t");
  controller.handleInput("\t");
  controller.handleInput("92");
  controller.handleInput("\t");
  controller.handleInput("\x1b[B");
  controller.handleInput("\r");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(submitted, {
    selectedChoiceValues: ["context"],
    dontKnow: false,
    confidence: 92,
  });
});

test("multiple-choice controller uses the same bounded compact learning layout", () => {
  const controller = createQuizController({
    question: question({
      question: "A deliberately long prompt should remain readable even when Pi is open in a very wide terminal, because reading width and terminal width are different interface concerns.",
    }),
    requestRender() {},
    done() {},
    submit() {},
  });

  const lines = controller.render(200);
  const rendered = lines.join("\n");

  assert.ok(Math.max(...lines.map((line) => line.length)) <= 76);
  assert.match(rendered, /QUESTION/);
  assert.match(rendered, /CHOICES/);
  assert.match(rendered, /Note \(optional\): —/);
  assert.match(rendered, /Confidence 0-100 \(optional\): —/);
  assert.ok(lines.filter((line) => line === "").length <= 4);
});

function freeResponseQuestion(overrides = {}) {
  return {
    id: "probe-free-1",
    stage: "probe",
    nodeId: "attention",
    kind: "explanation",
    question: "Why can the same token have different contextual representations?",
    activityType: "contrastive-case",
    strategyReason: "Test the identity-versus-representation boundary.",
    supportLevel: 1,
    transferLevel: 2,
    ...overrides,
  };
}

function responseToolHarness(response, { pendingForAssessment = false } = {}) {
  const tools = new Map();
  const calls = [];
  let answered = false;
  const persisted = {
    ...freeResponseQuestion(),
    mode: "free-response",
    choices: [],
    responses: [{
      id: "response-free-1",
      textAnswer: response?.textAnswer ?? "Its hidden state changes with context.",
      dontKnow: response?.dontKnow ?? false,
      confidence: response?.confidence ?? 80,
      responseTimeMs: 12000,
      assessmentId: null,
    }],
    status: "awaiting-assessment",
  };
  const pi = {
    registerCommand() {},
    registerTool(tool) { tools.set(tool.name, tool); },
    sendUserMessage() {},
  };
  const ctx = {
    cwd: "/tmp/adaptive-learning-root",
    mode: "tui",
    hasUI: true,
    ui: { notify() {}, custom() {} },
  };
  const runCli = async (command, args, root, options) => {
    calls.push({ command, args, root, options });
    if (command === "start-question") {
      return { active: { question: { ...persisted, responses: [], status: "awaiting-answer" } } };
    }
    if (command === "answer-question") {
      answered = true;
      const answerIndex = args.indexOf("--text-answer");
      const confidenceIndex = args.indexOf("--confidence");
      const dontKnow = args.includes("--dont-know");
      return {
        active: {
          question: {
            ...persisted,
            status: dontKnow ? "gap" : "awaiting-assessment",
            responses: [{
              ...persisted.responses[0],
              textAnswer: answerIndex >= 0 ? args[answerIndex + 1] : null,
              confidence: confidenceIndex >= 0 ? Number(args[confidenceIndex + 1]) : null,
              dontKnow,
            }],
          },
        },
      };
    }
    if (command === "submit-question") {
      return { active: { question: { ...persisted, status: "gap", responses: [{ ...persisted.responses[0], dontKnow: true }] } } };
    }
    if (command === "pending-question") {
      return { question: pendingForAssessment || answered ? persisted : null };
    }
    if (command === "record-assessment") {
      return {
        active: {
          question: {
            ...persisted,
            status: "retry-required",
            responses: [{ ...persisted.responses[0], assessmentId: "assessment-free-1" }],
          },
        },
      };
    }
    if (command === "cancel-question") {
      return { active: { question: { ...persisted, status: "cancelled", responses: [] } } };
    }
    if (command === "record-admitted-gap") {
      return { active: { question: { ...persisted, status: "gap" } } };
    }
    throw new Error(`Unexpected command: ${command}`);
  };
  const askResponse = async ({ submit }) => response === null ? null : submit(response);
  createAdaptiveLearningExtension({ runCli, askResponse })(pi);
  return { tools, calls, ctx };
}

test("Pi free-response tool persists the prompt before the learner's own words", async () => {
  const response = {
    textAnswer: "The token ID stays fixed, but attention changes its hidden representation using context.",
    confidence: 82,
    note: "Identity and representation are separate.",
    dontKnow: false,
  };
  const h = responseToolHarness(response);
  const result = await h.tools.get("adaptive_learning_response").execute(
    "response-call-1",
    freeResponseQuestion(),
    undefined,
    undefined,
    h.ctx,
  );

  assert.deepEqual(h.calls.map((call) => call.command), ["pending-question", "start-question", "answer-question"]);
  const startArgs = h.calls[1].args;
  assert.deepEqual(startArgs.slice(startArgs.indexOf("--mode"), startArgs.indexOf("--mode") + 2), ["--mode", "free-response"]);
  assert.equal(startArgs[startArgs.indexOf("--activity-type") + 1], "contrastive-case");
  const answerArgs = h.calls[2].args;
  assert.equal(answerArgs[answerArgs.indexOf("--text-answer") + 1], response.textAnswer);
  assert.equal(answerArgs[answerArgs.indexOf("--confidence") + 1], "82");
  assert.ok(Number(answerArgs[answerArgs.indexOf("--response-time-ms") + 1]) >= 0);
  assert.match(result.content[0].text, /awaiting.*assessment/i);
});

test("Pi free-response I don't know commits through one atomic submit command", async () => {
  const h = responseToolHarness({
    textAnswer: "",
    confidence: 35,
    note: "I need the contextual representation mechanism taught.",
    dontKnow: true,
  });
  const result = await h.tools.get("adaptive_learning_response").execute(
    "response-gap-call-1",
    freeResponseQuestion(),
    undefined,
    undefined,
    h.ctx,
  );

  assert.deepEqual(h.calls.map((call) => call.command), [
    "pending-question",
    "start-question",
    "submit-question",
  ]);
  assert.match(result.content[0].text, /I don't know/i);
});

test("closing a newly persisted free response pauses it without cancelling the checkpoint", async () => {
  const h = responseToolHarness(null);
  const result = await h.tools.get("adaptive_learning_response").execute(
    "response-pause-call-1",
    freeResponseQuestion(),
    undefined,
    undefined,
    h.ctx,
  );

  assert.deepEqual(h.calls.map((call) => call.command), ["pending-question", "start-question"]);
  assert.match(result.content[0].text, /closed without an answer.*remains persisted/is);
  assert.equal(result.details.question.status, "awaiting-answer");
});

test("Pi assessment tool grades the exact persisted answer and records a misconception", async () => {
  const h = responseToolHarness(
    {
      textAnswer: "Attention changes the token ID.",
      confidence: 90,
      dontKnow: false,
    },
    { pendingForAssessment: true },
  );
  const result = await h.tools.get("adaptive_learning_assess_response").execute(
    "assessment-call-1",
    {
      id: "assessment-free-1",
      questionId: "probe-free-1",
      grade: "incorrect",
      evidence: "The answer changes token identity instead of the contextual hidden representation.",
      mistakeType: "identity-versus-representation",
      misconceptionId: "misconception-token-id",
      misconceptionStatement: "Attention changes token IDs rather than hidden representations.",
      counterexample: "A repeated token keeps one ID while acquiring different hidden states.",
      repair: "Separate token identity from contextual hidden state.",
    },
    undefined,
    undefined,
    h.ctx,
  );

  assert.deepEqual(h.calls.map((call) => call.command), ["pending-question", "record-assessment"]);
  const args = h.calls[1].args;
  assert.equal(args[args.indexOf("--answer") + 1], "Attention changes the token ID.");
  assert.equal(args[args.indexOf("--misconception-statement") + 1], "Attention changes token IDs rather than hidden representations.");
  assert.match(result.content[0].text, /^Incorrect\./);
  assert.match(result.content[0].text, /contextual hidden representation/);
});

test("free-response controller keeps answer, confidence, note, and I don't know on one surface", async () => {
  let submitted = null;
  let completed = null;
  const controller = createResponseController({
    question: freeResponseQuestion(),
    requestRender() {},
    done(value) { completed = value; },
    submit: async (value) => {
      submitted = value;
      return { status: "awaiting-assessment", responses: [{ ...value }] };
    },
  });

  assert.match(controller.render(100).join("\n"), /YOUR ANSWER.*Confidence.*Note.*I don't know/s);
  controller.handleInput("The token ID stays fixed while its hidden state changes.");
  controller.handleInput("\t");
  controller.handleInput("85");
  controller.handleInput("\t");
  controller.handleInput("Useful distinction.");
  controller.handleInput("\t");
  controller.handleInput("\r");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(submitted, {
    textAnswer: "The token ID stays fixed while its hidden state changes.",
    confidence: 85,
    note: "Useful distinction.",
    dontKnow: false,
  });
  assert.match(controller.render(100).join("\n"), /saved.*assessment/i);
  controller.handleInput("\r");
  assert.equal(completed.status, "awaiting-assessment");
});

test("free-response controller turns a long multipart checkpoint into a bounded reading layout", () => {
  const controller = createResponseController({
    question: freeResponseQuestion({
      question: "Prerequisite checkpoint; all inputs are provided. X and Y are independent, and these four (X,Y) pairs are equally likely: (-2,-1), (-2,+1), (+2,-1), (+2,+1). Let S=X+Y. Give four labeled parts: (1) E[X] and Var(X), (2) E[Y] and Var(Y), (3) the four S values and Var(S), and (4) verify Var(S)=Var(X)+Var(Y), then explain in one sentence why this distribution-level calculation needs no additional observed Q/K vector values.",
    }),
    requestRender() {},
    done() {},
    submit() {},
  });

  const lines = controller.render(200);
  const rendered = lines.join("\n");

  assert.ok(Math.max(...lines.map((line) => visibleWidth(line))) <= 88);
  assert.match(rendered, /CHECKPOINT/);
  assert.match(rendered, /^│\s+1\. E\[X\] and Var\(X\)/m);
  assert.match(rendered, /^│\s+2\. E\[Y\] and Var\(Y\)/m);
  assert.match(rendered, /^│\s+3\. the four S values and Var\(S\)/m);
  assert.match(rendered, /^│\s+4\. verify Var\(S\)=Var\(X\)\+Var\(Y\)/m);
  assert.match(rendered, /^│\s+distribution-level calculation/m);
});

test("free-response controller keeps unused fields compact and gives the learner a clear next action", () => {
  const controller = createResponseController({
    question: freeResponseQuestion(),
    requestRender() {},
    done() {},
    submit() {},
  });

  const lines = controller.render(100);
  const rendered = lines.join("\n");

  assert.match(rendered, /YOUR ANSWER · EDITING/);
  assert.match(rendered, /Type your answer/);
  assert.match(rendered, /OPTIONAL/);
  assert.match(rendered, /Confidence 0-100 \(optional\): —/);
  assert.match(rendered, /Note \(optional\): —/);
  assert.match(rendered, /ACTIONS/);
  assert.match(rendered, /Paste works · arrows edit · Tab next · Ctrl\+J new line/);
  assert.match(rendered, /Shift\+Tab back/);
  assert.doesNotMatch(rendered, /Down actions/);
  assert.ok(lines.filter((line) => line === "").length <= 6);
});
