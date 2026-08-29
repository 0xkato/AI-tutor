---
name: adaptive-learning
description: Use when a learner asks to learn, understand, be taught, test retention, review prior material, or build a durable mental model through an adaptive chat session.
---

# Adaptive Learning

Build transferable understanding through one trusted chat interface while the
local engine preserves calibration, evidence, sources, and future reviews.
The learner supplies the learning target; do not silently replace or broaden it.

## Required preflight

1. Locate this repository's `bin/learn.mjs` and the learning root.
2. Initialize state if needed. Run `context --json` before probing, resuming, or
   teaching an active session; use `status --json` when no session is active.
   Read `learnerProfile` from that context before calibration, research,
   planning, teaching, or review. Apply the learner-authored philosophy and
   preferences across sessions; do not invent or silently replace preferences
   that are not recorded. An empty profile uses this protocol's defaults.
3. Treat `.adaptive-learning/state.json` as canonical. Obsidian Markdown is a
   derived, inspectable view, never the mutation source.
4. Read [the teaching protocol](references/teaching-protocol.md) before any
   probe, lesson, assessment, clarification, or review.
5. Read [the research protocol](references/research-protocol.md) before
   selecting or discussing sources. Read [the CLI reference](references/cli-reference.md)
   before recording state.

## Operating loop

### New target

- Persist the learner-owned target and relevant prior context.
- Start with a broad probe. For a new target, the first broad probe must be
  multiple-choice. Every
  multiple-choice interaction includes an explicit **I don't know** option and
  an optional note alongside the answer. Then binary-search each prerequisite
  strand until the learner's actual edge of understanding is located.
- In Pi, use `adaptive_learning_quiz`. It persists the question, answer, note,
  and assessment itself; do not duplicate those mutations with separate CLI
  calls.
- In Codex, use the numbered-card fallback: run `start-question` and wait until
  it succeeds before showing the question, then accept one numbered choice or
  `I don't know` plus an optional `Note: ...`, and run `submit-question` before
  feedback. That command atomically persists the response, note, and
  deterministic assessment or phase-correct admitted gap.
- After the first question, every adaptive child must include
  `--parent-question-id` and `--adaptation-reason` so the branch is auditable.
- When the learner explicitly identifies a missing mechanism, persist it with
  `record-admitted-gap` without creating an assessment or grade. Do not use a
  fabricated incorrect answer or duplicate admission to unlock teaching.
- Summarize what is demonstrated, fragile, missing, and not yet checked.
- Research the missing path and store claim-level provenance.
- Build and validate a prerequisite dependency DAG before teaching. Show the
  same plan as Mermaid so the route and target remain visible.
- Begin at the first teachable frontier.

### Source-guided target

When `session.materials` is non-empty, this is a source-guided session. Inspect
every learner-supplied material before teaching from it, then persist whether
each material is `verified` or `unavailable` with `resolve-material`. Do not
substitute model recall for an unavailable source.

- An unavailable anchor blocks source-guided teaching. Tell the learner and
  wait for an accessible replacement or an explicit choice to continue as a
  supplemental-only lesson. Persist a replacement with `add-material
  --reference ...`. Persist supplemental-only continuation with
  `continue-supplemental-only --reason ...` only after the learner explicitly
  makes that choice; never infer consent from source failure.
- Preserve the supplied material as the **anchor**. Record its supported claims
  with `add-source --role anchor --material-id ...` and an exact timestamp,
  page, section, heading, or file locator.
- Research may correct, limit, or supplement the anchor, but record that work
  as **supplemental** evidence. Keep anchor and supplemental evidence distinct.
- Make any disagreement or conflict visible: state whether the supplemental
  evidence corrects, limits, or supplements the anchor before using the claim.
- After validating the dependency DAG, run `record-source-coverage` for every
  plan node before teaching that node. Coverage must identify the sources and
  explain why they support the node.
- When teaching from a recorded claim, show or cite its exact locator next to
  the explanation so the learner can inspect the basis without hunting for it.
- Source coverage is not learner understanding or mastery evidence. Only the
  learner's persisted answers, transfers, reconstructions, or other assessed
  work can demonstrate understanding.

### Teaching

- Run `recommend-next --node ... --json` before choosing each activity. Preserve
  its activity type, reason, support level, and transfer level in the question
  or teaching-step record.
- Begin from unconditional foundations, definitions and invariants already
  justified by evidence.
- Motivate every step as a discovery forced by a concrete problem.
- Teach one reasoning step at a time. Before presenting its checkpoint, persist
  the foundation, motivation, explanation, question ID, question text, and
  kind with `record-step`.
- Resolve that checkpoint before advancing to another step.
- Use `adaptive_learning_response` for own-words Pi checkpoints and
  `adaptive_learning_assess_response` only after the response is persisted.
  In Codex, use `start-question --mode free-response`, then `answer-question`,
  then `record-assessment` in that order.
- Treat productive-failure attempts as ungraded diagnostics and use them only
  when `recommend-next` confirms all prerequisites are durable.

### Assessment and repair

- Assess substantive answers as exactly **Correct**, **Partial**, or
  **Incorrect**, followed by the specific evidence.
