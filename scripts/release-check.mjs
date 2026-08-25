#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stageNames = [
  "automated test suite",
  "Pi host input contract",
  "JavaScript syntax",
  "JSON documents",
  "fresh-path setup",
  "end-to-end learning and review fixtures",
  "fresh-path doctor",
];

if (process.argv.slice(2).includes("--list")) {
  process.stdout.write(`${JSON.stringify(stageNames)}\n`);
  process.exit(0);
}

function filesWithExtensions(root, extensions) {
  const files = [];
  if (!fs.existsSync(root)) return files;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...filesWithExtensions(absolute, extensions));
    else if (extensions.has(path.extname(entry.name))) files.push(absolute);
  }
  return files.sort();
}

function selectedTests() {
  const testRoot = path.join(repoRoot, "test");
  return fs.readdirSync(testRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => path.join(testRoot, entry.name))
    .sort();
}

function runNode(args, options = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.status !== 0) {
    const details = options.capture ? `${result.stdout ?? ""}${result.stderr ?? ""}` : "";
    throw new Error(`Command failed: node ${args.join(" ")}\n${details}`);
  }
  return result;
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
    "CHANGELOG.md",
    "README.md",
    "package-lock.json",
    "package.json",
  ]) {
    const source = path.join(repoRoot, entry);
    if (!fs.existsSync(source)) throw new Error(`Release file is missing: ${entry}`);
    fs.cpSync(source, path.join(destination, entry), { recursive: true });
  }
}

function announce(name) {
  process.stdout.write(`\n[release-check] ${name}\n`);
}

if (process.argv.slice(2).includes("--list-tests")) {
  process.stdout.write(`${JSON.stringify(selectedTests())}\n`);
  process.exit(0);
}

const temporaryParent = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive learning release check "));
const freshRoot = path.join(temporaryParent, "fresh clone");

try {
  announce(stageNames[0]);
  runNode(["--test", ...selectedTests()]);

  announce(stageNames[1]);
  runNode(["--test", path.join(repoRoot, "test", "pi-host-contract.test.mjs")]);

  announce(stageNames[2]);
  const javascript = [
    ...filesWithExtensions(path.join(repoRoot, "bin"), new Set([".mjs", ".js"])),
    ...filesWithExtensions(path.join(repoRoot, "src"), new Set([".mjs", ".js"])),
    ...filesWithExtensions(path.join(repoRoot, "scripts"), new Set([".mjs", ".js"])),
    ...filesWithExtensions(path.join(repoRoot, ".pi", "extensions"), new Set([".mjs", ".js"])),
  ];
  for (const file of javascript) runNode(["--check", file]);

  announce(stageNames[3]);
  const jsonFiles = [
    path.join(repoRoot, "package-lock.json"),
    path.join(repoRoot, "package.json"),
    ...filesWithExtensions(path.join(repoRoot, ".pi"), new Set([".json"])),
    ...filesWithExtensions(path.join(repoRoot, "examples"), new Set([".json"])),
  ];
  for (const file of jsonFiles) JSON.parse(fs.readFileSync(file, "utf8"));

  announce(stageNames[4]);
  copyReleaseFixture(freshRoot);
  const setup = runNode([path.join(freshRoot, "scripts", "setup.mjs")], {
    cwd: freshRoot,
    capture: true,
  });
  process.stdout.write(setup.stdout);

  announce(stageNames[5]);
  runNode([
    "--test",
    path.join(repoRoot, "test", "e2e-learning-session.test.mjs"),
    path.join(repoRoot, "test", "review-lifecycle.test.mjs"),
  ]);

  announce(stageNames[6]);
  const doctor = runNode(
    [path.join(freshRoot, "bin", "learn.mjs"), "doctor", "--root", freshRoot, "--json"],
    { cwd: freshRoot, capture: true },
  );
  const report = JSON.parse(doctor.stdout);
  if (!report.ok) throw new Error(`Fresh-path doctor failed: ${JSON.stringify(report.actions)}`);
  process.stdout.write("Fresh-path doctor: ok\n");

  process.stdout.write("\nRelease check passed.\n");
} catch (error) {
  process.stderr.write(`\nRelease check failed: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  fs.rmSync(temporaryParent, { recursive: true, force: true });
}
