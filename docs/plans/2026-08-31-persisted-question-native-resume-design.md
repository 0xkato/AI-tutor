# Persisted Question Native Resume Design

## Problem

Pi persists a learning question before presenting it, but a later Pi process can
only read the learner-visible form of that pending question. The answer key and
explanation are intentionally redacted. The existing interactive tools are
creation-shaped: they require the model to supply the full definition again and
call `start-question`. A relaunched model therefore has to invent redacted fields,
the definition digest changes, and the engine correctly raises
`DUPLICATE_QUESTION`. The agent then degraded to a plain-text question, which is
not an acceptable Pi interaction.

The affected question and the plain-text fallback are contaminated interaction
work. The restart point remains the same persisted first calibration question.

## Reference pattern

`amosblomqvist/learn` keeps one quiz interaction under the quiz extension's
control: the extension presents the choices, collects the response, and returns
the result. AI-tutor adds durable cross-process state, so it cannot copy that
stateless lifecycle directly. It should preserve the same ownership principle:
the native extension, not the model's prose, owns presentation of an existing
interactive question.

## Chosen architecture

1. Canonical state remains the authority for pending question identity and
   grading.
2. Add `adaptive_learning_resume_question`, which accepts only a persisted
   question ID. It reads the redacted pending question, verifies that it is the
   requested unresolved item, and opens the correct native Pi controller.
3. Make the create tools preflight `pending-question`. If the pending item has
   the exact same visible definition, delegate to the same resume path and
   ignore newly supplied hidden grading fields. If the visible definition
   differs, fail closed without opening a different question.
4. Render feedback from the state returned by submission, so a resumed question
   does not need its redacted explanation before the learner answers.
5. In Pi, prohibit a manual numbered or free-text fallback after an interactive
   tool error. The Codex numbered-card path remains Codex-only.

## Rejected alternatives

- Accept a changed answer-key digest: this would weaken grading identity.
- Return answer keys in `context` or `pending-question`: this would leak the
  answer before the learner responds.
- Rely only on prompt wording: that leaves the runtime unable to recover when
  the model calls the create-shaped tool after relaunch.

## Acceptance

- A persisted `awaiting-answer` multiple-choice item opens the native selectable
  Pi UI after relaunch without another `start-question` mutation.
- The native selectable menu is the sole answer-choice surface: tool-call and
  transcript rendering do not enumerate choices before the menu opens.
- The stored answer key, not regenerated tool arguments, grades the response.
- A visibly different pending question is rejected before UI presentation.
- A Pi UI/tool failure produces an explicit stop, never a manual quiz prompt.
- New-question creation, free-response, cancellation, retry, and full release
  checks remain green.

## Checkpoint-first extension

The first implementation still left one invalid intermediate state: after
`record-step`, the durable teaching checkpoint could be `awaiting-answer` while
no interactive question existed. A model could reasonably call the resume tool
and receive `QUESTION_NOT_RESUMABLE`.

The resume tool now owns that transition for free-response teaching
checkpoints. It first reopens an existing pending question. If none exists, it
loads the active step and checkpoint from canonical context, materializes the
exact matching interactive question with durable activity metadata and adaptive
parentage, then opens the native response controller. The end-to-end acceptance
test begins from a real `record-step` and asserts that the native Pi controller
opens, preventing a test double from hiding this boundary again.
