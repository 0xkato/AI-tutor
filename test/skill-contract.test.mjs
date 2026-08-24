import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillDir = path.join(root, ".agents", "skills", "adaptive-learning");

function read(relative) {
  return fs.readFileSync(path.join(skillDir, relative), "utf8");
}

function requires(corpus, label, pattern) {
  assert.match(corpus, pattern, `Missing skill contract: ${label}`);
}

test("shared skill is discoverable by Codex and Pi and routes to focused references", () => {
  const skill = read("SKILL.md");
  assert.match(skill, /^---\nname: adaptive-learning\ndescription: Use when /);
  assert.match(skill, /references\/teaching-protocol\.md/);
  assert.match(skill, /references\/research-protocol\.md/);
  assert.match(skill, /references\/cli-reference\.md/);
  assert.equal(fs.existsSync(path.join(skillDir, "references", "teaching-protocol.md")), true);
  assert.equal(fs.existsSync(path.join(skillDir, "references", "research-protocol.md")), true);
  assert.equal(fs.existsSync(path.join(skillDir, "references", "cli-reference.md")), true);
});

test("skill corpus preserves the complete adaptive-learning behavior", () => {
  const corpus = [
    read("SKILL.md"),
    read("references/teaching-protocol.md"),
    read("references/research-protocol.md"),
    read("references/cli-reference.md"),
  ].join("\n");

  const contracts = [
    ["learner-owned target", /learner (supplies|owns) the (learning )?target/i],
    ["durable resume before memory", /run .*context --json.*before (probing|resuming|teaching)/is],
    ["broad probe", /start (with )?a broad probe/i],
    ["binary-search prerequisites", /binary[- ]search each prerequisite strand/i],
    ["teach admitted gaps", /admitted knowledge gap.*teach.*before.*test/is],
    [
      "persist admitted gaps without false grading",
      /record-admitted-gap[\s\S]*without.*(assessment|grad)/i,
    ],
    ["agent-led research", /agent (owns|handles).*research.*verification.*fact-check/is],
    ["visible source choice", /discuss.*source (selection|choices).*learner/is],
    ["no per-source approval", /do not require.*per-source approval/i],
    ["claim-level provenance fields", /supported claim/i],
    ["source class provenance", /source class/i],
    ["verification provenance", /verification note/i],
    ["DAG before teaching", /validated.*dependency DAG.*before teaching/i],
    ["Mermaid plan", /Mermaid/i],
    ["unconditional foundations", /unconditional foundations|definitions and invariants/i],
    ["motivated discovery", /motivat(e|ion).*every (move|step)/i],
    ["one reasoning step", /one reasoning step at a time/i],
    ["checkpoint gate", /checkpoint.*before advancing/i],
    ["checkpoint identity before answer", /persist.*question ID.*question text.*kind.*before.*answer/is],
    ["exact grades", /exactly.*Correct.*Partial.*Incorrect/is],
    ["bounded retry", /first genuine miss.*do not reveal.*answer.*retry/is],
    ["stable retry identity", /retry.*reuse.*exact persisted question.*kind/is],
    ["clarification safety", /clarification.*only.*missing term.*same question/is],
    ["contamination discard", /contaminated.*discard.*evidence/is],
    ["new transfer", /new transfer (question|task)/i],
    ["retention schedule", /spaced retention|due review/i],
    ["executable review lifecycle", /start-review[\s\S]*close-review/i],
    ["due listing is not completion", /Listing an item as due does \*\*not\*\* complete it/i],
    ["explicit review deferral", /defer-review[\s\S]*concrete reason/i],
    ["whole-system synthesis", /whole-system synthesis/i],
    ["assessed synthesis lifecycle", /start-synthesis[\s\S]*record-synthesis[\s\S]*(close-review|close)/i],
    ["synthesis cannot be arbitrary close prose", /close.*derives.*synthesis.*clean correct\s+assessment/is],
    ["visual inspection", /inspect.*visual.*before.*embed/is],
    ["record every mutation", /record every state change.*CLI/i],
    ["Obsidian derived view", /Obsidian[\s\S]*?derived/i],
  ];
  for (const [label, pattern] of contracts) requires(corpus, label, pattern);

  assert.doesNotMatch(corpus, /ask the learner to approve each source/i);
});
