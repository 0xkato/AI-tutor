# Pi Quiz Keyboard Navigation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the adaptive-learning quiz respond to Pi's configured Up, Down, Enter, Escape, Tab, newline, and backspace inputs across legacy and modern terminal keyboard protocols.

**Architecture:** Pass Pi's injected `KeybindingsManager` from `ctx.ui.custom()` into the quiz controller. Route semantic quiz actions through the manager, while retaining the existing raw-byte checks as a compatibility fallback for direct controller use and older Pi hosts.

**Tech Stack:** Node.js ESM, Pi extension API, `node:test`.

### Task 1: Reproduce the navigation failure

**Files:**
- Modify: `test/pi-quiz.test.mjs`

1. Add a test keybindings manager that recognizes Pi selection actions for modern arrow sequences.
2. Add a regression test which passes `\x1b[1;1B` and confirms the selected answer moves from choice 1 to choice 2 before Enter.
3. Run `node --test test/pi-quiz.test.mjs` and confirm the new test fails because the controller ignores the injected keybindings manager.

### Task 2: Use Pi's semantic keyboard actions

**Files:**
- Modify: `.pi/extensions/adaptive-learning.js`

1. Accept the injected keybindings manager in `createQuizController`.
2. Match navigation, confirmation, cancellation, Tab, newline, and backward deletion through Pi action identifiers, with the existing raw encodings as fallback.
3. Pass the manager supplied by `ctx.ui.custom()` into the controller.
4. Run `node --test test/pi-quiz.test.mjs` and confirm the regression and existing quiz tests pass.

### Task 3: Verify and land

**Files:**
- Modify if needed: `CHANGELOG.md`

1. Run `npm test`.
2. Run `npm run release-check`.
3. Run `git diff --check` and inspect the exact diff.
4. Commit the scoped fix, fast-forward `main`, push the private repository, and verify the remote commit.
