import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repository, "bin", "learn.mjs");

function invoke(root, command, options = []) {
  const result = spawnSync(process.execPath, [cli, command, ...options, "--root", root], {
    cwd: repository,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${command}: ${result.stderr || result.stdout}`);
  return result.stdout;
}

test("complete adaptive session persists evidence, retry state, review, and Obsidian notes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-e2e-"));
  const at = "2026-08-24T08:00:00.000Z";
  const planPath = path.join(repository, "examples", "differential-forms-plan.json");

  invoke(root, "init", ["--now", at]);
  invoke(root, "start", [
    "--id", "s1",
    "--topic", "Differential forms",
    "--target", "Build a causal introduction to differential forms",
    "--context", "Comfortable with basic calculus",
    "--now", at,
  ]);
  invoke(root, "record-probe", [
    "--id", "probe-a1",
    "--question-id", "probe-q1",
    "--node", "vectors",
    "--kind", "explanation",
    "--question", "Which operations must vectors support?",
    "--answer", "Vector addition and scalar multiplication under the vector-space laws.",
    "--grade", "correct",
    "--evidence", "Named both vector-space operations and tied them to the required closure laws.",
    "--now", at,
  ]);
  invoke(root, "finish-probe", [
    "--summary", "Vectors are usable; covectors are the first missing prerequisite.",
    "--now", at,
  ]);
  invoke(root, "add-source", [
    "--id", "source-1",
    "--title", "Primary covector reference",
    "--url", "https://example.test/covectors",
    "--source-class", "primary",
    "--locator", "Heading: Covectors as linear functionals",
    "--supports", "A covector is a linear functional from vectors to scalars.",
    "--verification", "Definition and assumptions were checked against an independent textbook.",
    "--now", at,
  ]);
  invoke(root, "set-plan", ["--file", planPath, "--now", at]);
  invoke(root, "begin-teach", ["--now", at]);
  invoke(root, "record-step", [
    "--id", "step-1",
    "--node", "covectors",
    "--foundation", "A linear map preserves vector addition and scalar multiplication.",
    "--motivation", "We need an object that measures a directed displacement linearly.",
    "--explanation", "A covector consumes a vector and produces a scalar while preserving linear combinations.",
    "--question-id", "teach-q1",
    "--kind", "transfer",
    "--question", "Describe a new linear displacement-measuring object.",
    "--now", at,
  ]);
  invoke(root, "record-assessment", [
    "--id", "teach-a1",
    "--question-id", "teach-q1",
    "--node", "covectors",
    "--stage", "teach",
    "--kind", "transfer",
    "--question", "Describe a new linear displacement-measuring object.",
    "--answer", "It consumes and returns vectors.",
    "--grade", "incorrect",
    "--evidence", "Correctly identified a vector input but incorrectly made the output another vector.",
    "--mistake-type", "output-type",
    "--now", at,
  ]);

  let status = JSON.parse(invoke(root, "status", ["--json"]));
  assert.equal(status.active.retry[0].answerMayBeTaught, false);
  assert.equal(status.active.activeStepId, "step-1");

  invoke(root, "record-assessment", [
    "--id", "teach-a2",
    "--question-id", "teach-q1",
    "--node", "covectors",
    "--stage", "teach",
    "--kind", "transfer",
    "--question", "Describe a new linear displacement-measuring object.",
    "--answer", "It consumes a vector, produces a scalar, and preserves linear combinations.",
    "--grade", "correct",
    "--evidence", "On the bounded retry, corrected the input-output types and preserved linearity for the same object.",
    "--now", at,
  ]);
  fs.mkdirSync(path.join(root, "vault", "Assets"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "vault", "Assets", "covector.svg"),
    "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>\n",
  );
  invoke(root, "add-visual", [
    "--id", "visual-1",
    "--path", "Assets/covector.svg",
    "--description", "Parallel level sets showing a covector acting on a vector.",
    "--verification", "Inspected labels, arrow direction, and consistency with the teaching explanation.",
    "--now", at,
  ]);
  invoke(root, "record-step", [
    "--id", "step-2",
    "--node", "forms",
    "--foundation", "A covector is a linear scalar-valued measurement of one vector.",
    "--motivation", "We need measurements that consume several vectors with orientation.",
    "--explanation", "A differential form generalizes the measurement to alternating multilinear inputs.",
    "--question-id", "teach-forms-q1",
    "--kind", "transfer",
    "--question", "Describe an oriented area measurement on two displacement vectors.",
    "--now", at,
  ]);
  invoke(root, "record-assessment", [
    "--id", "teach-forms-a1",
    "--question-id", "teach-forms-q1",
    "--node", "forms",
    "--stage", "teach",
    "--kind", "transfer",
    "--question", "Describe an oriented area measurement on two displacement vectors.",
    "--answer", "It consumes two vectors, returns a scalar, is multilinear, and changes sign when inputs swap.",
    "--grade", "correct",
    "--evidence", "Transferred alternating multilinear scalar measurement to an unfamiliar area example.",
    "--now", at,
  ]);
  invoke(root, "start-synthesis", [
    "--question-id", "synthesis-q1",
    "--question", "Connect vectors, covectors, and differential forms in one causal chain.",
    "--now", at,
  ]);
  invoke(root, "record-synthesis", [
    "--id", "synthesis-a1",
    "--question-id", "synthesis-q1",
    "--question", "Connect vectors, covectors, and differential forms in one causal chain.",
    "--answer", "Vectors are inputs to covectors, whose scalar linear measurements generalize to alternating multilinear forms.",
    "--grade", "correct",
    "--evidence", "Connected all planned nodes and preserved their input, output, linearity, and alternation roles.",
    "--now", at,
  ]);
  invoke(root, "close", [
    "--gap", "Alternating multilinearity still needs a later teaching step.",
    "--now", at,
  ]);

  status = JSON.parse(invoke(root, "status", ["--json"]));
  assert.equal(status.active, null);
  const due = JSON.parse(
    invoke(root, "due", ["--now", "2026-08-25T08:00:00.000Z", "--json"]),
  );
  assert.equal(due.reviews.some((item) => item.nodeId === "covectors"), true);

  const state = JSON.parse(
    fs.readFileSync(path.join(root, ".adaptive-learning", "state.json"), "utf8"),
  );
  const session = state.sessions.s1;
  const covectors = session.conceptIds
    .map((conceptId) => state.concepts[conceptId])
    .find((concept) => concept.key === "covectors");
  const review = state.reviews[covectors.reviewId];
  assert.equal(session.phase, "complete");
  assert.equal(session.assessments.length, 5);
  assert.equal(session.synthesisCheckpoint.resolvedEvidenceId, "synthesis-a1");
  assert.match(session.synthesis, /generalize to alternating multilinear forms/);
  assert.equal(covectors.retry, null);
  assert.equal(review.level, 1);
  assert.equal(session.sources[0].verification.includes("independent"), true);
  assert.equal(session.visuals[0].verification.includes("Inspected"), true);

  const sessionFile = fs.readdirSync(path.join(root, "vault", "Sessions"))[0];
  assert.match(sessionFile, /^differential-forms-[a-f0-9]{20}\.md$/);
  const note = fs.readFileSync(path.join(root, "vault", "Sessions", sessionFile), "utf8");
  assert.match(note, /```mermaid/);
  assert.match(note, /Primary covector reference/);
  assert.match(note, /Incorrect — covectors/);
  assert.match(note, /Correct — covectors/);
  assert.match(note, /!\[\[Assets\/covector\.svg\]\]/);
  assert.match(note, /Alternating multilinearity still needs a later teaching step/);
});

