# Learning Engine Upgrade Design

## Purpose

AI Tutor must improve learning, not merely store a transcript. The upgraded
engine will turn each learner response into evidence about a specific ability,
preserve durable misconceptions, choose the next useful learning activity, and
schedule later retrieval from the learner's own performance.

The approved scope contains ten connected capabilities:

1. first-class free-response reasoning;
2. multidimensional mastery;
3. persistent misconception modelling;
4. adaptive worked-example fading;
5. contrastive cases and incorrect examples;
6. interleaved cumulative practice;
7. a measured transfer ladder;
8. confidence calibration;
9. learner-specific forgetting and review timing;
10. conditional productive failure.

## Architecture

Canonical state remains `.adaptive-learning/state.json`; Obsidian remains a
derived inspection surface. Schema version 6 adds the learning signals needed
to make decisions without replacing existing evidence or review records.

`src/learning-strategy.mjs` becomes the decision layer. It maps assessment
kinds to mastery dimensions, updates dimension-specific evidence, maintains
misconception lifecycles, recommends the next activity, and constructs an
interleaved practice queue. Existing model, question, assessment, and review
modules remain responsible for phase and identity invariants.

The recommendation is advisory but deterministic. The host must persist the
recommended activity metadata on the question or teaching step, so later
evidence can show whether the strategy was actually followed. The engine never
calls a low score "mastery," treats source coverage as learner evidence, or
uses confidence instead of correctness.

## Evidence model

Each concept records eight independent dimensions: recall, explanation,
prediction, application, discrimination, debugging, integration, and delayed
retention. A dimension stores its level, supporting evidence IDs, attempts,
and latest check. Concept status remains a compact summary for compatibility;
the dimension matrix is authoritative for selecting the next activity.

Every assessment may also store confidence (0-100), response time, transfer
level (0-4), support level (0-4), activity type, and misconception references.
Missing optional metrics preserve existing behavior. Correct evidence raises
only the matching dimension. Partial or incorrect evidence can create or
relapse a durable misconception; a later clean transfer can explicitly resolve
it.

## Activity selection

The selector returns one next activity with a reason and guard evidence:

- admitted foundations are taught before testing;
- active misconceptions favor a contrastive or debugging task;
- low support-readiness uses a worked example;
- successful work fades one support level at a time;
- transfer advances from changed values, to new context, to structural
  discrimination, composition, and realistic use;
- productive failure is allowed only when every prerequisite has usable
  evidence and the target is not an admitted gap;
- due concepts are interleaved with confusable or related concepts instead of
  repeated in isolated blocks;
- integration is periodically tested with whole-system synthesis.

The engine records productive-failure attempts as attempts, not grades. They
become useful only when a later explanation contrasts the attempt with the
mechanism.

## Interaction surfaces

Selectable Pi quizzes continue to support single and multi-select questions.
They now optionally collect confidence. A new free-response Pi tool displays a
persisted prompt, accepts the learner's own words and optional note/confidence,
and persists the response before returning it to the host for assessment. A
second assessment tool records the host's Correct/Partial/Incorrect judgment
and misconception updates.

Codex uses the same canonical lifecycle through new CLI flags and the existing
numbered fallback. `recommend-next` exposes the selector; `practice-plan`
exposes the interleaved queue. Neither command mutates learning evidence.

## Review scheduling

The familiar 1, 3, 7, 14, 30, and 60 day intervals remain the neutral starting
prior. Each review then adjusts stability and difficulty from correctness,
attempt count, confidence calibration, response time, lapses, and evidence
quality. Missing metrics produce the old interval exactly. High-confidence
errors shorten future intervals; fast, confident, correct durable retrieval
can lengthen them. The complete scheduling history remains inspectable.

## Failure and compatibility behavior

- Version 5 state migrates additively to version 6 with neutral defaults.
- A free response cannot be graded before its exact question and answer are
  persisted.
- Recognition-only evidence cannot satisfy durable transfer or retention.
- Productive failure is rejected when prerequisites are not demonstrated.
- Confidence never changes correctness, and a high-confidence error is never
  softened.
- Invalid or contaminated evidence does not update mastery, misconceptions, or
  review timing.
- Existing commands and state without optional learning signals continue to
  work.

## Verification

Tests cover every state transition, migration, CLI flag, Pi interaction, and
rendered record. The release gate must pass from a fresh worktree. A scripted
end-to-end fixture must demonstrate: multiple choice, free response,
confidence, misconception creation and repair, worked-example fading,
contrastive transfer, interleaved review selection, personalized scheduling,
and guarded productive failure.
