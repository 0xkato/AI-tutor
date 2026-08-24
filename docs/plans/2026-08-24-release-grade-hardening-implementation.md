# Release-Grade Local Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the existing adaptive-learning prototype into a dependable local macOS release whose cross-session learning, retention, recovery, rendering, Codex/Pi integrations, and behavioral quality are verified end to end.

**Architecture:** Keep the existing dependency-free Node.js engine and shared host skill. Move authoritative knowledge and review state from individual sessions into a schema-versioned learner-level concept catalog, make reviews first-class sessions, and add explicit recovery and render-reconciliation surfaces. Preserve JSON as canonical and Obsidian Markdown as a derived view.

**Tech Stack:** Node.js 20/22 ESM, built-in `node:test`, JSON, Markdown/Mermaid, Agent Skills, Pi JavaScript extensions, macOS filesystem semantics, GitHub Actions.

**Design:** `docs/plans/2026-08-24-release-grade-hardening-design.md`

## Execution rules

- Work test-first and keep each commit limited to one task.
- Preserve the current prototype as the migration source; do not rewrite it.
- Never change canonical state without validating both the input state and the
  proposed next state.
- Never call derived Markdown authoritative.
- Do not claim Pi support until a live Pi run is recorded.
- Run the focused test after every red/green step, then run the complete suite
  before committing.
- Do not add hosted services, accounts, telemetry, or cross-platform work.

### Task 1: Preserve the prototype and document the release boundary

**Files:**
- Create: `docs/baseline/2026-08-24-prototype-verification.md`
- Modify: `docs/verification.md`

**Step 1: Record the exact baseline**

Run:

```bash
git status --short --branch
npm test
node --version
```

Record that the repository has 49 passing tests, no prior commit, no live Pi
run, and only harness-level behavioral evidence.

**Step 2: Correct the verification claim boundary**

Add a prominent prototype-status note to `docs/verification.md`. The note must
state that 49 passing tests establish the existing deterministic contract, not
release readiness, and link to the baseline gap record.

**Step 3: Run the unchanged baseline again**

```bash
npm test
git diff --check
```

Expected: 49 tests pass and the new documentation has no whitespace errors.

**Step 4: Commit the preserved prototype and planning boundary**

```bash
git add .agents/skills/adaptive-learning/SKILL.md \
  .agents/skills/adaptive-learning/references/cli-reference.md \
  .agents/skills/adaptive-learning/references/research-protocol.md \
  .agents/skills/adaptive-learning/references/teaching-protocol.md \
  .gitignore .pi/extensions/adaptive-learning.js .pi/settings.json \
  AGENTS.md README.md bin/learn.mjs examples/differential-forms-plan.json \
  package.json src/assessment.mjs src/errors.mjs src/graph.mjs src/model.mjs \
  src/render.mjs src/retention.mjs src/store.mjs \
  test/assessment.test.mjs test/cli-help.test.mjs test/cli-lifecycle.test.mjs \
  test/e2e-learning-session.test.mjs test/fixtures/store-mutate-worker.mjs \
  test/graph.test.mjs test/lifecycle.test.mjs test/pi-extension.test.mjs \
  test/render.test.mjs test/retention.test.mjs test/session-actions.test.mjs \
  test/skill-contract.test.mjs test/store.test.mjs \
  docs/plans/2026-08-24-adaptive-learning-agent-design.md \
  docs/plans/2026-08-24-adaptive-learning-agent-implementation.md \
  docs/plans/2026-08-24-release-grade-hardening-design.md \
  docs/plans/2026-08-24-release-grade-hardening-implementation.md \
  docs/baseline/2026-08-24-prototype-verification.md docs/verification.md
git commit -m "chore: preserve adaptive learning prototype baseline"
```

Expected: one baseline commit containing the current prototype and existing
verification record.

Do not commit known-red tests. Each later task introduces its own failing test,
observes the intended failure, implements the behavior, and commits only after
the focused and complete suites return green.

### Task 2: Add complete state validation and version-1 migration

