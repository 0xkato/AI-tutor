import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseInstant, validateState } from "../src/schema.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(scriptDir, "..");
const suiteFile = path.join(repository, "evals", "scenarios.json");
const REQUIRED_FILES = ["transcript", "stateSnapshot", "sourceLedger", "renderedNote"];
const REQUIRED_DIMENSIONS = [
  "targetFidelity",
  "frontierAccuracy",
  "questionClarity",
  "leakageAvoidance",
  "assessmentAccuracy",
  "sourceSupport",
  "pacing",
  "persistence",
  "synthesis",
];

class EvalArtifactError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "EvalArtifactError";
    this.code = code;
  }
}

function fail(message, code) {
  throw new EvalArtifactError(message, code);
}

function object(value, label, code = "INVALID_EVAL_ARTIFACT") {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`, code);
  }
  return value;
}

function text(value, label, code = "INVALID_EVAL_ARTIFACT") {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} must be non-empty text`, code);
  return value;
}

function readJson(file, label, code) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    fail(`${label} could not be read: ${error.message}`, code);
  }
  try {
    return { raw, value: JSON.parse(raw) };
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`, code);
  }
}

function digest(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function readEvidence(root, realRoot, role, record) {
  object(record, `files.${role}`);
  const relativePath = text(record.path, `files.${role}.path`);
  if (path.isAbsolute(relativePath)) fail(`${role} path must be relative`, "INVALID_EVAL_PATH");
  const target = path.resolve(root, relativePath);
  if (target === root || !target.startsWith(`${root}${path.sep}`)) {
    fail(`${role} path escapes the artifact directory`, "INVALID_EVAL_PATH");
  }
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch {
    fail(`Missing required evaluation file for ${role}: ${relativePath}`, "MISSING_EVAL_FILE");
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail(`${role} must be a regular file`, "INVALID_EVAL_PATH");
  }
  const realTarget = fs.realpathSync(target);
  if (!realTarget.startsWith(`${realRoot}${path.sep}`)) {
    fail(`${role} resolves outside the artifact directory`, "INVALID_EVAL_PATH");
  }
  const contents = fs.readFileSync(target);
  if (contents.length === 0) fail(`${role} must not be empty`, "EMPTY_EVAL_FILE");
  if (!Number.isInteger(record.bytes) || record.bytes < 1 || record.bytes !== contents.length) {
    fail(`${role} byte count does not match the file`, "EVAL_FILE_MISMATCH");
  }
  if (!/^[a-f0-9]{64}$/.test(record.sha256) || digest(contents) !== record.sha256) {
    fail(`${role} SHA-256 does not match the file`, "EVAL_FILE_MISMATCH");
  }
  return contents;
}

function validateRubric(rubric, acceptance) {
  object(rubric, "rubric");
  const dimensions = object(rubric.dimensions, "rubric.dimensions", "INVALID_RUBRIC_FIELD");
  const scores = [];
  for (const dimension of REQUIRED_DIMENSIONS) {
    const entry = object(
      dimensions[dimension],
      `rubric.dimensions.${dimension}`,
      "INVALID_RUBRIC_FIELD",
    );
    if (!Number.isInteger(entry.score) || entry.score < 0 || entry.score > 4) {
      fail(`rubric dimension ${dimension} needs an integer score from 0 to 4`, "INVALID_RUBRIC_FIELD");
    }
    text(entry.evidence, `rubric.dimensions.${dimension}.evidence`, "INVALID_RUBRIC_FIELD");
    scores.push(entry.score);
  }

  if (!Array.isArray(rubric.deterministicChecks) || rubric.deterministicChecks.length === 0) {
    fail("rubric.deterministicChecks must contain at least one check", "INVALID_DETERMINISTIC_CHECK");
  }
  for (const check of rubric.deterministicChecks) {
    object(check, "deterministic check", "INVALID_DETERMINISTIC_CHECK");
    text(check.name, "deterministic check name", "INVALID_DETERMINISTIC_CHECK");
    if (typeof check.passed !== "boolean") {
      fail("deterministic check passed must be boolean", "INVALID_DETERMINISTIC_CHECK");
    }
    text(check.evidence, "deterministic check evidence", "INVALID_DETERMINISTIC_CHECK");
  }

  if (!Array.isArray(rubric.contaminatedQuestions)) {
    fail("rubric.contaminatedQuestions must be an array", "CONTAMINATED_EVIDENCE");
  }
  for (const question of rubric.contaminatedQuestions) {
    object(question, "contaminated question", "CONTAMINATED_EVIDENCE");
    text(question.questionId, "contaminated question id", "CONTAMINATED_EVIDENCE");
    text(question.reason, "contaminated question reason", "CONTAMINATED_EVIDENCE");
    if (question.excludedFromEvidence !== true) {
      fail("Every contaminated question must be excluded from evidence", "CONTAMINATED_EVIDENCE");
    }
  }

  if (!Array.isArray(rubric.criticalFailures)) {
    fail("rubric.criticalFailures must be an array", "INVALID_CRITICAL_FAILURES");
  }
  for (const failure of rubric.criticalFailures) {
    object(failure, "critical failure", "INVALID_CRITICAL_FAILURES");
    text(failure.code, "critical failure code", "INVALID_CRITICAL_FAILURES");
    text(failure.description, "critical failure description", "INVALID_CRITICAL_FAILURES");
    text(failure.evidence, "critical failure evidence", "INVALID_CRITICAL_FAILURES");
  }

  const verdict = object(rubric.humanVerdict, "rubric.humanVerdict", "INVALID_HUMAN_VERDICT");
  if (!new Set(["pass", "fail", "pending"]).has(verdict.outcome)) {
    fail("human verdict outcome must be pass, fail, or pending", "INVALID_HUMAN_VERDICT");
  }
  text(verdict.reviewer, "human verdict reviewer", "INVALID_HUMAN_VERDICT");
  if (verdict.outcome === "pending") {
    if (verdict.reviewedAt !== null) {
      fail("pending human verdict reviewedAt must be null", "INVALID_HUMAN_VERDICT");
    }
  } else {
    parseInstant(verdict.reviewedAt, "human verdict reviewedAt");
  }
  text(verdict.rationale, "human verdict rationale", "INVALID_HUMAN_VERDICT");

  const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const allChecksPass = rubric.deterministicChecks.every((check) => check.passed === true);
  const minimumPass = scores.every((score) => score >= acceptance.minimumDimensionScore);
  const accepted =
    (!acceptance.requireAllDeterministicChecks || allChecksPass) &&
    minimumPass &&
    average >= acceptance.minimumAverageScore &&
    (acceptance.allowCriticalFailures || rubric.criticalFailures.length === 0) &&
    (!acceptance.requireHumanPass || verdict.outcome === "pass");
  return { accepted, averageScore: average };
}

export function validateEvalArtifact(directory, { requirePass = true } = {}) {
  const root = path.resolve(directory);
  let rootStat;
  try {
    rootStat = fs.lstatSync(root);
  } catch {
    fail(`Evaluation artifact directory does not exist: ${root}`, "EVAL_ARTIFACT_NOT_FOUND");
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    fail("Evaluation artifact root must be a real directory", "INVALID_EVAL_PATH");
  }
  const realRoot = fs.realpathSync(root);
  const suite = readJson(suiteFile, "Scenario suite", "INVALID_SCENARIO_SUITE").value;
  const artifact = readJson(
    path.join(root, "artifact.json"),
    "Evaluation artifact",
    "INVALID_EVAL_ARTIFACT",
  ).value;
  object(artifact, "artifact");
  if (artifact.formatVersion !== 1 || artifact.suiteVersion !== suite.suiteVersion) {
    fail("Evaluation artifact version does not match the current suite", "EVAL_VERSION_MISMATCH");
  }
  const scenarioRef = object(artifact.scenario, "scenario");
  const scenario = suite.scenarios.find((candidate) => candidate.id === scenarioRef.id);
  if (!scenario || scenario.version !== scenarioRef.version) {
    fail("Evaluation artifact references an unknown scenario version", "UNKNOWN_EVAL_SCENARIO");
  }
  if (!new Set(["codex", "pi"]).has(artifact.host)) {
    fail("Evaluation host must be codex or pi", "INVALID_EVAL_HOST");
  }
  text(artifact.sessionId, "sessionId");
  const startedAt = parseInstant(artifact.startedAt, "startedAt");
  const completedAt = parseInstant(artifact.completedAt, "completedAt");
  if (Date.parse(completedAt) < Date.parse(startedAt)) {
    fail("completedAt must not precede startedAt", "INVALID_EVAL_TIME");
  }

  const fileRecords = object(artifact.files, "files");
  const contents = {};
  for (const role of REQUIRED_FILES) {
    contents[role] = readEvidence(root, realRoot, role, fileRecords[role]);
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
    fail("Source ledger must use formatVersion 1 with a sources array", "INVALID_SOURCE_LEDGER");
  }
  if (!contents.transcript.toString("utf8").trim() || !contents.renderedNote.toString("utf8").trim()) {
    fail("Transcript and rendered note must contain text", "EMPTY_EVAL_FILE");
  }

  const rubric = validateRubric(artifact.rubric, suite.acceptance);
  const result = {
    valid: true,
    accepted: rubric.accepted,
    suiteVersion: suite.suiteVersion,
    scenarioId: scenario.id,
    scenarioVersion: scenario.version,
    host: artifact.host,
    averageScore: rubric.averageScore,
    artifact: root,
  };
  if (requirePass && !result.accepted) {
    fail("Evaluation artifact is complete but does not pass the release rubric", "EVAL_NOT_ACCEPTED");
  }
  return result;
}

const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedFile === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const allowFailed = args.includes("--allow-failed");
  const positional = args.filter((arg) => arg !== "--allow-failed" && arg !== "--json");
  if (positional.length !== 1) {
    process.stderr.write("Usage: node scripts/validate-eval-artifact.mjs <artifact-directory> [--allow-failed] [--json]\n");
    process.exit(1);
  }
  try {
    const result = validateEvalArtifact(positional[0], { requirePass: !allowFailed });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const code = error instanceof EvalArtifactError ? error.code : "UNEXPECTED_ERROR";
    process.stderr.write(`[${code}] ${error.message}\n`);
    process.exit(1);
  }
}
