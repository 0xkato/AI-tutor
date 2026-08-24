import fs from "node:fs";
import path from "node:path";

import { LearningError } from "./errors.mjs";
import { migrateV1ToV2 } from "./migrations.mjs";
import { createInitialState } from "./model.mjs";
import { validateState } from "./schema.mjs";

export function pathsFor(root) {
  const dataDir = path.join(path.resolve(root), ".adaptive-learning");
  return {
    dataDir,
    state: path.join(dataDir, "state.json"),
    tempState: path.join(dataDir, "state.json.tmp"),
    lock: path.join(dataDir, "state.lock"),
    backups: path.join(dataDir, "backups"),
  };
}

function acquireLock(lockPath) {
  const deadline = Date.now() + 2_000;
  while (true) {
    try {
      return fs.openSync(lockPath, "wx", 0o600);
    } catch (error) {
      if (error.code !== "EEXIST" || Date.now() >= deadline) {
        throw new LearningError("Could not acquire the learning-state lock", "STATE_LOCKED");
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
}

function releaseLock(paths, lockFd) {
  fs.closeSync(lockFd);
  fs.rmSync(paths.lock, { force: true });
  fs.rmSync(paths.tempState, { force: true });
}

function writeStateUnlocked(paths, state) {
  const validated = validateState(state);
  fs.writeFileSync(paths.tempState, `${JSON.stringify(validated, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(paths.tempState, paths.state);
}

function parseState(paths) {
  try {
    return JSON.parse(fs.readFileSync(paths.state, "utf8"));
  } catch (error) {
    throw new LearningError(`Could not read learning state: ${error.message}`, "INVALID_STATE");
  }
}

function backupVersionOne(paths, state) {
  fs.mkdirSync(paths.backups, { recursive: true, mode: 0o700 });
  const stamp = String(state.updatedAt ?? state.createdAt ?? "unknown").replace(/[^0-9A-Za-z]+/g, "-");
  const destination = path.join(paths.backups, `state-v1-${stamp}.json`);
  if (!fs.existsSync(destination)) {
    fs.writeFileSync(destination, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
  }
}

function readStateUnlocked(paths) {
  const state = parseState(paths);
  if (state.schemaVersion === 1) {
    backupVersionOne(paths, state);
    const migrated = migrateV1ToV2(state);
    writeStateUnlocked(paths, migrated);
    return migrated;
  }
  return validateState(state);
}

export function writeState(root, state) {
  const paths = pathsFor(root);
  fs.mkdirSync(paths.dataDir, { recursive: true });
  const lockFd = acquireLock(paths.lock);
  try {
    writeStateUnlocked(paths, validateState(state));
  } finally {
    releaseLock(paths, lockFd);
  }
  return state;
}

export function mutateState(root, mutation, { afterWrite } = {}) {
  if (typeof mutation !== "function") throw new TypeError("mutation must be a function");
  const paths = pathsFor(root);
  fs.mkdirSync(paths.dataDir, { recursive: true });
  const lockFd = acquireLock(paths.lock);
  try {
    const current = readStateUnlocked(paths);
    const next = mutation(current);
    const validated = validateState(next);
    writeStateUnlocked(paths, validated);
    if (afterWrite) afterWrite(validated);
    return validated;
  } finally {
    releaseLock(paths, lockFd);
  }
}

export function readState(root) {
  const paths = pathsFor(root);
  if (!fs.existsSync(paths.state)) {
    throw new LearningError("Learning state is not initialized", "STATE_NOT_INITIALIZED");
  }
  const state = parseState(paths);
  if (state.schemaVersion !== 1) return validateState(state);
  const lockFd = acquireLock(paths.lock);
  try {
    return readStateUnlocked(paths);
  } finally {
    releaseLock(paths, lockFd);
  }
}

export function initializeStore(root, { now } = {}) {
  const paths = pathsFor(root);
  if (fs.existsSync(paths.state)) return readState(root);
  fs.mkdirSync(paths.dataDir, { recursive: true });
  const lockFd = acquireLock(paths.lock);
  try {
    if (fs.existsSync(paths.state)) return readStateUnlocked(paths);
    const state = createInitialState({ now });
    writeStateUnlocked(paths, state);
    return state;
  } finally {
    releaseLock(paths, lockFd);
  }
}