**Files:**
- Create: `src/schema.mjs`
- Create: `src/migrations.mjs`
- Create: `test/schema.test.mjs`
- Create: `test/migrations.test.mjs`
- Modify: `src/model.mjs`
- Modify: `src/store.mjs`

**Step 1: Write failing schema tests**

Cover missing maps, invalid session phases, malformed evidence references,
invalid review state, duplicate IDs, invalid timestamps, and unsupported
future versions.

```js
test("validateState rejects structurally incomplete version-2 state", () => {
  assert.throws(
    () => validateState({ schemaVersion: 2, sessions: {} }),
    error => error.code === "INVALID_STATE",
  );
});
```

Run:

```bash
node --test test/schema.test.mjs
```

Expected: FAIL because `validateState` does not exist.

**Step 2: Implement strict ISO timestamps and version-2 shape validation**

`src/schema.mjs` must export:

```js
export const SCHEMA_VERSION = 2;
export function parseInstant(value, label) { /* exact ISO instant or LearningError */ }
export function validateState(value) { /* return normalized validated clone */ }
```

Validate the complete state on read and before write, including referential
integrity among sessions, topics, concepts, evidence, and reviews.

**Step 3: Write failing migration tests**

Use a fixed version-1 fixture with one completed session and one scheduled
concept. Assert deterministic IDs, preserved evidence, preserved due time, and
an unchanged source session record.

**Step 4: Implement `migrateV1ToV2`**

Create learner-level maps:

```js
{
  schemaVersion: 2,
  revision: 1,
  activeSessionId: null,
  sessions: {},
  topics: {},
  concepts: {},
  reviews: {},
  settings: {},
  render: { revision: 0, status: "stale", error: null }
}
```

Migration must produce stable IDs from existing session and node IDs without
fuzzy topic merging.

**Step 5: Integrate validation and migration into reads**

On version 1, create a backup first, migrate, validate, then atomically commit.
On malformed version 2, stop with `INVALID_STATE`; do not guess repairs.

**Step 6: Run focused and full tests**

```bash
node --test test/schema.test.mjs test/migrations.test.mjs test/store.test.mjs
npm test
```

Expected: all pass.

**Step 7: Commit**

```bash
git add src/schema.mjs src/migrations.mjs src/model.mjs src/store.mjs test/schema.test.mjs test/migrations.test.mjs
git commit -m "feat: add validated state schema and migration"
```

### Task 3: Move knowledge into a durable concept catalog

**Files:**
- Create: `src/concepts.mjs`
- Create: `test/concepts.test.mjs`
- Modify: `src/model.mjs`
- Modify: `src/assessment.mjs`
- Modify: `src/graph.mjs`
- Modify: `src/render.mjs`

**Step 1: Write failing concept-catalog tests**

Test explicit creation, explicit reuse, evidence append, conflicting topic
names, and two titles that slugify identically.

```js
test("a later session explicitly reuses prior concept evidence", () => {
  const next = startSession(stateWithConcept("gradient"), {
    topic: "Optimization",
    target: "Understand momentum",
    reuseConceptIds: ["gradient"],
  });
  assert.equal(next.sessions[next.activeSessionId].conceptIds.includes("gradient"), true);
  assert.equal(next.concepts.gradient.evidence.length, 1);
});
```

**Step 2: Implement stable learner-level topics and concepts**

Concepts own status, evidence IDs, retry/checkpoint state, and review state.
Sessions store concept references and evidence produced during that session.
Use UUID-backed filenames or a stable short ID suffix; never use a slug alone
as identity.

**Step 3: Make assessment updates target canonical concepts**

Append evidence once, update the durable concept, and store the assessment ID
in the active session. Prevent an assessment from referencing a concept outside
the session's declared concept set.

**Step 4: Render topic history without flattening contradictory statuses**

Topic notes must show the current concept state followed by dated evidence
history. They must not concatenate multiple session statuses as though all are
simultaneously current.

**Step 5: Run tests and commit**

```bash
node --test test/concepts.test.mjs test/assessment.test.mjs test/render.test.mjs
npm test
git add src/concepts.mjs src/model.mjs src/assessment.mjs src/graph.mjs src/render.mjs test/concepts.test.mjs
git commit -m "feat: persist learner concepts across sessions"
```

