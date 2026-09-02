# Adaptive Learning Continuation-Safety Implementation Plan

1. Add failing state-machine tests for contaminated teaching and synthesis recovery.
2. Transition contaminated checkpoints to `new-transfer-required` without recording learner evidence, then prove a fresh checkpoint can replace each one.
3. Add a failing atomicity test for free-response `I don't know`; make `submit-question --dont-know` perform the response and admitted-gap transition in one state update.
4. Add failing Pi tests showing Escape must leave questions awaiting input; remove automatic `cancel-question` mutations from native UI dismissal paths.
5. Add failing command tests for awaiting-assessment, checkpoint-only teaching, active review, active-learning review conflicts, and source-guided continuation.
6. Implement one continuation classifier shared by `/teach`, `/teach-from`, and `/learn-review`.
7. Update operator and skill contracts to describe pause, exact resume, assessment continuation, and review continuation.
8. Run focused tests, the full release check, `git diff --check`, and the restart-at-every-checkpoint matrix.

## Verified continuation matrix

| Durable point | Required continuation | Verification |
| --- | --- | --- |
| Question persisted, native UI closed | Leave `awaiting-answer`; reopen exact question | Pi quiz and free-response pause tests |
| Question in `retry-required` | Reopen exact stored definition | Pi resume and retry acceptance tests |
| Free response in `awaiting-assessment` | Assess exact stored response | `/teach` and `/teach-from` routing tests |
| Free-response teaching checkpoint before question creation | Engine materializes exact checkpoint | Live-state-copy materialization plus acceptance test |
| Multiple-choice teaching checkpoint before question creation | Engine materializes private stored choices and key | Selectable checkpoint acceptance test |
| Free-response `I don't know` | Atomically persist response and admitted-gap transition | CLI revision and Pi command-sequence tests |
| Contaminated teaching checkpoint | Move to `new-transfer-required`; permit replacement | Protocol invariant test |
| Contaminated synthesis checkpoint | Move to `new-transfer-required`; permit replacement | Synthesis lifecycle test |
| Review already claimed | Resume active checkpoint; never query only due work | `/learn-review` continuation tests |
| Active learning session plus due reviews | Refuse impossible overlapping review start | `/learn-review` conflict test |
| Active review synthesis | Resume synthesis before review-item work | Review synthesis routing test |
| Legacy cancelled checkpoint | Reopen exact stored cancelled definition | Question materialization test |

Final verification on 2026-09-01: `scripts/release-check.mjs` passed with 289
main tests, 9 Pi host-input tests, and 10 end-to-end learning/review fixtures;
`git diff --check` passed. A copy of the live transformer state successfully
materialized `transformers-teach-token-representations-1` without mutating the
learner's canonical state.
