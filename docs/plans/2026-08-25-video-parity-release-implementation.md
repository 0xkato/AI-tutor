# Video-Parity Release Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the source-backed video-parity gap, produce fresh release evidence, and publish the verified AI-tutor release candidate.

**Architecture:** Keep the local deterministic Node.js engine and shared Codex/Pi skill. Add a canonical cross-session learner profile, expose it through the CLI, Pi, skill preflight, and Obsidian renderer, then reconcile release evidence against the exact video-parity contract.

**Tech Stack:** Node.js ESM, `node:test`, TypeBox-backed Pi extension UI, JSON canonical state, generated Obsidian Markdown, GitHub Actions.

### Task 1: Persist the learner's teaching philosophy

**Files:**
- Modify: `src/model.mjs`
- Modify: `src/schema.mjs`
- Modify: `src/migrations.mjs`
- Modify: `test/schema.test.mjs`
- Modify: `test/migrations.test.mjs`

1. Write failing tests for a schema-versioned learner profile with teaching
   philosophy and explanation, feedback, visual, and source preferences.
2. Verify the tests fail against schema version 3.
3. Add the next deterministic migration and strict profile validation.
4. Run the focused schema and migration tests until they pass.

### Task 2: Add the profile product surface

**Files:**
- Modify: `bin/learn.mjs`
- Modify: `src/render.mjs`
- Modify: `src/render-manifest.mjs`
- Modify: `test/cli-lifecycle.test.mjs`
- Modify: `test/render.test.mjs`

1. Write failing CLI tests for `profile --json` and an atomic profile update.
2. Write failing render assertions for `vault/Profile.md` and Home navigation.
3. Implement the read/update commands and profile rendering.
4. Verify invalid updates preserve canonical state and valid updates advance
   the revision and regenerate the vault.

### Task 3: Make both hosts honor the profile

**Files:**
- Modify: `.agents/skills/adaptive-learning/SKILL.md`
- Modify: `.agents/skills/adaptive-learning/references/teaching-protocol.md`
- Modify: `.pi/extensions/adaptive-learning.js`
- Modify: `test/skill-contract.test.mjs`
- Modify: `test/pi-extension.test.mjs`

1. Write failing contract tests requiring the profile before calibration.
2. Add `/learn-profile` for showing or updating the shared profile.
3. Require `context --json` to expose the profile before the host probes,
   researches, plans, teaches, or reviews.
4. Run the focused host tests.

### Task 4: Freeze the source-backed parity contract

**Files:**
- Create: `docs/product/video-parity.md`
- Create: `test/video-parity-contract.test.mjs`
- Modify: `README.md`
- Modify: `docs/operator/quickstart.md`

1. Write a failing contract test for every source-derived workflow feature.
2. Publish the timestamped parity table without copying the transcript.
3. Document the exact first-run and profile setup experience.
4. Run the contract and documentation tests.

### Task 5: Produce current release evidence

**Files:**
- Modify: `docs/verification.md`
- Modify: `docs/verification/live-host-acceptance.md`
- Modify: `docs/release/first-local-release.md`
- Create: `CHANGELOG.md`
- Modify: `package.json`
- Modify: `package-lock.json`

1. Run the complete test suite and release check from a clean worktree.
2. Run the supported Node 20 and 22 release matrix.
3. Exercise a fresh interactive question, learner note, adaptive child, plan,
   teaching checkpoint, visual record, and Obsidian render.
4. Record the GitHub Actions billing annotation separately from code results.
5. Update counts, evidence, version, and changelog only from fresh receipts.
6. Do not convert pending human acceptance into a pass.

### Task 6: Publish the verified candidate

**Files:**
- No new product files.

1. Run `git diff --check`, the full release check, and clean-state checks.
2. Commit only intended files.
3. Push the verified commit to private `0xkato/AI-tutor` `main`.
4. Read back the remote commit, visibility, default branch, and hosted workflow
   result.
5. Create an annotated release tag only if every release gate, including human
   acceptance, is green.