### Task 4: Implement first-class retention review sessions

**Files:**
- Create: `src/reviews.mjs`
- Create: `test/review-lifecycle.test.mjs`
- Modify: `src/model.mjs`
- Modify: `src/assessment.mjs`
- Modify: `src/retention.mjs`
- Modify: `bin/learn.mjs`
- Modify: `.agents/skills/adaptive-learning/references/cli-reference.md`
- Modify: `.agents/skills/adaptive-learning/SKILL.md`

**Step 1: Write the multi-day failing integration test**

The test must use independent CLI processes:

1. complete and close a learning session;
2. query due reviews on the next day;
3. `start-review --review <id>` with no active learning session;
4. record an incorrect retention assessment;
5. record the permitted repair and new transfer;
6. `close-review`;
7. assert updated learner-level concept evidence and next due date.

Run:

```bash
node --test test/review-lifecycle.test.mjs
```

Expected: FAIL because review sessions and commands do not exist.

**Step 2: Implement explicit review items and review sessions**

`due` returns stable review IDs. `start-review` atomically claims selected due
items into a session with `kind: "review"`. Only selected concepts can be
assessed. `close-review` requires every selected item to be resolved or
explicitly deferred with a reason.

**Step 3: Update synthesis accounting**

Increment completed review counts only after a valid retention assessment.
Trigger synthesis every seventh completed review or when three related due
concepts are selected together. Store the synthesis as evidence, not mastery.

**Step 4: Update the host contract**

The skill must start and close review sessions through the CLI. It must never
pretend that listing a due item completed it.

**Step 5: Run tests and commit**

```bash
node --test test/review-lifecycle.test.mjs test/retention.test.mjs test/cli-lifecycle.test.mjs
npm test
git add src/reviews.mjs src/model.mjs src/assessment.mjs src/retention.mjs bin/learn.mjs .agents/skills/adaptive-learning test/review-lifecycle.test.mjs
git commit -m "feat: make retention reviews executable across sessions"
```

### Task 5: Enforce retry and lifecycle invariants

**Files:**
- Modify: `src/assessment.mjs`
- Modify: `src/model.mjs`
- Create: `test/protocol-invariants.test.mjs`
- Modify: `test/session-actions.test.mjs`

**Step 1: Write failing invariant tests**

Cover:

- unknown assessment stages;
- retention assessment in a learning session;
- probe assessment outside probe;
- unrelated question while retry is required;
- new step while a repair transfer is required;
- partial retry escalation;
- contaminated response not resolving a checkpoint;
- closing from probe or plan;
- closing with unresolved review items;
- a disconnected plan node not leading to the target.

**Step 2: Implement an explicit checkpoint state machine**

Use states such as:

```js
{ status: "awaiting-answer", questionId, attempts: 0 }
{ status: "retry-required", questionId, attempts: 1 }
{ status: "teaching-permitted", questionId, attempts: 2 }
{ status: "new-transfer-required", priorQuestionId }
{ status: "resolved", evidenceId }
```

Reject every transition not listed in the state machine. Do not infer
resolution from grade alone.

**Step 3: Strengthen graph relevance**

Every plan node must be the target or have a directed path to the target.
Reject disconnected surplus nodes with `INVALID_PLAN`.

**Step 4: Run tests and commit**

```bash
node --test test/protocol-invariants.test.mjs test/assessment.test.mjs test/graph.test.mjs
npm test
git add src/assessment.mjs src/model.mjs src/graph.mjs test/protocol-invariants.test.mjs test/session-actions.test.mjs test/graph.test.mjs
git commit -m "feat: enforce learning protocol transitions"
```

### Task 6: Make storage crash-recoverable

**Files:**
- Create: `src/backup.mjs`
- Create: `src/doctor.mjs`
- Modify: `src/store.mjs`
- Create: `test/store-recovery.test.mjs`
- Create: `test/fixtures/kill-while-locked.mjs`

