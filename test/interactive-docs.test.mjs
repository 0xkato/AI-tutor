import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

test("README provides a concise public quickstart with honest boundaries", () => {
  const readme = read("README.md");

  assert.ok(
    readme.trimEnd().split(/\r?\n/).length <= 90,
    "README should remain fast to scan",
  );
  assert.match(readme, /^# AI Tutor/m);
  assert.match(readme, /Node\.js 22\.19 or newer/i);
  assert.ok(readme.indexOf("npm ci") < readme.indexOf("npm run setup"));
  assert.ok(readme.indexOf("npm run setup") < readme.indexOf("npm run pi"));
  assert.match(readme, /Codex and Pi use the same saved learning state/i);
  assert.match(readme, /\/teach-from <source> :: <learning target>/i);
  assert.match(readme, /YouTube[\s\S]*PDF[\s\S]*notes[\s\S]*web page[\s\S]*repository/i);
  assert.match(readme, /anchor[\s\S]*supplemental/i);
  assert.match(readme, /source coverage[\s\S]*not[\s\S]*(understanding|mastery)/i);
  assert.match(readme, /unavailable\s+anchor[\s\S]*(replacement|supplemental-only)[\s\S]*(saves|saved|decision)/i);
  assert.match(readme, /I don['’]t know[^\n]*ungraded gap/i);
  assert.match(readme, /\.adaptive-learning\/[\s\S]*vault\/[\s\S]*ignored by Git/i);
  assert.match(readme, /no telemetry/i);
  assert.match(readme, /release candidate/i);
  assert.match(readme, /Native\s+Pi\s+quiz\s+behavior[\s\S]*human\s+acceptance/i);
  assert.match(readme, /docs\/operator\/quickstart\.md/);
});

test("operator quickstart tells a learner what they will see and how to answer", () => {
  const quickstart = read("docs/operator/quickstart.md");

  assert.match(quickstart, /built-in defaults/i);
  assert.match(quickstart, /engine and Codex[\s\S]*Node\.js 20/i);
  assert.match(quickstart, /Pi 0\.84[\s\S]*requires Node\.js 22\.19/i);
  assert.match(quickstart, /learner profile stores optional/i);
  assert.ok(quickstart.indexOf("/teach") < quickstart.indexOf("/learn-profile"));
  assert.match(quickstart, /multiple[- ]choice/i);
  assert.match(quickstart, /I don['’]t know/i);
  assert.match(quickstart, /Note:/i);
  assert.match(quickstart, /Pi[\s\S]*(Tab|arrow)[\s\S]*optional note/i);
  assert.match(quickstart, /OpenAI Codex[\s\S]*project default[\s\S]*gpt-5\.5/i);
  assert.match(quickstart, /native Pi (quiz|modal)[\s\S]*live\s+human\s+acceptance[\s\S]*pending/i);
  assert.match(quickstart, /Codex[\s\S]*numbered/i);
  assert.match(quickstart, /vault[\s\S]*question[\s\S]*note/i);
  assert.match(quickstart, /retention[\s\S]*not[\s\S]*recognition-only multiple choice/i);
  assert.match(quickstart, /open-ended teaching or review checkpoint[\s\S]*I don['’]t know[\s\S]*ungraded admission/i);
  assert.match(quickstart, /free[- ]response[\s\S]*own words[\s\S]*confidence[\s\S]*explicit.*assessment/i);
  assert.match(quickstart, /worked example[\s\S]*fade[\s\S]*contrastive[\s\S]*transfer[\s\S]*whole-system/i);
  assert.match(quickstart, /practice-plan[\s\S]*interleav/i);
});

test("state format documents schema v6 adaptive evidence and migration", () => {
  const format = read("docs/operator/state-format.md");

  assert.match(format, /current schema version is `6`/i);
  assert.match(format, /Version-1[\s\S]*versions 2, 3, 4, 5, and 6/i);
  assert.match(format, /learnerProfile[\s\S]*teaching[\s\S]*preferences/i);
  assert.match(format, /question[\s\S]*response[\s\S]*learner note/i);
  assert.match(format, /answer key[\s\S]*redact/i);
  assert.match(format, /checkpointGaps[\s\S]*teaching, retention, or[\s\S]*synthesis/i);
  assert.match(format, /materials[\s\S]*pending[\s\S]*(verified|unavailability)/i);
  assert.match(format, /anchor material[\s\S]*supplemental research/i);
  assert.match(format, /sourceCoverage[\s\S]*not learner evidence/i);
  assert.match(format, /sourceGuidance[\s\S]*pending materials block[\s\S]*continue-supplemental-only/i);
  assert.match(format, /mastery[\s\S]*recall[\s\S]*explanation[\s\S]*prediction[\s\S]*application[\s\S]*discrimination[\s\S]*debugging[\s\S]*integration[\s\S]*retention/i);
  assert.match(format, /misconceptions[\s\S]*active[\s\S]*resolved[\s\S]*relapse/i);
  assert.match(format, /productiveAttempts[\s\S]*ungraded/i);
  assert.match(format, /confidence[\s\S]*responseTimeMs[\s\S]*supportLevel[\s\S]*transferLevel/i);
  assert.match(format, /stabilityDays[\s\S]*difficulty[\s\S]*lapses[\s\S]*history/i);
});