test("complete source-guided session preserves its anchor, coverage, and separate understanding evidence", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-source-e2e-"));
  const at = "2026-08-29T08:00:00.000Z";
  const planPath = path.join(root, "attention-plan.json");
  fs.writeFileSync(planPath, JSON.stringify({
    targetNodeId: "attention",
    nodes: [{ id: "attention", title: "Self-attention" }],
    edges: [],
  }));

  invoke(root, "init", ["--now", at]);
  invoke(root, "start", [
    "--id", "guided-1",
    "--topic", "Transformers",
    "--target", "Understand self-attention from the supplied lesson",
    "--material", "https://www.youtube.com/watch?v=example",
    "--now", at,
  ]);

  const materialId = JSON.parse(
    fs.readFileSync(path.join(root, ".adaptive-learning", "state.json"), "utf8"),
  ).sessions["guided-1"].materials[0].id;
  invoke(root, "resolve-material", [
    "--material-id", materialId,
    "--status", "verified",
    "--title", "Supplied self-attention lesson",
    "--evidence", "Retrieved the complete transcript and checked timestamp order.",
    "--now", at,
  ]);
  invoke(root, "record-probe", [
    "--id", "probe-a1",
    "--question-id", "probe-q1",
    "--node", "token-representations",
    "--kind", "explanation",
    "--question", "What information does one token representation contain before attention?",
    "--answer", "Its learned token embedding and position information.",
    "--grade", "correct",
    "--evidence", "Distinguished initial token identity and position from later contextual mixing.",
    "--now", at,
  ]);
  invoke(root, "finish-probe", [
    "--summary", "Token representations are usable; attention is the first missing mechanism.",
    "--now", at,
  ]);
  invoke(root, "add-source", [
    "--id", "anchor-attention",
    "--title", "Supplied self-attention lesson",
    "--url", "https://www.youtube.com/watch?v=example",
    "--source-class", "learner-supplied",
    "--role", "anchor",
    "--locator", "08:12-09:05",
    "--material-id", materialId,
    "--supports", "Query-key scores determine how value vectors are mixed.",
    "--verification", "Matched the claim to the cited transcript segment.",
    "--now", at,
  ]);
  invoke(root, "set-plan", ["--file", planPath, "--now", at]);
  invoke(root, "record-source-coverage", [
    "--id", "coverage-attention",
    "--node", "attention",
    "--source-id", "anchor-attention",
    "--summary", "The timestamped segment supports the query-key scoring and value-mixing mechanism.",
    "--now", at,
  ]);
  invoke(root, "begin-teach", ["--now", at]);
  invoke(root, "record-step", [
    "--id", "step-attention",
    "--node", "attention",
    "--foundation", "Each token has a representation that can be compared with other token representations.",
    "--motivation", "A token needs a content-dependent way to select relevant context.",
    "--explanation", "Queries compare with keys to weight the value vectors mixed into the token's new representation.",
    "--question-id", "teach-attention-q1",
    "--kind", "transfer",
    "--question", "Explain how one token can selectively use two other tokens in a new sentence.",
    "--now", at,
  ]);
  invoke(root, "record-assessment", [
    "--id", "teach-attention-a1",
    "--question-id", "teach-attention-q1",
    "--node", "attention",
    "--stage", "teach",
    "--kind", "transfer",
    "--question", "Explain how one token can selectively use two other tokens in a new sentence.",
    "--answer", "Its query scores both keys, normalizes those scores, and uses the weights to mix both values.",
    "--grade", "correct",
    "--evidence", "Transferred query-key scoring and weighted value mixing to an unfamiliar sequence.",
    "--now", at,
  ]);
  invoke(root, "start-synthesis", [
    "--question-id", "synthesis-q1",
    "--question", "Connect token representations, query-key scores, and value mixing.",
    "--now", at,
  ]);
  invoke(root, "record-synthesis", [
    "--id", "synthesis-a1",
    "--question-id", "synthesis-q1",
    "--question", "Connect token representations, query-key scores, and value mixing.",
    "--answer", "A token's query scores other keys and the normalized scores weight their values to form contextual information.",
    "--grade", "correct",
    "--evidence", "Connected the complete source-supported mechanism without relying on recognition.",
    "--now", at,
  ]);
  invoke(root, "close", ["--now", at]);

  const state = JSON.parse(
    fs.readFileSync(path.join(root, ".adaptive-learning", "state.json"), "utf8"),
  );
  const session = state.sessions["guided-1"];
  assert.equal(session.phase, "complete");
  assert.equal(session.materials[0].status, "verified");
  assert.equal(session.sources[0].role, "anchor");
  assert.equal(session.sources[0].locator, "08:12-09:05");
  assert.equal(session.sourceCoverage[0].nodeId, "attention");
  assert.equal(session.assessments.some((item) => item.id === "teach-attention-a1"), true);

  const sessionFile = fs.readdirSync(path.join(root, "vault", "Sessions"))[0];
  const note = fs.readFileSync(path.join(root, "vault", "Sessions", sessionFile), "utf8");
  assert.match(note, /Supplied learning materials/);
  assert.match(note, /08:12-09:05/);
  assert.match(note, /Source coverage and understanding/);
  assert.match(note, /Transferred query-key scoring and weighted value mixing/);
});

