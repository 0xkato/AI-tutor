# Learning Engine Upgrade Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement all ten approved learning-improvement features as one durable, adaptive AI Tutor workflow.

**Architecture:** Add a schema-v6 evidence model and a deterministic learning-strategy module, then integrate them through assessments, questions, reviews, CLI, Pi, rendering, and the adaptive-learning protocol. Preserve existing behavior when new metrics are absent and enforce every new state transition with tests before production changes.

**Tech Stack:** Node.js ES modules, built-in `node:test`, JSON canonical state, Pi TUI extension, Markdown/Obsidian projection.

### Task 1: Schema-v6 learning evidence

**Files:**
- Modify: `src/schema.mjs`
- Modify: `src/migrations.mjs`
- Modify: `src/model.mjs`
- Test: `test/schema.test.mjs`
- Test: `test/migrations.test.mjs`

**Step 1: Write failing tests** for neutral mastery dimensions, global misconceptions, session activity history, enriched assessments/questions, and personalized review fields.

**Step 2: Verify RED** with `node --test test/schema.test.mjs test/migrations.test.mjs`; expect schema version 5 or missing-field failures.

**Step 3: Implement the additive v5-to-v6 migration and validators** without weakening existing identity or phase checks.

**Step 4: Verify GREEN** with the same targeted tests.

**Step 5: Commit** with `git commit -m "feat: add adaptive learning evidence schema"`.

### Task 2: Multidimensional mastery and misconception lifecycle

**Files:**
- Create: `src/learning-strategy.mjs`
- Modify: `src/concepts.mjs`
- Modify: `src/assessment.mjs`
- Test: `test/learning-strategy.test.mjs`
- Test: `test/assessment.test.mjs`

**Step 1: Write failing tests** proving that each assessment kind updates only its matching ability, recognition remains weak, misconceptions persist/relapse/resolve, and contaminated evidence changes nothing.

**Step 2: Verify RED** with `node --test test/learning-strategy.test.mjs test/assessment.test.mjs`.

**Step 3: Implement minimal dimension and misconception updates**, preserving the existing compact concept status.

**Step 4: Verify GREEN**, then refactor the mapping and lifecycle helpers while staying green.

**Step 5: Commit** with `git commit -m "feat: model mastery and misconceptions"`.

### Task 3: Adaptive activity selection

**Files:**
- Modify: `src/learning-strategy.mjs`
- Modify: `src/model.mjs`
- Test: `test/learning-strategy.test.mjs`
- Test: `test/session-actions.test.mjs`

**Step 1: Write failing tests** for worked-example fading, contrastive repair, the five-level transfer ladder, whole-system integration, and prerequisite-gated productive failure.

**Step 2: Verify RED** with the two targeted test modules.

**Step 3: Implement `recommendNextActivity` and persist strategy metadata** on steps and activity history.

**Step 4: Verify GREEN** and confirm admitted gaps always force teaching.

**Step 5: Commit** with `git commit -m "feat: select adaptive learning activities"`.

### Task 4: Personalized retention and interleaving

**Files:**
- Modify: `src/retention.mjs`
- Modify: `src/reviews.mjs`
- Modify: `src/learning-strategy.mjs`
- Test: `test/retention.test.mjs`
- Test: `test/review-lifecycle.test.mjs`

**Step 1: Write failing tests** for neutral legacy intervals, high-confidence lapses, fast confident retrieval, response-time/attempt penalties, scheduling history, and interleaving related/confusable concepts.

**Step 2: Verify RED** with the targeted retention tests.

**Step 3: Implement the bounded scheduling model and deterministic practice queue**.

**Step 4: Verify GREEN** and preserve due ordering and lifecycle ownership.

**Step 5: Commit** with `git commit -m "feat: personalize retention practice"`.

### Task 5: Free-response, confidence, and productive-attempt questions

**Files:**
- Modify: `src/questions.mjs`
- Modify: `src/interactive.mjs`
- Modify: `src/assessment.mjs`
- Test: `test/questions.test.mjs`
- Test: `test/protocol-invariants.test.mjs`

**Step 1: Write failing tests** for persisted free-response prompts, text responses, optional confidence/timing, assessment-after-answer, and ungraded productive-failure attempts.

**Step 2: Verify RED** with the targeted question tests.

**Step 3: Generalize the question lifecycle** while keeping selectable answer keys redacted and deterministic submission selectable-only.

**Step 4: Verify GREEN**, including retry and contamination invariants.

**Step 5: Commit** with `git commit -m "feat: support free response learning"`.

### Task 6: CLI and Pi integration

**Files:**
- Modify: `bin/learn.mjs`
- Modify: `.pi/extensions/adaptive-learning.js`
- Test: `test/cli-help.test.mjs`
- Test: `test/question-cli.test.mjs`
- Test: `test/pi-quiz.test.mjs`
- Test: `test/pi-extension.test.mjs`

**Step 1: Write failing contract tests** for `recommend-next`, `practice-plan`, free-response question/answer flags, confidence collection, and Pi response/assessment tools.

**Step 2: Verify RED** with the four targeted modules.

**Step 3: Implement CLI routing and Pi surfaces**. Keep the response text visible to the host but persist it before assessment.

**Step 4: Verify GREEN**, including modern keybindings, cancellation, timeouts, and answer-key secrecy.

**Step 5: Commit** with `git commit -m "feat: expose adaptive response tools"`.

### Task 7: Human-readable records and teaching protocol

**Files:**
- Modify: `src/render.mjs`
- Modify: `docs/operator/state-format.md`
- Modify: `docs/operator/quickstart.md`
- Modify: `.agents/skills/adaptive-learning/SKILL.md`
- Modify: `.agents/skills/adaptive-learning/references/teaching-protocol.md`
- Modify: `.agents/skills/adaptive-learning/references/cli-reference.md`
- Test: `test/render.test.mjs`
- Test: `test/interactive-docs.test.mjs`
- Test: `test/skill-contract.test.mjs`

**Step 1: Write failing tests** requiring mastery, misconception, confidence, transfer, support, activity, and scheduling details in inspectable records and host instructions.

**Step 2: Verify RED** with the three targeted modules.

**Step 3: Render and document the complete workflow** in learner-facing language.

**Step 4: Verify GREEN** and keep Markdown safety tests intact.

**Step 5: Commit** with `git commit -m "docs: define evidence driven teaching flow"`.

### Task 8: End-to-end acceptance and release verification

**Files:**
- Modify: `test/e2e-learning-session.test.mjs`
- Modify: `test/interactive-learning-acceptance.test.mjs`
- Modify: `CHANGELOG.md`

**Step 1: Write the failing end-to-end acceptance** spanning all ten capabilities.

**Step 2: Verify RED** with the two acceptance modules.

**Step 3: Add only missing integration glue** required by the acceptance path.

**Step 4: Verify GREEN** with targeted tests, `npm test`, `npm run check`, `git diff --check`, and `npm run release-check`.

**Step 5: Review the complete diff and commit** with `git commit -m "feat: complete adaptive learning upgrade"`.
