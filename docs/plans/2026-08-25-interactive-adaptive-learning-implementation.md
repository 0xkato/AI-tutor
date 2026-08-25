# Interactive Adaptive Learning Implementation Plan

**Goal:** Build the missing multiple-choice, note-taking, and adaptive-question
interaction for Pi and Codex on one durable state model.

**Architecture:** Schema version 3 stores questions and learner notes. Pure
state functions own the lifecycle, the CLI exposes safe mutations and redacted
reads, Pi supplies a native custom quiz tool, and the Agent Skill supplies the
Codex fallback and adaptive sequencing contract.

**Tech stack:** Node.js ESM, built-in `node:test`, JSON, Markdown/Obsidian,
Agent Skills, Pi project extensions and `ctx.ui.custom()`.

## Task 1: Define the state lifecycle test-first

**Files:** `test/questions.test.mjs`, `test/migrations.test.mjs`,
`src/questions.mjs`, `src/schema.mjs`, `src/migrations.mjs`, `src/store.mjs`,
`src/model.mjs`.

1. Add failing tests for question creation, redaction, one-pending-question
   enforcement, deterministic grading, **I don't know**, cancellation, notes,
   and adaptive parent metadata.
2. Add a failing version-2 migration and backup test.
3. Implement schema version 3 and the minimum pure lifecycle functions.
4. Run the focused tests until green.

## Task 2: Expose safe CLI commands

**Files:** `test/question-cli.test.mjs`, `bin/learn.mjs`,
`.agents/skills/adaptive-learning/references/cli-reference.md`.

1. Add failing end-to-end tests for `start-question`, `pending-question`,
   atomic `submit-question`, lower-level `answer-question`, `cancel-question`,
   and `add-note`.
2. Assert pending output redacts correct values and answer output returns the
   stored outcome.
3. Implement named options with no shell interpolation and reuse the existing
   locked commit-and-render path.
4. Document exact examples.

## Task 3: Render inspectable questions and notes

**Files:** `test/render.test.mjs`, `src/render.mjs`.

1. Add a failing renderer test covering displayed choices, response, outcome,
   adaptive link, and learner note.
2. Ensure an unanswered question does not render its answer key.
3. Implement a compact `Questions and learner notes` section.

## Task 4: Build the native Pi quiz tool

**Files:** `test/pi-quiz.test.mjs`, `test/pi-extension.test.mjs`,
`.pi/extensions/adaptive-learning.js`.

1. Add failing fake-host tests for tool registration, pre-answer persistence,
   custom UI invocation, answer/note persistence, cancellation, and absence of
   answer leakage in the call renderer.
2. Implement a pure quiz controller that can be driven in tests.
3. Implement the TUI component using Pi's injected UI and TUI package.
4. Keep non-TUI behavior explicit and safe.

## Task 5: Make calibration and teaching use the interaction

**Files:** `test/skill-contract.test.mjs`,
`.agents/skills/adaptive-learning/SKILL.md`,
`.agents/skills/adaptive-learning/references/teaching-protocol.md`.

1. Add failing contract assertions that new calibration begins with persisted
   multiple choice, uses the Pi tool when present, always offers **I don't
   know** and note capture, and records adaptive parent/reason metadata.
2. Require the Codex numbered-card fallback when the tool is unavailable.
3. Preserve the exact assessment, retry, contamination, clarification, and
   admitted-gap rules.

## Task 6: Acceptance and release verification

**Files:** `test/interactive-learning-acceptance.test.mjs`, `README.md`,
`docs/operator/quickstart.md`, `docs/verification.md`.

1. Add an end-to-end temporary-root scenario: start target, ask broad MCQ,
   submit note, branch to a linked question, inspect state and Obsidian.
2. Run focused tests, the complete suite, diagnostics, and the release check.
3. Inspect the final diff and verify live `.adaptive-learning` and `vault`
   paths were never touched.
4. Commit the verified implementation on `codex/interactive-learning-ui`.
