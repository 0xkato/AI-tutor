# Verification Record

Date: 2026-08-24

## Current release-grade audit

Status: **not release-ready**

The hardened implementation has moved materially beyond the version-1
prototype described below, but the release decision is still negative. The
current evidence is reconciled in
[`docs/release/first-local-release.md`](release/first-local-release.md), and the
live-host evidence is recorded in
[`docs/verification/live-host-acceptance.md`](verification/live-host-acceptance.md).

Current local evidence includes:

- 146 automated tests and the repository release-check path;
- complete release checks on official Node `v20.20.2` and `v22.23.2` macOS
  arm64 runtimes, including 146 of 146 automated tests, 7 of 7 end-to-end
  fixtures, fresh-path setup, syntax and JSON checks, and a healthy fresh-path
  `doctor` result under each runtime;
- destructive coverage for migration, corrupt and future state, backup and
  restore-check, stale locks, renderer recovery, render-target safety, setup,
  CLI lifecycle, review lifecycle, pre-initialization vault validation, and
  symlink-swap races during export and live-evidence capture;
- an actual `EACCES` renderer failure in which canonical revision 1 committed,
  `repair-render` returned revision 1 without changing canonical state bytes,
  and `doctor` reported a current projection afterward;
- five complete live-host evidence packages: three preserved historical
  packages and two fresh byte-exact Codex/Pi candidates that validate
  structurally with no critical failures but still have pending human verdicts.

Those facts do not satisfy the release definition of done. The Codex artifact
and Pi-to-OpenAI-Codex artifact now preserve their original final state bytes,
pass every deterministic check, and contain no critical failures. They remain
pending because neither has an independent human `pass` verdict. The two older
local Pi behavioral artifacts retain their critical failures as regression
evidence. The supported Node 20/22 matrix is verified locally on macOS arm64.
The uncached GitHub Actions workflow is present and contract-tested, but this
repository has no GitHub remote, so it has not run in hosted CI. Accepted human
verdicts, changelog/version discipline, clean release commit, and release tag
are still unproved or absent.

No production-ready, Pi-support, cross-host, or tagged-release claim is made.

## Archived version-1 prototype verification

Everything below this heading is the historical verification snapshot for the
initial version-1 prototype. It is preserved as baseline evidence and must not
be read as the current release status. The 49 passing tests reproduced that
prototype's deterministic contract; they did not establish release readiness.
The audited prototype gaps are recorded in
[`docs/baseline/2026-08-24-prototype-verification.md`](baseline/2026-08-24-prototype-verification.md).

### Historical verified result

The deterministic adaptive-learning engine, shared Codex/Pi skill contract,
Pi command adapter, persistence layer, retention scheduler, and Obsidian
renderer pass the repository's automated and manual checks.

### Historical environment

- Node.js: `v26.0.0`
- Repository: `/Users/0xkato/Desktop/Hobby/adaptive-learning-agent`
- Runtime dependencies: none

### Historical automated evidence

`npm test` completed with:

- 49 tests;
- 49 passed;
- 0 failed, skipped, cancelled, or pending.

The suite covers:

- exact `Correct` / `Partial` / `Incorrect` assessment semantics;
- evidence requirements, bounded retry, answer-teaching boundary,
  clarification, and contamination exclusion;
- lifecycle and invalid-transition behavior;
- DAG validation, stable prerequisite ordering, frontier selection, and Mermaid;
- source provenance and verification fields;
- one unresolved teaching step at a time;
- spaced-retention progression, regression, due ordering, and related-node
  synthesis triggers;
- atomic state replacement and concurrent read-modify-write serialization
  across two Node processes;
- independent CLI invocations, restart behavior, failure preservation, and a
  complete target-to-review end-to-end session;
- Obsidian home, session, topic, review, source, assessment, visual, synthesis,
  and gap rendering;
- shared-skill discovery and complete protocol contract;
- Pi command registration, start/resume/refusal behavior, safe argument
  handling, and a real adapter-to-CLI round trip.

Additional checks completed successfully:

- every `.mjs` and `.js` file passed `node --check`;
- `package.json`, `.pi/settings.json`, and the checked-in example plan parsed as
  JSON;
- the Agent Skill passed the official local `quick_validate.py` validator;
- a repository-wide text scan reported no trailing whitespace.

### Historical manual lifecycle evidence

A fresh temporary root was driven through initialization, target capture,
probe, probe conclusion, verified source, dependency plan, teaching, transfer
assessment, closeout, and next-day due review.

The resulting state had no active session after close, and its due queue
contained the successfully assessed `covectors` node at review level 1. The
generated session note contained the learner target and context, probe
conclusion, source ledger, Mermaid graph, motivated teaching step, exact
assessment evidence, review schedule, synthesis, and unresolved gap.

Temporary inspection root:
`/private/tmp/adaptive-learning-verification.F0dRZY`

### Historical Pi compatibility check

Pi was inspected from terminal-only source at commit
`a470b121bf683b4c2b9fc0b3a7c807de7e0cfe9c`.

That source confirms:

- project skills are discovered from `.agents/skills/`;
- `enableSkillCommands` exposes `/skill:name` commands and defaults to enabled;
- project extensions are discovered from `.pi/extensions/`;
- the extension loader accepts direct `.js` files as well as `.ts` files;
- `pi.registerCommand()` and `pi.sendUserMessage()` are current extension APIs.

Pi itself is not installed on this machine. Therefore the evidence proves
source-level compatibility, command behavior against a faithful extension API
harness, and a real adapter-to-engine process round trip. It does not claim a
live interactive Pi process was launched.

### Historical acceptance audit

| Requirement | Evidence | Status |
| --- | --- | --- |
| Learner-owned target and context | Lifecycle, CLI, Pi, and Obsidian tests | Verified |
| Broad-to-narrow adaptive probing | Shared teaching protocol plus durable probe records | Structurally verified; host-model quality remains behavioral |
| Verified dependency route | DAG validation, frontier, Mermaid, and E2E tests | Verified |
| Agent-led research with visible source discussion | Research protocol and required provenance fields | Structurally verified; source truth remains evidence-dependent |
| One motivated reasoning step at a time | Active-step invariant and skill contract | Verified |
| Exact feedback, retry, clarification, and contamination rules | Assessment and session-action tests | Verified |
| Spaced retention and whole-system synthesis | Deterministic scheduler tests and manual due queue | Verified |
| Useful inspected visuals embedded in the vault | Path/metadata checks, skill protocol, renderer, and E2E test | Structurally verified; visual inspection is performed by the host agent |
| Durable Obsidian learning artifact | Renderer, CLI restart, E2E, and manual inspection | Verified |
| Codex and Pi support | Shared Agent Skill, Codex `AGENTS.md`, Pi adapter tests, pinned Pi source | Verified within the boundaries above |

### Historical claim boundary

These checks establish that the implementation preserves and enforces the
defined workflow. They do not establish that every host model will choose good
questions, teach clearly, find true sources, inspect a visual correctly, or
that a learner has mastered a topic. Those outcomes require the recorded
conversation evidence and, where applicable, external source verification.

Live behavioral evaluation with an independent model/subagent was not run
because this build was completed without delegated agents. The executable
contract tests are the available behavior-level safeguard for this build.
