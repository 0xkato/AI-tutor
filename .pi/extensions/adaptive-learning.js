import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  for (const paragraph of String(text ?? "").split("\n")) {
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

export function createQuizController({ question, requestRender, done, submit }) {
  let optionIndex = 0;
  let focus = "options";
  let note = "";
  let phase = "select";
  let result = null;
  let failure = null;
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

  function handleInput(data) {
    if (phase === "saving") return;
    if (phase === "feedback") {
      if (data === "\r" || data === "\n" || data === "\x1b") done(result);
      return;
    }
    if (phase === "error") {
      if (data === "\r" || data === "\n" || data === "\x1b") done({ error: failure });
      return;
    }

    if (data === "\t") {
      focus = focus === "options" ? "note" : "options";
      refresh();
      return;
    }
    if (focus === "note") {
      if (data === "\r" || data === "\x1b") {
        focus = "options";
      } else if (data === "\x7f" || data === "\b") {
        note = lastCodePoint(note);
      } else if (data === "\n") {
        note += "\n";
      } else if (!data.startsWith("\x1b")) {
        note += data;
      }
      refresh();
      return;
    }

    if (data === "\x1b[A") {
      optionIndex = Math.max(0, optionIndex - 1);
      refresh();
      return;
    }
    if (data === "\x1b[B") {
      optionIndex = Math.min(finalIndex, optionIndex + 1);
      refresh();
      return;
    }
    if (data === "\x1b") {
      done(null);
      return;
    }
    if (data !== "\r" && data !== "\n" && data !== " ") return;

    if (optionIndex === dontKnowIndex) {
      beginSubmit(responseFor([], true));
      return;
    }
    if (multi && optionIndex === submitIndex) {
      if (selected.size > 0) beginSubmit(responseFor([...selected], false));
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
    lines.push("");
    lines.push(
      focus === "note"
        ? "Type note - Ctrl+J newline - Enter back - Tab choices - Esc back"
        : multi
          ? "Up/Down navigate - Space/Enter toggle - Submit row - Tab note - Esc cancel"
          : "Up/Down navigate - Enter answer - Tab note - Esc cancel",
    );
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
  return ctx.ui.custom((tui, _theme, _keybindings, done) =>
    createQuizController({
      question,
      requestRender: () => tui.requestRender(),
      done,
      submit,
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

async function persistQuizResponse(runCli, ctx, params, response, signal) {
  const responseId = randomUUID();
  const submitArgs = [
    "--question-id", params.id,
    "--response-id", responseId,
    "--outcome-id", `${responseId}-${response.dontKnow ? "gap" : "assessment"}`,
    ...response.selectedChoiceValues.flatMap((value) => ["--selected", value]),
    ...(response.dontKnow ? ["--dont-know"] : []),
    ...(response.note ? ["--note-id", `${responseId}-note`, "--note", response.note] : []),
  ];
  const submitted = await runCli("submit-question", submitArgs, ctx.cwd, runOptions(ctx, signal));
  return submitted.active.question;
}

export function createAdaptiveLearningExtension({
  runCli = runAdaptiveLearningCli,
  askQuiz = showAdaptiveQuiz,
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

        const submitted = await askQuiz({
          ctx,
          question: params,
          submit: (response) => persistQuizResponse(runCli, ctx, params, response, signal),
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
