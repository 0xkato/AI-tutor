import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { checkBackup, createBackup } from "../src/backup.mjs";
import { doctor } from "../src/doctor.mjs";
import {
  initializeStore,
  mutateState,
  pathsFor,
  readState,
} from "../src/store.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const killWorker = path.join(repository, "test", "fixtures", "kill-while-locked.mjs");

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-recovery-"));
}

function childExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function waitForFile(file) {
  const deadline = Date.now() + 2_000;
  while (!fs.existsSync(file)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${file}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function startLockHolder(root, signal) {
  return spawn(process.execPath, [killWorker, root, signal], {
    cwd: repository,
    stdio: "inherit",
  });
}

test("a dead lock owner is recovered without losing canonical state", async (t) => {
  const root = tempRoot();
  const signal = path.join(root, "lock-held.json");
  const initial = initializeStore(root, { now: "2026-08-24T08:00:00.000Z" });
  initial.counter = 0;
  mutateState(root, () => initial);

  const child = startLockHolder(root, signal);
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });
  await waitForFile(signal);
  const metadata = JSON.parse(fs.readFileSync(signal, "utf8"));
  assert.equal(metadata.pid, child.pid);
  assert.match(metadata.token, /^[0-9a-f-]{36}$/);
  assert.equal(typeof metadata.createdAt, "string");

  child.kill("SIGKILL");
  await childExit(child);

  const next = mutateState(root, (state) => {
    state.counter += 1;
    return state;
  });
  assert.equal(next.counter, 1);
  assert.equal(readState(root).counter, 1);
  assert.equal(fs.existsSync(pathsFor(root).lock), false);
});

test("a live lock owner is never displaced merely because a timeout expires", async (t) => {
  const root = tempRoot();
  const signal = path.join(root, "lock-held.json");
  initializeStore(root, { now: "2026-08-24T08:00:00.000Z" });
  const child = startLockHolder(root, signal);
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });
  await waitForFile(signal);
  const before = fs.readFileSync(pathsFor(root).lock, "utf8");

  assert.throws(
    () => mutateState(root, (state) => state, { lockTimeoutMs: 50 }),
    (error) => error.code === "STATE_LOCKED",
  );
  assert.equal(fs.readFileSync(pathsFor(root).lock, "utf8"), before);

  child.kill("SIGKILL");
  await childExit(child);
});

test("a mutation cleans only its own unique temporary state file", () => {
  const root = tempRoot();
  initializeStore(root, { now: "2026-08-24T08:00:00.000Z" });
  const paths = pathsFor(root);
  const foreign = path.join(paths.dataDir, "state.json.tmp-999-foreign-token");
  fs.writeFileSync(foreign, "foreign", { mode: 0o600 });

  mutateState(root, (state) => {
    state.settings.vaultDir = "Recovered Vault";
    return state;
  });

  const ownTemps = fs.readdirSync(paths.dataDir).filter((name) =>
    name.startsWith(`state.json.tmp-${process.pid}-`),
  );
  assert.deepEqual(ownTemps, []);
  assert.equal(fs.readFileSync(foreign, "utf8"), "foreign");
});

test("backup validation detects tampering without changing canonical state", () => {
  const root = tempRoot();
  const state = initializeStore(root, { now: "2026-08-24T08:00:00.000Z" });
  state.settings.vaultDir = "Learning Vault";
  mutateState(root, () => state);
  const before = fs.readFileSync(pathsFor(root).state, "utf8");

  const backup = createBackup(root, {
    id: "backup-test",
    now: "2026-08-24T09:00:00.000Z",
  });
  const checked = checkBackup(root, backup.id);
  assert.equal(checked.valid, true);
  assert.equal(checked.manifest.stateSha256, backup.manifest.stateSha256);
  assert.equal(checked.state.settings.vaultDir, "Learning Vault");

  fs.appendFileSync(path.join(backup.path, "state.json"), "tampered");
  assert.throws(
    () => checkBackup(root, backup.id),
    (error) => error.code === "BACKUP_CHECKSUM_MISMATCH",
  );
  assert.equal(fs.readFileSync(pathsFor(root).state, "utf8"), before);
});

test("doctor reports state, ownership, backups, render revision, and permissions", () => {
  const root = tempRoot();
  initializeStore(root, { now: "2026-08-24T08:00:00.000Z" });
  createBackup(root, { id: "backup-doctor", now: "2026-08-24T09:00:00.000Z" });

  const report = doctor(root);

  assert.equal(report.ok, false);
  assert.deepEqual(report.state, {
    exists: true,
    valid: true,
    schemaVersion: 2,
    revision: 0,
    error: null,
  });
  assert.equal(report.lock.exists, false);
  assert.equal(report.backups.valid, 1);
  assert.equal(report.backups.invalid, 0);
  assert.deepEqual(report.render, {
    stateRevision: 0,
    renderedRevision: 0,
    status: "stale",
    current: false,
    error: null,
  });
  assert.equal(report.permissions.stateOwnerOnly, true);
  assert.equal(report.actions.includes("Run repair-render to reconcile the Obsidian projection."), true);
  assert.equal(report.actions.includes("Restore the Codex adaptive-learning skill files."), true);
  assert.equal(report.actions.includes("Restore the Pi extension and enable project skill commands."), true);
  assert.equal(report.actions.includes("Run setup or repair-render to create the Obsidian vault."), true);
});
