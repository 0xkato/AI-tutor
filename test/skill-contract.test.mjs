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
    [
      "cross-session learner profile before teaching work",
      /learnerProfile[\s\S]*before[\s\S]*(calibrat|prob|research|plan|teach|review)/i,
    ],
    [
      "profile preferences are applied without reinvention",
      /apply[\s\S]*learner[- ]authored[\s\S]*(philosophy|preferences)[\s\S]*do not (invent|silently replace)/i,
    ],
    ["broad probe", /start (with )?a broad probe/i],
    ["binary-search prerequisites", /binary[- ]search each prerequisite strand/i],
    ["teach admitted gaps", /admitted knowledge gap.*teach.*before.*test/is],
    [
      "persist admitted gaps without false grading",
      /record-admitted-gap[\s\S]*without.*(assessment|grad)/i,
    ],
    [
      "open-ended checkpoint gaps preserve identity before teaching",
      /open-ended teaching or retention checkpoint[\s\S]*exact[\s\S]*question ID[\s\S]*node[\s\S]*before teaching/i,
    ],
    ["agent-led research", /agent (owns|handles).*research.*verification.*fact-check/is],
    ["visible source choice", /discuss.*source (selection|choices).*learner/is],
    ["no per-source approval", /do not require.*per-source approval/i],
    [
      "scoped external-transmission approval is accepted without a magic phrase",
      /name the exact payload.*destination.*before asking for\s+approval[\s\S]*explicit approval[\s\S]*authorizes exactly that\s+described transmission[\s\S]*do not ask.*repeat.*approval/is,
    ],
    [
      "materially changed egress scope requires new approval",
      /ask again only if.*payload.*destination.*purpose.*scope.*materially changes/is,
    ],
    ["claim-level provenance fields", /supported claim/i],
    ["source class provenance", /source class/i],
    ["verification provenance", /verification note/i],
    [
      "source-guided material is inspected before teaching",
      /source-guided[\s\S]*inspect[\s\S]*learner-supplied material[\s\S]*before teaching/i,
    ],
    [
      "exact source locators",
      /exact (timestamp|page|section|heading|file)[\s\S]*locator/i,
    ],
    [
      "anchor and supplemental evidence stay distinct",
      /anchor[\s\S]*supplemental[\s\S]*(distinct|separate)/i,
    ],
    [
      "source disagreement is visible",
      /(disagreement|conflict)[\s\S]*(corrects|limits|supplements|visible)/i,
    ],
    [
      "unavailable anchor cannot silently become a research-only lesson",
      /unavailable anchor[\s\S]*(blocks|stops)[\s\S]*source-guided teaching[\s\S]*(replacement|supplemental-only)/i,
    ],
    [
      "source locator remains visible during teaching",
      /when teaching[\s\S]*claim[\s\S]*(show|cite)[\s\S]*exact locator/i,
    ],
    [
      "plan-node source coverage before source-guided teaching",
      /record-source-coverage[\s\S]*plan node[\s\S]*before teaching/i,
    ],
    [
      "source coverage is not understanding evidence",
      /source coverage[\s\S]*(not|never)[\s\S]*(understanding|learner evidence|mastery)/i,
    ],
    ["DAG before teaching", /validated.*dependency DAG.*before teaching/i],
    ["Mermaid plan", /Mermaid/i],
    ["unconditional foundations", /unconditional foundations|definitions and invariants/i],
    ["motivated discovery", /motivat(e|ion).*every (move|step)/i],
    ["one reasoning step", /one reasoning step at a time/i],
    ["checkpoint gate", /checkpoint.*before advancing/i],
    ["checkpoint identity before answer", /persist.*question ID.*question text.*kind.*before.*answer/is],
    ["exact grades", /exactly.*Correct.*Partial.*Incorrect/is],
    ["bounded retry", /first genuine miss.*do not reveal.*answer.*retry/is],
    [
      "first-miss feedback excludes the expected mechanism",
      /first[- ]miss feedback[\s\S]*must not state[\s\S]*(correct outcome|expected mechanism)[\s\S]*correct value/i,
    ],
    [
      "assessment persists before conversational feedback",
      /record-assessment[\s\S]*succeeds[\s\S]*before[\s\S]*(send|show|present).*assessment feedback/i,
    ],
    ["stable retry identity", /retry.*reuse.*exact persisted question.*kind/is],
    ["clarification safety", /clarification.*only.*missing term.*same question/is],
    ["contamination discard", /contaminated.*discard.*evidence/is],
    ["new transfer", /new transfer (question|task)/i],
    ["retention schedule", /spaced retention|due review/i],
    ["executable review lifecycle", /start-review[\s\S]*close-review/i],
    [
      "review question persisted before answer",
      /start-review-checkpoint[\s\S]*persist[\s\S]*question ID[\s\S]*question text[\s\S]*kind[\s\S]*before[\s\S]*learner answer/i,
    ],
    [
      "review question must match the selected concept before persistence",
      /before[\s\S]*start-review-checkpoint[\s\S]*(compare|verify)[\s\S]*question[\s\S]*selected concept[\s\S]*(causal mechanism|knowledge summary)/i,
    ],
    [
      "repair transfer question persisted before answer",
      /start-review-checkpoint[\s\S]*question-id retention-transfer-q1[\s\S]*kind transfer[\s\S]*record-assessment[\s\S]*question-id retention-transfer-q1/i,
    ],
    [
      "contaminated review replacement is persisted before answer",
      /If a review answer is contaminated[\s\S]*start-review-checkpoint[\s\S]*new question ID[\s\S]*before.*answer/i,
    ],
    ["due listing is not completion", /Listing an item as due does \*\*not\*\* complete it/i],
    ["explicit review deferral", /defer-review[\s\S]*concrete reason/i],
    [
      "review deferral cannot strand a checkpoint",
      /defer-review[\s\S]*before starting a review checkpoint[\s\S]*cannot be deferred while.*checkpoint.*active/i,
    ],
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

