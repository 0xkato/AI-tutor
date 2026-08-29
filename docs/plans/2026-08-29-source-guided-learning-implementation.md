# Source-Guided Learning Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add durable source-guided sessions launched through Pi or Codex, with anchor-material resolution, claim-level provenance, per-node source coverage, and Obsidian visibility.

**Architecture:** Extend canonical state to schema version 5 with learner-supplied materials and source-coverage records. Keep retrieval and extraction in the host skill, while the deterministic engine validates material lifecycle, source roles, coverage, and teaching gates. Add `/teach-from` as the learner-facing Pi entrypoint.

**Tech Stack:** Node.js ESM, built-in `node:test`, Pi extension API, JSON canonical state, generated Obsidian Markdown.

### Task 1: Define schema-v5 material and provenance behavior

**Files:**
- Modify: `test/session-actions.test.mjs`
- Modify: `test/schema.test.mjs`
- Modify: `src/model.mjs`
- Modify: `src/schema.mjs`

1. Add failing model tests for source-guided session creation, material
   resolution, anchor/supplemental source invariants, source coverage, and the
   uncited-teaching rejection.
2. Run the two test files and confirm failures are caused by the missing
   schema-v5 behavior.
3. Add the smallest state model and validation needed to pass.
4. Rerun the tests and keep existing ordinary `/teach` behavior unchanged.

### Task 2: Add deterministic schema migration

**Files:**
- Modify: `test/migrations.test.mjs`
- Modify: `src/migrations.mjs`
- Modify: `src/store.mjs`
- Modify: `docs/operator/state-format.md`

1. Add failing tests for deterministic v4-to-v5 migration and read-time backup
   plus migration.
2. Confirm the tests fail because v4 is not migrated.
3. Add `migrateV4ToV5`, chain every older schema through it, and document the
   new fields and boundary.
4. Rerun migration and store tests.

### Task 3: Expose the material lifecycle and coverage through the CLI

**Files:**
- Modify: `test/cli-help.test.mjs`
- Modify: `test/cli-lifecycle.test.mjs`
- Modify: `bin/learn.mjs`
- Modify: `.agents/skills/adaptive-learning/references/cli-reference.md`

1. Add failing CLI tests for repeatable `start --material`,
   `resolve-material`, extended `add-source`, and `record-source-coverage`.
2. Confirm help and lifecycle tests fail for missing commands/options.
3. Wire commands to the model without shell evaluation or implicit network
   access.
4. Rerun targeted CLI tests.

### Task 4: Add `/teach-from` to Pi

**Files:**
- Modify: `test/pi-extension.test.mjs`
- Modify: `.pi/extensions/adaptive-learning.js`

1. Add failing tests for command registration, URL/local-path parsing,
   canonical start arguments, active-session conflict handling, and skill
   dispatch containing the material plus target.
2. Confirm the tests fail because `/teach-from` is absent.
3. Implement the parser and handler by reusing the existing asynchronous CLI
   runner and error boundary.
4. Rerun Pi extension and host-contract tests.

### Task 5: Render source guidance and provenance in Obsidian

**Files:**
- Modify: `test/render.test.mjs`
- Modify: `src/render.mjs`

1. Add a failing render test that requires supplied-material status, source
   role and locator, per-node coverage, and separate learner understanding.
2. Confirm it fails because the projection lacks those sections.
3. Add compact session-note sections while preserving Markdown escaping and
   manifest ownership.
4. Rerun render and render-safety tests.

### Task 6: Make host behavior source-guided

**Files:**
- Modify: `test/skill-contract.test.mjs`
- Modify: `.agents/skills/adaptive-learning/SKILL.md`
- Modify: `.agents/skills/adaptive-learning/references/research-protocol.md`
- Modify: `docs/product/video-parity.md`

1. Add failing contract assertions for material inspection, exact locators,
   anchor/supplemental separation, disagreement handling, source coverage, and
   the understanding-evidence boundary.
2. Confirm the contract test fails on the missing language.
3. Update the skill and research protocol with the deterministic command order
   and fail-closed rules.
4. Rerun skill and video-parity contract tests.

### Task 7: Document and exercise the complete user journey

**Files:**
- Modify: `test/interactive-docs.test.mjs`
- Modify: `test/e2e-learning-session.test.mjs`
- Modify: `README.md`

1. Add failing public-documentation and end-to-end source-guided lifecycle
   tests.
2. Confirm both fail for missing behavior.
3. Add the concise `/teach-from` quickstart and complete fixture lifecycle.
4. Rerun the targeted tests.

### Task 8: Verify and review the release candidate

**Files:**
- Review all changed files.

1. Run `git diff --check`.
2. Run targeted source-guided tests.
3. Run `npm test`.
4. Run `npm run release-check`.
5. Inspect the complete diff for accidental scope, leaked local data, and
   weakened release boundaries.
6. Commit the feature only after every applicable gate is green.
