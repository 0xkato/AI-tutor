import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeKittyPrintable,
  Editor,
  matchesKey,
  stripTerminalSequences,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  DEFAULT_PROJECT_MODEL,
  hasExplicitStartupSelection,
  readProjectModelPreference,
  writeProjectModelPreference,
} from "../../src/pi-model-preference.mjs";

const extensionDir = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(extensionDir, "..", "..");
const defaultCliPath = path.join(repository, "bin", "learn.mjs");
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const INTERACTIVE_QUIZ_STAGES = new Set(["probe", "teach"]);
const LEARNING_PANEL_MAX_WIDTH = 76;
const RESPONSE_PANEL_MAX_WIDTH = 88;

function modelMatches(left, right) {
  return left?.provider === right?.provider && left?.id === right?.id;
}

const QuizChoice = Type.Object({
  value: Type.String({ description: "Stable value used for grading." }),
  label: Type.String({ description: "Choice text shown to the learner." }),
  description: Type.Optional(Type.String({ description: "Optional supporting detail." })),
});

const AdaptiveQuizParameters = Type.Object({
  id: Type.String({ description: "Stable question identifier." }),
  stage: Type.Union([
    Type.Literal("probe"),
    Type.Literal("teach"),
  ]),
  nodeId: Type.String({ description: "Concept or prerequisite strand being tested." }),
  kind: Type.Literal("multiple-choice"),
  question: Type.String({ description: "One fully framed multiple-choice question." }),
  mode: Type.Union([Type.Literal("single-select"), Type.Literal("multi-select")]),
  choices: Type.Array(QuizChoice, { minItems: 2, maxItems: 12 }),
  correctChoiceValues: Type.Array(Type.String(), { minItems: 1 }),
  explanation: Type.String({
    description: "Explanation available only after retry-safe persistence permits it.",
  }),
  parentQuestionId: Type.Optional(Type.String({
    description: "Required after the first item: the prior question that caused this branch.",
  })),
  adaptationReason: Type.Optional(Type.String({
    description: "Required after the first item: what the prior response changed.",
  })),
});

const AdaptiveResumeParameters = Type.Object({
  questionId: Type.String({
    description: "Exact identifier of the unresolved persisted question to reopen in the native Pi UI.",
  }),
});

const AdaptiveResponseParameters = Type.Object({
  id: Type.String({ description: "Stable question identifier." }),
  stage: Type.Union([Type.Literal("probe"), Type.Literal("teach")]),
  nodeId: Type.String({ description: "Concept or prerequisite strand being tested." }),
  kind: Type.Union([
    Type.Literal("explanation"),
    Type.Literal("prediction"),
    Type.Literal("transfer"),
    Type.Literal("contrastive"),
    Type.Literal("reconstruction"),
    Type.Literal("debugging"),
  ]),
  question: Type.String({ description: "One fully framed prompt answered in the learner's own words." }),
  activityType: Type.Optional(Type.String({ description: "Adaptive activity selected from durable evidence." })),
  strategyReason: Type.Optional(Type.String({ description: "Why this activity is the next useful learning move." })),
  supportLevel: Type.Optional(Type.Integer({ minimum: 0, maximum: 4 })),
  transferLevel: Type.Optional(Type.Integer({ minimum: 0, maximum: 4 })),
  parentQuestionId: Type.Optional(Type.String({ description: "Prior resolved question that caused this branch." })),
  adaptationReason: Type.Optional(Type.String({ description: "What the prior response changed." })),
});

const AdaptiveAssessmentParameters = Type.Object({
  id: Type.String({ description: "Stable assessment identifier." }),
  questionId: Type.String({ description: "Persisted free-response question being assessed." }),
  grade: Type.Union([
    Type.Literal("correct"),
    Type.Literal("partial"),
    Type.Literal("incorrect"),
  ]),
  evidence: Type.String({ description: "Exact demonstrated, missing, or incorrect mechanism." }),
  mistakeType: Type.Optional(Type.String({ description: "Specific mistake category when not correct." })),
  contaminated: Type.Optional(Type.Boolean({ description: "Exclude evidence if the answer was exposed." })),
  misconceptionId: Type.Optional(Type.String({ description: "Stable misconception identifier." })),
  misconceptionStatement: Type.Optional(Type.String({ description: "Specific misconception expressed by the persisted answer." })),
  counterexample: Type.Optional(Type.String({ description: "Case that distinguishes the misconception from the correct mechanism." })),
  repair: Type.Optional(Type.String({ description: "Mechanism-level correction for the misconception." })),
  resolveMisconceptionIds: Type.Optional(Type.Array(Type.String(), { description: "Misconceptions repaired by durable evidence." })),
});

class AdaptiveLearningCliError extends Error {
  constructor(message, code = "CLI_ERROR", details = {}) {
    super(message);
    this.name = "AdaptiveLearningCliError";
    this.code = code;
    Object.assign(this, details);
  }
}

function parseOutput(stdout, command) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new AdaptiveLearningCliError(
      `Adaptive-learning CLI returned invalid JSON for ${command}: ${error.message}`,
      "INVALID_CLI_OUTPUT",
    );
  }
}

function failureFromExit(command, stdout, stderr) {
  let payload = null;
  if (stdout.trim()) {
    try {
      payload = JSON.parse(stdout);
    } catch {
      payload = null;
    }
  }
  if (payload?.stateCommitted === true && payload.render?.ok === false) {
    const revision = payload.stateRevision;
    const renderMessage = payload.render.error ?? "The Obsidian projection could not be updated.";
    return new AdaptiveLearningCliError(
      `State revision ${revision} was committed, but Obsidian rendering failed: ${renderMessage} Run repair-render for this learning root before continuing.`,
      payload.render.code ?? "RENDER_FAILED",
      {
        stateCommitted: true,
        stateRevision: revision,
        render: payload.render,
        repair: { command: "repair-render", root: null },
      },
    );
  }
  const message = (stderr || stdout || `Command failed: ${command}`).trim();
  const code = /^\[([A-Z][A-Z0-9_]*)\]/.exec(message)?.[1] ?? "CLI_ERROR";
  return new AdaptiveLearningCliError(message, code);
}

