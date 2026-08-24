import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { LearningError } from "./errors.mjs";
import { migrateV1ToV2 } from "./migrations.mjs";
import { createInitialState } from "./model.mjs";
import { parseInstant, validateState } from "./schema.mjs";

const DEFAULT_LOCK_TIMEOUT_MS = 2_000;
const WAIT_BUFFER = new Int32Array(new SharedArrayBuffer(4));

export function pathsFor(root) {
  const dataDir = path.join(path.resolve(root), ".adaptive-learning");
  return {
    dataDir,
    state: path.join(dataDir, "state.json"),
    lock: path.join(dataDir, "state.lock"),
    backups: path.join(dataDir, "backups"),
    renderManifest: path.join(dataDir, "render-manifest.json"),
    renderPending: path.join(dataDir, "render-pending.json"),
  };
}

function ensureDirectory(directory, mode = 0o700) {
  fs.mkdirSync(directory, { recursive: true, mode });
  fs.chmodSync(directory, mode);
}

function syncDirectory(directory) {
  const fd = fs.openSync(directory, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true;
    throw new LearningError(
      `Could not inspect lock owner ${pid}: ${error.message}`,
      "LOCK_OWNER_CHECK_FAILED",
    );
  }
}

function parseLock(raw) {
  let metadata;
  try {
    metadata = JSON.parse(raw);
  } catch (error) {
    throw new LearningError(`Lock metadata is not valid JSON: ${error.message}`, "INVALID_LOCK");
  }
  if (
    !metadata ||
    typeof metadata !== "object" ||
    Array.isArray(metadata) ||
    !Number.isInteger(metadata.pid) ||
    metadata.pid <= 0 ||
    typeof metadata.token !== "string" ||
    !/^[0-9a-f-]{36}$/.test(metadata.token)
  ) {
    throw new LearningError("Lock metadata is structurally invalid", "INVALID_LOCK");
  }
  parseInstant(metadata.createdAt, "lock createdAt");
  return metadata;
}

