# Adaptive Learning Agent Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build and verify the complete local adaptive-learning system described in the design, with persistent state, an Obsidian view, and working Codex/Pi integrations.

**Architecture:** A dependency-free Node.js CLI owns deterministic state and rendering. A shared Agent Skill supplies the teaching workflow to both runners, while a small Pi extension supplies chat commands. JSON is canonical and Markdown is derived.

**Tech Stack:** Node.js ESM, built-in `node:test`, JSON, Markdown/Mermaid, Agent Skills, Pi JavaScript extensions.

### Task 1: Project contract and CLI shell

**Files:**
- Create: `package.json`
- Create: `README.md`
- Create: `AGENTS.md`
- Create: `bin/learn.mjs`
- Test: `test/cli-help.test.mjs`

1. Write a test that runs `learn --help` and asserts every lifecycle command is listed.
2. Run the test and verify it fails because the CLI does not exist.
3. Add the package metadata, executable shell, help, and unknown-command error.
4. Run the test and verify it passes.

### Task 2: Canonical store and session lifecycle

**Files:**
- Create: `src/errors.mjs`
- Create: `src/store.mjs`
- Create: `src/model.mjs`
- Test: `test/store.test.mjs`
- Test: `test/lifecycle.test.mjs`

1. Write failing tests for initialization, atomic persistence, active-session
   selection, valid transitions, and rejected invalid transitions.
2. Implement schema versioning, lock acquisition, atomic writes, IDs, and phase
   guards.
3. Run the focused tests and verify they pass.

### Task 3: Probe and assessment evidence

**Files:**
- Modify: `src/model.mjs`
- Create: `src/assessment.mjs`
- Modify: `bin/learn.mjs`
- Test: `test/assessment.test.mjs`

1. Write failing tests for Correct/Partial/Incorrect validation, required exact
   evidence, first-miss retry, second-miss teachability, clarification
   exclusion, and contaminated-question exclusion.
2. Implement probe and assessment mutation functions and CLI commands.
3. Run the focused tests and verify they pass.

### Task 4: Dependency plan and frontier

**Files:**
- Create: `src/graph.mjs`
- Modify: `src/model.mjs`
- Modify: `bin/learn.mjs`
- Test: `test/graph.test.mjs`

1. Write failing tests for missing nodes, self-edges, cycles, stable topological
   order, and next-frontier selection from known prerequisites.
2. Implement DAG validation, Mermaid generation, and plan-phase commands.
3. Run the focused tests and verify they pass.

### Task 5: Retention scheduler

**Files:**
- Create: `src/retention.mjs`
- Modify: `src/assessment.mjs`
- Modify: `bin/learn.mjs`
- Test: `test/retention.test.mjs`

1. Write failing tests for correct interval progression, partial regression,
   incorrect reset, contaminated exclusion, due ordering, and synthesis flags.
2. Implement deterministic UTC scheduling and the `due` command.
3. Run the focused tests and verify they pass.

### Task 6: Obsidian renderer

**Files:**
- Create: `src/render.mjs`
- Modify: `src/model.mjs`
- Modify: `bin/learn.mjs`
- Test: `test/render.test.mjs`

1. Write failing snapshot-style assertions for the vault home, session note,
   topic note, Mermaid plan, source ledger, lesson steps, review evidence, and
   visual embeds.
2. Implement deterministic Markdown rendering after every successful mutation.
3. Run the focused tests and verify they pass.

### Task 7: Shared Codex/Pi teaching skill

**Files:**
- Create: `.agents/skills/adaptive-learning/SKILL.md`
- Create: `.agents/skills/adaptive-learning/references/teaching-protocol.md`
- Create: `.agents/skills/adaptive-learning/references/research-protocol.md`
- Create: `.agents/skills/adaptive-learning/references/cli-reference.md`
- Test: `test/skill-contract.test.mjs`

1. Write a failing contract test for target ownership, broad-to-narrow probing,
   agent-led research, visible sources, DAG planning, one-step teaching,
   foundations, motivated discovery, exact assessment labels, retry without
   leakage, contamination, transfer, retention, synthesis, and CLI recording.
2. Write the skill and references so both Codex and Pi can discover them from
   `.agents/skills`.
3. Run the contract test and verify it passes.

### Task 8: Pi chat adapter

**Files:**
- Create: `.pi/extensions/adaptive-learning.js`
- Create: `.pi/settings.json`
- Test: `test/pi-extension.test.mjs`

1. Write a failing test with a fake Pi API that expects `/teach`,
   `/learn-status`, and `/learn-review` registration and safe argument handling.
2. Implement the dependency-free extension. `/teach` invokes the local CLI,
   then sends `/skill:adaptive-learning` into Pi with the learner's target.
3. Run the extension test and verify it passes.

### Task 9: Full CLI integration and end-to-end session

**Files:**
- Modify: `bin/learn.mjs`
- Create: `test/cli-lifecycle.test.mjs`
- Create: `test/e2e-learning-session.test.mjs`
- Create: `examples/differential-forms-plan.json`

1. Write a failing process-level test covering independent CLI invocations.
2. Wire all commands through the canonical store and renderer.
3. Simulate start, broad and narrow probes, finish-probe, verified sources,
   plan, teach step, first miss, retry, successful transfer, visual, close, and
   due-review inspection.
4. Assert canonical JSON, Markdown artifacts, phase, mastery evidence, retry
   state, source provenance, and schedule.
5. Run the focused integration tests and verify they pass.

### Task 10: Verification and completion audit

**Files:**
- Modify: `README.md`
- Create: `docs/verification.md`

1. Run `npm test`.
2. Run Node syntax checks over every JavaScript module.
3. Run the end-to-end example in a fresh temporary directory.
4. Verify Pi's current project-local skill and extension conventions against
   the pinned upstream commit recorded in `docs/verification.md`.
5. Inspect generated Obsidian notes and every acceptance item in the design
   matrix.
6. Record exact commands and results; leave any unproved requirement open.