export function runAdaptiveLearningCli(
  command,
  args,
  root,
  {
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
    cliPath: selectedCliPath = defaultCliPath,
    executable = process.execPath,
  } = {},
) {
  if (signal?.aborted) {
    return Promise.reject(
      new AdaptiveLearningCliError(`Adaptive-learning CLI command ${command} was cancelled.`, "CLI_ABORTED"),
    );
  }

  return new Promise((resolve, reject) => {
    const child = spawn(executable, [selectedCliPath, command, ...args, "--root", root, "--json"], {
      cwd: repository,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    let capturedBytes = 0;
    let settled = false;
    let terminalError = null;
    let forceKillTimer = null;

    const cleanup = () => {
      clearTimeout(timeout);
      if (forceKillTimer !== null) clearTimeout(forceKillTimer);
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const stopChild = (error) => {
      if (settled || terminalError) return;
      terminalError = error;
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 250);
    };
    const capture = (target, chunk) => {
      if (terminalError || settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      capturedBytes += buffer.length;
      if (capturedBytes > maxOutputBytes) {
        stopChild(
          new AdaptiveLearningCliError(
            `Adaptive-learning CLI output exceeded ${maxOutputBytes} bytes for ${command}.`,
            "CLI_OUTPUT_LIMIT",
          ),
        );
        return;
      }
      target.push(buffer);
    };
    const onAbort = () => {
      stopChild(
        new AdaptiveLearningCliError(
          `Adaptive-learning CLI command ${command} was cancelled.`,
          "CLI_ABORTED",
        ),
      );
    };
    const timeout = setTimeout(() => {
      stopChild(
        new AdaptiveLearningCliError(
          `Adaptive-learning CLI command ${command} timed out after ${timeoutMs}ms.`,
          "CLI_TIMEOUT",
        ),
      );
    }, timeoutMs);

    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk) => capture(stdout, chunk));
    child.stderr.on("data", (chunk) => capture(stderr, chunk));
    child.once("error", (error) => {
      finish(
        reject,
        new AdaptiveLearningCliError(
          `Could not start adaptive-learning CLI command ${command}: ${error.message}`,
          "CLI_SPAWN_FAILED",
          { cause: error },
        ),
      );
    });
    child.once("close", (code) => {
      if (terminalError) {
        finish(reject, terminalError);
        return;
      }
      const stdoutText = Buffer.concat(stdout).toString("utf8");
      const stderrText = Buffer.concat(stderr).toString("utf8");
      if (code !== 0) {
        const error = failureFromExit(command, stdoutText, stderrText);
        if (error.stateCommitted === true) error.repair.root = root;
        finish(reject, error);
        return;
      }
      try {
        finish(resolve, parseOutput(stdoutText, command));
      } catch (error) {
        finish(reject, error);
      }
    });
  });
}

function parseTarget(raw) {
  const input = raw.trim();
  if (!input) return null;
  const separator = input.indexOf("::");
  if (separator === -1) return { topic: input, target: input };
  const topic = input.slice(0, separator).trim();
  const target = input.slice(separator + 2).trim();
  if (!topic || !target) {
    throw new AdaptiveLearningCliError(
      "Use /teach <target> or /teach <topic> :: <specific learning target>.",
      "INVALID_TARGET",
    );
  }
  return { topic, target };
}

function parseSourceGuidedTarget(raw) {
  const input = raw.trim();
  if (!input) return null;
  const separator = input.indexOf("::");
  if (separator === -1) {
    throw new AdaptiveLearningCliError(
      "Use /teach-from <source> :: <specific learning target>.",
      "INVALID_SOURCE_GUIDE",
    );
  }
  const suppliedReference = input.slice(0, separator).trim();
  const target = input.slice(separator + 2).trim();
  if (!suppliedReference || !target) {
    throw new AdaptiveLearningCliError(
      "Use /teach-from <source> :: <specific learning target>.",
      "INVALID_SOURCE_GUIDE",
    );
  }
  const reference = /^(?:https?:\/\/|local:)/i.test(suppliedReference)
    ? suppliedReference
    : `local:${suppliedReference}`;
  return { reference, topic: target, target };
}

const PROFILE_FIELDS = new Map([
  ["teaching", "--teaching-philosophy"],
  ["philosophy", "--teaching-philosophy"],
  ["explanations", "--explanation-preferences"],
  ["explanation", "--explanation-preferences"],
  ["feedback", "--feedback-preferences"],
  ["visuals", "--visual-preferences"],
  ["visual", "--visual-preferences"],
  ["sources", "--source-preferences"],
  ["source", "--source-preferences"],
]);

function parseProfileUpdate(raw) {
  const input = raw.trim();
  if (!input) return null;
  const separator = input.indexOf("::");
  if (separator === -1) return ["--teaching-philosophy", input];
  const field = input.slice(0, separator).trim().toLowerCase();
  const value = input.slice(separator + 2).trim();
  const flag = PROFILE_FIELDS.get(field);
  if (!flag || !value) {
    throw new AdaptiveLearningCliError(
      "Use /learn-profile <teaching philosophy> or /learn-profile <teaching|explanations|feedback|visuals|sources> :: <preference>.",
      "INVALID_PROFILE_UPDATE",
    );
  }
  return [flag, value];
}

function profileSummary(profile) {
  const defaultStatus = "Built-in default active (optional customization)";
  const entries = [
    ["Teaching", profile.teachingPhilosophy],
    ["Explanations", profile.explanationPreferences],
    ["Feedback", profile.feedbackPreferences],
    ["Visuals", profile.visualPreferences],
    ["Sources", profile.sourcePreferences],
  ];
  return entries
    .map(([label, value]) => `${label}: ${value || defaultStatus}`)
    .join("\n");
}

function notifyError(ctx, error) {
  const message = error instanceof Error ? error.message : String(error);
  ctx.ui.notify(message, error?.stateCommitted === true ? "warning" : "error");
}

function dispatchSkill(pi, message) {
  pi.sendUserMessage(`/skill:adaptive-learning ${message}`, { expandPromptTemplates: true });
}

function runOptions(ctx, suppliedSignal) {
  const signal = suppliedSignal ?? ctx.abortSignal ?? ctx.signal;
  return signal ? { signal } : {};
}

function plainLines(text, width, indent = "") {
  const limit = Math.max(1, width - indent.length);
  const output = [];
  const safeText = stripTerminalSequences(String(text ?? ""));
  for (const paragraph of safeText.split("\n")) {
    if (paragraph.length === 0) {
      output.push(indent);
      continue;
    }
    const words = paragraph.split(/\s+/);
    let line = "";
    for (const word of words) {
      if (line && line.length + 1 + word.length > limit) {
        output.push(`${indent}${line}`.slice(0, width));
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
      while (line.length > limit) {
        output.push(`${indent}${line.slice(0, limit)}`.slice(0, width));
        line = line.slice(limit);
      }
    }
    output.push(`${indent}${line}`.slice(0, width));
  }
  return output;
}

function learningPanelWidth(width) {
  const availableWidth = Number.isFinite(width) ? width : LEARNING_PANEL_MAX_WIDTH;
  return Math.max(1, Math.min(availableWidth, LEARNING_PANEL_MAX_WIDTH));
}

function responsePanelWidth(width) {
  const availableWidth = Number.isFinite(width) ? width : RESPONSE_PANEL_MAX_WIDTH;
  return Math.max(1, Math.min(availableWidth, RESPONSE_PANEL_MAX_WIDTH));
}

function numberedItemLines(number, item, width) {
  const prefix = `  ${number}. `;
  const continuation = " ".repeat(prefix.length);
  const bodyLines = plainLines(item, Math.max(1, width - prefix.length));
  return bodyLines.map((line, index) =>
    `${index === 0 ? prefix : continuation}${line}`.slice(0, width));
}

function readableQuestionLines(text, width) {
  const safeText = stripTerminalSequences(String(text ?? ""));
  const markers = [...safeText.matchAll(/(?:^|\s)\((\d+)\)\s+/g)];
  const isNumberedSequence =
    markers.length >= 2 &&
    markers.every((match, index) => Number(match[1]) === index + 1);
  if (!isNumberedSequence) return plainLines(safeText, width);

  const lines = [];
  const introduction = safeText.slice(0, markers[0].index).trim();
  if (introduction) lines.push(...plainLines(introduction, width));
  for (const [index, marker] of markers.entries()) {
    const start = marker.index + marker[0].length;
    const end = markers[index + 1]?.index ?? safeText.length;
    const item = safeText.slice(start, end).trim();
    lines.push(...numberedItemLines(marker[1], item, width));
  }
  return lines;
}

function wrapPreservingIndent(line, width) {
  const value = String(line ?? "");
  const indent = /^\s*/.exec(value)?.[0] ?? "";
  return plainLines(value.slice(indent.length), width, indent);
}

function staticTextComponent(lines) {
  return {
    render(width) {
      return lines.flatMap((line) => plainLines(line, width));
    },
    invalidate() {},
  };
}

function lastCodePoint(value) {
  const points = Array.from(value);
  points.pop();
  return points.join("");
}

export function createQuizController({ question, requestRender, done, submit, keybindings }) {
  let optionIndex = 0;
  let focus = "options";
  let note = "";
  let confidence = "";
  let phase = "select";
  let result = null;
  let failure = null;
  let pasteBuffer = null;
  const selected = new Set();
  const multi = question.mode === "multi-select";
  const dontKnowIndex = question.choices.length;
  const submitIndex = multi ? question.choices.length + 1 : null;
  const finalIndex = submitIndex ?? dontKnowIndex;

  function refresh() {
    requestRender();
  }

  function responseFor(values, dontKnow) {
    const trimmed = note.trim();
    return {
      selectedChoiceValues: values,
      dontKnow,
      ...(confidence === "" ? {} : { confidence: Number(confidence) }),
      ...(trimmed ? { note: trimmed } : {}),
    };
  }

  function beginSubmit(response) {
    phase = "saving";
    failure = null;
    refresh();
    Promise.resolve(submit(response)).then(
      (value) => {
        result = value;
        phase = "feedback";
        refresh();
      },
      (error) => {
        failure = error instanceof Error ? error : new Error(String(error));
        phase = "error";
        refresh();
      },
    );
  }

  function matchesAction(data, action, rawFallbacks = []) {
    return keybindings?.matches?.(data, action) || rawFallbacks.includes(data);
  }

  function cleanNoteText(value) {
    return stripTerminalSequences(String(value))
      .replace(/\r\n?/g, "\n")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  }

  function appendNoteInput(data) {
    const pasteStart = "\x1b[200~";
    const pasteEnd = "\x1b[201~";

    if (pasteBuffer !== null) {
      pasteBuffer += data;
      const endIndex = pasteBuffer.indexOf(pasteEnd);
      if (endIndex === -1) return true;
      note += cleanNoteText(pasteBuffer.slice(0, endIndex));
      pasteBuffer = null;
      return true;
    }

    const startIndex = data.indexOf(pasteStart);
    if (startIndex !== -1) {
      note += cleanNoteText(data.slice(0, startIndex));
      const pasted = data.slice(startIndex + pasteStart.length);
      const endIndex = pasted.indexOf(pasteEnd);
      if (endIndex === -1) pasteBuffer = pasted;
      else note += cleanNoteText(pasted.slice(0, endIndex));
      return true;
    }

    const printable = decodeKittyPrintable(data);
    if (printable !== undefined) {
      note += cleanNoteText(printable);
      return true;
    }
    if (!data.startsWith("\x1b")) {
      note += cleanNoteText(data);
      return true;
    }
    return false;
  }

  function handleInput(data) {
    if (phase === "saving") return;
    if (phase === "feedback") {
      if (
        matchesAction(data, "tui.select.confirm", ["\r", "\n"])
        || matchesAction(data, "tui.select.cancel", ["\x1b"])
      ) done(result);
      return;
    }
    if (phase === "error") {
      if (
        matchesAction(data, "tui.select.confirm", ["\r", "\n"])
        || matchesAction(data, "tui.select.cancel", ["\x1b"])
      ) done({ error: failure });
      return;
    }

    if (matchesAction(data, "tui.input.tab", ["\t"])) {
      focus = { options: "note", note: "confidence", confidence: "options" }[focus];
      refresh();
      return;
    }
    if (focus === "confidence") {
      if (matchesAction(data, "tui.select.cancel", ["\x1b"])) {
        focus = "options";
      } else if (
        matchesAction(data, "tui.input.submit", ["\r"]) ||
        matchesAction(data, "tui.select.confirm", ["\r"])
      ) {
        focus = "options";
      } else if (matchesAction(data, "tui.editor.deleteCharBackward", ["\x7f", "\b"])) {
        confidence = lastCodePoint(confidence);
      } else {
        const printable = decodeKittyPrintable(data);
        const value = printable === undefined && !data.startsWith("\x1b") ? data : printable ?? "";
        const digits = String(value).replace(/\D/g, "");
        const next = `${confidence}${digits}`.slice(0, 3);
        if (next === "" || Number(next) <= 100) confidence = next;
      }
      refresh();
      return;
    }
    if (focus === "note") {
      if (matchesAction(data, "tui.select.cancel", ["\x1b"])) {
        focus = "options";
      } else if (
        matchesAction(data, "tui.input.submit", ["\r"])
        || matchesAction(data, "tui.select.confirm", ["\r"])
      ) {
        focus = "options";
      } else if (matchesAction(data, "tui.editor.deleteCharBackward", ["\x7f", "\b"])) {
        note = lastCodePoint(note);
      } else if (matchesAction(data, "tui.input.newLine", ["\n"])) {
        note += "\n";
      } else appendNoteInput(data);
      refresh();
      return;
    }

    if (matchesAction(data, "tui.select.up", ["\x1b[A"])) {
      optionIndex = Math.max(0, optionIndex - 1);
      refresh();
      return;
    }
    if (matchesAction(data, "tui.select.down", ["\x1b[B"])) {
      optionIndex = Math.min(finalIndex, optionIndex + 1);
      refresh();
      return;
    }
    if (matchesAction(data, "tui.select.cancel", ["\x1b"])) {
      done(null);
      return;
    }
    const confirm = matchesAction(data, "tui.select.confirm", ["\r", "\n"]);
    const toggle = confirm || matchesKey(data, "space") || data === " ";
    if (!toggle) return;

    if (optionIndex === dontKnowIndex) {
      if (confirm) beginSubmit(responseFor([], true));
      return;
    }
    if (multi && optionIndex === submitIndex) {
      if (confirm && selected.size > 0) beginSubmit(responseFor([...selected], false));
      return;
    }
    const value = question.choices[optionIndex].value;
    if (multi) {
      if (selected.has(value)) selected.delete(value);
      else selected.add(value);
      refresh();
      return;
    }
    beginSubmit(responseFor([value], false));
  }

  function render(width) {
    const panelWidth = learningPanelWidth(width);
    const rule = "─".repeat(panelWidth);
    const lines = [rule, "QUESTION", ...readableQuestionLines(question.question, panelWidth)];

    if (phase === "feedback") {
      const latest = result?.responses?.at(-1) ?? null;
      lines.push(rule);
      if (result?.status === "gap" || latest?.dontKnow) {
        lines.push("I don't know recorded. This is an admitted gap, not a guess.");
      } else if (latest?.correct) {
        lines.push("Correct.");
        const explanation = result?.explanation ?? question.explanation;
        if (explanation) lines.push("", ...plainLines(explanation, width));
      } else if (result?.status === "retry-required") {
        lines.push("Incorrect - retry required.");
        lines.push("The answer and explanation are withheld for the same-question retry.");
      } else {
        lines.push("Incorrect. The persisted retry state now permits teaching.");
        const explanation = result?.explanation ?? question.explanation;
        if (explanation) lines.push("", ...plainLines(explanation, width));
      }
      if (note.trim()) lines.push("", ...plainLines(`Your note: ${note.trim()}`, width));
      if (confidence !== "") lines.push(...plainLines(`Confidence: ${confidence}%`, width));
      lines.push("", "Enter or Esc to continue");
      lines.push(rule);
      return lines.flatMap((line) => wrapPreservingIndent(line, panelWidth));
    }
    if (phase === "saving") {
      lines.push(rule, "Saving your answer before feedback...", rule);
      return lines.flatMap((line) => wrapPreservingIndent(line, panelWidth));
    }
    if (phase === "error") {
      lines.push(rule, `Could not persist this answer: ${failure?.message ?? "Unknown error"}`);
      lines.push("Enter or Esc to close without advancing.", rule);
      return lines.flatMap((line) => wrapPreservingIndent(line, panelWidth));
    }

    lines.push(rule, "CHOICES");
    for (const [index, choice] of question.choices.entries()) {
      const focused = focus === "options" && optionIndex === index ? ">" : " ";
      const checked = multi ? (selected.has(choice.value) ? "[x]" : "[ ]") : `${index + 1}.`;
      lines.push(`${focused} ${checked} ${choice.label}`);
      if (choice.description) lines.push(...plainLines(choice.description, panelWidth, "     "));
    }
    lines.push(`${focus === "options" && optionIndex === dontKnowIndex ? ">" : " "} I don't know`);
    if (multi) {
      lines.push(`${focus === "options" && optionIndex === submitIndex ? ">" : " "} Submit selected choices`);
    }
    if (focus === "note") {
      lines.push("Note (optional) · editing");
      lines.push(...plainLines(note || "Type a note…", panelWidth, "> "));
    } else if (note.trim()) {
      lines.push(...plainLines(`Note (optional): ${note}`, panelWidth));
    } else {
      lines.push("Note (optional): —");
    }
    lines.push(
      focus === "confidence"
        ? `Confidence 0-100 (optional) · editing: ${confidence || "—"}`
        : `Confidence 0-100 (optional): ${confidence || "—"}`,
      "",
    );
    lines.push(
      focus === "note"
        ? "Type note · Ctrl+J new line · Enter back · Tab confidence"
        : focus === "confidence"
          ? "Type 0–100 · Enter choices · Tab choices · Esc back"
          : multi
            ? "Up/Down move · Space/Enter select · Tab note/confidence · Esc pause"
            : "Up/Down move · Enter answer · Tab note/confidence · Esc pause",
    );
    lines.push(rule);
    return lines.flatMap((line) => wrapPreservingIndent(line, panelWidth));
  }

  return { render, invalidate() {}, handleInput };
}

function identityEditorTheme(theme) {
  const color = (name, value) => theme?.fg?.(name, value) ?? value;
  return {
    borderColor: (value) => color("accent", value),
    selectList: {
      selectedPrefix: (value) => color("accent", value),
      selectedText: (value) => color("accent", value),
      description: (value) => color("muted", value),
      scrollInfo: (value) => color("dim", value),
      noMatch: (value) => color("warning", value),
    },
  };
}

function fitVisibleLine(value, width) {
  const missing = Math.max(0, width - visibleWidth(value));
  return `${value}${" ".repeat(missing)}`;
}

export function createResponseController({
  question,
  requestRender,
  done,
  submit,
  keybindings,
  answerEditor,
  theme,
  tui,
}) {
  let focus = "answer";
  let confidence = "";
  let note = "";
  let actionIndex = 0;
  let phase = "input";
  let result = null;
  let failure = null;

  const refresh = () => requestRender();
  const color = (name, value) => theme?.fg?.(name, value) ?? value;
  const editor = answerEditor ?? new Editor(
    tui ?? { requestRender, terminal: { rows: 40 } },
    identityEditorTheme(theme),
  );
  editor.disableSubmit = true;
  editor.focused = true;
  const matchesAction = (data, action, fallbacks = []) =>
    keybindings?.matches?.(data, action) || fallbacks.includes(data);
  const cleanText = (value) => stripTerminalSequences(String(value))
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  const printableText = (data) => {
    const printable = decodeKittyPrintable(data);
    if (printable !== undefined) return cleanText(printable);
    if (!data.startsWith("\x1b")) return cleanText(data);
    return "";
  };
  const validConfidence = () =>
    confidence === "" || (/^\d{1,3}$/.test(confidence) && Number(confidence) <= 100);

  function response(dontKnow) {
    const answer = editor.getExpandedText().trim();
    return {
      ...(dontKnow ? {} : { textAnswer: answer }),
      ...(confidence === "" ? {} : { confidence: Number(confidence) }),
      ...(note.trim() ? { note: note.trim() } : {}),
      dontKnow,
    };
  }

  function beginSubmit(value) {
    phase = "saving";
    refresh();
    Promise.resolve(submit(value)).then(
      (saved) => {
        result = saved;
        phase = "feedback";
        refresh();
      },
      (error) => {
        failure = error instanceof Error ? error : new Error(String(error));
        phase = "error";
        refresh();
      },
    );
  }

  function appendToFocused(data) {
    const text = printableText(data);
    if (!text) return;
    if (focus === "note") note += text;
    else if (focus === "confidence") confidence += text.replace(/\D/g, "").slice(0, 3 - confidence.length);
  }

  function deleteFromFocused() {
    if (focus === "note") note = lastCodePoint(note);
    else if (focus === "confidence") confidence = lastCodePoint(confidence);
  }

  function setFocus(nextFocus) {
    focus = nextFocus;
    editor.focused = focus === "answer";
    refresh();
  }

  function handleInput(data) {
    if (phase === "saving") return;
    if (["feedback", "error"].includes(phase)) {
      if (
        matchesAction(data, "tui.select.confirm", ["\r", "\n"]) ||
        matchesAction(data, "tui.select.cancel", ["\x1b"])
      ) done(phase === "error" ? { error: failure } : result);
      return;
    }

    if (matchesKey(data, "shift+tab")) {
      setFocus({
        answer: "actions",
        confidence: "answer",
        note: "confidence",
        actions: "note",
      }[focus]);
      return;
    }
    if (matchesAction(data, "tui.input.tab", ["\t"])) {
      setFocus({
        answer: "confidence",
        confidence: "note",
        note: "actions",
        actions: "answer",
      }[focus]);
      return;
    }
    if (focus === "actions") {
      if (matchesAction(data, "tui.select.cancel", ["\x1b"])) {
        done(null);
        return;
      }
      if (matchesAction(data, "tui.select.up", ["\x1b[A"])) {
        if (actionIndex === 0) {
          setFocus("answer");
          return;
        }
        actionIndex = 0;
      }
      else if (matchesAction(data, "tui.select.down", ["\x1b[B"])) actionIndex = 1;
      else if (matchesAction(data, "tui.select.confirm", ["\r", "\n"])) {
        if (actionIndex === 1) beginSubmit(response(true));
        else if (editor.getExpandedText().trim() && validConfidence()) beginSubmit(response(false));
      }
      refresh();
      return;
    }
    if (matchesAction(data, "tui.select.cancel", ["\x1b"])) {
      setFocus("actions");
      return;
    }
    if (focus === "answer") {
      if (matchesAction(data, "tui.input.submit", ["\r"])) {
        actionIndex = 0;
        setFocus("actions");
        return;
      }
      editor.handleInput(data);
      refresh();
      return;
    }
    if (matchesAction(data, "tui.editor.deleteCharBackward", ["\x7f", "\b"])) {
      deleteFromFocused();
      refresh();
      return;
    }
    if (
      focus !== "confidence" &&
      matchesAction(data, "tui.input.newLine", ["\n"])
    ) {
      note += "\n";
      refresh();
      return;
    }
    appendToFocused(data);
    refresh();
  }

  function render(width) {
    const panelWidth = responsePanelWidth(width);
    const innerWidth = Math.max(1, panelWidth - 4);
    const topPrefix = "╭─ CHECKPOINT ";
    const top = `${topPrefix}${"─".repeat(Math.max(0, panelWidth - visibleWidth(topPrefix) - 1))}╮`;
    const separator = (label) => {
      const prefix = `├─ ${label} `;
      return color("accent", `${prefix}${"─".repeat(Math.max(0, panelWidth - visibleWidth(prefix) - 1))}┤`);
    };
    const framed = (value = "") => {
      const safe = fitVisibleLine(value, innerWidth);
      return `${color("accent", "│")} ${safe} ${color("accent", "│")}`;
    };
    const bottom = color("accent", `╰${"─".repeat(Math.max(0, panelWidth - 2))}╯`);
    const lines = [color("accent", top)];
    lines.push(...readableQuestionLines(question.question, innerWidth).map((line) => framed(color("text", line))));
    if (phase === "saving") {
      lines.push(separator("SAVING"), framed(color("muted", "Saving your response before assessment...")));
    } else if (phase === "feedback") {
      lines.push(separator("SAVED"));
      if (result?.status === "gap") {
        lines.push(framed("I don't know was saved as an admitted gap, not a graded answer."));
      } else if (result?.status === "resolved" && question.activityType === "productive-failure") {
        lines.push(framed("The bounded independent attempt was saved ungraded for the teaching comparison."));
      } else {
        lines.push(framed("Response saved; an explicit assessment is next."));
      }
      lines.push(framed(), framed(color("dim", "Enter or Esc to continue")));
    } else if (phase === "error") {
      lines.push(separator("NOT SAVED"));
      lines.push(...plainLines(`Could not persist this response: ${failure?.message ?? "Unknown error"}`, innerWidth)
        .map((line) => framed(color("warning", line))));
      lines.push(framed("Enter or Esc to close without advancing."));
    } else {
      const answerLabel = focus === "answer" ? "YOUR ANSWER · EDITING" : "YOUR ANSWER";
      lines.push(separator(answerLabel));
      const answerText = editor.getExpandedText();
      if (!answerText && focus !== "answer") {
        lines.push(framed(color("dim", "No answer yet")));
      } else {
        if (!answerText) lines.push(framed(color("dim", "Type your answer…")));
        for (const line of editor.render(innerWidth)) lines.push(framed(line));
      }

      lines.push(framed(color(
        "dim",
        focus === "answer"
          ? "Paste works · arrows edit · Tab next · Ctrl+J new line"
          : "Shift+Tab back · your draft is preserved",
      )));

      lines.push(separator("OPTIONAL"));
      if (focus === "confidence") {
        lines.push(framed(`Confidence 0-100 (optional) · editing: ${confidence || "—"}${validConfidence() ? "" : " (must be 0-100)"}`));
      } else {
        lines.push(framed(`Confidence 0-100 (optional): ${confidence || "—"}`));
      }

      if (focus === "note") {
        lines.push(framed("Note (optional) · editing"));
        lines.push(...plainLines(note || "Type a note…", innerWidth, "> ").map((line) => framed(line)));
      } else if (note.trim()) {
        lines.push(...plainLines(`Note (optional): ${note}`, innerWidth).map((line) => framed(line)));
      } else {
        lines.push(framed("Note (optional): —"));
      }

      lines.push(separator("ACTIONS"));
      const submitPrefix = focus === "actions" && actionIndex === 0 ? ">" : " ";
      const gapPrefix = focus === "actions" && actionIndex === 1 ? ">" : " ";
      lines.push(framed(color(submitPrefix === ">" ? "accent" : "text", `${submitPrefix} Submit response`)));
      lines.push(framed(color(gapPrefix === ">" ? "accent" : "text", `${gapPrefix} I don't know`)));
      lines.push(framed());
      lines.push(framed(color(
        "dim",
        focus === "actions"
          ? "↑/↓ choose · Enter confirm · Shift+Tab back · Esc pause"
          : "Tab next · Shift+Tab back · Esc actions",
      )));
    }
    lines.push(bottom);
    return lines;
  }

  return { render, invalidate() {}, handleInput };
}

export function showAdaptiveQuiz({ ctx, question, submit }) {
  if (ctx.mode !== "tui" || !ctx.hasUI || typeof ctx.ui?.custom !== "function") {
    throw new AdaptiveLearningCliError(
      "The adaptive-learning quiz requires Pi TUI mode; no question was shown.",
      "QUIZ_UI_UNAVAILABLE",
    );
  }
  return ctx.ui.custom((tui, _theme, keybindings, done) =>
    createQuizController({
      question,
      requestRender: () => tui.requestRender(),
      done,
      submit,
      keybindings,
    }));
}

export function showAdaptiveResponse({ ctx, question, submit }) {
  if (ctx.mode !== "tui" || !ctx.hasUI || typeof ctx.ui?.custom !== "function") {
    throw new AdaptiveLearningCliError(
      "The adaptive-learning response requires Pi TUI mode; no prompt was shown.",
      "RESPONSE_UI_UNAVAILABLE",
    );
  }
  return ctx.ui.custom((tui, theme, keybindings, done) =>
    createResponseController({
      question,
      requestRender: () => tui.requestRender(),
      done,
      submit,
      keybindings,
      theme,
      tui,
    }));
}

function choiceArgs(choices) {
  return choices.flatMap((choice) => ["--choice", JSON.stringify(choice)]);
}

function safeQuestionDetails(question) {
  const details = structuredClone(question);
  delete details.correctChoiceValues;
  delete details.explanation;
  return details;
}

function sameVisibleQuestion(persisted, params) {
  const persistedChoices = persisted.choices.map((choice) => ({
    value: choice.value,
    label: choice.label,
    description: choice.description ?? null,
  }));
  const suppliedChoices = params.choices.map((choice) => ({
    value: choice.value,
    label: choice.label,
    description: choice.description ?? null,
  }));
  return (
    persisted.id === params.id &&
    persisted.stage === params.stage &&
    persisted.nodeId === params.nodeId &&
    persisted.kind === params.kind &&
    persisted.question === params.question &&
    persisted.mode === params.mode &&
    JSON.stringify(persistedChoices) === JSON.stringify(suppliedChoices) &&
    (persisted.parentQuestionId ?? null) === (params.parentQuestionId ?? null) &&
    (persisted.adaptationReason ?? null) === (params.adaptationReason ?? null)
  );
}

function selectedAnswer(question, response) {
  const labels = new Map(question.choices.map((choice) => [choice.value, choice.label]));
  return response.selectedChoiceValues.map((value) => labels.get(value) ?? value).join(", ");
}

function quizResult(question) {
  const latest = question.responses?.at(-1) ?? null;
  let message;
  if (question.status === "cancelled") {
    message = "Learner cancelled the persisted quiz.";
  } else if (question.status === "gap" || latest?.dontKnow) {
    message = "Learner selected I don't know. The admitted gap was persisted without fabricating an assessment.";
  } else if (latest?.correct) {
    message = `Learner answered correctly. Selected: ${selectedAnswer(question, latest)}.`;
  } else if (question.status === "retry-required") {
    message = `Learner answered incorrectly. Selected: ${selectedAnswer(question, latest)}. The answer remains withheld while the persisted same-question retry is required.`;
  } else {
    message = `Learner answered incorrectly. Selected: ${selectedAnswer(question, latest)}. The persisted retry state now permits teaching before a new transfer question.`;
  }
  return {
    content: [{ type: "text", text: message }],
    details: { question: safeQuestionDetails(question) },
  };
}

function pausedQuestionResult(question) {
  return {
    content: [{
      type: "text",
      text: "Question closed without an answer. It remains persisted and awaiting learner input; resume it to continue.",
    }],
    details: { question: safeQuestionDetails(question), paused: true },
  };
}

async function persistQuizResponse(runCli, ctx, params, response, signal, responseTimeMs) {
  const responseId = randomUUID();
  const submitArgs = [
    "--question-id", params.id,
    "--response-id", responseId,
    "--outcome-id", `${responseId}-${response.dontKnow ? "gap" : "assessment"}`,
    ...response.selectedChoiceValues.flatMap((value) => ["--selected", value]),
    ...(response.dontKnow ? ["--dont-know"] : []),
    ...(response.confidence === undefined ? [] : ["--confidence", String(response.confidence)]),
    "--response-time-ms", String(responseTimeMs),
    ...(response.note ? ["--note-id", `${responseId}-note`, "--note", response.note] : []),
  ];
  const submitted = await runCli("submit-question", submitArgs, ctx.cwd, runOptions(ctx, signal));
  return submitted.active.question;
}

function sameVisibleFreeResponse(persisted, params) {
  return (
    persisted.id === params.id &&
    persisted.stage === params.stage &&
    persisted.nodeId === params.nodeId &&
    persisted.kind === params.kind &&
    persisted.question === params.question &&
    persisted.mode === "free-response" &&
    persisted.activityType === (params.activityType ?? "free-response") &&
    persisted.strategyReason === (params.strategyReason ?? "Host-selected question activity.") &&
    (persisted.supportLevel ?? null) === (params.supportLevel ?? null) &&
    (persisted.transferLevel ?? null) === (params.transferLevel ?? null) &&
    (persisted.parentQuestionId ?? null) === (params.parentQuestionId ?? null) &&
    (persisted.adaptationReason ?? null) === (params.adaptationReason ?? null)
  );
}

function responseResult(question) {
  const latest = question.responses?.at(-1) ?? null;
  let message;
  if (question.status === "cancelled") {
    message = "Learner cancelled the persisted free-response prompt.";
  } else if (question.status === "gap" || latest?.dontKnow) {
    message = "Learner said I don't know. The admitted gap was persisted without fabricating an assessment.";
  } else if (question.status === "resolved" && question.activityType === "productive-failure") {
    message = "Learner's bounded productive-failure attempt was persisted ungraded. Teach the mechanism, then use a new transfer question.";
  } else {
    message = "Learner response persisted and awaiting an explicit Correct, Partial, or Incorrect assessment.";
  }
  return {
    content: [{ type: "text", text: message }],
    details: { question: safeQuestionDetails(question) },
  };
}

async function persistFreeResponse(runCli, ctx, params, response, signal, responseTimeMs) {
  const responseId = randomUUID();
  const answerArgs = [
    "--question-id", params.id,
    "--response-id", responseId,
    ...(response.dontKnow ? ["--dont-know"] : ["--text-answer", response.textAnswer]),
    ...(response.confidence === undefined ? [] : ["--confidence", String(response.confidence)]),
    "--response-time-ms", String(responseTimeMs),
    ...(response.note ? ["--note-id", `${responseId}-note`, "--note", response.note] : []),
    ...(response.rationale ? ["--rationale", response.rationale] : []),
  ];
  const command = response.dontKnow ? "submit-question" : "answer-question";
  const result = await runCli(
    command,
    response.dontKnow
      ? [...answerArgs, "--outcome-id", `${responseId}-gap`]
      : answerArgs,
    ctx.cwd,
    runOptions(ctx, signal),
  );
  return result.active.question;
}

const RESUMABLE_QUESTION_STATUSES = new Set(["awaiting-answer", "retry-required"]);

function latestQuestionWithStatus(session, statuses) {
  return [...(session?.questions ?? [])]
    .reverse()
    .find((question) => statuses.has(question.status)) ?? null;
}

function continuationDirective(status, context, { sourceReferences = [] } = {}) {
  const session = context?.session ?? {};
  const target = status.active?.target ?? session.target ?? "the active target";
  const sourceSuffix = sourceReferences.length > 0
    ? ` The persisted anchor materials are: ${sourceReferences.join(", ")}. Preserve exact source locators.`
    : "";
  const base = `Resume the active learning session from its durable context. The learner supplied this target: ${target}.`;

  const awaitingAssessment = latestQuestionWithStatus(
    session,
    new Set(["awaiting-assessment"]),
  );
  if (awaitingAssessment) {
    return `${base} Question ${awaitingAssessment.id} has an exact persisted learner response awaiting assessment. Read that stored response and call adaptive_learning_assess_response with that exact ID; do not reopen, recreate, or paraphrase the response.${sourceSuffix}`;
  }

  const resumable = latestQuestionWithStatus(session, RESUMABLE_QUESTION_STATUSES);
  if (resumable) {
    return `${base} Question ${resumable.id} is already persisted and awaiting learner input. Call adaptive_learning_resume_question with that exact ID now; do not recreate, reconstruct, or print the question manually.${sourceSuffix}`;
  }

  const checkpoint = session.checkpoint ?? status.active?.checkpoint ?? null;
  const synthesisCheckpoint = session.synthesisCheckpoint ?? status.active?.synthesisCheckpoint ?? null;
  if (status.active?.kind === "review") {
    if (synthesisCheckpoint && synthesisCheckpoint.status !== "resolved") {
      return `${base} Resume the already claimed retention review from synthesis checkpoint ${synthesisCheckpoint.questionId}; do not call due or start-review again. Preserve the exact persisted question, retry, contamination, and new-transfer rules.${sourceSuffix}`;
    }
    if (checkpoint && checkpoint.status !== "resolved") {
      return `${base} Resume the already claimed retention review from checkpoint ${checkpoint.questionId}; do not call due or start-review again. Preserve the exact persisted question, retry, contamination, and new-transfer rules.${sourceSuffix}`;
    }
    return `${base} Resume the already claimed retention review; do not call due or start-review again. Continue from its persisted review items and checkpoint state.${sourceSuffix}`;
  }

  if (checkpoint && RESUMABLE_QUESTION_STATUSES.has(checkpoint.status)) {
    return `${base} Teaching checkpoint ${checkpoint.questionId} is persisted even though no separate question record is active. Call adaptive_learning_resume_question with that exact ID now; the runtime must materialize or resume it. Do not recreate or print the question manually.${sourceSuffix}`;
  }
  if (checkpoint?.status === "new-transfer-required") {
    const retry = (context?.retry ?? []).find((item) => (
      item.status === "new-transfer-required"
      && item.questionId === checkpoint.questionId
    ));
    const repair = retry?.answerMayBeTaught === false
      ? "The prior answer was correct but not yet durable transfer evidence, so do not reteach it."
      : "Teach only what the retry state permits before testing it again.";
    return `${base} Durable state is new-transfer-required for teaching checkpoint ${checkpoint.questionId}. ${repair} Run recommend-next for ${checkpoint.nodeId}, record one replacement teaching step with a different checkpoint question ID, then call adaptive_learning_resume_question for that new ID. Do not end by merely announcing the next frontier.${sourceSuffix}`;
  }
  if (synthesisCheckpoint && synthesisCheckpoint.status !== "resolved") {
    return `${base} Continue from the persisted whole-system synthesis checkpoint ${synthesisCheckpoint.questionId} and preserve its retry and new-transfer state.${sourceSuffix}`;
  }
  if (sourceReferences.length > 0) {
    return `${base}${sourceSuffix} Inspect unresolved material before teaching. If every supplied anchor is unavailable, do not teach until the learner explicitly chooses supplemental-only continuation and that decision is persisted.`;
  }
  return base;
}

function continuationFingerprint(context) {
  const session = context?.session ?? null;
  if (!session) return null;
  const pending = latestQuestionWithStatus(
    session,
    new Set(["awaiting-answer", "awaiting-assessment", "retry-required"]),
  );
  const retry = context?.retry?.at(-1) ?? null;
  return JSON.stringify({
    sessionId: session.id,
    phase: session.phase,
    completedAt: session.completedAt,
    activeStepId: session.activeStepId,
    checkpointStatus: session.checkpoint?.status,
    checkpointQuestionId: session.checkpoint?.questionId,
    pendingQuestionId: pending?.id,
    pendingQuestionStatus: pending?.status,
    pendingResponseId: pending?.responses?.at(-1)?.id,
    assessmentId: session.assessments?.at(-1)?.id,
    retryStatus: retry?.status,
    retryQuestionId: retry?.questionId,
    retryAttempts: retry?.attempts,
  });
}

function createLearningLoopController({ pi, runCli }) {
  let armed = false;
  let lastTriggeredFingerprint = null;

  function arm() {
    armed = true;
    lastTriggeredFingerprint = null;
  }

  function pause() {
    armed = false;
    lastTriggeredFingerprint = null;
  }

  function observeInteractiveResult(result) {
    if (result?.details?.paused === true) pause();
    else arm();
    return result;
  }

  async function settled(ctx) {
    if (!armed || ctx.mode !== "tui" || !ctx.isIdle()) return;
    let context;
    try {
      context = await runCli("context", [], ctx.cwd, runOptions(ctx));
    } catch (error) {
      pause();
      notifyError(ctx, error);
      return;
    }
    const session = context?.session;
    if (!session || session.completedAt || session.phase === "complete") {
      pause();
      return;
    }

    const fingerprint = continuationFingerprint(context);
    if (!fingerprint || fingerprint === lastTriggeredFingerprint) {
      pause();
      ctx.ui.notify(
        "AI Tutor stopped again without advancing durable learning state; automatic continuation was halted instead of retrying blindly.",
        "error",
      );
      return;
    }
    lastTriggeredFingerprint = fingerprint;
    const directive = continuationDirective({ active: session }, context);
    pi.sendMessage({
      customType: "adaptive-learning-continuation",
      content: `The durable learning loop still requires progression. ${directive} Continue now until a native interactive checkpoint is open, the session is complete, or a real blocker is reported. Do not end by merely announcing the next frontier.`,
      display: false,
      details: { sessionId: session.id, fingerprint },
    }, {
      deliverAs: "followUp",
      triggerTurn: true,
    });
  }

  return { arm, pause, observeInteractiveResult, settled };
}

function pendingQuestionError(pending, expectedId) {
  if (!pending) {
    return new AdaptiveLearningCliError(
      `Question ${expectedId} is not awaiting learner input.`,
      "QUESTION_NOT_RESUMABLE",
    );
  }
  if (pending.id !== expectedId) {
    return new AdaptiveLearningCliError(
      `Question ${pending.id} is already awaiting learner input; ${expectedId} was not presented.`,
      "QUESTION_PENDING",
    );
  }
  return new AdaptiveLearningCliError(
    `Question ${expectedId} is ${pending.status}, not awaiting a native Pi response.`,
    "QUESTION_NOT_RESUMABLE",
  );
}

function requireResumableQuestion(payload, expectedId) {
  const pending = payload?.question ?? null;
  if (
    !pending ||
    pending.id !== expectedId ||
    !RESUMABLE_QUESTION_STATUSES.has(pending.status)
  ) {
    throw pendingQuestionError(pending, expectedId);
  }
  return pending;
}

async function pendingOrMaterializedCheckpoint({ runCli, ctx, signal, questionId }) {
  let pending = await runCli("pending-question", [], ctx.cwd, runOptions(ctx, signal));
  if (pending.question) return pending;

  try {
    await runCli(
      "materialize-checkpoint",
      ["--question-id", questionId],
      ctx.cwd,
      runOptions(ctx, signal),
    );
  } catch (error) {
    if (error?.code !== "DUPLICATE_QUESTION") throw error;
  }
  pending = await runCli("pending-question", [], ctx.cwd, runOptions(ctx, signal));
  requireResumableQuestion(pending, questionId);
  return pending;
}

async function presentPersistedQuestion({
  runCli,
  askQuiz,
  askResponse,
  ctx,
  signal,
  onUpdate,
  questionId,
  pendingPayload,
}) {
  const payload = pendingPayload ?? await runCli(
    "pending-question",
    [],
    ctx.cwd,
    runOptions(ctx, signal),
  );
  const question = requireResumableQuestion(payload, questionId);
  onUpdate?.({
    content: [{ type: "text", text: "Opening the stored question in the native Pi interface." }],
    details: { question: safeQuestionDetails(question) },
  });

  const startedAt = Date.now();
  if (question.mode === "single-select" || question.mode === "multi-select") {
    const submitted = await askQuiz({
      ctx,
      question,
      submit: (response) => persistQuizResponse(
        runCli,
        ctx,
        question,
        response,
        signal,
        Math.max(0, Date.now() - startedAt),
      ),
    });
    if (submitted?.error) throw submitted.error;
    if (submitted === null) {
      return pausedQuestionResult(question);
    }
    return quizResult(submitted);
  }

  if (question.mode === "free-response") {
    const submitted = await askResponse({
      ctx,
      question,
      submit: (response) => persistFreeResponse(
        runCli,
        ctx,
        question,
        response,
        signal,
        Math.max(0, Date.now() - startedAt),
      ),
    });
    if (submitted?.error) throw submitted.error;
    if (submitted === null) {
      return pausedQuestionResult(question);
    }
    return responseResult(submitted);
  }

  throw new AdaptiveLearningCliError(
    `Question ${question.id} has unsupported interactive mode ${question.mode}.`,
    "INVALID_MODE",
  );
}

function optionalArg(args, flag, value) {
  if (value !== undefined && value !== null && value !== "") args.push(flag, String(value));
}

export function createAdaptiveLearningExtension({
  runCli = runAdaptiveLearningCli,
  askQuiz = showAdaptiveQuiz,
  askResponse = showAdaptiveResponse,
  cliArgs = process.argv.slice(2),
  readModelPreference = readProjectModelPreference,
  writeModelPreference = writeProjectModelPreference,
} = {}) {
  return function adaptiveLearningExtension(pi) {
    const learningLoop = createLearningLoopController({ pi, runCli });
    const dispatchLearningSkill = (message) => {
      dispatchSkill(pi, message);
      learningLoop.arm();
    };
    if (typeof pi.on === "function") {
      pi.on("session_start", async (event, ctx) => {
        if (
          ctx.mode !== "tui"
          || !["startup", "new", "resume"].includes(event.reason)
          || hasExplicitStartupSelection(cliArgs)
        ) {
          return;
        }

        const preference = readModelPreference(ctx.cwd) ?? DEFAULT_PROJECT_MODEL;
        const model = ctx.modelRegistry.find(preference.provider, preference.id);
        if (!model) {
          ctx.ui.notify(
            `Saved AI Tutor model ${preference.provider}/${preference.id} is unavailable; keeping Pi's current model.`,
            "warning",
          );
          return;
        }

        try {
          if (!modelMatches(ctx.model, model)) {
            const selected = await pi.setModel(model);
            if (!selected) {
              ctx.ui.notify(
                `AI Tutor could not select ${model.provider}/${model.id}; keeping Pi's current model.`,
                "warning",
              );
              return;
            }
          }
          writeModelPreference(ctx.cwd, model);
        } catch (error) {
          ctx.ui.notify(`AI Tutor could not restore the project model: ${error.message}`, "warning");
        }
      });

      pi.on("model_select", (event, ctx) => {
        if (ctx.mode !== "tui" || event.source === "restore") return;
        try {
          writeModelPreference(ctx.cwd, event.model);
        } catch (error) {
          ctx.ui.notify(`AI Tutor could not save the project model: ${error.message}`, "warning");
        }
      });

      pi.on("agent_settled", async (_event, ctx) => {
        await learningLoop.settled(ctx);
      });
    }

    pi.registerTool({
      name: "adaptive_learning_resume_question",
      label: "Open Adaptive Learning Checkpoint",
      description:
        "Open the exact unresolved persisted question or active teaching checkpoint in Pi's native interface without requiring the model to choose create versus resume.",
      promptSnippet:
        "After record-step, or when durable context contains an awaiting-answer or retry-required question, call adaptive_learning_resume_question with the exact ID; the runtime materializes the stored free-response or selectable definition, or resumes it.",
      promptGuidelines: [
        "Use the exact active checkpoint or pending question ID from durable context.",
        "Do not decide whether an interactive question must be created; this tool owns that transition.",
        "If native presentation fails, stop and report the failure; never print a manual Pi quiz or response prompt.",
      ],
      parameters: AdaptiveResumeParameters,
      async execute(_toolCallId, params, signal, onUpdate, ctx) {
        learningLoop.pause();
        if (ctx.mode !== "tui" || !ctx.hasUI || typeof ctx.ui?.custom !== "function") {
          throw new AdaptiveLearningCliError(
            "The adaptive-learning question requires Pi TUI mode; the stored question was not shown.",
            "QUESTION_UI_UNAVAILABLE",
          );
        }
        const pendingPayload = await pendingOrMaterializedCheckpoint({
          runCli,
          ctx,
          signal,
          questionId: params.questionId,
        });
        return learningLoop.observeInteractiveResult(await presentPersistedQuestion({
          runCli,
          askQuiz,
          askResponse,
          ctx,
          signal,
          onUpdate,
          questionId: params.questionId,
          pendingPayload,
        }));
      },
      renderCall(params) {
        return staticTextComponent([`Open persisted learning checkpoint: ${params.questionId}`]);
      },
      renderResult(result) {
        return staticTextComponent(result.content?.map((item) => item.text) ?? ["Question finished."]);
      },
    });

    pi.registerTool({
      name: "adaptive_learning_quiz",
      label: "Adaptive Learning Quiz",
      description:
        "Ask one persisted graded multiple-choice learning question with I don't know and an optional learner note on the same screen.",
      promptSnippet:
        "Use adaptive_learning_quiz for every calibration item and multiple-choice learning checkpoint.",
      promptGuidelines: [
        "Persist and ask one question at a time.",
        "After the first question, always provide parentQuestionId and adaptationReason from the prior result.",
        "Treat I don't know as an admitted gap and teach it before testing that mechanism.",
      ],
      parameters: AdaptiveQuizParameters,
      async execute(_toolCallId, params, signal, onUpdate, ctx) {
        learningLoop.pause();
        if (!INTERACTIVE_QUIZ_STAGES.has(params.stage)) {
          throw new AdaptiveLearningCliError(
            "Multiple-choice recognition cannot serve as durable retention evidence; use the retention review checkpoint lifecycle instead.",
            "INVALID_STAGE",
          );
        }
        if (ctx.mode !== "tui" || !ctx.hasUI || typeof ctx.ui?.custom !== "function") {
          throw new AdaptiveLearningCliError(
            "The adaptive-learning quiz requires Pi TUI mode; no question was persisted or shown.",
            "QUIZ_UI_UNAVAILABLE",
          );
        }
        const pending = await runCli("pending-question", [], ctx.cwd, runOptions(ctx, signal));
        if (pending.question) {
          if (
            RESUMABLE_QUESTION_STATUSES.has(pending.question.status) &&
            sameVisibleQuestion(pending.question, params)
          ) {
            return learningLoop.observeInteractiveResult(await presentPersistedQuestion({
              runCli,
              askQuiz,
              askResponse,
              ctx,
              signal,
              onUpdate,
              questionId: params.id,
              pendingPayload: pending,
            }));
          }
          throw new AdaptiveLearningCliError(
            `Question ${pending.question.id} is already awaiting learner input; a different quiz was not presented.`,
            "QUESTION_PENDING",
          );
        }
        const startArgs = [
          "--id", params.id,
          "--stage", params.stage,
          "--node", params.nodeId,
          "--kind", "multiple-choice",
          "--question", params.question,
          "--mode", params.mode,
          ...choiceArgs(params.choices),
          ...params.correctChoiceValues.flatMap((value) => ["--correct", value]),
          "--explanation", params.explanation,
          ...(params.parentQuestionId ? ["--parent-question-id", params.parentQuestionId] : []),
          ...(params.adaptationReason ? ["--adaptation-reason", params.adaptationReason] : []),
        ];
        try {
          await runCli("start-question", startArgs, ctx.cwd, runOptions(ctx, signal));
        } catch (error) {
          if (error?.code !== "DUPLICATE_QUESTION") throw error;
          const racedPending = await runCli("pending-question", [], ctx.cwd, runOptions(ctx, signal));
          if (
            !racedPending.question ||
            !RESUMABLE_QUESTION_STATUSES.has(racedPending.question.status) ||
            !sameVisibleQuestion(racedPending.question, params)
          ) {
            throw error;
          }
          return learningLoop.observeInteractiveResult(await presentPersistedQuestion({
            runCli,
            askQuiz,
            askResponse,
            ctx,
            signal,
            onUpdate,
            questionId: params.id,
            pendingPayload: racedPending,
          }));
        }
        onUpdate?.({
          content: [{ type: "text", text: "Question persisted and awaiting learner input." }],
          details: { question: safeQuestionDetails(params) },
        });

        const startedAt = Date.now();
        const submitted = await askQuiz({
          ctx,
          question: params,
          submit: (response) => persistQuizResponse(
            runCli,
            ctx,
            params,
            response,
            signal,
            Math.max(0, Date.now() - startedAt),
          ),
        });
        if (submitted?.error) throw submitted.error;
        if (submitted === null) {
          return learningLoop.observeInteractiveResult(pausedQuestionResult({ ...params, status: "awaiting-answer", responses: [] }));
        }
        return learningLoop.observeInteractiveResult(quizResult(submitted));
      },
      renderCall(params) {
        const noun = params.choices.length === 1 ? "option" : "options";
        return staticTextComponent([
          `Opening native adaptive-learning quiz: ${params.question} (${params.choices.length} ${noun})`,
        ]);
      },
      renderResult(result) {
        return staticTextComponent(result.content?.map((item) => item.text) ?? ["Quiz finished."]);
      },
    });

    pi.registerTool({
      name: "adaptive_learning_response",
      label: "Adaptive Learning Response",
      description:
        "Ask one persisted free-response learning question, capture the learner's exact words, confidence, timing, and optional note, then wait for a separate assessment.",
      promptSnippet:
        "Use adaptive_learning_response for explanation, prediction, transfer, contrastive, reconstruction, and debugging checkpoints.",
      promptGuidelines: [
        "Persist and ask one fully framed question at a time.",
        "Never grade or paraphrase the answer inside this tool; assess the exact persisted response afterward.",
        "Use productive failure only when recommend-next explicitly permits it.",
      ],
      parameters: AdaptiveResponseParameters,
      async execute(_toolCallId, params, signal, onUpdate, ctx) {
        learningLoop.pause();
        if (ctx.mode !== "tui" || !ctx.hasUI || typeof ctx.ui?.custom !== "function") {
          throw new AdaptiveLearningCliError(
            "The adaptive-learning response requires Pi TUI mode; no prompt was persisted or shown.",
            "RESPONSE_UI_UNAVAILABLE",
          );
        }
        const pending = await runCli("pending-question", [], ctx.cwd, runOptions(ctx, signal));
        if (pending.question) {
          if (
            RESUMABLE_QUESTION_STATUSES.has(pending.question.status) &&
            sameVisibleFreeResponse(pending.question, params)
          ) {
            return learningLoop.observeInteractiveResult(await presentPersistedQuestion({
              runCli,
              askQuiz,
              askResponse,
              ctx,
              signal,
              onUpdate,
              questionId: params.id,
              pendingPayload: pending,
            }));
          }
          throw new AdaptiveLearningCliError(
            `Question ${pending.question.id} is already awaiting learner input; a different free-response prompt was not presented.`,
            "QUESTION_PENDING",
          );
        }
        const startArgs = [
          "--id", params.id,
          "--stage", params.stage,
          "--node", params.nodeId,
          "--kind", params.kind,
          "--question", params.question,
          "--mode", "free-response",
        ];
        optionalArg(startArgs, "--activity-type", params.activityType);
        optionalArg(startArgs, "--strategy-reason", params.strategyReason);
        optionalArg(startArgs, "--support-level", params.supportLevel);
        optionalArg(startArgs, "--transfer-level", params.transferLevel);
        optionalArg(startArgs, "--parent-question-id", params.parentQuestionId);
        optionalArg(startArgs, "--adaptation-reason", params.adaptationReason);

        try {
          await runCli("start-question", startArgs, ctx.cwd, runOptions(ctx, signal));
        } catch (error) {
          if (error?.code !== "DUPLICATE_QUESTION") throw error;
          const racedPending = await runCli("pending-question", [], ctx.cwd, runOptions(ctx, signal));
          if (
            !racedPending.question ||
            !RESUMABLE_QUESTION_STATUSES.has(racedPending.question.status) ||
            !sameVisibleFreeResponse(racedPending.question, params)
          ) {
            throw error;
          }
          return learningLoop.observeInteractiveResult(await presentPersistedQuestion({
            runCli,
            askQuiz,
            askResponse,
            ctx,
            signal,
            onUpdate,
            questionId: params.id,
            pendingPayload: racedPending,
          }));
        }
        onUpdate?.({
          content: [{ type: "text", text: "Free-response prompt persisted and awaiting learner input." }],
          details: { question: safeQuestionDetails({ ...params, mode: "free-response" }) },
        });

        const startedAt = Date.now();
        const submitted = await askResponse({
          ctx,
          question: params,
          submit: (response) => persistFreeResponse(
            runCli,
            ctx,
            params,
            response,
            signal,
            Math.max(0, Date.now() - startedAt),
          ),
        });
        if (submitted?.error) throw submitted.error;
        if (submitted === null) {
          return learningLoop.observeInteractiveResult(pausedQuestionResult({ ...params, status: "awaiting-answer", responses: [] }));
        }
        return learningLoop.observeInteractiveResult(responseResult(submitted));
      },
      renderCall(params) {
        return staticTextComponent([
          `Adaptive free response: ${params.question}`,
          "Answer in your own words",
          "Confidence 0-100 (optional)",
          "Note (optional)",
          "I don't know",
        ]);
      },
      renderResult(result) {
        return staticTextComponent(result.content?.map((item) => item.text) ?? ["Response finished."]);
      },
    });

    pi.registerTool({
      name: "adaptive_learning_assess_response",
      label: "Assess Adaptive Response",
      description:
        "Assess the exact persisted free response as Correct, Partial, or Incorrect and optionally record or resolve a durable misconception.",
      promptSnippet:
        "After adaptive_learning_response, use adaptive_learning_assess_response to assess only the explicit persisted question and answer.",
      promptGuidelines: [
        "Give an explicit Correct, Partial, or Incorrect grade.",
        "Evidence must name the exact demonstrated, missing, or incorrect mechanism.",
        "On a first genuine miss, preserve the same-question retry and do not reveal the answer.",
      ],
      parameters: AdaptiveAssessmentParameters,
      async execute(_toolCallId, params, signal, onUpdate, ctx) {
        learningLoop.pause();
        const pending = await runCli("pending-question", [], ctx.cwd, runOptions(ctx, signal));
        const question = pending.question;
        const response = question?.responses?.at(-1) ?? null;
        if (
          !question ||
          question.id !== params.questionId ||
          question.mode !== "free-response" ||
          question.status !== "awaiting-assessment" ||
          !response ||
          response.dontKnow ||
          !response.textAnswer
        ) {
          throw new AdaptiveLearningCliError(
            `Question ${params.questionId} has no persisted free response awaiting assessment.`,
            "RESPONSE_NOT_AWAITING_ASSESSMENT",
          );
        }
        const args = [
          "--id", params.id,
          "--question-id", question.id,
          "--node", question.nodeId,
          "--stage", question.stage,
          "--kind", question.kind,
          "--question", question.question,
          "--answer", response.textAnswer,
          "--grade", params.grade,
          "--evidence", params.evidence,
        ];
        optionalArg(args, "--mistake-type", params.mistakeType);
        if (params.contaminated) args.push("--contaminated");
        optionalArg(args, "--misconception-id", params.misconceptionId);
        optionalArg(args, "--misconception-statement", params.misconceptionStatement);
        optionalArg(args, "--counterexample", params.counterexample);
        optionalArg(args, "--repair", params.repair);
        for (const id of params.resolveMisconceptionIds ?? []) {
          args.push("--resolve-misconception", id);
        }
        onUpdate?.({
          content: [{ type: "text", text: "Assessing the exact persisted learner response." }],
          details: { questionId: question.id },
        });
        const recorded = await runCli(
          "record-assessment",
          args,
          ctx.cwd,
          runOptions(ctx, signal),
        );
        const label = params.grade[0].toUpperCase() + params.grade.slice(1);
        learningLoop.arm();
        return {
          content: [{ type: "text", text: `${label}. ${params.evidence}` }],
          details: {
            question: recorded.active?.question ?? safeQuestionDetails(question),
            grade: params.grade,
            evidence: params.evidence,
          },
        };
      },
      renderCall(params) {
        return staticTextComponent([
          `Assess persisted response ${params.questionId}: ${params.grade}`,
          params.evidence,
        ]);
      },
      renderResult(result) {
        return staticTextComponent(result.content?.map((item) => item.text) ?? ["Assessment recorded."]);
      },
    });

    pi.registerCommand("teach", {
      description: "Start or resume a durable adaptive-learning session",
      handler: async (args, ctx) => {
        if (!ctx.isIdle()) {
          ctx.ui.notify("The agent is busy. Run /teach again when the current turn finishes.", "warning");
          return;
        }

        try {
          let status;
          try {
            status = await runCli("status", [], ctx.cwd, runOptions(ctx));
          } catch (error) {
            if (error?.code !== "STATE_NOT_INITIALIZED") throw error;
            status = { active: null };
          }

          const supplied = parseTarget(args);
          if (status.active) {
            if (supplied && supplied.target !== status.active.target) {
              ctx.ui.notify(
                `A different active target already exists: ${status.active.target}. Resume it with /teach or close it before starting another target.`,
                "warning",
              );
              return;
            }
            const context = await runCli("context", [], ctx.cwd, runOptions(ctx));
            dispatchLearningSkill(continuationDirective(status, context));
            return;
          }

          if (!supplied) {
            ctx.ui.notify(
              "Usage: /teach <target> or /teach <topic> :: <specific learning target>",
              "warning",
            );
            return;
          }

          await runCli("init", [], ctx.cwd, runOptions(ctx));
          await runCli(
            "start",
            ["--topic", supplied.topic, "--target", supplied.target],
            ctx.cwd,
            runOptions(ctx),
          );
          await runCli("context", [], ctx.cwd, runOptions(ctx));
          dispatchLearningSkill(
            `Start the active learning session from its durable context. The learner supplied this target: ${supplied.target}`,
          );
        } catch (error) {
          notifyError(ctx, error);
        }
      },
    });

    pi.registerCommand("teach-restart", {
      description: "Preserve the current learning history and restart its target from the beginning",
      handler: async (_args, ctx) => {
        if (!ctx.isIdle()) {
          ctx.ui.notify("The agent is busy. Run /teach-restart again when the current turn finishes.", "warning");
          return;
        }

        try {
          const status = await runCli("status", [], ctx.cwd, runOptions(ctx));
          if (!status.active) {
            ctx.ui.notify("There is no active learning session to restart.", "warning");
            return;
          }
          if (status.active.kind === "review") {
            ctx.ui.notify("A retention review cannot be replaced with a fresh learning probe.", "warning");
            return;
          }

          await runCli(
            "restart",
            [
              "--reason",
              "The learner explicitly requested a complete restart from the beginning.",
            ],
            ctx.cwd,
            runOptions(ctx),
          );
          const context = await runCli("context", [], ctx.cwd, runOptions(ctx));
          dispatchLearningSkill(
            `Begin a completely fresh probe for the restarted target: ${context.session.target}. Do not reuse prior questions, answers, assessments, gaps, plans, or teaching checkpoints as current evidence. The first broad probe must be multiple-choice with visible selectable choices and an explicit I don't know option.`,
          );
        } catch (error) {
          notifyError(ctx, error);
        }
      },
    });

    pi.registerCommand("teach-from", {
      description: "Start or resume learning from a supplied video, PDF, notes, page, or repository",
      handler: async (args, ctx) => {
        if (!ctx.isIdle()) {
          ctx.ui.notify(
            "The agent is busy. Run /teach-from again when the current turn finishes.",
            "warning",
          );
          return;
        }

        try {
          let status;
          try {
            status = await runCli("status", [], ctx.cwd, runOptions(ctx));
          } catch (error) {
            if (error?.code !== "STATE_NOT_INITIALIZED") throw error;
            status = { active: null };
          }

          const supplied = parseSourceGuidedTarget(args);
          if (status.active) {
            let context = await runCli("context", [], ctx.cwd, runOptions(ctx));
            let materials = context.session?.materials ?? [];
            if (materials.length === 0) {
              ctx.ui.notify(
                "The active target is not source-guided. Resume it with /teach or close it before starting /teach-from.",
                "warning",
              );
              return;
            }
            if (supplied && supplied.target !== status.active.target) {
              ctx.ui.notify(
                `A different active target already exists: ${status.active.target}. Resume it with /teach-from or close it before starting another target.`,
                "warning",
              );
              return;
            }
            if (
              supplied &&
              !materials.some((material) => material.reference === supplied.reference)
            ) {
              await runCli(
                "add-material",
                ["--reference", supplied.reference],
                ctx.cwd,
                runOptions(ctx),
              );
              context = await runCli("context", [], ctx.cwd, runOptions(ctx));
              materials = context.session?.materials ?? [];
            }
            dispatchLearningSkill(continuationDirective(status, context, {
              sourceReferences: materials.map((material) => material.reference),
            }));
            return;
          }

          if (!supplied) {
            ctx.ui.notify(
              "Usage: /teach-from <source> :: <specific learning target>",
              "warning",
            );
            return;
          }

          await runCli("init", [], ctx.cwd, runOptions(ctx));
          await runCli(
            "start",
            [
              "--topic",
              supplied.topic,
              "--target",
              supplied.target,
              "--material",
              supplied.reference,
            ],
            ctx.cwd,
            runOptions(ctx),
          );
          await runCli("context", [], ctx.cwd, runOptions(ctx));
          dispatchLearningSkill(
            `Start the source-guided learning session from durable context. The learner supplied this target: ${supplied.target}. The persisted anchor material is: ${supplied.reference}. Inspect and resolve the material before teaching, cite exact locations, and keep supplemental research distinct.`,
          );
        } catch (error) {
          notifyError(ctx, error);
        }
      },
    });

    pi.registerCommand("learn-profile", {
      description: "Show or update the durable learner teaching profile",
      handler: async (args, ctx) => {
        if (!ctx.isIdle()) {
          ctx.ui.notify(
            "The agent is busy. Run /learn-profile again when the current turn finishes.",
            "warning",
          );
          return;
        }
        try {
          let profile;
          try {
            profile = await runCli("profile", [], ctx.cwd, runOptions(ctx));
          } catch (error) {
            if (error?.code !== "STATE_NOT_INITIALIZED") throw error;
            await runCli("init", [], ctx.cwd, runOptions(ctx));
            profile = await runCli("profile", [], ctx.cwd, runOptions(ctx));
          }
          const update = parseProfileUpdate(args);
          if (!update) {
            ctx.ui.notify(profileSummary(profile), "info");
            return;
          }
          const updated = await runCli("set-profile", update, ctx.cwd, runOptions(ctx));
          ctx.ui.notify(`Learner profile updated.\n${profileSummary(updated)}`, "info");
        } catch (error) {
          notifyError(ctx, error);
        }
      },
    });

    pi.registerCommand("learn-status", {
      description: "Show the current durable learning phase and frontier",
      handler: async (_args, ctx) => {
        try {
          const status = await runCli("status", [], ctx.cwd, runOptions(ctx));
          if (!status.active) {
            ctx.ui.notify("No adaptive-learning session is active.", "info");
            return;
          }
          const frontier = status.active.frontier?.length
            ? status.active.frontier.join(", ")
            : "not established";
          ctx.ui.notify(
            `${status.active.topic} — ${status.active.phase} — frontier: ${frontier}`,
            "info",
          );
        } catch (error) {
          if (error?.code === "STATE_NOT_INITIALIZED") {
            ctx.ui.notify("No adaptive-learning state exists yet. Start with /teach <target>.", "info");
            return;
          }
          notifyError(ctx, error);
        }
      },
    });

    pi.registerCommand("learn-review", {
      description: "Run the retention reviews currently due",
      handler: async (_args, ctx) => {
        if (!ctx.isIdle()) {
          ctx.ui.notify(
            "The agent is busy. Run /learn-review again when the current turn finishes.",
            "warning",
          );
          return;
        }
        try {
          let status;
          try {
            status = await runCli("status", [], ctx.cwd, runOptions(ctx));
          } catch (error) {
            if (error?.code !== "STATE_NOT_INITIALIZED") throw error;
            status = { active: null };
          }
          if (status.active?.kind === "review") {
            const context = await runCli("context", [], ctx.cwd, runOptions(ctx));
            dispatchLearningSkill(continuationDirective(status, context));
            return;
          }
          if (status.active) {
            ctx.ui.notify(
              "An active learning session must finish or close before starting retention reviews.",
              "warning",
            );
            return;
          }
          const due = await runCli("due", [], ctx.cwd, runOptions(ctx));
          const count = due.reviews?.length ?? 0;
          if (count === 0) {
            ctx.ui.notify("No retention reviews are due.", "info");
            return;
          }
          const synthesis = due.synthesisDue
            ? " Include the required whole-system synthesis."
            : "";
          dispatchLearningSkill(
            `Run the ${count} due retention ${count === 1 ? "review" : "reviews"} from durable context. Preserve the assessment and retry rules.${synthesis}`,
          );
        } catch (error) {
          if (error?.code === "STATE_NOT_INITIALIZED") {
            ctx.ui.notify("No retention reviews are due because no learning state exists yet.", "info");
            return;
          }
          notifyError(ctx, error);
        }
      },
    });
  };
}

export default createAdaptiveLearningExtension();
