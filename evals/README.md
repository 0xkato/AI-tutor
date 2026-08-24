# Behavioral Evaluation Suite

The suite tests whether a live Codex or Pi session behaves like the adaptive
learning design, not merely whether the local state engine runs. The scenario
catalog and rubric are fixed before a live run begins.

## Run procedure

1. Choose one scenario from `scenarios.json` and record its exact version.
2. Use a fresh learning root unless the scenario explicitly requires prior
   durable evidence.
3. Preserve the complete host/learner transcript without rewriting mistakes.
4. Copy the final canonical state, the source ledger used in the conversation,
   and the relevant generated learning note into one artifact directory.
5. Record byte counts and SHA-256 hashes for those four evidence files in
   `artifact.json`.
6. Score all nine rubric dimensions with evidence pointers, record every
   deterministic check, and mark every contaminated question as excluded.
7. Have a human reviewer record the final verdict. The host model cannot grade
   its own run as the human verdict.
8. Validate the artifact:

   `node scripts/validate-eval-artifact.mjs artifacts/evals/<run>`

Use `--allow-failed` only to confirm that a failed run is structurally complete
before preserving it. It does not turn the run into accepted release evidence.

## Artifact contract

Each run directory contains:

- `artifact.json` — scenario, host, timestamps, file identities, scores,
  deterministic checks, contamination, critical failures, and human verdict;
- `transcript.md` — the complete conversation;
- `state.json` — the canonical schema-valid state snapshot;
- `source-ledger.json` — `{ "formatVersion": 1, "sources": [...] }`;
- `rendered-note.md` — the generated note used for human inspection.

Evidence files must be regular files inside the artifact directory and must
match the recorded size and SHA-256. Keep failed artifacts; never overwrite
them with a rerun. Evaluation fixtures should use non-sensitive learning data.
Do not commit private learner material or credentials.

## Acceptance boundary

An artifact is accepted only when it is structurally complete, every
deterministic check passes, every dimension meets the minimum score, the
average meets the suite threshold, there are no critical failures, all
contaminated questions are excluded from evidence, and the human verdict is
`pass`. Harness and unit-test results do not substitute for live Codex and Pi
artifacts.
