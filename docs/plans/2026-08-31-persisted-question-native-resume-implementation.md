# Persisted Question Native Resume Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reopen an unresolved persisted learning question in Pi's native UI without recreating it or falling back to a plain-text prompt.

**Architecture:** A shared extension helper resolves the redacted pending item and owns native presentation/submission. A dedicated resume tool uses that helper directly, while the existing create tools delegate to it when the same visible question is already pending. Submission remains authoritative because grading happens against canonical state.

**Tech Stack:** Node.js ESM, Pi extension API, TypeBox, `node:test`, durable adaptive-learning CLI.

### Task 1: Lock the failing resume behavior

**Files:**
- Modify: `test/pi-quiz.test.mjs`
- Modify: `test/pi-extension.test.mjs`

1. Add a test with an `awaiting-answer` question whose hidden definition differs from the replayed create arguments.
2. Assert that native UI receives the stored visible question and `start-question` is not called.
3. Add a test that a visibly different pending item fails before UI presentation.
4. Run the focused tests and confirm they fail because no first-class resume path exists.

### Task 2: Implement native stored-question presentation

**Files:**
- Modify: `.pi/extensions/adaptive-learning.js`

1. Add the `adaptive_learning_resume_question` tool with a question-ID-only schema.
2. Add one shared resolver/presenter for multiple-choice and free-response pending items.
3. Make existing create tools preflight pending state and delegate only on exact visible identity.
4. Use the persisted submission result for feedback fields that were redacted before presentation.
5. Run the focused tests and confirm they pass.

### Task 3: Remove the Pi manual fallback contract

**Files:**
- Modify: `.agents/skills/adaptive-learning/SKILL.md`
- Modify: `.agents/skills/adaptive-learning/references/teaching-protocol.md`
- Modify: `test/skill-contract.test.mjs`

1. Add a failing contract test that distinguishes Pi fail-closed behavior from the Codex-only numbered fallback.
2. Document pending-question resume through the dedicated Pi tool.
3. Explicitly prohibit rendering a manual question after any Pi interactive failure.
4. Run the skill contract tests.

### Task 4: Verify the repaired boundary

**Files:**
- Modify only if a test exposes a scoped defect.

1. Run focused Pi quiz, extension, host-contract, CLI, and skill tests.
2. Run `git diff --check`.
3. Run `npm run release-check`.
4. Confirm the real canonical pending question is unchanged and still awaiting native presentation.
5. Record that a human Pi terminal pass remains the final UI acceptance boundary until the learner completes it.

### Task 5: Eliminate the checkpoint-only presentation gap

**Files:**
- Modify: `.pi/extensions/adaptive-learning.js`
- Modify: `test/interactive-learning-acceptance.test.mjs`
- Modify: `.agents/skills/adaptive-learning/SKILL.md`
- Modify: `.agents/skills/adaptive-learning/references/teaching-protocol.md`
- Modify: `.agents/skills/adaptive-learning/references/cli-reference.md`

1. Change the end-to-end test to call the question-ID-only presentation tool
   immediately after a real free-response `record-step`.
2. Run it and confirm `QUESTION_NOT_RESUMABLE` reproduces the live failure.
3. Make the runtime materialize the exact active free-response checkpoint when
   no interactive question exists, preserving activity metadata and adaptive
   parentage from canonical state.
4. Drive the real native response controller in the acceptance test and persist
   its answer before assessment.
5. Document the presentation tool as the single checkpoint path and run the
   full release check.
