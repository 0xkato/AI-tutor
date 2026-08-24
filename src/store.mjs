import fs from "node:fs";
import path from "node:path";

import { LearningError } from "./errors.mjs";
import { createInitialState, SCHEMA_VERSION } from "./model.mjs";

export function pathsFor(root) {
  const dataDir = path.join(path.resolve(root), ".adaptive-learning");
  return {
    dataDir,
    state: path.join(dataDir, "state.json"),
    tempState: path.join(dataDir, "state.json.tmp"),
    lock: path.join(dataDir, "state.lock"),
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
  fs.writeFileSync(paths.tempState, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(paths.tempState, paths.state);
}

export function writeState(root, state) {
  const paths = pathsFor(root);
  fs.mkdirSync(paths.dataDir, { recursive: true });
  const lockFd = acquireLock(paths.lock);
  try {
    writeStateUnlocked(paths, state);
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
    const current = readState(root);
    const next = mutation(current);
    if (!next || next.schemaVersion !== SCHEMA_VERSION) {
      throw new LearningError("Mutation returned invalid learning state", "INVALID_STATE");
    }
    writeStateUnlocked(paths, next);
    if (afterWrite) afterWrite(next);
    return next;
  } finally {
    releaseLock(paths, lockFd);
  }
}

export function readState(root) {
  const paths = pathsFor(root);
  if (!fs.existsSync(paths.state)) {
    throw new LearningError("Learning state is not initialized", "STATE_NOT_INITIALIZED");
  }
  let state;
  try {
    state = JSON.parse(fs.readFileSync(paths.state, "utf8"));
  } catch (error) {
    throw new LearningError(`Could not read learning state: ${error.message}`, "INVALID_STATE");
  }
  if (state.schemaVersion !== SCHEMA_VERSION) {
    throw new LearningError(
      `Unsupported state schema version: ${state.schemaVersion}`,
      "UNSUPPORTED_SCHEMA",
    );
  }
  return state;
}

export function initializeStore(root, { now } = {}) {
  const paths = pathsFor(root);
  if (fs.existsSync(paths.state)) return readState(root);
  fs.mkdirSync(paths.dataDir, { recursive: true });
  const lockFd = acquireLock(paths.lock);
  try {
    if (fs.existsSync(paths.state)) return readState(root);
    const state = createInitialState({ now });
    writeStateUnlocked(paths, state);
    return state;
  } finally {
    releaseLock(paths, lockFd);
  }
}
