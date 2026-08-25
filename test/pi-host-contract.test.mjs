import assert from "node:assert/strict";
import test from "node:test";

import {
  KeybindingsManager,
  TUI_KEYBINDINGS,
} from "@earendil-works/pi-tui";

import { createQuizController } from "../.pi/extensions/adaptive-learning.js";

const KEY = {
  enter: "\x1b[13u",
  escape: "\x1b[27u",
  tab: "\x1b[9u",
  down: "\x1b[1;1B",
  backspace: "\x1b[127u",
  newline: "\x1b[106;5u",
  space: "\x1b[32u",
  a: "\x1b[97u",
  b: "\x1b[98u",
  c: "\x1b[99u",
};

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

function controllerHarness({ quiz = question(), keybindings, submit } = {}) {
  let completed = Symbol("not-completed");
  let submitted = null;
  const controller = createQuizController({
    question: quiz,
    requestRender() {},
    done(value) { completed = value; },
    keybindings: keybindings ?? new KeybindingsManager(TUI_KEYBINDINGS),
    submit: submit ?? (async (response) => {
      submitted = response;
      return { status: "resolved", responses: [{ ...response, correct: true }] };
    }),
  });
  return {
    controller,
    completed: () => completed,
    submitted: () => submitted,
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("Pi 0.84 modern Down and Enter input selects and submits an answer", async () => {
  const h = controllerHarness();

  h.controller.handleInput(KEY.down);
  h.controller.handleInput(KEY.enter);
  await flush();

  assert.deepEqual(h.submitted(), {
    selectedChoiceValues: ["context"],
    dontKnow: false,
  });
});

test("Pi 0.84 modern Enter dismisses persisted feedback", async () => {
  const h = controllerHarness();

  h.controller.handleInput(KEY.enter);
  await flush();
  assert.equal(h.completed().description, "not-completed");

  h.controller.handleInput(KEY.enter);
  assert.equal(h.completed().status, "resolved");
});

test("Pi 0.84 note editing accepts Tab, printable keys, Backspace, newline, and Enter", async () => {
  const h = controllerHarness();

  h.controller.handleInput(KEY.tab);
  h.controller.handleInput(KEY.a);
  h.controller.handleInput(KEY.b);
  h.controller.handleInput(KEY.backspace);
  h.controller.handleInput(KEY.newline);
  h.controller.handleInput(KEY.c);
  h.controller.handleInput(KEY.enter);
  h.controller.handleInput(KEY.down);
  h.controller.handleInput(KEY.enter);
  await flush();

  assert.deepEqual(h.submitted(), {
    selectedChoiceValues: ["context"],
    dontKnow: false,
    note: "a\nc",
  });
});

test("Pi 0.84 bracketed paste is captured as note text without paste markers", async () => {
  const h = controllerHarness();

  h.controller.handleInput(KEY.tab);
  h.controller.handleInput("\x1b[200~first line\nsecond line\x1b[201~");
  h.controller.handleInput(KEY.enter);
  h.controller.handleInput(KEY.down);
  h.controller.handleInput(KEY.enter);
  await flush();

  assert.equal(h.submitted().note, "first line\nsecond line");
});

test("Pi 0.84 modern Escape cancels a quiz before any answer is submitted", () => {
  const h = controllerHarness();

  h.controller.handleInput(KEY.escape);

  assert.equal(h.completed(), null);
  assert.equal(h.submitted(), null);
});

test("Pi 0.84 modern Space toggles a multi-select choice before confirmation", async () => {
  const h = controllerHarness({
    quiz: question({ mode: "multi-select", correctChoiceValues: ["context"] }),
  });

  h.controller.handleInput(KEY.down);
  h.controller.handleInput(KEY.space);
  h.controller.handleInput(KEY.down);
  h.controller.handleInput(KEY.down);
  h.controller.handleInput(KEY.enter);
  await flush();

  assert.deepEqual(h.submitted(), {
    selectedChoiceValues: ["context"],
    dontKnow: false,
  });
});

test("quiz actions honor learner-configured Pi keybindings", async () => {
  const keybindings = new KeybindingsManager(TUI_KEYBINDINGS, {
    "tui.select.confirm": "ctrl+x",
  });
  const h = controllerHarness({ keybindings });

  h.controller.handleInput("\x1b[120;5u");
  await flush();

  assert.deepEqual(h.submitted(), {
    selectedChoiceValues: ["position"],
    dontKnow: false,
  });
});

test("quiz rendering removes terminal control sequences from learning content", () => {
  const h = controllerHarness({
    quiz: question({
      question: "What is \x1b[31mred\x1b[0m?",
      choices: [
        { value: "red", label: "\x1b[31mRed\x1b[0m" },
        { value: "blue", label: "Blue" },
      ],
    }),
  });

  const output = h.controller.render(100).join("\n");
  assert.doesNotMatch(output, /\x1b/);
  assert.match(output, /What is red\?/);
  assert.match(output, /Red/);
});
