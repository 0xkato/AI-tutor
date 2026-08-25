import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

test("the source-backed video parity contract names every demonstrated workflow behavior", () => {
  const parity = read("docs/product/video-parity.md");
  const requirements = [
    /learner[- ]owned target/i,
    /broad[- ]to[- ]narrow probe/i,
    /multiple[- ]choice/i,
    /I don['’]t know/i,
    /note area/i,
    /agent[- ]owned (research|logistics)/i,
    /dependency (plan|DAG)/i,
    /learner[- ]specific (teaching )?(philosophy|profile)/i,
    /one reasoning step at a time/i,
    /periodic (quiz|assessment|checkpoint)/i,
    /verified visual/i,
    /Obsidian/i,
    /one trusted interface/i,
  ];
  for (const requirement of requirements) assert.match(parity, requirement);
  assert.match(parity, /0:00[\s\S]*16:21/);
  assert.match(parity, /host-quality boundary/i);
});

test("first-run documentation exposes profile setup before the first target", () => {
  const readme = read("README.md");
  const quickstart = read("docs/operator/quickstart.md");

  for (const document of [readme, quickstart]) {
    assert.match(document, /learner profile/i);
    assert.match(document, /teaching philosophy/i);
    assert.match(document, /\/learn-profile/);
    assert.match(document, /Profile\.md/);
  }
});
