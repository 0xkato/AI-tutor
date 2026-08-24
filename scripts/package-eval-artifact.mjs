import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseInstant, validateState } from "../src/schema.mjs";
import { validateEvalArtifact } from "./validate-eval-artifact.mjs";

const evidenceFiles = {
  transcript: "transcript.md",
  stateSnapshot: "state.json",
  sourceLedger: "source-ledger.json",
  renderedNote: "rendered-note.md",
};

class EvalCaptureError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "EvalCaptureError";
    this.code = code;
  }
}

function fail(message, code) {
  throw new EvalCaptureError(message, code);
}

function digest(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function readRegularFile(file, label) {
  const resolved = path.resolve(file);
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  let handle;
  try {
    handle = fs.openSync(resolved, flags);
  } catch (error) {
    fail(`${label} could not be read: ${error.message}`, "INVALID_EVAL_SOURCE");
  }
  try {
    const stat = fs.fstatSync(handle);
    if (!stat.isFile()) {
      fail(`${label} must be a regular, non-symlink file`, "INVALID_EVAL_SOURCE");
    }
    return fs.readFileSync(handle);
  } catch (error) {
    if (error instanceof EvalCaptureError) throw error;
    fail(`${label} could not be read: ${error.message}`, "INVALID_EVAL_SOURCE");
  } finally {
    fs.closeSync(handle);
  }
}

function validateEvidence(contents) {
  if (!contents.transcript.toString("utf8").trim()) {
    fail("Transcript must contain text", "EMPTY_EVAL_SOURCE");
  }
  if (!contents.renderedNote.toString("utf8").trim()) {
    fail("Rendered note must contain text", "EMPTY_EVAL_SOURCE");
  }

  try {
    validateState(JSON.parse(contents.stateSnapshot.toString("utf8")));
  } catch (error) {
    fail(`State snapshot is invalid: ${error.message}`, "INVALID_STATE_SNAPSHOT");
  }

  let ledger;
  try {
    ledger = JSON.parse(contents.sourceLedger.toString("utf8"));
  } catch (error) {
    fail(`Source ledger is not valid JSON: ${error.message}`, "INVALID_SOURCE_LEDGER");
  }
  if (ledger?.formatVersion !== 1 || !Array.isArray(ledger.sources)) {
    fail(
      "Source ledger must use formatVersion 1 with a sources array",
      "INVALID_SOURCE_LEDGER",
    );
  }
}

function writeDurableFile(file, contents) {
  const handle = fs.openSync(file, "wx", 0o600);
  try {
    fs.writeFileSync(handle, contents);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

function ensureOutputIsNew(outputDirectory) {
  const output = path.resolve(outputDirectory);
  if (fs.existsSync(output)) {
    fail(`Evaluation artifact output already exists: ${output}`, "EVAL_OUTPUT_EXISTS");
  }
  const parent = path.dirname(output);
  let parentStat;
  try {
    parentStat = fs.lstatSync(parent);
  } catch (error) {
    fail(`Evaluation artifact parent does not exist: ${error.message}`, "INVALID_EVAL_OUTPUT");
  }
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    fail("Evaluation artifact parent must be a real directory", "INVALID_EVAL_OUTPUT");
  }
  return { output, parent };
}

export function packageEvalArtifact({
  outputDirectory,
  draft,
  evidence,
  capturedAt = new Date().toISOString(),
}) {
  if (draft === null || typeof draft !== "object" || Array.isArray(draft)) {
    fail("Evaluation artifact draft must be an object", "INVALID_EVAL_DRAFT");
  }
  if (Object.hasOwn(draft, "files")) {
    fail("Evaluation artifact draft must not contain stale file records", "INVALID_EVAL_DRAFT");
  }
  if (evidence === null || typeof evidence !== "object" || Array.isArray(evidence)) {
    fail("Evaluation evidence paths must be an object", "INVALID_EVAL_SOURCE");
  }
  parseInstant(capturedAt, "capturedAt");
  const { output, parent } = ensureOutputIsNew(outputDirectory);

  const contents = Object.fromEntries(
    Object.keys(evidenceFiles).map((role) => [
      role,
      readRegularFile(evidence[role], `Evidence source ${role}`),
    ]),
  );
  validateEvidence(contents);

  const stage = path.join(parent, `.${path.basename(output)}.capture-${process.pid}-${randomUUID()}`);
  fs.mkdirSync(stage, { mode: 0o700 });
  try {
    const files = {};
    for (const [role, filename] of Object.entries(evidenceFiles)) {
      writeDurableFile(path.join(stage, filename), contents[role]);
      files[role] = {
        path: filename,
        bytes: contents[role].length,
        sha256: digest(contents[role]),
      };
    }

    writeDurableFile(
      path.join(stage, "capture.json"),
      Buffer.from(`${JSON.stringify({ formatVersion: 1, capturedAt, files }, null, 2)}\n`),
    );
    writeDurableFile(
      path.join(stage, "artifact.json"),
      Buffer.from(`${JSON.stringify({ ...draft, files }, null, 2)}\n`),
    );

    const result = validateEvalArtifact(stage, { requirePass: false });
    fs.renameSync(stage, output);
    return { ...result, artifact: output };
  } catch (error) {
    fs.rmSync(stage, { recursive: true, force: true });
    throw error;
  }
}

function parseCli(argv) {
  const names = new Map([
    ["--draft", "draft"],
    ["--output", "outputDirectory"],
    ["--transcript", "transcript"],
    ["--state", "stateSnapshot"],
    ["--source-ledger", "sourceLedger"],
    ["--rendered-note", "renderedNote"],
  ]);
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const key = names.get(flag);
    if (!key || index + 1 >= argv.length || argv[index + 1].startsWith("--")) {
      fail(`Unknown or incomplete option: ${flag ?? "<missing>"}`, "INVALID_EVAL_OPTION");
    }
    if (Object.hasOwn(parsed, key)) {
      fail(`Duplicate option: ${flag}`, "INVALID_EVAL_OPTION");
    }
    parsed[key] = argv[index + 1];
  }
  for (const key of names.values()) {
    if (!Object.hasOwn(parsed, key)) fail(`Missing required option: ${key}`, "INVALID_EVAL_OPTION");
  }
  return parsed;
}

function readDraft(file) {
  const contents = readRegularFile(file, "Evaluation artifact draft");
  try {
    return JSON.parse(contents.toString("utf8"));
  } catch (error) {
    fail(`Evaluation artifact draft is not valid JSON: ${error.message}`, "INVALID_EVAL_DRAFT");
  }
}

const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedFile === fileURLToPath(import.meta.url)) {
  try {
    const options = parseCli(process.argv.slice(2));
    const result = packageEvalArtifact({
      outputDirectory: options.outputDirectory,
      draft: readDraft(options.draft),
      evidence: {
        transcript: options.transcript,
        stateSnapshot: options.stateSnapshot,
        sourceLedger: options.sourceLedger,
        renderedNote: options.renderedNote,
      },
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const code = error.code ?? "UNEXPECTED_ERROR";
    process.stderr.write(`[${code}] ${error.message}\n`);
    process.exit(1);
  }
}