**Step 1: Write failing process-death tests**

Spawn a worker that acquires the lock, records lock metadata, and is killed
before release. Assert a later mutation proves the PID dead, recovers the stale
lock, and preserves valid state. Also assert a live owner's lock is never
stolen.

**Step 2: Implement ownership-bearing locks**

The lock contains `{pid, token, createdAt}`. Release verifies the token before
unlinking. Recovery checks that the owner process is dead and that the lock
contents are valid. A timeout alone never authorizes stealing a live lock.

**Step 3: Use unique temporary files and durable replacement**

Use a per-mutation temp filename containing PID and token. Flush the file
before rename. Clean only the caller's own temporary file.

**Step 4: Implement backup, restore-check, and doctor primitives**

Backups contain validated state plus a manifest and SHA-256. `restore --check`
validates without writing. `doctor` reports canonical state, schema, lock
owner, backups, render revision, permissions, and actionable recovery text.

**Step 5: Run destructive fixtures and commit**

```bash
node --test test/store-recovery.test.mjs test/store.test.mjs
npm test
git add src/store.mjs src/backup.mjs src/doctor.mjs test/store-recovery.test.mjs test/fixtures/kill-while-locked.mjs
git commit -m "feat: add crash recovery and state diagnostics"
```

### Task 7: Make rendering reconcilable and safe

**Files:**
- Create: `src/markdown.mjs`
- Create: `src/render-manifest.mjs`
- Modify: `src/render.mjs`
- Modify: `src/store.mjs`
- Modify: `bin/learn.mjs`
- Create: `test/render-recovery.test.mjs`
- Create: `test/render-safety.test.mjs`

**Step 1: Write failing renderer-failure tests**

Inject a renderer that throws after canonical state commits. Assert the command
reports the committed revision and render failure separately. Then run
`repair-render` and assert the vault and manifest reach that revision without
changing learning evidence.

**Step 2: Implement revisions and a generated-file manifest**

Every successful state mutation increments `revision`. The render manifest
contains `stateRevision`, generated paths, and hashes. Stage generated files,
then atomically replace them. Clean obsolete generated files only when listed
in the prior manifest.

**Step 3: Escape every rendering context**

Provide separate helpers for headings, plain paragraphs, list values,
Markdown links, Obsidian embeds, and Mermaid labels. Mermaid node identifiers
must be generated (`n0`, `n1`, ...) and never derived from user input.

**Step 4: Protect file permissions and user assets**

Create state and generated notes with owner-only permissions. Never overwrite
or delete unmanifested files. Reject symlink traversal for generated paths.

**Step 5: Run tests and commit**

```bash
node --test test/render-recovery.test.mjs test/render-safety.test.mjs test/render.test.mjs
npm test
git add src/markdown.mjs src/render-manifest.mjs src/render.mjs src/store.mjs bin/learn.mjs test/render-recovery.test.mjs test/render-safety.test.mjs
git commit -m "feat: reconcile and secure Obsidian rendering"
```

### Task 8: Validate sources, visuals, times, and command options

**Files:**
- Create: `src/inputs.mjs`
- Modify: `src/model.mjs`
- Modify: `src/graph.mjs`
- Modify: `bin/learn.mjs`
- Create: `test/input-safety.test.mjs`
- Modify: `test/cli-help.test.mjs`

**Step 1: Write a hostile-input matrix**

Cover control characters, newlines, very long fields, `javascript:` URLs,
Mermaid syntax in IDs, duplicate scalar options, unknown options, invalid
dates, nonexistent visuals, directories, symlinks, and files outside the
vault.

**Step 2: Add per-command option schemas**

Reject unknown flags and duplicate scalar flags. Add command-specific help and
`--version`. Keep repeatable `--gap` explicit in the schema.

**Step 3: Validate sources and visuals**

Sources are either allowed `https:`/`http:` URLs or typed local references.
Visual registration resolves the file under the vault, rejects symlinks and
non-files, and records bytes, media type, and SHA-256.

**Step 4: Run tests and commit**

