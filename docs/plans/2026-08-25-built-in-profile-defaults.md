# Built-in Learner Profile Defaults Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make it clear that the adaptive teaching protocol is active without learner configuration and keep `/learn-profile` strictly optional.

**Architecture:** Preserve empty learner-profile fields in canonical state as optional overrides. Change the Pi presentation layer and first-run documentation so empty fields are rendered as active built-in defaults instead of missing configuration. Keep the existing protocol and persistence behavior unchanged.

**Tech Stack:** Node.js, Pi project extension, Node test runner, Markdown documentation.

### Task 1: Specify default-active Pi messaging

**Files:**
- Modify: `test/pi-extension.test.mjs`
- Modify: `.pi/extensions/adaptive-learning.js`

1. Add an assertion that an empty profile is displayed as using the built-in default and is not displayed as `Not configured`.
2. Run `node --test test/pi-extension.test.mjs` and confirm the new assertion fails.
3. Update `profileSummary` with the minimal default-active fallback.
4. Re-run the focused test and confirm it passes.

### Task 2: Make onboarding explicitly optional

**Files:**
- Modify: `test/video-parity-contract.test.mjs`
- Modify: `test/interactive-docs.test.mjs`
- Modify: `README.md`
- Modify: `docs/operator/quickstart.md`

1. Add contract assertions that profile customization is optional, built-in defaults remain active, and `/teach` can be the first learner command.
2. Run the focused documentation tests and confirm they fail against the current required-setup wording.
3. Rewrite the profile sections as optional customization and place the direct `/teach` path first.
4. Re-run the focused documentation tests and confirm they pass.

### Task 3: Verify and integrate

**Files:**
- Verify all changed files.

1. Run the focused Pi and documentation tests.
2. Run `npm test`.
3. Run `npm run release-check`.
4. Run `git diff --check` and inspect the final diff.
5. Commit the scoped change and merge it into `main` after verification.