test("review CLI example preserves checkpoint identity through retry and repair", () => {
  const cliReference = read("references/cli-reference.md");

  assert.match(
    cliReference,
    /start-review-checkpoint[\s\S]*?question-id retention-q1[\s\S]*?node <selected-node>[\s\S]*?kind retention[\s\S]*?question "<fully framed retrieval question>"[\s\S]*?record-assessment[\s\S]*?question-id retention-q1 --node <selected-node>[\s\S]*?kind retention[\s\S]*?question "<fully framed retrieval question>"/i,
  );
  assert.equal(
    cliReference.match(/--question-id retention-q1\b/g)?.length,
    3,
    "The review example must persist one checkpoint and record both attempts under its exact identity",
  );
});

test("new targets begin with a persisted interactive multiple-choice card", () => {
  const skill = read("SKILL.md");
  const protocol = read("references/teaching-protocol.md");
  const cliReference = read("references/cli-reference.md");
  const corpus = [skill, protocol, cliReference].join("\n");

  requires(
    corpus,
    "multiple-choice first",
    /new target[\s\S]*first broad probe[\s\S]*multiple[- ]choice/i,
  );
  requires(
    corpus,
    "persist before display",
    /start-question[\s\S]*succeeds[\s\S]*before[\s\S]*(show|display|present).*question/i,
  );
  requires(
    corpus,
    "I don't know is always available",
    /every multiple[- ]choice[\s\S]*I don['’]t know/i,
  );
  requires(
    corpus,
    "optional note is on the same interaction",
    /optional note[\s\S]*(same|alongside)[\s\S]*(question|interaction|answer)/i,
  );
  requires(
    corpus,
    "Pi owns question persistence",
    /adaptive_learning_quiz[\s\S]*persists[\s\S]*(question|answer|note|assessment)[\s\S]*do not.*duplicate/is,
  );
  requires(
    corpus,
    "Codex fallback is persisted",
    /Codex[\s\S]*numbered[\s\S]*start-question[\s\S]*submit-question/is,
  );
  requires(
    corpus,
    "follow-ups carry adaptive provenance",
    /after the first question[\s\S]*parent-question-id[\s\S]*adaptation-reason/i,
  );
  requires(
    corpus,
    "I don't know teaches before testing",
    /I don['’]t know[\s\S]*record-admitted-gap[\s\S]*teach[\s\S]*new (transfer )?(question|example)/i,
  );
});

test("CLI reference demonstrates question, response, and note persistence", () => {
  const cliReference = read("references/cli-reference.md");

  assert.match(
    cliReference,
    /start-question[\s\S]*--choice[\s\S]*--correct[\s\S]*pending-question[\s\S]*submit-question[\s\S]*--selected[\s\S]*--note/is,
  );
  assert.match(cliReference, /submit-question[\s\S]*--dont-know[\s\S]*--note/is);
  assert.match(
    cliReference,
    /start-question[\s\S]*--parent-question-id[\s\S]*--adaptation-reason/is,
  );
  assert.match(cliReference, /add-note[\s\S]*--target-type[\s\S]*--target-id/is);
});
