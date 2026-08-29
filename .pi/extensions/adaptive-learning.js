import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeKittyPrintable,
  matchesKey,
  stripTerminalSequences,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";

const extensionDir = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(extensionDir, "..", "..");
const defaultCliPath = path.join(repository, "bin", "learn.mjs");
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const INTERACTIVE_QUIZ_STAGES = new Set(["probe", "teach"]);

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
    const lines = ["-".repeat(Math.max(1, Math.min(width, 80)))];
    lines.push(...plainLines(question.question, width, " "));

    if (phase === "feedback") {
      const latest = result?.responses?.at(-1) ?? null;
      lines.push("");
      if (result?.status === "gap" || latest?.dontKnow) {
        lines.push("I don't know recorded. This is an admitted gap, not a guess.");
      } else if (latest?.correct) {
        lines.push("Correct.");
        lines.push("", ...plainLines(question.explanation, width));
      } else if (result?.status === "retry-required") {
        lines.push("Incorrect - retry required.");
        lines.push("The answer and explanation are withheld for the same-question retry.");
      } else {
        lines.push("Incorrect. The persisted retry state now permits teaching.");
        lines.push("", ...plainLines(question.explanation, width));
      }
      if (note.trim()) lines.push("", ...plainLines(`Your note: ${note.trim()}`, width));
      if (confidence !== "") lines.push(...plainLines(`Confidence: ${confidence}%`, width));
      lines.push("", "Enter or Esc to continue");
      return lines.flatMap((line) => plainLines(line, width));
    }
    if (phase === "saving") {
      lines.push("", "Saving answer and note before feedback...");
      return lines.flatMap((line) => plainLines(line, width));
    }
    if (phase === "error") {
      lines.push("", `Could not persist this answer: ${failure?.message ?? "Unknown error"}`);
      lines.push("Enter or Esc to close without advancing.");
      return lines.flatMap((line) => plainLines(line, width));
    }

    lines.push("");
    for (const [index, choice] of question.choices.entries()) {
      const focused = focus === "options" && optionIndex === index ? ">" : " ";
      const checked = multi ? (selected.has(choice.value) ? "[x]" : "[ ]") : `${index + 1}.`;
      lines.push(`${focused} ${checked} ${choice.label}`);
      if (choice.description) lines.push(...plainLines(choice.description, width, "     "));
    }
    lines.push("");
    lines.push(`${focus === "options" && optionIndex === dontKnowIndex ? ">" : " "} I don't know`);
    if (multi) {
      lines.push(`${focus === "options" && optionIndex === submitIndex ? ">" : " "} Submit selected choices`);
    }
    lines.push("", focus === "note" ? "Note (optional) [editing]:" : "Note (optional):");
    lines.push(...plainLines(note || " ", width, " "));
    lines.push(
      "",
      focus === "confidence"
        ? "Confidence 0-100 (optional) [editing]:"
        : "Confidence 0-100 (optional):",
      ` ${confidence || " "}`,
    );
    lines.push("");
    lines.push(
      focus === "note"
        ? "Type note - Ctrl+J newline - Enter back - Tab confidence - Esc back"
        : focus === "confidence"
          ? "Type 0-100 - Enter choices - Tab choices - Esc back"
        : multi
          ? "Up/Down navigate - Space/Enter toggle - Submit row - Tab note/confidence - Esc cancel"
          : "Up/Down navigate - Enter answer - Tab note/confidence - Esc cancel",
    );
    lines.push("-".repeat(Math.max(1, Math.min(width, 80))));
    return lines.flatMap((line) => plainLines(line, width));
  }

  return { render, invalidate() {}, handleInput };
}

