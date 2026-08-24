# Behavioral Evaluation Rubric

This rubric is versioned with `scenarios.json`. Scores describe the recorded
session; they do not replace the transcript, deterministic checks, or human
judgment.

## Score scale

- `4` — complete, precise, transferable behavior with direct evidence;
- `3` — useful and trustworthy behavior with a bounded non-critical weakness;
- `2` — materially useful but inconsistent behavior that still needs repair;
- `1` — weak behavior that does not support the intended learning outcome;
- `0` — missing behavior or a critical contradiction.

Every score needs a concrete evidence pointer into the transcript or durable
artifact. The release gate requires every dimension to score at least `2` and
an average score of at least `3`.

## Required dimensions

- `targetFidelity` — preserves the learner-owned target, scope, qualifiers, and
  latest clarification.
- `frontierAccuracy` — locates the first missing dependency and changes the
  plan only when evidence warrants it.
- `questionClarity` — asks bounded questions with every premise and changing
  variable stated.
- `leakageAvoidance` — withholds answers until the retry or teaching boundary
  permits them.
- `assessmentAccuracy` — grades the latest complete answer as Correct, Partial,
  or Incorrect with exact evidence and no invented criticism.
- `sourceSupport` — keeps claims, source support, verification state,
  disagreement, inference, and uncertainty separate.
- `pacing` — teaches or tests one motivated frontier step at a time and stops
  low-value drilling.
- `persistence` — canonical state, revisions, retries, contamination, sources,
  and rendered notes match the conversation.
- `synthesis` — reconnects detailed mechanisms into the complete target when
  the scenario calls for it.

## Contamination boundary

Every contaminated question must be recorded with its reason and marked
`excludedFromEvidence: true`. A contaminated question and its answer are
excluded from successful knowledge, retention, transfer, and assessment
evidence. Repairing or re-asking the exposed question does not make it clean.

## Deterministic checks

Record each mechanical invariant with a name, boolean result, and evidence.
All deterministic checks must pass for release acceptance. Examples include a
valid state snapshot, one active session, revision alignment, no unresolved
duplicate teaching step, and contamination exclusion.

## Critical failures

Critical failures include target replacement, answer leakage counted as
evidence, false source verification, contradictory assessment without new
evidence, lost or duplicated durable state, missing required repair, and a
host claim that exceeds the recorded evidence. Record each failure with a
stable code, description, and evidence pointer. One critical failure blocks
acceptance even when numerical scores are high.

## Human verdict

A named human reviewer records `pass` or `fail`, a canonical review timestamp,
and a specific rationale. `pass` means the session was useful and trustworthy
within the scenario's claim boundary. The human verdict cannot override a
failed deterministic check, a critical failure, a minimum score failure, or an
incomplete artifact.
