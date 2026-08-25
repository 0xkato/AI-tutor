# Live Host Acceptance Record

Date: 2026-08-25

Status: **not release-accepted**

This record separates mechanically valid evidence from behavioral release
acceptance. A complete package may preserve a successful, failed, or pending
run. Only a package that satisfies every deterministic gate and receives an
independent human `pass` verdict counts toward release acceptance.

## Fresh Codex candidate

The fresh Codex `novice-branches` session used an unfamiliar browser-to-server
target, diagnosed multiple prerequisite branches, researched narrow primary
source claims, built the dependency route, persisted each checkpoint before
answering, survived an interruption, resumed with the byte-identical pending
question, and closed after a clean whole-system synthesis.

Evidence:

- `artifacts/evals/2026-08-24-codex-novice-branches-byte-exact/`
- Codex thread: `01a03560-bc29-7981-ae46-37067d4b7f8e`
- learning session: `e89f7607-ce37-41c5-aca2-b351d5dadd43`
- byte-exact final state SHA-256:
  `c4c33551d13e3fa0d762e226c730926878629e5599b87a8127700dfed8f14a8f`

The package validates structurally with every deterministic check passing, no
contaminated questions, and no critical failures. Its nine rubric dimensions
average `3.888888888888889` out of `4`; pacing is `3` and every other dimension
is `4`. Its human verdict remains `pending`, so it is not release-accepted.

The earlier `artifacts/evals/2026-08-24-codex-context-resume/` package remains
preserved as historical evidence. Its reconstructed final state is not used as
the fresh release candidate.

## Fresh Pi-to-OpenAI-Codex candidate

**Scope correction:** this candidate exercised Pi's model/tool path and the
durable review, retry, repair, transfer, and closure lifecycle. It did not open
or operate the native `adaptive_learning_quiz` multiple-choice modal. It is
therefore evidence for the Pi adapter and learning-state lifecycle, not evidence
that the modal's keyboard controls work in a learner's terminal. Earlier
wording that treated this artifact as general live Pi UI evidence was too broad.

After the founder approved sending the adaptive-learning skill/protocol and
synthetic acceptance state/transcript to OpenAI Codex through Pi, a live Pi
session used `@earendil-works/pi-coding-agent@0.84.2` with provider
`openai-codex` and model `gpt-5.6-luna`. It opened the same canonical learning
root, claimed the due durability-versus-visibility review, persisted the exact
question before showing it, handled two misses under the same durable identity,
withheld the answer after the first miss, taught the missing mechanism only
after the second miss, persisted a new warehouse transfer before asking it,
recorded the clean transfer, and durably closed before showing closure.

Evidence:

- `artifacts/evals/2026-08-25-pi-retry-repair-transfer-openai-byte-exact/`
- Pi session: `01a03586-9e68-76f3-8e3b-592d5a5eb813`
- learning review session: `55ad5c9b-e338-49ac-a32b-d17959d50ef5`
- review: `c8e22cfe-76ff-43f6-b934-8a567f1c1077`
- byte-exact final state SHA-256:
  `ceae680e1ed1cd62975ef605336476f2f0e350536cd1d7c389555af2c4b54bd2`

The package validates structurally with every deterministic check passing, no
contaminated questions, and no critical failures. Its nine rubric dimensions
average `3.888888888888889` out of `4`; persistence is `3` because an initial
non-monotonic timestamp mutation was rejected and safely retried before the
question, while every other dimension is `4`. Its human verdict remains
`pending`, so it is not release-accepted.

The two earlier live local `ollama/gpt-oss:20b` packages remain preserved as
failed regression evidence:

- `artifacts/evals/2026-08-24-pi-gptoss-answer-leakage/` records first-miss
  answer leakage, a persistence mismatch, and an incomplete review.
- `artifacts/evals/2026-08-24-pi-gptoss-target-drift/` records replacement of
  the selected concept, first-miss answer leakage, and an incomplete review.

Those historical failures are not the fresh Pi release candidate.

## Scoped approval rule

Before requesting approval for external transmission, the agent must name the
exact payload, destination, purpose, and material exclusions. Once that scoped
request is stated, a direct explicit approval such as `I approve`, `yes`, or
`go ahead` authorizes exactly that action. The agent must not ask for the same
approval again merely because the response is short or does not repeat the
payload and destination. New approval is required only when the payload,
destination, purpose, or scope materially changes.

For this run, the approved scope was the adaptive-learning skill/protocol and
synthetic acceptance state/transcript sent to OpenAI Codex through Pi. No
second approval was required.

## Remaining acceptance work

1. Restart Pi and complete a native quiz acceptance pass covering arrow
   navigation, Enter submission, Tab note focus, printable note input,
   Backspace, Ctrl+J newline, Escape cancellation, and feedback dismissal;
   confirm that the persisted response count advances exactly once.
2. Have the founder independently review the fresh Codex and Pi packages and
   replace each `pending` verdict with a justified `pass` or `fail`.
3. Validate both accepted packages without `--allow-failed`.
4. Resolve the GitHub account billing/spending-limit block and rerun the
   committed macOS Node 20/22 matrix. Workflow run
   [`32833414368`](https://github.com/0xkato/AI-tutor/actions/runs/32833414368)
   created zero-step jobs for release-candidate commit `c827024`; both were
   rejected before any workflow step, so they are not code evidence.
5. Version `0.2.0-rc.2` and its changelog are present. Create an annotated
   stable tag only after the human verdicts and hosted matrix pass.
