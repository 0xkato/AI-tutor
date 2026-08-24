import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const extensionDir = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(extensionDir, "..", "..");
const cliPath = path.join(repository, "bin", "learn.mjs");

class AdaptiveLearningCliError extends Error {
  constructor(message, code = "CLI_ERROR") {
    super(message);
    this.name = "AdaptiveLearningCliError";
    this.code = code;
  }
}

export function runAdaptiveLearningCli(command, args, root) {
  const result = spawnSync(process.execPath, [cliPath, command, ...args, "--root", root, "--json"], {
    cwd: repository,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || `Command failed: ${command}`).trim();
    const code = /^\[([A-Z_]+)\]/.exec(message)?.[1] ?? "CLI_ERROR";
    throw new AdaptiveLearningCliError(message, code);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new AdaptiveLearningCliError(
      `Adaptive-learning CLI returned invalid JSON for ${command}: ${error.message}`,
      "INVALID_CLI_OUTPUT",
    );
  }
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
  ctx.ui.notify(message, "error");
}

function dispatchSkill(pi, message) {
  pi.sendUserMessage(`/skill:adaptive-learning ${message}`, { expandPromptTemplates: true });
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
            status = runCli("status", [], ctx.cwd);
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
            runCli("context", [], ctx.cwd);
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

          runCli("init", [], ctx.cwd);
          runCli(
            "start",
            ["--topic", supplied.topic, "--target", supplied.target],
            ctx.cwd,
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
          const status = runCli("status", [], ctx.cwd);
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
          const due = runCli("due", [], ctx.cwd);
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