```bash
node --test test/input-safety.test.mjs test/cli-help.test.mjs test/graph.test.mjs
npm test
git add src/inputs.mjs src/model.mjs src/graph.mjs bin/learn.mjs test/input-safety.test.mjs test/cli-help.test.mjs
git commit -m "feat: validate external learning inputs"
```

### Task 9: Add setup, export, recovery, and portable documentation

**Files:**
- Create: `scripts/setup.mjs`
- Create: `scripts/release-check.mjs`
- Create: `docs/operator/quickstart.md`
- Create: `docs/operator/recovery.md`
- Create: `docs/operator/privacy.md`
- Create: `docs/operator/state-format.md`
- Modify: `README.md`
- Modify: `package.json`
- Create: `test/setup.test.mjs`
- Create: `test/export.test.mjs`

**Step 1: Write a fresh-path setup test**

Copy the tracked release files to a temporary path whose name contains spaces.
Run setup with no prior state. Assert runtime validation, protected directories,
vault creation, `doctor` success, and printed Codex/Pi next steps. Assert no
output contains the developer's absolute path.

**Step 2: Implement one-command setup and release check**

Add:

```json
{
  "scripts": {
    "setup": "node scripts/setup.mjs",
    "doctor": "node bin/learn.mjs doctor",
    "release-check": "node scripts/release-check.mjs"
  }
}
```

The release check runs tests, syntax checks, JSON parsing, a fresh setup, an
end-to-end learning/review fixture, and doctor.

**Step 3: Implement deterministic export**

Export validated canonical state, generated Markdown, a manifest, checksums,
schema version, and product version without including lock or temporary files.

**Step 4: Write operator documentation**

Document setup, exact data locations, Obsidian opening, backup, restore-check,
repair-render, deletion, no-telemetry boundary, and known support limits.

**Step 5: Run tests and commit**

```bash
node --test test/setup.test.mjs test/export.test.mjs
npm run release-check
git add scripts docs/operator README.md package.json test/setup.test.mjs test/export.test.mjs
git commit -m "feat: add portable setup and recovery workflow"
```

### Task 10: Make the Pi adapter non-blocking and diagnosable

**Files:**
- Modify: `.pi/extensions/adaptive-learning.js`
- Modify: `test/pi-extension.test.mjs`
- Create: `test/pi-extension-timeout.test.mjs`

**Step 1: Write failing async adapter tests**

Test successful JSON output, timeout, cancellation, malformed output, state
committed with render warning, and a busy host. Assert the Pi event loop is not
blocked by a synchronous child process.

**Step 2: Replace `spawnSync` with asynchronous execution**

Use `spawn`, bounded stdout/stderr capture, a timeout, and an abort path. Kill
only the child process started by this invocation. Return structured error
codes and preserve repair instructions.

**Step 3: Run tests and commit**

```bash
node --test test/pi-extension.test.mjs test/pi-extension-timeout.test.mjs
npm test
git add .pi/extensions/adaptive-learning.js test/pi-extension.test.mjs test/pi-extension-timeout.test.mjs
git commit -m "feat: make Pi integration asynchronous"
```

### Task 11: Build the behavioral evaluation suite

**Files:**
- Create: `evals/scenarios.json`
- Create: `evals/rubric.md`
- Create: `evals/README.md`
- Create: `scripts/validate-eval-artifact.mjs`
- Create: `test/eval-contract.test.mjs`
- Create at run time: `artifacts/evals/<date>-<host>-<scenario>/`

**Step 1: Define the versioned scenarios**

Include expert-edge, novice-branches, admitted-gap, ambiguous-target,
misconception, retry-repair-transfer, contamination, conflicting-source,
context-resume, retention-regression, and cross-topic-reuse scenarios.

**Step 2: Define the rubric before running hosts**

Each artifact records target fidelity, frontier accuracy, question clarity,
leakage, assessment accuracy, source support, pacing, persistence, synthesis,
critical failures, and human verdict. Do not score a contaminated question as
successful evidence.

**Step 3: Validate artifact completeness mechanically**

The validator rejects missing transcript, state snapshot, source ledger,
rendered note, rubric field, or human verdict.

