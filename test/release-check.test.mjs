import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(repoRoot, "scripts", "release-check.mjs");

test("release check declares every release gate from one executable plan", () => {
  const result = spawnSync(process.execPath, [script, "--list"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const stages = JSON.parse(result.stdout);
  assert.deepEqual(stages, [
    "automated test suite",
    "JavaScript syntax",
    "JSON documents",
    "fresh-path setup",
    "end-to-end learning and review fixtures",
    "fresh-path doctor",
  ]);
});

test("release check selects test modules without executing process fixtures as tests", () => {
  const result = spawnSync(process.execPath, [script, "--list-tests"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const selected = JSON.parse(result.stdout);
  assert.equal(selected.length > 0, true);
  assert.equal(selected.every((file) => file.endsWith(".test.mjs")), true);
  assert.equal(selected.some((file) => file.includes("/fixtures/")), false);
});

test("fresh release fixture includes the locked runtime dependency graph", () => {
  const source = fs.readFileSync(script, "utf8");
  assert.match(source, /"package-lock\.json"/);
  assert.match(source, /"CHANGELOG\.md"/);
});
