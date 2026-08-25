#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import { doctor } from "../src/doctor.mjs";
import { LearningError } from "../src/errors.mjs";
import { repairRender } from "../src/render.mjs";
import { initializeStore } from "../src/store.mjs";

function parseRoot(args) {
  if (args.length === 0) return process.cwd();
  if (args.length === 2 && args[0] === "--root" && args[1] && !args[1].startsWith("--")) {
    return path.resolve(args[1]);
  }
  throw new LearningError("Usage: npm run setup -- [--root <path>]", "INVALID_ARGUMENT");
}
function setup(root) {
  const packagePath = path.join(root, "package.json");
  if (!fs.existsSync(packagePath)) {
    throw new LearningError("Run setup from the Adaptive Learning Agent repository", "INVALID_SETUP_ROOT");
  }
  initializeStore(root);
  const rendered = repairRender(root);
  if (!rendered.ok) {
    throw new LearningError(`Could not create the Obsidian projection: ${rendered.error}`, "SETUP_RENDER_FAILED");
  }
  const report = doctor(root);
  if (!report.ok) {
    throw new LearningError(`Setup diagnostics failed:\n${report.actions.join("\n")}`, "SETUP_DIAGNOSTICS_FAILED");
  }
  return report;
}

try {
  const root = parseRoot(process.argv.slice(2));
  const report = setup(root);
  const matrix = report.runtime.releaseMatrix.join(" and ");
  process.stdout.write(
    [
      "Adaptive Learning Agent is ready.",
      `Runtime: Node.js ${report.runtime.major} on macOS (release matrix: ${matrix}).`,
      "State: .adaptive-learning/state.json",
      "Obsidian vault: vault/",
      "Built-in teaching defaults: active",
      "Learner profile overrides (optional): vault/Profile.md",
      "Diagnostics: npm run doctor",
      "Codex: open this repository and ask it to teach a specific target.",
      "Pi: launch Pi here, then run /teach <your learning target>.",
      "",
    ].join("\n"),
  );
} catch (error) {
  const code = error instanceof LearningError ? error.code : "UNEXPECTED_ERROR";
  process.stderr.write(`[${code}] ${error.message}\n`);
  process.exit(1);
}
