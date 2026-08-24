# Live Host Acceptance Record

Date: 2026-08-24

Status: **not release-accepted**

This record separates structurally valid evidence from behavioral release
acceptance. A complete evidence package can preserve a successful, failed, or
pending run. Only a package that satisfies every deterministic gate and receives
an independent human `pass` verdict counts toward release acceptance.

## Codex

The live Codex session completed the `context-resume` scenario successfully at
the conversational level. It preserved the learner's target, resumed with the
exact persisted question, avoided answer leakage, recorded four assessments,
and reached a whole-system synthesis.

Evidence:

- `artifacts/evals/2026-08-24-codex-context-resume/`
- Codex thread: `01a0347e-8674-7b00-9a59-9cc98185a127`
- learning session: `1fc8b737-a2f6-4aef-a2d1-03641b86f1dd`

This run is not release-accepted. A later failed Pi review mutated the original
root before the revision-22 state bytes were copied. The packaged state reverses
only the isolated review mutations and was cross-checked against an independent
revision-22 replay, but that reconstruction is not byte-exact preservation of
the original final live snapshot. The corresponding deterministic check is
therefore `false`, and the human verdict remains `pending`.

## Pi

Two live local Pi sessions using `ollama/gpt-oss:20b` were preserved as failed
evidence:

- `artifacts/evals/2026-08-24-pi-gptoss-answer-leakage/` records first-miss
  answer leakage, a persistence mismatch, and an incomplete review.
- `artifacts/evals/2026-08-24-pi-gptoss-target-drift/` records replacement of
  the selected concept, first-miss answer leakage, and an incomplete review.

These packages are useful regression records. They do not support Pi release
acceptance.

The preserved failures were traced against the shared host contract before a
rerun. The deterministic engine correctly rejected mismatched checkpoint
identity and incomplete review state, but semantic question-to-concept alignment
and conversational ordering remain host responsibilities. The shared skill now
requires three explicit preconditions for the rerun:

- a retention question must require the selected concept's causal mechanism,
  not merely share its broad topic;
- `record-assessment` must succeed before assessment feedback is shown;
- first-miss feedback must omit the correct outcome, expected mechanism,
  correct value, corrective steps, and replacement answer wording.

The skill-contract regression and complete local release check pass with these
rules. That is repair evidence, not live-host acceptance; only a fresh Pi run
can show whether the host follows them.

A separate cloud Pi smoke session proved that the Pi runtime could invoke an
OpenAI Codex-subscription model and execute a real tool call. The session is
stored at:

`/private/tmp/adaptive-pi-openai-session.Q8O4YR/2026-08-24T17-15-28-185Z_01a034c5-1c38-7fc5-a279-8bd59e0c0420.jsonl`

That smoke test proves model/runtime/tool connectivity only. It does not prove
the adaptive-learning behavior.

The cloud Pi behavioral run has not been performed because it would transmit
the project skill/protocol and a synthetic acceptance learning state/transcript
to OpenAI. That requires the founder's explicit approval. No Pi support or
cross-host release-readiness claim may be made until a fresh behavioral run is
packaged, independently reviewed, and accepted.

## Remaining acceptance work

1. Run a fresh Codex scenario while preserving the final live state bytes before
   any later mutation.
2. Obtain explicit data-egress approval, then run the cloud Pi behavioral
   scenario on a fresh disposable root.
3. Package each run with hashes, canonical state, transcript, source ledger,
   rendered note, deterministic checks, contamination records, and claim
   boundaries.
4. Have the founder independently review each package and replace `pending`
   with a justified `pass` or `fail` verdict.
5. Validate accepted packages without `--allow-failed` before making release
   claims.
