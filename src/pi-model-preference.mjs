import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const PROJECT_MODEL_PREFERENCE_FILE = "pi-model-preference.json";

export const DEFAULT_PROJECT_MODEL = Object.freeze({
  provider: "openai-codex",
  id: "gpt-5.6-sol",
});

function projectModelPreferencePath(root) {
  return path.join(path.resolve(root), ".adaptive-learning", PROJECT_MODEL_PREFERENCE_FILE);
}

function validProjectModelPreference(value) {
  return value
    && value.schemaVersion === 1
    && typeof value.provider === "string"
    && value.provider.length > 0
    && typeof value.id === "string"
    && value.id.length > 0;
}

export function readProjectModelPreference(root) {
  try {
    const parsed = JSON.parse(fs.readFileSync(projectModelPreferencePath(root), "utf8"));
    return validProjectModelPreference(parsed)
      ? { provider: parsed.provider, id: parsed.id }
      : null;
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

export function writeProjectModelPreference(root, model) {
  const destination = projectModelPreferencePath(root);
  const directory = path.dirname(destination);
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(
      descriptor,
      `${JSON.stringify({ schemaVersion: 1, provider: model.provider, id: model.id }, null, 2)}\n`,
      "utf8",
    );
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, destination);
    fs.chmodSync(destination, 0o600);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try {
      fs.unlinkSync(temporary);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

export function hasExplicitStartupSelection(cliArgs) {
  const explicitFlags = new Set([
    "--model",
    "--models",
    "--continue",
    "-c",
    "--resume",
    "-r",
    "--session",
    "--session-id",
    "--fork",
  ]);
  return cliArgs.some((arg) => explicitFlags.has(arg));
}
