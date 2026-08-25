# Changelog

## 0.2.0-rc.2 — 2026-08-25

### Fixed

- Every Pi quiz action now uses Pi's injected keybindings, including modern
  terminal sequences for navigation, confirmation, cancellation, note focus,
  Backspace, newline, multi-select toggles, printable input, and feedback
  dismissal.
- Bracketed paste works in the note editor and terminal control sequences are
  removed before quiz content is rendered.
- Pi now defaults this project to OpenAI Codex with model `gpt-5.5` instead of
  selecting whichever authenticated provider appears first.
- Setup and doctor now distinguish local readiness from untested host
  authentication and live terminal acceptance.
- Runtime diagnostics now distinguish the Node 20 engine/Codex path from Pi
  0.84's Node 22.19 minimum.

### Verification boundary

- Deterministic engine, migration, host adapter, interactive-flow, render,
  safety, Pi 0.84 input-contract, and release checks are locally testable.
- This is a release candidate, not a tagged stable release. Independent human
  acceptance of the native Pi quiz and fresh learning artifacts remains a
  separate release gate, and hosted GitHub Actions is separately blocked by
  account billing rather than a reported code failure.

## 0.2.0-rc.1 — 2026-08-25

### Added

- Pi's interactive multiple-choice surface with **I don't know** and an
  optional learner note in the same modal.
- The matching persisted numbered-card fallback for Codex.
- Adaptive parent-question and branch-reason provenance.
- A schema-versioned cross-session learner profile for the learner's teaching
  philosophy and explanation, feedback, visual, and source preferences.
- `/learn-profile`, `profile`, and atomic `set-profile` surfaces shared by Pi,
  Codex, canonical state, and Obsidian's generated `Profile.md`.
- A timestamped source-backed parity contract for the complete reference-video
  workflow.

### Fixed

- Pi quiz Up/Down navigation uses Pi's injected keybindings, including modern
  terminal keyboard-protocol sequences and user-configured bindings.

### Changed

- Canonical state is schema version 4; versions 1, 2, and 3 migrate
  deterministically with a backup of the original state.
- New targets now begin with a persisted multiple-choice probe, while later
  recognition evidence must advance to a new durable transfer checkpoint.
- Context exposes the learner profile before calibration, research, planning,
  teaching, and review.

### Verification boundary

- Deterministic engine, migration, host adapter, interactive-flow, render,
  safety, and release checks are locally testable.
- This is a release candidate, not a tagged stable release. Independent human
  acceptance of the fresh Codex and Pi learning artifacts remains a separate
  release gate, and hosted GitHub Actions is separately blocked by account
  billing rather than a reported code failure.
