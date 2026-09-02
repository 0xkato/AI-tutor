# Adaptive Learning Continuation-Safety Design

## Goal

Every durable learning state must have one deterministic next action after a pause, reload, cancelled UI surface, or interrupted host turn. A learner must never need manual state edits or have to recreate a checkpoint that the product already persisted.

## Failure model

The continuation surface spans three layers:

1. the durable session and question state machine;
2. the Pi extension that opens or resumes native checkpoints;
3. slash commands that tell the agent the exact legal next action.

A path is broken when durable state is valid but the public command routes to an illegal mutation, cannot reopen the active checkpoint, or leaves a checkpoint in a state no legal command can replace.

## Required invariants

- Closing a native question pauses presentation; it does not discard the persisted awaiting-answer state.
- A free-response `I don't know` response and its admitted-gap control transition commit atomically.
- Contaminated teaching and synthesis questions never count as evidence and always transition to a fresh-transfer state that can be replaced.
- An awaiting-assessment free response routes to explicit assessment of the exact stored response.
- An active review session resumes from its claimed checkpoint instead of querying only unclaimed due reviews.
- `/teach` and `/teach-from` use the same deterministic continuation classifier.
- The model is never asked to infer create-versus-resume from internal storage details.

## Continuation classifier

Given durable status and context, choose the first matching action:

1. awaiting-assessment question: assess the exact persisted response;
2. awaiting-answer or retry-required question: reopen that exact question;
3. teaching checkpoint awaiting-answer without a question record: call the resume tool, which materializes and opens it;
4. teaching checkpoint new-transfer-required: create the required replacement step and checkpoint;
5. active review checkpoint or synthesis checkpoint: resume that exact review lifecycle;
6. source material still unresolved: inspect/resolve material;
7. otherwise resume the current durable phase.

## Verification boundary

Focused unit tests prove each transition. Acceptance tests cover native pause/reopen and checkpoint materialization. The release check plus a restart-at-every-checkpoint matrix is required before claiming the workflow is fluid. Review/synthesis answers that exist only in chat before their assessment mutation remain a separate crash-window unless they receive their own persisted response records.