**Step 4: Run the contract test and commit**

```bash
node --test test/eval-contract.test.mjs
git add evals scripts/validate-eval-artifact.mjs test/eval-contract.test.mjs
git commit -m "test: define adaptive teaching quality gates"
```

### Task 12: Run live Codex and Pi acceptance sessions

**Files:**
- Create: `artifacts/evals/<date>-codex-*/`
- Create: `artifacts/evals/<date>-pi-*/`
- Create: `docs/verification/live-host-acceptance.md`

**Step 1: Run the complete Codex scenario**

Use a fresh root and an unfamiliar target. Preserve the transcript, canonical
state revisions, sources, plan, rendered notes, and rubric. Interrupt the
conversation once and resume from durable context.

**Step 2: Run the cross-host retention scenario in live Pi**

Install or otherwise provide the supported Pi runtime. Open the same learning
root, complete a due review, include one bounded failure and repair, and close
the review. A fake API harness does not satisfy this step.

**Step 3: Adjudicate every scenario**

Record critical failures separately from numerical scores. Any target change,
answer leakage counted as evidence, false source verification, persistence
mismatch, or inability to complete the review blocks release.

**Step 4: Repair and rerun failed scenarios**

For each failure, add a regression test or a narrower skill rule, then rerun
the affected scenario from a fresh root. Preserve failed artifacts rather than
overwriting them.

**Step 5: Commit accepted evidence**

```bash
git add artifacts/evals docs/verification/live-host-acceptance.md
git commit -m "test: verify live Codex and Pi learning workflows"
```

### Task 13: Add continuous release verification

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `CHANGELOG.md`
- Modify: `package.json`
- Modify: `docs/verification.md`

**Step 1: Add supported-version CI**

Run the complete release check on macOS for Node.js 20 and 22. Cache nothing
until the uncached workflow is stable. Upload failing test output, never learner
state containing private answers.

**Step 2: Add version and changelog discipline**

Choose the first hardened prerelease version only after live acceptance. Add
`--version`, update the changelog, and record schema compatibility.

**Step 3: Run the local release check**

```bash
npm run release-check
git diff --check
git status --short
```

Expected: release check passes, diff check is clean, and only intended release
files remain changed.

**Step 4: Commit**

```bash
git add .github/workflows/ci.yml CHANGELOG.md package.json docs/verification.md
git commit -m "chore: add release verification"
```

### Task 14: Final destructive audit and release tag

**Files:**
- Modify: `docs/verification.md`
- Create: `docs/release/first-local-release.md`

**Step 1: Run the full failure matrix**

From disposable roots, test hard kill while locked, corrupted canonical JSON,
unsupported future schema, version-1 migration, renderer permission failure,
stale render repair, invalid visual symlink, backup validation, restore-check,
fresh setup path, Codex resume, and Pi review completion.

**Step 2: Review generated Obsidian artifacts manually**

Confirm graph labels, source links, evidence wording, current concept status,
review history, privacy, colliding topic titles, and visuals. Mechanical tests
do not replace this inspection.

**Step 3: Reconcile every release criterion**

Use the eight-item definition of done in the hardening design. Mark each item
`Verified`, `Failed`, or `Unproved` with evidence. Do not convert `Unproved`
into `Verified` because implementation exists.

**Step 4: Run final commands**

```bash
npm run release-check
git diff --check
git status --short
git log --oneline --decorate -15
```

Expected: all checks pass and the worktree is clean.

**Step 5: Tag only after the evidence passes**

```bash
git tag -a v0.2.0 -m "Release-grade local adaptive learning system"
```

If any live-host, recovery, privacy, or migration gate remains unproved, do not
create the release tag. Record the remaining blocker in
`docs/release/first-local-release.md` instead.

## Final claim boundary

Completion of this plan establishes a release-grade local workflow on the
explicitly supported macOS and Node versions, with recorded live Codex and Pi
evidence. It does not prove that every host model, every future version, or
every subject will produce excellent teaching. Those remain bounded by the
behavioral artifacts, supported environments, and recorded human judgments.
