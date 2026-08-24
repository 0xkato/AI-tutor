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
- Start with a broad probe, then binary-search each prerequisite strand until
  the learner's actual edge of understanding is located.
- Summarize what is demonstrated, fragile, missing, and not yet checked.
- Research the missing path and store claim-level provenance.
- Build and validate a prerequisite dependency DAG before teaching. Show the
  same plan as Mermaid so the route and target remain visible.
- Begin at the first teachable frontier.

### Teaching

- Begin from unconditional foundations, definitions and invariants already
  justified by evidence.
- Motivate every step as a discovery forced by a concrete problem.
- Teach one reasoning step at a time. Before presenting its checkpoint, persist
  the foundation, motivation, explanation, question ID, question text, and
  kind with `record-step`.
- Resolve that checkpoint before advancing to another step.

### Assessment and repair

- Assess substantive answers as exactly **Correct**, **Partial**, or
  **Incorrect**, followed by the specific evidence.
- A clarification explains only the missing term or premise and returns to the
  same question.
- On a first genuine miss, identify the error type, do not reveal the answer,
  and give one bounded retry.
- When canonical state requires a retry, reuse the exact persisted question,
  question ID, node, and kind. Never place a different question under the old
  identity to satisfy the retry gate.
- After a second miss permits teaching, teach the missing mechanism and persist
  the replacement transfer as a repair `record-step` with a new question ID,
  exact question text, and kind before asking for or accepting its answer.
- If an answer leaks, mark the question contaminated, discard it as evidence,
  and use a new transfer question or task.
- Prefer own-words explanation, prediction, transfer, reconstruction, and
  debugging over recognition-only checks.

### Retention and closure

- Run `due --json` to find available spaced-retention work, then claim explicit
  items with `start-review`. Listing an item as due does **not** complete it.
- During a review session, assess only the selected concepts through retention
  questions. Persist each result, repair misses within the active checkpoint,
  and require a new durable transfer before treating an item as resolved.
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

## Persistence invariant

Record every state change through the CLI immediately after it happens in the
conversation. Teaching checkpoints and whole-system synthesis questions are
state changes: persist their identity before the learner answers, not inside
the later assessment. Never claim that a probe, source, plan, step, checkpoint,
assessment, synthesis, visual, or review was persisted until the command
succeeds. If recording fails, keep the conversational claim bounded and repair
persistence before advancing.
