import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { exportLearnerRecord } from "../src/export.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "bin", "learn.mjs");
const now = "2026-08-24T12:00:00.000Z";

function tempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function run(root, command, options = []) {
  return spawnSync(process.execPath, [cli, command, "--root", root, ...options], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function filesUnder(root, current = root) {
  const files = [];
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(root, absolute));
    else files.push(path.relative(root, absolute).split(path.sep).join("/"));
  }
  return files.sort();
}

test("export creates a deterministic portable record with generated notes and verified visuals", () => {
  const root = tempRoot("adaptive-learn-export-source-");
  assert.equal(run(root, "init", ["--now", now]).status, 0);
  assert.equal(
    run(root, "start", [
      "--id",
      "session-1",
      "--topic-id",
      "topic-1",
      "--topic",
      "Portable learning",
      "--target",
      "Preserve the complete learner record",
      "--now",
      now,
    ]).status,
    0,
  );

  const visual = path.join(root, "vault", "Assets", "diagram.svg");
  fs.mkdirSync(path.dirname(visual), { recursive: true });
  const originalVisual = "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>\n";
  fs.writeFileSync(visual, originalVisual);
  const addVisual = run(root, "add-visual", [
    "--id",
    "visual-1",
    "--path",
    "Assets/diagram.svg",
    "--description",
    "Verified diagram",
    "--verification",
    "Opened and inspected locally.",
    "--now",
    now,
  ]);
  assert.equal(addVisual.status, 0, addVisual.stderr);

  const first = path.join(tempRoot("adaptive-learn-export-out-"), "record one");
  const second = path.join(tempRoot("adaptive-learn-export-out-"), "record two");
  const firstRun = run(root, "export", ["--output", first]);
  assert.equal(firstRun.status, 0, firstRun.stderr);
  const secondRun = run(root, "export", ["--output", second]);
  assert.equal(secondRun.status, 0, secondRun.stderr);

  const expected = filesUnder(first);
  assert.equal(expected.includes("export-manifest.json"), true);
  assert.equal(expected.includes("render-manifest.json"), true);
  assert.equal(expected.includes("state.json"), true);
  assert.equal(expected.includes("vault/Assets/diagram.svg"), true);
  assert.equal(expected.includes("vault/Home.md"), true);
  assert.equal(expected.includes("vault/Reviews.md"), true);
  assert.equal(expected.some((file) => /^vault\/Sessions\/portable-learning-.*\.md$/.test(file)), true);
  assert.equal(expected.some((file) => /^vault\/Topics\/portable-learning-.*\.md$/.test(file)), true);
  assert.deepEqual(filesUnder(first), expected);
  assert.deepEqual(filesUnder(second), expected);
  for (const file of expected) {
    assert.deepEqual(fs.readFileSync(path.join(first, ...file.split("/"))), fs.readFileSync(path.join(second, ...file.split("/"))));
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(first, "export-manifest.json"), "utf8"));
  assert.equal(manifest.formatVersion, 1);
  assert.equal(manifest.productVersion, "0.2.0-rc.2");
  assert.equal(manifest.schemaVersion, 6);
  assert.equal(manifest.stateRevision, 2);
  assert.deepEqual(manifest.files.map((entry) => entry.path), expected.slice(1));
  assert.equal(manifest.files.every((entry) => /^[0-9a-f]{64}$/.test(entry.sha256)), true);
  assert.equal(JSON.stringify(manifest).includes(root), false);
  assert.equal(filesUnder(first).some((file) => /lock|pending|\.tmp/i.test(file)), false);

  const duplicate = run(root, "export", ["--output", first]);
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.stderr, /already exists/i);
});

test("export refuses a verified visual swapped to a symlink between inspection and copy", (t) => {
  if (process.platform === "win32") t.skip("symlink permissions differ on Windows");
  const root = tempRoot("adaptive-learn-export-race-source-");
  assert.equal(run(root, "init", ["--now", now]).status, 0);
  assert.equal(
    run(root, "start", [
      "--id", "session-1",
      "--topic-id", "topic-1",
      "--topic", "Race-safe export",
      "--target", "Never copy a swapped visual",
      "--now", now,
    ]).status,
    0,
  );

  const visual = path.join(root, "vault", "Assets", "diagram.svg");
  fs.mkdirSync(path.dirname(visual), { recursive: true });
  fs.writeFileSync(visual, "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>\n");
  assert.equal(
    run(root, "add-visual", [
      "--id", "visual-1",
      "--path", "Assets/diagram.svg",
      "--description", "Verified diagram",
      "--verification", "Opened and inspected locally.",
      "--now", now,
    ]).status,
    0,
  );
  const replacement = path.join(root, "replacement.svg");
  fs.writeFileSync(replacement, "<svg><text>must never be exported</text></svg>\n");
  const output = path.join(tempRoot("adaptive-learn-export-race-out-"), "record");

  const originalLstatSync = fs.lstatSync;
  const originalOpenSync = fs.openSync;
  let visualLstatCount = 0;
  let visualOpenCount = 0;
  let swapped = false;
  const swap = () => {
    if (swapped) return;
    fs.unlinkSync(visual);
    fs.symlinkSync(replacement, visual);
    swapped = true;
  };
  fs.lstatSync = function instrumentedLstat(file, ...args) {
    const stat = originalLstatSync.call(fs, file, ...args);
    if (path.resolve(file) === visual && ++visualLstatCount === 2) swap();
    return stat;
  };
  fs.openSync = function instrumentedOpen(file, ...args) {
    if (path.resolve(file) === visual && ++visualOpenCount === 2) swap();
    return originalOpenSync.call(fs, file, ...args);
  };

  try {
    let rejected = false;
    try {
      exportLearnerRecord(root, output);
    } catch (error) {
      assert.match(error.message, /regular file|symlink|changed/i);
      rejected = true;
    }
    if (rejected) {
      assert.equal(fs.existsSync(output), false);
    } else {
      assert.equal(
        fs.readFileSync(path.join(output, "vault", "Assets", "diagram.svg"), "utf8"),
        originalVisual,
      );
    }
  } finally {
    fs.lstatSync = originalLstatSync;
    fs.openSync = originalOpenSync;
  }
});

test("backup and restore check validate a snapshot without changing canonical state", () => {
  const root = tempRoot("adaptive-learn-recovery-");
  assert.equal(run(root, "init", ["--now", now]).status, 0);
  const ambiguousTime = run(root, "backup", ["--id", "ambiguous", "--now", "2026-08-24"]);
  assert.notEqual(ambiguousTime.status, 0);
  assert.match(ambiguousTime.stderr, /canonical ISO instant/);
  const backup = run(root, "backup", ["--id", "before-change", "--now", now]);
  assert.equal(backup.status, 0, backup.stderr);
  const before = fs.readFileSync(path.join(root, ".adaptive-learning", "state.json"));

  const checked = run(root, "restore", ["--backup", "before-change", "--check"]);
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /"valid": true/);
  assert.deepEqual(fs.readFileSync(path.join(root, ".adaptive-learning", "state.json")), before);

  const unsafe = run(root, "restore", ["--backup", "before-change"]);
  assert.notEqual(unsafe.status, 0);
  assert.match(unsafe.stderr, /--check/);
});
