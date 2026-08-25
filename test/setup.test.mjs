import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "adaptive learning setup "));
}

function copyReleaseFixture(destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of [
    ".agents",
    ".pi",
    "bin",
    "docs",
    "examples",
    "scripts",
    "src",
    "AGENTS.md",
    "README.md",
    "package.json",
  ]) {
    const source = path.join(sourceRoot, entry);
    if (fs.existsSync(source)) fs.cpSync(source, path.join(destination, entry), { recursive: true });
  }
}

function ownerOnly(file) {
  return (fs.statSync(file).mode & 0o077) === 0;
}

test("one-command setup works from a fresh path with spaces and prints portable host steps", () => {
  const parent = tempRoot();
  const releaseRoot = path.join(parent, "fresh adaptive learner");
  copyReleaseFixture(releaseRoot);

  const setup = spawnSync("npm", ["run", "setup"], {
    cwd: releaseRoot,
    encoding: "utf8",
  });
  assert.equal(setup.status, 0, `${setup.stdout}\n${setup.stderr}`);
  assert.match(setup.stdout, /Node\.js \d+/);
  assert.match(setup.stdout, /macOS/);
  assert.match(setup.stdout, /Codex/);
  assert.match(setup.stdout, /Pi/);
  assert.match(setup.stdout, /Profile\.md/);
  assert.match(setup.stdout, /learn-profile/);
  assert.match(setup.stdout, /npm run doctor/);
  assert.doesNotMatch(setup.stdout, new RegExp(sourceRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(setup.stdout, /\/Users\/0xkato/);

  const dataDir = path.join(releaseRoot, ".adaptive-learning");
  const state = path.join(dataDir, "state.json");
  const vault = path.join(releaseRoot, "vault");
  assert.equal(fs.existsSync(state), true);
  assert.equal(fs.existsSync(path.join(vault, "Home.md")), true);
  assert.equal(ownerOnly(dataDir), true);
  assert.equal(ownerOnly(state), true);
  assert.equal(ownerOnly(vault), true);

  const doctor = spawnSync("npm", ["run", "doctor", "--", "--json"], {
    cwd: releaseRoot,
    encoding: "utf8",
  });
  assert.equal(doctor.status, 0, `${doctor.stdout}\n${doctor.stderr}`);
  const report = JSON.parse(doctor.stdout.slice(doctor.stdout.indexOf("{")));
  assert.equal(report.ok, true);
  assert.equal(report.runtime.minimumSatisfied, true);
  assert.equal(report.platform.supported, true);
  assert.equal(report.discovery.codex, true);
  assert.equal(report.discovery.pi, true);
  assert.equal(report.vault.exists, true);
  assert.equal(report.render.current, true);

  fs.appendFileSync(path.join(vault, "Home.md"), "tampered\n");
  const unhealthy = spawnSync("npm", ["run", "doctor", "--", "--json"], {
    cwd: releaseRoot,
    encoding: "utf8",
  });
  assert.equal(unhealthy.status, 1);
  const unhealthyReport = JSON.parse(unhealthy.stdout.slice(unhealthy.stdout.indexOf("{")));
  assert.equal(unhealthyReport.ok, false);
  assert.equal(unhealthyReport.render.current, false);

  const again = spawnSync("npm", ["run", "setup"], {
    cwd: releaseRoot,
    encoding: "utf8",
  });
  assert.equal(again.status, 0, `${again.stdout}\n${again.stderr}`);
});
