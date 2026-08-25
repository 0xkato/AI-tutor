# Changelog

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
