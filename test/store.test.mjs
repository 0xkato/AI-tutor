import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  initializeStore,
  mutateState,
  pathsFor,
  readState,
  writeState,
} from "../src/store.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const worker = path.join(repository, "test", "fixtures", "store-mutate-worker.mjs");

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-store-"));
}

test("initializeStore creates versioned canonical state", () => {
  const root = tempRoot();
  const state = initializeStore(root, { now: "2026-08-24T08:00:00.000Z" });

  assert.equal(state.schemaVersion, 5);
  assert.equal(state.revision, 0);
  assert.equal(state.activeSessionId, null);
  assert.deepEqual(state.sessions, {});
  assert.deepEqual(state.concepts, {});
  assert.deepEqual(state.reviews, {});
  assert.equal(state.learnerProfile.updatedAt, null);
  assert.deepEqual(readState(root), state);
});

test("writeState atomically replaces state and leaves no temporary file", () => {
  const root = tempRoot();
  const state = initializeStore(root, { now: "2026-08-24T08:00:00.000Z" });
  state.settings.vaultDir = "Learning Vault";

  writeState(root, state);

  assert.equal(readState(root).settings.vaultDir, "Learning Vault");
  const paths = pathsFor(root);
  assert.deepEqual(
    fs.readdirSync(paths.dataDir).filter((name) => name.startsWith("state.json.tmp-")),
    [],
  );
  assert.equal(fs.existsSync(paths.lock), false);
});

test("readState rejects an unsupported schema version", () => {
  const root = tempRoot();
  initializeStore(root);
  const paths = pathsFor(root);
  fs.writeFileSync(paths.state, JSON.stringify({ schemaVersion: 999 }));

  assert.throws(() => readState(root), /Unsupported state schema version: 999/);
});

function completed(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`store worker exited with ${code}`));
    });
  });
}

async function waitForFile(file) {
  const deadline = Date.now() + 2_000;
  while (!fs.existsSync(file)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${file}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("mutateState serializes concurrent read-modify-write operations", async () => {
  const root = tempRoot();
  const signal = path.join(root, "first-worker-holds-lock");
  const state = initializeStore(root, { now: "2026-08-24T08:00:00.000Z" });
  state.counter = 0;
  writeState(root, state);

  const first = spawn(process.execPath, [worker, root, "250", signal], {
    cwd: repository,
    stdio: "inherit",
  });
  await waitForFile(signal);
  const second = spawn(process.execPath, [worker, root, "0"], {
    cwd: repository,
    stdio: "inherit",
  });

  await Promise.all([completed(first), completed(second)]);
  assert.equal(readState(root).counter, 2);
  assert.equal(fs.existsSync(pathsFor(root).lock), false);

  const result = mutateState(root, (current) => {
    current.counter += 1;
    return current;
  });
  assert.equal(result.counter, 3);
});