export function createResponseController({ question, requestRender, done, submit, keybindings }) {
  let focus = "answer";
  let answer = "";
  let confidence = "";
  let note = "";
  let actionIndex = 0;
  let phase = "input";
  let result = null;
  let failure = null;

  const refresh = () => requestRender();
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
    return {
      ...(dontKnow ? {} : { textAnswer: answer.trim() }),
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
    if (focus === "answer") answer += text;
    else if (focus === "note") note += text;
    else if (focus === "confidence") confidence += text.replace(/\D/g, "").slice(0, 3 - confidence.length);
  }

  function deleteFromFocused() {
    if (focus === "answer") answer = lastCodePoint(answer);
    else if (focus === "note") note = lastCodePoint(note);
    else if (focus === "confidence") confidence = lastCodePoint(confidence);
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

    if (matchesAction(data, "tui.input.tab", ["\t"])) {
      focus = {
        answer: "confidence",
        confidence: "note",
        note: "actions",
        actions: "answer",
      }[focus];
      refresh();
      return;
    }
    if (focus === "actions") {
      if (matchesAction(data, "tui.select.cancel", ["\x1b"])) {
        done(null);
        return;
      }
      if (matchesAction(data, "tui.select.up", ["\x1b[A"])) actionIndex = 0;
      else if (matchesAction(data, "tui.select.down", ["\x1b[B"])) actionIndex = 1;
      else if (matchesAction(data, "tui.select.confirm", ["\r", "\n"])) {
        if (actionIndex === 1) beginSubmit(response(true));
        else if (answer.trim() && validConfidence()) beginSubmit(response(false));
      }
      refresh();
      return;
    }
    if (matchesAction(data, "tui.select.cancel", ["\x1b"])) {
      focus = "actions";
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
      if (focus === "answer") answer += "\n";
      else note += "\n";
      refresh();
      return;
    }
    appendToFocused(data);
    refresh();
  }

  function render(width) {
    const lines = ["-".repeat(Math.max(1, Math.min(width, 80)))];
    lines.push(...plainLines(question.question, width));
    if (phase === "saving") {
      lines.push("", "Saving the learner's exact response before any assessment...");
    } else if (phase === "feedback") {
      lines.push("");
      if (result?.status === "gap") {
        lines.push("I don't know was saved as an admitted gap, not a graded answer.");
      } else if (result?.status === "resolved" && question.activityType === "productive-failure") {
        lines.push("The bounded independent attempt was saved ungraded for the teaching comparison.");
      } else {
        lines.push("Response saved and awaiting an explicit Correct, Partial, or Incorrect assessment.");
      }
      lines.push("", "Enter or Esc to continue");
    } else if (phase === "error") {
      lines.push("", `Could not persist this response: ${failure?.message ?? "Unknown error"}`);
      lines.push("Enter or Esc to close without advancing.");
    } else {
      lines.push(
        "",
        focus === "answer" ? "Answer [editing]:" : "Answer:",
        ...plainLines(answer || " ", width, " "),
        "",
        focus === "confidence" ? "Confidence 0-100 (optional) [editing]:" : "Confidence 0-100 (optional):",
        ` ${confidence || " "}${validConfidence() ? "" : " (must be 0-100)"}`,
        "",
        focus === "note" ? "Note (optional) [editing]:" : "Note (optional):",
        ...plainLines(note || " ", width, " "),
        "",
        `${focus === "actions" && actionIndex === 0 ? ">" : " "} Submit response`,
        `${focus === "actions" && actionIndex === 1 ? ">" : " "} I don't know`,
        "",
        focus === "actions"
          ? "Up/Down choose - Enter submit - Tab answer - Esc cancel"
          : "Type - Ctrl+J newline - Tab next field - Esc actions",
      );
    }
    lines.push("-".repeat(Math.max(1, Math.min(width, 80))));
    return lines.flatMap((line) => plainLines(line, width));
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
  return ctx.ui.custom((tui, _theme, keybindings, done) =>
    createResponseController({
      question,
      requestRender: () => tui.requestRender(),
      done,
      submit,
      keybindings,
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

function questionDefinitionDigest(question) {
  const definition = {
    id: question.id,
    stage: question.stage,
    nodeId: question.nodeId,
    kind: question.kind,
    question: question.question,
    mode: question.mode,
    choices: question.choices.map((choice) => ({
      value: choice.value,
      label: choice.label,
      description: choice.description ?? null,
    })),
    correctChoiceValues: [...question.correctChoiceValues].sort(),
    explanation: question.explanation,
    parentQuestionId: question.parentQuestionId ?? null,
    adaptationReason: question.adaptationReason ?? null,
  };
  return createHash("sha256").update(JSON.stringify(definition)).digest("hex");
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

function freeResponseDefinition(params) {
  return {
    id: params.id,
    stage: params.stage,
    nodeId: params.nodeId,
    kind: params.kind,
    question: params.question,
    mode: "free-response",
    choices: [],
    correctChoiceValues: [],
    explanation: null,
    parentQuestionId: params.parentQuestionId ?? null,
    adaptationReason: params.adaptationReason ?? null,
  };
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
  const answered = await runCli("answer-question", answerArgs, ctx.cwd, runOptions(ctx, signal));
  if (!response.dontKnow) return answered.active.question;

  const admitted = await runCli(
    "record-admitted-gap",
    [
      "--id", `${responseId}-gap`,
      "--question-id", params.id,
      "--node", params.nodeId,
      "--statement", response.note || "I don't know this mechanism yet.",
      "--evidence", `The learner explicitly admitted a gap on persisted free-response question ${params.id}.`,
    ],
    ctx.cwd,
    runOptions(ctx, signal),
  );
  return admitted.active.question;
}

function optionalArg(args, flag, value) {
  if (value !== undefined && value !== null && value !== "") args.push(flag, String(value));
}

export function createAdaptiveLearningExtension({
  runCli = runAdaptiveLearningCli,
  askQuiz = showAdaptiveQuiz,
  askResponse = showAdaptiveResponse,
} = {}) {
  return function adaptiveLearningExtension(pi) {
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
          const pending = await runCli("pending-question", [], ctx.cwd, runOptions(ctx, signal));
          if (
            !pending.question ||
            !["awaiting-answer", "retry-required"].includes(pending.question.status) ||
            !sameVisibleQuestion(pending.question, params) ||
            pending.definitionDigest !== questionDefinitionDigest(params)
          ) {
            throw error;
          }
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
          const cancelled = await runCli(
            "cancel-question",
            ["--question-id", params.id],
            ctx.cwd,
            runOptions(ctx, signal),
          );
          return quizResult(cancelled.active.question);
        }
        return quizResult(submitted);
      },
      renderCall(params) {
        return staticTextComponent([
          `Adaptive learning quiz: ${params.question}`,
          ...params.choices.map((choice, index) => `${index + 1}. ${choice.label}`),
          "I don't know",
          "Note (optional)",
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
        if (ctx.mode !== "tui" || !ctx.hasUI || typeof ctx.ui?.custom !== "function") {
          throw new AdaptiveLearningCliError(
            "The adaptive-learning response requires Pi TUI mode; no prompt was persisted or shown.",
            "RESPONSE_UI_UNAVAILABLE",
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
          const pending = await runCli("pending-question", [], ctx.cwd, runOptions(ctx, signal));
          const digest = createHash("sha256")
            .update(JSON.stringify(freeResponseDefinition(params)))
            .digest("hex");
          if (
            !pending.question ||
            !["awaiting-answer", "retry-required"].includes(pending.question.status) ||
            !sameVisibleFreeResponse(pending.question, params) ||
            pending.definitionDigest !== digest
          ) {
            throw error;
          }
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
          const cancelled = await runCli(
            "cancel-question",
            ["--question-id", params.id],
            ctx.cwd,
            runOptions(ctx, signal),
          );
          return responseResult(cancelled.active.question);
        }
        return responseResult(submitted);
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
            await runCli("context", [], ctx.cwd, runOptions(ctx));
            dispatchSkill(
              pi,
              `Resume the active learning session from its durable context. The learner supplied this target: ${status.active.target}`,
            );
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
          dispatchSkill(
            pi,
            `Start the active learning session from its durable context. The learner supplied this target: ${supplied.target}`,
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
            const references = materials.map((material) => material.reference).join(", ");
            dispatchSkill(
              pi,
              `Resume the source-guided learning session from durable context. The learner supplied this target: ${status.active.target}. The persisted anchor materials are: ${references}. Inspect unresolved material before teaching and preserve exact source locators. If every supplied anchor is unavailable, do not teach until the learner explicitly chooses supplemental-only continuation and that decision is persisted.`,
            );
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
          dispatchSkill(
            pi,
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
          const due = await runCli("due", [], ctx.cwd, runOptions(ctx));
          const count = due.reviews?.length ?? 0;
          if (count === 0) {
            ctx.ui.notify("No retention reviews are due.", "info");
            return;
          }
          const synthesis = due.synthesisDue
            ? " Include the required whole-system synthesis."
            : "";
          dispatchSkill(
            pi,
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