test("adaptive upgrade runs productive failure, free response, misconception repair, fading, transfer, calibration, and interleaved review end to end", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-learn-upgrade-e2e-"));
  const at = "2026-08-29T08:00:00.000Z";
  const attentionPlan = path.join(root, "attention-plan.json");
  fs.writeFileSync(attentionPlan, `${JSON.stringify({
    targetNodeId: "contextual-representations",
    nodes: [
      { id: "token-identity", title: "Token identity" },
      { id: "contextual-representations", title: "Contextual representations" },
    ],
    edges: [{
      from: "token-identity",
      to: "contextual-representations",
      reason: "A fixed identity must be separated from its context-dependent hidden state.",
    }],
  }, null, 2)}\n`);

  invoke(root, "init", ["--now", at]);
  invoke(root, "start", [
    "--id", "adaptive-session",
    "--topic", "Transformers",
    "--target", "Separate token identity from contextual representation",
    "--now", at,
  ]);
  invoke(root, "record-probe", [
    "--id", "identity-a1", "--question-id", "identity-q1",
    "--node", "token-identity", "--kind", "explanation",
    "--question", "What remains fixed for two occurrences of one token ID?",
    "--answer", "The vocabulary identity and its initial embedding lookup remain the same.",
    "--grade", "correct",
    "--evidence", "Separated the stable vocabulary identity from later context-dependent computation.",
    "--now", at,
  ]);
  invoke(root, "finish-probe", [
    "--summary", "Token identity is demonstrated; contextual representation is the next frontier.",
    "--now", at,
  ]);
  invoke(root, "set-plan", ["--file", attentionPlan, "--now", at]);
  invoke(root, "begin-teach", ["--now", at]);

  const firstRecommendation = JSON.parse(invoke(root, "recommend-next", [
    "--node", "contextual-representations", "--json",
  ]));
  assert.equal(firstRecommendation.type, "productive-failure");
  assert.equal(firstRecommendation.productiveFailureAllowed, true);

  invoke(root, "start-question", [
    "--id", "productive-q1", "--stage", "teach",
    "--node", "contextual-representations", "--kind", "prediction",
    "--question", "Predict how two equal token IDs could later behave differently.",
    "--mode", "free-response", "--activity-type", "productive-failure",
    "--strategy-reason", firstRecommendation.reason,
    "--support-level", "0", "--transfer-level", "0", "--now", at,
  ]);
  invoke(root, "answer-question", [
    "--question-id", "productive-q1", "--response-id", "productive-r1",
    "--text-answer", "Perhaps the model changes one token's identity after reading its neighbors.",
    "--confidence", "35", "--response-time-ms", "26000",
    "--rationale", "The neighboring words must create the difference somehow.",
    "--now", at,
  ]);

  const misconception = "Context changes the token identity itself.";
  const workedQuestion = "Why can equal token IDs acquire different hidden representations?";
  invoke(root, "record-step", [
    "--id", "worked-step", "--node", "contextual-representations",
    "--foundation", "Equal token IDs share one vocabulary identity and embedding lookup.",
    "--motivation", "The model still needs each occurrence to use different surrounding information.",
    "--explanation", "Attention changes the contextual hidden representation without changing token identity.",
    "--question-id", "worked-q1", "--kind", "explanation", "--question", workedQuestion,
    "--activity-type", "worked-example",
    "--strategy-reason", "Teach the distinction exposed by the ungraded independent attempt.",
    "--support-level", "4", "--transfer-level", "0", "--now", at,
  ]);
  invoke(root, "start-question", [
    "--id", "worked-q1", "--stage", "teach",
    "--node", "contextual-representations", "--kind", "explanation",
    "--question", workedQuestion, "--mode", "free-response",
    "--activity-type", "worked-example",
    "--strategy-reason", "Teach the distinction exposed by the ungraded independent attempt.",
    "--support-level", "4", "--transfer-level", "0",
    "--parent-question-id", "productive-q1",
    "--adaptation-reason", "The productive attempt exposed an identity-versus-representation model.",
    "--now", at,
  ]);
  for (const [index, answer] of [
    "The model replaces the original token identity with a contextual token.",
    "Its neighbors rewrite which vocabulary item the token is.",
  ].entries()) {
    invoke(root, "answer-question", [
      "--question-id", "worked-q1", "--response-id", `worked-r${index + 1}`,
      "--text-answer", answer, "--confidence", "92",
      "--response-time-ms", "48000", "--now", at,
    ]);
    invoke(root, "record-assessment", [
      "--id", `worked-a${index + 1}`, "--question-id", "worked-q1",
      "--node", "contextual-representations", "--stage", "teach",
      "--kind", "explanation", "--question", workedQuestion, "--answer", answer,
      "--grade", "incorrect",
      "--evidence", "The answer still changes stable token identity instead of only the contextual hidden representation.",
      "--mistake-type", "identity-versus-representation",
      "--misconception-id", "identity-context", "--misconception-statement", misconception,
      "--counterexample", "One token ID can occur in two sentences while keeping the same vocabulary identity.",
      "--repair", "Separate the fixed identity from the hidden representation produced using context.",
      "--confidence", "92", "--response-time-ms", "48000",
      "--support-level", "4", "--transfer-level", "0",
      "--activity-type", "worked-example", "--now", at,
    ]);
  }

  const contrastQuestion = "In river bank and bank loan, what stays fixed and what can differ?";
  invoke(root, "record-step", [
    "--id", "contrast-step", "--node", "contextual-representations",
    "--foundation", "Token identity and contextual hidden representation are distinct state.",
    "--motivation", "A minimally different pair exposes whether the distinction transfers.",
    "--explanation", "Both bank tokens keep one ID while attention can produce different hidden representations.",
    "--question-id", "contrast-q1", "--kind", "transfer", "--question", contrastQuestion,
    "--activity-type", "contrastive-case",
    "--strategy-reason", "The active misconception requires a contrastive repair.",
    "--support-level", "3", "--transfer-level", "2", "--now", at,
  ]);
  invoke(root, "start-question", [
    "--id", "contrast-q1", "--stage", "teach",
    "--node", "contextual-representations", "--kind", "transfer",
    "--question", contrastQuestion, "--mode", "free-response",
    "--activity-type", "contrastive-case",
    "--strategy-reason", "The active misconception requires a contrastive repair.",
    "--support-level", "3", "--transfer-level", "2",
    "--parent-question-id", "worked-q1",
    "--adaptation-reason", "Two misses permit teaching followed by a new durable contrastive transfer.",
    "--now", at,
  ]);
  const contrastAnswer = "Both keep the same bank token ID; their contextual hidden representations can differ with river versus loan context.";
  invoke(root, "answer-question", [
    "--question-id", "contrast-q1", "--response-id", "contrast-r1",
    "--text-answer", contrastAnswer, "--confidence", "78",
    "--response-time-ms", "34000", "--now", at,
  ]);
  invoke(root, "record-assessment", [
    "--id", "contrast-a1", "--question-id", "contrast-q1",
    "--node", "contextual-representations", "--stage", "teach",
    "--kind", "transfer", "--question", contrastQuestion, "--answer", contrastAnswer,
    "--grade", "correct",
    "--evidence", "Transferred the fixed-identity and contextual-representation distinction to a confusable new pair.",
    "--confidence", "78", "--response-time-ms", "34000",
    "--support-level", "3", "--transfer-level", "2",
    "--activity-type", "contrastive-case",
    "--resolve-misconception", "identity-context", "--now", at,
  ]);

  const faded = JSON.parse(invoke(root, "recommend-next", [
    "--node", "contextual-representations", "--json",
  ]));
  assert.equal(faded.type, "faded-example");
  assert.equal(faded.supportLevel, 2);

  const fadedQuestion = "Apply the same distinction to two occurrences of light in unrelated sentences.";
  invoke(root, "record-step", [
    "--id", "faded-step", "--node", "contextual-representations",
    "--foundation", "The identity-versus-context distinction transferred once with support.",
    "--motivation", "One scaffold should now be removed without also changing transfer distance.",
    "--explanation", "Use the same distinction without the worked bank comparison.",
    "--question-id", "faded-q1", "--kind", "transfer", "--question", fadedQuestion,
    "--activity-type", "faded-example", "--strategy-reason", faded.reason,
    "--support-level", "2", "--now", at,
  ]);
  invoke(root, "start-question", [
    "--id", "faded-q1", "--stage", "teach",
    "--node", "contextual-representations", "--kind", "transfer",
    "--question", fadedQuestion, "--mode", "free-response",
    "--activity-type", "faded-example", "--strategy-reason", faded.reason,
    "--support-level", "2",
    "--parent-question-id", "contrast-q1",
    "--adaptation-reason", "The contrastive transfer passed, so one support level is faded and transfer increases.",
    "--now", at,
  ]);
  const fadedAnswer = "The light ID stays fixed, while each sentence can produce a different contextual hidden representation.";
  invoke(root, "answer-question", [
    "--question-id", "faded-q1", "--response-id", "faded-r1",
    "--text-answer", fadedAnswer, "--confidence", "90",
    "--response-time-ms", "12000", "--now", at,
  ]);
  invoke(root, "record-assessment", [
    "--id", "faded-a1", "--question-id", "faded-q1",
    "--node", "contextual-representations", "--stage", "teach",
    "--kind", "transfer", "--question", fadedQuestion, "--answer", fadedAnswer,
    "--grade", "correct",
    "--evidence", "Applied the distinction independently in a changed context with less scaffolding.",
    "--confidence", "90", "--response-time-ms", "12000",
    "--support-level", "2",
    "--activity-type", "faded-example", "--now", at,
  ]);

  const fadedAgain = JSON.parse(invoke(root, "recommend-next", [
    "--node", "contextual-representations", "--json",
  ]));
  assert.equal(fadedAgain.type, "faded-example");
  assert.equal(fadedAgain.supportLevel, 1);
  const fadedAgainQuestion = "Explain the distinction for two occurrences of position in unrelated documents.";
  invoke(root, "record-step", [
    "--id", "faded-step-2", "--node", "contextual-representations",
    "--foundation", "The mechanism succeeded with two support levels.",
    "--motivation", "The remaining scaffold should now be reduced again.",
    "--explanation", "Only one reminder of the identity-versus-representation distinction remains.",
    "--question-id", "faded-q2", "--kind", "transfer", "--question", fadedAgainQuestion,
    "--activity-type", "faded-example", "--strategy-reason", fadedAgain.reason,
    "--support-level", "1", "--now", at,
  ]);
  invoke(root, "start-question", [
    "--id", "faded-q2", "--stage", "teach",
    "--node", "contextual-representations", "--kind", "transfer",
    "--question", fadedAgainQuestion, "--mode", "free-response",
    "--activity-type", "faded-example", "--strategy-reason", fadedAgain.reason,
    "--support-level", "1", "--parent-question-id", "faded-q1",
    "--adaptation-reason", "The first faded transfer passed, so one final support level is removed.",
    "--now", at,
  ]);
  const fadedAgainAnswer = "The position ID remains the same while document context can change the hidden representation.";
  invoke(root, "answer-question", [
    "--question-id", "faded-q2", "--response-id", "faded-r2",
    "--text-answer", fadedAgainAnswer, "--confidence", "88",
    "--response-time-ms", "14000", "--now", at,
  ]);
  invoke(root, "record-assessment", [
    "--id", "faded-a2", "--question-id", "faded-q2",
    "--node", "contextual-representations", "--stage", "teach",
    "--kind", "transfer", "--question", fadedAgainQuestion, "--answer", fadedAgainAnswer,
    "--grade", "correct",
    "--evidence", "Preserved fixed identity and contextual representation with only one remaining scaffold.",
    "--confidence", "88", "--response-time-ms", "14000",
    "--support-level", "1", "--activity-type", "faded-example", "--now", at,
  ]);

  const fartherTransfer = JSON.parse(invoke(root, "recommend-next", [
    "--node", "contextual-representations", "--json",
  ]));
  assert.equal(fartherTransfer.type, "transfer-case");
  assert.equal(fartherTransfer.transferLevel, 3);
  const transferQuestion = "Debug a claim that changing context assigns a repeated token a new vocabulary identity.";
  invoke(root, "record-step", [
    "--id", "transfer-step", "--node", "contextual-representations",
    "--foundation", "The distinction now succeeds without scaffolding in changed examples.",
    "--motivation", "A structurally different debugging task tests farther transfer.",
    "--explanation", "Reject the claim by separating vocabulary identity from contextual computation.",
    "--question-id", "transfer-q1", "--kind", "transfer", "--question", transferQuestion,
    "--activity-type", "transfer-case", "--strategy-reason", fartherTransfer.reason,
    "--support-level", "0", "--transfer-level", "3", "--now", at,
  ]);
  invoke(root, "start-question", [
    "--id", "transfer-q1", "--stage", "teach",
    "--node", "contextual-representations", "--kind", "transfer",
    "--question", transferQuestion, "--mode", "free-response",
    "--activity-type", "transfer-case", "--strategy-reason", fartherTransfer.reason,
    "--support-level", "0", "--transfer-level", "3",
    "--parent-question-id", "faded-q2",
    "--adaptation-reason", "Support reached zero, so transfer advances to a structurally different debugging task.",
    "--now", at,
  ]);
  const transferAnswer = "The claim is wrong: context changes the hidden representation used downstream, not the token's vocabulary ID.";
  invoke(root, "answer-question", [
    "--question-id", "transfer-q1", "--response-id", "transfer-r1",
    "--text-answer", transferAnswer, "--confidence", "91",
    "--response-time-ms", "16000", "--now", at,
  ]);
  invoke(root, "record-assessment", [
    "--id", "transfer-a1", "--question-id", "transfer-q1",
    "--node", "contextual-representations", "--stage", "teach",
    "--kind", "transfer", "--question", transferQuestion, "--answer", transferAnswer,
    "--grade", "correct",
    "--evidence", "Debugged a structurally different claim using the same identity-versus-representation mechanism.",
    "--confidence", "91", "--response-time-ms", "16000",
    "--support-level", "0", "--transfer-level", "3",
    "--activity-type", "transfer-case", "--now", at,
  ]);
  invoke(root, "start-synthesis", [
    "--question-id", "synthesis-q1",
    "--question", "Connect token identity, contextual representation, attention, and next-token prediction.",
    "--now", at,
  ]);
  invoke(root, "record-synthesis", [
    "--id", "synthesis-a1", "--question-id", "synthesis-q1",
    "--question", "Connect token identity, contextual representation, attention, and next-token prediction.",
    "--answer", "Token identity selects an embedding; attention mixes context into hidden representations, which then determine next-token logits.",
    "--grade", "correct",
    "--evidence", "Connected stable token identity through contextual attention to the model output in one whole-system account.",
    "--now", at,
  ]);
  invoke(root, "close", ["--now", at]);

  const optimizationPlan = path.join(root, "optimization-plan.json");
  fs.writeFileSync(optimizationPlan, `${JSON.stringify({
    targetNodeId: "gradient-direction",
    nodes: [
      { id: "local-slope", title: "Local slope" },
      { id: "gradient-direction", title: "Gradient direction" },
    ],
    edges: [{ from: "local-slope", to: "gradient-direction", reason: "The local slope defines the local increase direction." }],
  }, null, 2)}\n`);
  invoke(root, "start", [
    "--id", "optimization-session", "--topic", "Optimization",
    "--target", "Understand the gradient update direction", "--now", at,
  ]);
  invoke(root, "record-probe", [
    "--id", "slope-a1", "--question-id", "slope-q1",
    "--node", "local-slope", "--kind", "explanation",
    "--question", "What does a positive local derivative mean?",
    "--answer", "A small positive input move locally increases the function.",
    "--grade", "correct",
    "--evidence", "Correctly tied derivative sign to the local direction of function increase.",
    "--now", at,
  ]);
  invoke(root, "finish-probe", ["--summary", "Local slope is demonstrated; update direction is next.", "--now", at]);
  invoke(root, "set-plan", ["--file", optimizationPlan, "--now", at]);
  invoke(root, "begin-teach", ["--now", at]);
  const gradientQuestion = "If the gradient is positive, which local parameter direction decreases loss?";
  invoke(root, "record-step", [
    "--id", "gradient-step", "--node", "gradient-direction",
    "--foundation", "The gradient points in the local loss-increasing direction.",
    "--motivation", "Optimization needs the opposite local direction.",
    "--explanation", "Subtracting the gradient moves in the local loss-decreasing direction.",
    "--question-id", "gradient-q1", "--kind", "transfer", "--question", gradientQuestion,
    "--activity-type", "transfer-case", "--strategy-reason", "Test the sign in a new local scenario.",
    "--support-level", "0", "--transfer-level", "1", "--now", at,
  ]);
  invoke(root, "record-assessment", [
    "--id", "gradient-a1", "--question-id", "gradient-q1",
    "--node", "gradient-direction", "--stage", "teach", "--kind", "transfer",
    "--question", gradientQuestion,
    "--answer", "Move the parameter in the negative direction by subtracting the positive gradient.",
    "--grade", "correct",
    "--evidence", "Applied the local derivative sign to choose the loss-decreasing update direction.",
    "--confidence", "85", "--response-time-ms", "18000",
    "--support-level", "0", "--transfer-level", "1", "--activity-type", "transfer-case",
    "--now", at,
  ]);
  invoke(root, "start-synthesis", [
    "--question-id", "optimization-synthesis-q1",
    "--question", "Connect local slope, gradient direction, and the optimizer update.", "--now", at,
  ]);
  invoke(root, "record-synthesis", [
    "--id", "optimization-synthesis-a1", "--question-id", "optimization-synthesis-q1",
    "--question", "Connect local slope, gradient direction, and the optimizer update.",
    "--answer", "The gradient gives local increase, so the optimizer subtracts it to seek local decrease.",
    "--grade", "correct",
    "--evidence", "Connected the derivative meaning to the signed optimizer update without changing scope.",
    "--now", at,
  ]);
  invoke(root, "close", ["--now", at]);

  const practice = JSON.parse(invoke(root, "practice-plan", [
    "--now", "2026-09-30T08:00:00.000Z", "--json",
  ]));
  assert.ok(practice.items.length >= 2);
  assert.notEqual(practice.items[0].topicId, practice.items[1].topicId);

  const state = JSON.parse(fs.readFileSync(path.join(root, ".adaptive-learning", "state.json"), "utf8"));
  const session = state.sessions["adaptive-session"];
  const concept = session.conceptIds
    .map((id) => state.concepts[id])
    .find((item) => item.key === "contextual-representations");
  const review = state.reviews[concept.reviewId];
  assert.equal(session.productiveAttempts.length, 1);
  assert.equal(session.productiveAttempts[0].answer.includes("changes one token's identity"), true);
  assert.equal(session.questions.every((item) => item.mode === "free-response"), true);
  assert.equal(concept.mastery.explanation.attempts, 2);
  assert.equal(concept.mastery.application.correct, 4);
  assert.equal(concept.highestTransferLevel, 3);
  assert.equal(concept.supportLevel, 0);
  assert.equal(state.misconceptions["identity-context"].status, "resolved");
  assert.equal(state.misconceptions["identity-context"].occurrences, 2);
  assert.deepEqual(
    session.steps.map((step) => step.activityType),
    ["worked-example", "contrastive-case", "faded-example", "faded-example", "transfer-case"],
  );
  assert.equal(session.assessments.some((item) => item.confidence === 92), true);
  assert.equal(review.history.length, 4);
  assert.ok(review.stabilityDays > 0);
  assert.notEqual(review.difficulty, 50);
  assert.equal(session.synthesisCheckpoint.resolvedEvidenceId, "synthesis-a1");

  const sessionFile = fs.readdirSync(path.join(root, "vault", "Sessions"))
    .find((name) => name.startsWith("transformers-"));
  const rendered = fs.readFileSync(path.join(root, "vault", "Sessions", sessionFile), "utf8");
  assert.match(rendered, /Productive-failure attempts/);
  assert.match(rendered, /Mastery by ability/);
  assert.match(rendered, /Misconceptions:\*\* identity-context/);
  assert.match(rendered, /Confidence:\*\* 92%/);
  assert.match(rendered, /Faded example/);

  const topicFile = fs.readdirSync(path.join(root, "vault", "Topics"))
    .find((name) => name.startsWith("transformers-"));
  const renderedTopic = fs.readFileSync(path.join(root, "vault", "Topics", topicFile), "utf8");
  assert.match(renderedTopic, /Context changes the token identity itself/);
});