- An admitted gap is diagnostic context, not a substantive answer. When the
  learner selects **I don't know** in an interactive question, let
  `submit-question` or `adaptive_learning_quiz` persist it, teach the missing
  mechanism, then test it with a new transfer question or example. Use
  `record-admitted-gap` for a gap stated outside that interaction. During an
  active open-ended teaching or retention checkpoint, include the exact
  checkpoint question ID and node; the command must succeed before teaching or
  advancing. It records no assessment or grade and requires a new transfer
  checkpoint after teaching.
- If **I don't know** answers a whole-system synthesis, ask one bounded,
  open diagnostic clarification to locate the first missing concept without
  suggesting candidates. Then run `record-admitted-gap` with the synthesis
  question ID and that exact plan or review node. Repair the concept and use a
  new synthesis transfer; do not fabricate an incorrect synthesis assessment.
- A clarification explains only the missing term or premise and returns to the
  same question.
- On a first genuine miss, identify the error type, do not reveal the answer,
  and give one bounded retry.
- First-miss feedback may identify where the learner's reasoning broke and its
  error type. It must not state the correct outcome, expected mechanism,
  correct value, corrective steps, or replacement answer wording.
- After receiving an open-ended substantive answer outside an interactive
  multiple-choice flow, run `record-assessment` with the exact persisted
  question and learner answer.
  Continue only after that command succeeds, and only then send the assessment
  feedback. If persistence fails, report that failure without presenting a
  grade or advancing the lesson. `adaptive_learning_quiz` already performs
  this persistence; do not record its assessment twice.
- When canonical state requires a retry, reuse the exact persisted question,
  question ID, node, and kind. Never place a different question under the old
  identity to satisfy the retry gate.
- A correct teaching-stage multiple-choice answer is recognition evidence, not
  durable transfer. When state returns `new-transfer-required` with
  `answerMayBeTaught: false`, do not reteach or reveal anything new about that
  answer. Persist a new `record-step` checkpoint with a new question ID and a
  durable transfer, prediction, reconstruction, or debugging task.
- After a second miss permits teaching, teach the missing mechanism and persist
  the replacement transfer as a repair `record-step` with a new question ID,
  exact question text, and kind before asking for or accepting its answer.
- If an answer leaks, mark the question contaminated, discard it as evidence,
  and use a new transfer question or task.
- Prefer own-words explanation, prediction, transfer, reconstruction, and
  debugging over recognition-only checks.
- Use interactive multiple-choice only during `probe` or `teach`. It locates a
  frontier but does not impersonate durable retention evidence; retention uses
  the persisted review-checkpoint lifecycle below.

### Retention and closure

- Run `practice-plan --json` and use its interleaved order when multiple
  concepts are due; do not convert the plan itself into review progress.
- Run `due --json` to find available spaced-retention work, then claim explicit
  items with `start-review`. Listing an item as due does **not** complete it.
- During a review session, assess only the selected concepts. Before running
  `start-review-checkpoint`, compare the candidate question with the selected
  concept's title, knowledge summary, and source-supported causal mechanism.
  Reject any question that can be answered without that selected mechanism or
  that merely shares a broad topic label. Then persist its question ID,
  question text, and kind before the learner answer. Only then record the
  assessment. Repair misses within that active checkpoint and require a new
  durable transfer checkpoint before treating an item as resolved.
- If the learner says **I don't know** to that persisted review checkpoint,
  run `record-admitted-gap` with its exact question ID and node. Teach the
  missing mechanism and open a new durable transfer checkpoint; do not invent
  a retention assessment.
- If a selected item cannot be validly assessed, use `defer-review` with a
  concrete reason and future time. Do not silently skip it.
- Run `close-review` only after every selected item is resolved or explicitly
  deferred. A review count and next interval advance only through this closed
  lifecycle, never from merely viewing the queue.
- When context says synthesis is required, run `start-synthesis` before asking
  the whole-system question, then persist the assessment with
  `record-synthesis`. This applies to learning sessions and required review
  syntheses.
- Run `close` or `close-review` only after the required synthesis resolves.
  Close derives the demonstrated synthesis only from a clean correct
  assessment; arbitrary prose passed at close cannot replace it.
- Close with explicit unresolved gaps and scheduled reviews. Never translate a
  schedule into a mastery claim.

## Research and visual boundary

The agent owns research, verification, and fact-checking. Discuss source
selection and source choices with the learner so assumptions remain visible,
but do not require per-source approval. Do not ask a novice to certify a source
whose subject they are learning.

Generate a visual only when it materially clarifies the current mechanism.
Inspect the visual before embedding it, then record its description and
verification. Mermaid is the default for the dependency graph.

## External transmission approval

Before sending local skill or protocol text, canonical learning state,
transcripts, source records, visuals, or other learner material to an external
model or provider, name the exact payload and destination before asking for
approval. Also state the purpose and any material exclusions.

Once that scoped request has been stated, the learner's explicit approval,
including a direct `I approve`, `yes`, or `go ahead`, authorizes exactly that
described transmission. Do not ask the learner to repeat or restate approval,
and do not require a special phrase. Ask again only if the payload,
destination, purpose, or scope materially changes. Record the approved boundary
in the resulting evidence without copying unrelated private material.

## Persistence invariant

Record every state change through the CLI immediately after it happens in the
conversation. Teaching checkpoints and whole-system synthesis questions are
state changes: persist their identity before the learner answers, not inside
the later assessment. Never claim that a probe, source, plan, step, checkpoint,
assessment, synthesis, visual, or review was persisted until the command
succeeds. If recording fails, keep the conversational claim bounded and repair
persistence before advancing.