function readLockFile(lockPath) {
  try {
    const raw = fs.readFileSync(lockPath, "utf8");
    return { raw, metadata: parseLock(raw) };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export function inspectLock(root) {
  const lockPath = pathsFor(root).lock;
  if (!fs.existsSync(lockPath)) {
    return {
      exists: false,
      valid: true,
      ownerAlive: null,
      metadata: null,
      error: null,
    };
  }
  try {
    const lock = readLockFile(lockPath);
    return {
      exists: true,
      valid: true,
      ownerAlive: processIsAlive(lock.metadata.pid),
      metadata: lock.metadata,
      error: null,
    };
  } catch (error) {
    return {
      exists: true,
      valid: false,
      ownerAlive: null,
      metadata: null,
      error: error.message,
    };
  }
}

function recoverDeadLock(paths) {
  let observed;
  try {
    observed = readLockFile(paths.lock);
  } catch (error) {
    if (error.code === "INVALID_LOCK") return false;
    throw error;
  }
  if (!observed || processIsAlive(observed.metadata.pid)) return false;

  let current;
  try {
    current = fs.readFileSync(paths.lock, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return true;
    throw error;
  }
  if (current !== observed.raw) return false;
  fs.unlinkSync(paths.lock);
  syncDirectory(paths.dataDir);
  return true;
}

function createLockCandidate(paths, metadata) {
  const candidate = path.join(
    paths.dataDir,
    `state.lock.${metadata.pid}.${metadata.token}.tmp`,
  );
  const fd = fs.openSync(candidate, "wx", 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(metadata)}\n`, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return candidate;
}

function acquireLock(paths, { timeoutMs = DEFAULT_LOCK_TIMEOUT_MS } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 0) {
    throw new LearningError("lockTimeoutMs must be a non-negative integer", "INVALID_INPUT");
  }
  const metadata = {
    pid: process.pid,
    token: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  const candidate = createLockCandidate(paths, metadata);
  const deadline = Date.now() + timeoutMs;
  try {
    while (true) {
      try {
        fs.linkSync(candidate, paths.lock);
        fs.unlinkSync(candidate);
        syncDirectory(paths.dataDir);
        return metadata;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        if (recoverDeadLock(paths)) continue;
        if (Date.now() >= deadline) {
          throw new LearningError("Could not acquire the learning-state lock", "STATE_LOCKED");
        }
        Atomics.wait(WAIT_BUFFER, 0, 0, 20);
      }
    }
  } finally {
    fs.rmSync(candidate, { force: true });
  }
}

function releaseLock(paths, ownership) {
  const current = readLockFile(paths.lock);
  if (!current || current.metadata.token !== ownership.token) {
    throw new LearningError(
      "Learning-state lock ownership changed before release",
      "LOCK_OWNERSHIP_LOST",
    );
  }
  fs.unlinkSync(paths.lock);
  syncDirectory(paths.dataDir);
}

function temporaryStatePath(paths, ownership) {
  return path.join(
    paths.dataDir,
    `state.json.tmp-${ownership.pid}-${ownership.token}`,
  );
}

function writeStateUnlocked(paths, state, ownership) {
  const validated = validateState(state);
  const temporary = temporaryStatePath(paths, ownership);
  let fd = null;
  try {
    fd = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(temporary, paths.state);
    fs.chmodSync(paths.state, 0o600);
    syncDirectory(paths.dataDir);
  } finally {
    if (fd !== null) fs.closeSync(fd);
    fs.rmSync(temporary, { force: true });
  }
  return validated;
}

function parseState(paths) {
  try {
    return JSON.parse(fs.readFileSync(paths.state, "utf8"));
  } catch (error) {
    throw new LearningError(`Could not read learning state: ${error.message}`, "INVALID_STATE");
  }
}

function backupVersionOne(paths, state) {
  ensureDirectory(paths.backups);
  const stamp = String(state.updatedAt ?? state.createdAt ?? "unknown").replace(/[^0-9A-Za-z]+/g, "-");
  const destination = path.join(paths.backups, `state-v1-${stamp}.json`);
  if (!fs.existsSync(destination)) {
    const fd = fs.openSync(destination, "wx", 0o600);
    try {
      fs.writeFileSync(fd, `${JSON.stringify(state, null, 2)}\n`, "utf8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    syncDirectory(paths.backups);
  }
}

function readStateUnlocked(paths, ownership) {
  const state = parseState(paths);
  if (state.schemaVersion === 1) {
    backupVersionOne(paths, state);
    const migrated = migrateV1ToV2(state);
    return writeStateUnlocked(paths, migrated, ownership);
  }
  return validateState(state);
}

function withLock(root, options, operation) {
  const paths = pathsFor(root);
  ensureDirectory(paths.dataDir);
  const ownership = acquireLock(paths, { timeoutMs: options.lockTimeoutMs });
  let operationError;
  try {
    return operation(paths, ownership);
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      releaseLock(paths, ownership);
    } catch (releaseError) {
      if (!operationError) throw releaseError;
    }
  }
}

export function writeState(root, state, options = {}) {
  return withLock(root, options, (paths, ownership) =>
    writeStateUnlocked(paths, validateState(state), ownership));
}

export function mutateState(root, mutation, { lockTimeoutMs } = {}) {
  if (typeof mutation !== "function") throw new TypeError("mutation must be a function");
  return withLock(root, { lockTimeoutMs }, (paths, ownership) => {
    const current = readStateUnlocked(paths, ownership);
    const next = mutation(current);
    next.revision = current.revision + 1;
    next.render = {
      revision: current.render.revision,
      status: "stale",
      error: null,
    };
    const validated = writeStateUnlocked(paths, validateState(next), ownership);
    return validated;
  });
}

export function readState(root, options = {}) {
  const paths = pathsFor(root);
  if (!fs.existsSync(paths.state)) {
    throw new LearningError("Learning state is not initialized", "STATE_NOT_INITIALIZED");
  }
  const state = parseState(paths);
  if (state.schemaVersion !== 1) return validateState(state);
  return withLock(root, options, (lockedPaths, ownership) =>
    readStateUnlocked(lockedPaths, ownership));
}

export function initializeStore(root, { now, lockTimeoutMs } = {}) {
  const paths = pathsFor(root);
  if (fs.existsSync(paths.state)) return readState(root, { lockTimeoutMs });
  return withLock(root, { lockTimeoutMs }, (lockedPaths, ownership) => {
    if (fs.existsSync(lockedPaths.state)) return readStateUnlocked(lockedPaths, ownership);
    return writeStateUnlocked(lockedPaths, createInitialState({ now }), ownership);
  });
}
