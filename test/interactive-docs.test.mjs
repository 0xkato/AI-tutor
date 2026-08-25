import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

test("README explains the interactive learning experience in both hosts", () => {
  const readme = read("README.md");

  assert.match(readme, /first broad probe[\s\S]*multiple[- ]choice/i);
  assert.match(readme, /I don['’]t know[\s\S]*optional note/i);
  assert.match(readme, /Pi[\s\S]*interactive[\s\S]*(quiz|modal)/i);
  assert.match(readme, /Codex[\s\S]*numbered[\s\S]*(card|fallback)/i);
  assert.match(readme, /adaptive[\s\S]*parent[\s\S]*reason/i);
  assert.match(readme, /Obsidian[\s\S]*question[\s\S]*note/i);
  assert.match(readme, /recognition alone[\s\S]*not durable retention/i);
  assert.doesNotMatch(readme, /implementation is dependency-free/i);
});

test("operator quickstart tells a learner what they will see and how to answer", () => {
  const quickstart = read("docs/operator/quickstart.md");

  assert.match(quickstart, /multiple[- ]choice/i);
  assert.match(quickstart, /I don['’]t know/i);
  assert.match(quickstart, /Note:/i);
  assert.match(quickstart, /Pi[\s\S]*(Tab|arrow)[\s\S]*optional note/i);
  assert.match(quickstart, /Codex[\s\S]*numbered/i);
  assert.match(quickstart, /vault[\s\S]*question[\s\S]*note/i);
  assert.match(quickstart, /retention[\s\S]*not[\s\S]*recognition-only multiple choice/i);
});

test("state format documents schema v3 interactive records and migration", () => {
  const format = read("docs/operator/state-format.md");

  assert.match(format, /current schema version is `3`/i);
  assert.match(format, /Version-1[\s\S]*version 2[\s\S]*version 3/i);
  assert.match(format, /question[\s\S]*response[\s\S]*learner note/i);
  assert.match(format, /answer key[\s\S]*redact/i);
});
