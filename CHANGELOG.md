# Changelog

## Unreleased

### Added

- Free-response explanation, prediction, transfer, contrastive, reconstruction,
  and debugging checkpoints in Pi, with exact learner wording, confidence,
  response timing, rationale, and notes persisted before a separate assessment.
- Mastery evidence tracked independently across recognition, explanation,
  application, and transfer instead of reducing learning to one quiz score.
- Durable misconceptions with occurrence, relapse, counterexample, repair, and
  resolution history that can drive later contrastive practice.
- Evidence-driven worked examples whose support fades one level at a time once
  the learner succeeds, followed by independent transfer.
- Contrastive cases that distinguish a learner's active misconception from the
  correct mechanism using a minimally different example.
- Interleaved practice plans across due topics, with no consecutive same-topic
  items when another due topic is available.
- A transfer ladder that records how far a concept has generalized and advances
  only after supported and independent evidence.
- Confidence calibration and response-time evidence used to distinguish
  uncertain success, calibrated understanding, and confidently wrong answers.
- Learner-specific forgetting schedules based on each concept's observed
  stability, difficulty, lapses, support, confidence, and response time.
- Bounded productive-failure attempts when prerequisites have durable evidence;
  these attempts are recorded as diagnostic evidence and never graded as
  mastery.

### Fixed

- Evidence-backed fading, contrastive, and transfer activities may reinforce a
  demonstrated concept after it leaves the dependency frontier, while all
  other off-frontier teaching remains rejected.
- Pi's free-response transfer path now has deterministic end-to-end acceptance
  coverage through persistence, assessment, and Obsidian rendering.

### Verification boundary

- Deterministic model, CLI, Pi adapter, complete adaptive-session, persistence,
  migration, rendering, and release checks are locally testable.
- Native human interaction in a real Pi terminal and the educational quality of
  generated questions remain separate acceptance gates; this section does not
  declare a stable release.

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
