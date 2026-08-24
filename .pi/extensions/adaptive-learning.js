import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const extensionDir = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(extensionDir, "..", "..");
const defaultCliPath = path.join(repository, "bin", "learn.mjs");
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

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

function notifyError(ctx, error) {
  const message = error instanceof Error ? error.message : String(error);
  ctx.ui.notify(message, error?.stateCommitted === true ? "warning" : "error");
}

function dispatchSkill(pi, message) {
  pi.sendUserMessage(`/skill:adaptive-learning ${message}`, { expandPromptTemplates: true });
}

function runOptions(ctx) {
  const signal = ctx.abortSignal ?? ctx.signal;
  return signal ? { signal } : {};
}

export function createAdaptiveLearningExtension({ runCli = runAdaptiveLearningCli } = {}) {
  return function adaptiveLearningExtension(pi) {
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
          dispatchSkill(
            pi,
            `Start the active learning session from its durable context. The learner supplied this target: ${supplied.target}`,
          );
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
