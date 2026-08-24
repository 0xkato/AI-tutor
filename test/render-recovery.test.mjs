import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { doctor } from "../src/doctor.mjs";
import { readRenderManifest } from "../src/render-manifest.mjs";
import { commitAndRender, repairRender } from "../src/render.mjs";
import { initializeStore, mutateState, pathsFor, readState } from "../src/store.mjs";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-render-recovery-"));
}

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repository, "bin", "learn.mjs");

test("successful state mutations advance the canonical revision and make rendering stale", () => {
  const root = tempRoot();
  initializeStore(root, { now: "2026-08-24T08:00:00.000Z" });

  const state = mutateState(root, (current) => {
    current.settings.vaultDir = "Learning Vault";
    return current;
  });

  assert.equal(state.revision, 1);
  assert.deepEqual(state.render, { revision: 0, status: "stale", error: null });
  assert.equal(readState(root).revision, 1);
});

test("a renderer failure is reported after the canonical revision commits and repair is non-mutating", () => {
  const root = tempRoot();
  initializeStore(root, { now: "2026-08-24T08:00:00.000Z" });

  const outcome = commitAndRender(
    root,
    (current) => {
      current.settings.vaultDir = "Learning Vault";
      return current;
    },
    {
      renderer() {
        throw new Error("simulated disk failure");
      },
    },
  );

  assert.equal(outcome.stateCommitted, true);
  assert.equal(outcome.stateRevision, 1);
  assert.deepEqual(outcome.render, {
    ok: false,
    code: "RENDER_FAILED",
    error: "simulated disk failure",
  });
  assert.equal(readState(root).settings.vaultDir, "Learning Vault");
  assert.equal(fs.existsSync(pathsFor(root).renderManifest), false);

  const canonicalBeforeRepair = fs.readFileSync(pathsFor(root).state, "utf8");
  const repaired = repairRender(root);

  assert.equal(repaired.ok, true);
  assert.equal(repaired.stateRevision, 1);
  assert.equal(readRenderManifest(root).stateRevision, 1);
  assert.equal(fs.readFileSync(pathsFor(root).state, "utf8"), canonicalBeforeRepair);
  assert.equal(doctor(root).render.current, true);
});

test("render reconciliation preserves files it does not own", () => {
  const root = tempRoot();
  initializeStore(root, { now: "2026-08-24T08:00:00.000Z" });
  repairRender(root);
  const custom = path.join(root, "vault", "My Notes.md");
  fs.writeFileSync(custom, "This belongs to the learner.\n");

  const outcome = commitAndRender(root, (current) => {
    current.updatedAt = "2026-08-24T09:00:00.000Z";
    return current;
  });

  assert.equal(outcome.render.ok, true);
  assert.equal(fs.readFileSync(custom, "utf8"), "This belongs to the learner.\n");
});

test("rendering refuses to overwrite an unmanifested generated target", () => {
  const root = tempRoot();
  const state = initializeStore(root, { now: "2026-08-24T08:00:00.000Z" });
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault, { recursive: true });
  const home = path.join(vault, "Home.md");
  fs.writeFileSync(home, "Unmanaged home\n");

  const result = repairRender(root);

  assert.equal(result.ok, false);
  assert.equal(result.code, "UNMANAGED_RENDER_TARGET");
  assert.equal(fs.readFileSync(home, "utf8"), "Unmanaged home\n");
  assert.equal(readState(root).revision, state.revision);
});

test("the CLI reports a committed revision separately from a render failure", () => {
  const root = tempRoot();
  const initialized = spawnSync(
    process.execPath,
    [cli, "init", "--root", root, "--json", "--now", "2026-08-24T08:00:00.000Z"],
    { cwd: repository, encoding: "utf8" },
  );
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);

  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-render-cli-outside-"));
  fs.symlinkSync(outside, path.join(root, "vault", "Sessions"));
  const failed = spawnSync(
    process.execPath,
    [
      cli,
      "start",
      "--root",
      root,
      "--json",
      "--id",
      "session-1",
      "--topic",
      "Render recovery",
      "--target",
      "Prove state and render outcomes are separate",
      "--now",
      "2026-08-24T08:01:00.000Z",
    ],
    { cwd: repository, encoding: "utf8" },
  );

  assert.equal(failed.status, 1);
  const payload = JSON.parse(failed.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.stateCommitted, true);
  assert.equal(payload.stateRevision, 1);
  assert.equal(payload.render.ok, false);
  assert.equal(payload.render.code, "SYMLINK_TRAVERSAL");
  assert.equal(readState(root).activeSessionId, "session-1");

  fs.unlinkSync(path.join(root, "vault", "Sessions"));
  const beforeRepair = fs.readFileSync(pathsFor(root).state, "utf8");
  const repaired = spawnSync(
    process.execPath,
    [cli, "repair-render", "--root", root, "--json"],
    { cwd: repository, encoding: "utf8" },
  );
  assert.equal(repaired.status, 0, repaired.stderr || repaired.stdout);
  assert.equal(JSON.parse(repaired.stdout).stateRevision, 1);
  assert.equal(fs.readFileSync(pathsFor(root).state, "utf8"), beforeRepair);
});
