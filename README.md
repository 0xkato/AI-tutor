# Adaptive Learning Agent

A local, chat-first learning system for Codex and Pi. It diagnoses current
understanding, builds a verified dependency plan, teaches one motivated step at
a time, schedules retention, and renders every session into an Obsidian vault.

Node.js 20 or newer runs the engine and Codex path. Pi 0.84 requires Node.js
22.19 or newer. Pi supplies the runtime extension packages; this repository
pins matching `typebox` and Pi TUI versions for its contract tests. No model SDK
or hosted database is required.

## Install and verify

From a fresh clone on macOS:

```bash
npm run setup
npm run doctor -- --json
```

Setup validates the runtime and host-discovery files, creates protected local
state, renders the initial Obsidian view, and prints the exact Codex and Pi next
steps. The engine/Codex release matrix is Node.js 20 and 22; only Node 22.19 or
newer in that matrix can host Pi 0.84. Newer Node versions may satisfy the
minimum runtime check but are outside that qualified matrix until CI covers
them.

## Start learning

The complete adaptive teaching protocol is active immediately. In Pi, start
with the learning target:

```text
/teach Understand why gradient descent subtracts the gradient
```

In Codex, ask naturally:

> Teach me why gradient descent subtracts the gradient, starting from what I already know.

You do not need to configure teaching behavior before starting.

## Optional learner profile

The built-in defaults enforce causal teaching, adaptive multiple-choice
calibration, exact feedback, source verification, useful visuals, retry rules,
and durable transfer checks. Profile customization is optional and only records
learner-specific overrides that should be reused across sessions. In Pi:

```text
/learn-profile teaching :: Build causal understanding before testing; use transfer rather than repetition.
/learn-profile explanations :: Teach one motivated reasoning step at a time.
/learn-profile feedback :: Assess only the explicit question and name the exact missing mechanism.
```

`/learn-profile` with no argument shows custom overrides or reports that each
built-in default is active. Codex can update the same canonical fields through
`set-profile`; both hosts read them from durable context before calibration or
teaching. The profile is also visible in Obsidian as `Profile.md`.

## What the learner does

State the understanding you want. The agent owns the rest of the workflow:

1. start the first broad probe as multiple-choice, then narrow each prerequisite strand to the actual knowledge edge;
2. research and fact-check the missing route while discussing source choices;
3. build and validate a Mermaid prerequisite graph;
4. teach from foundations through one motivated reasoning step at a time;
5. assess with exact evidence, retry misses without answer leakage, and discard contaminated questions;
6. schedule spaced reviews and periodically reconnect the details through whole-system synthesis.

The learner does not approve sources one by one. Source class, supported claim,
verification, and limitations remain visible in the conversation and vault.
Every multiple-choice interaction offers **I don't know** and an optional note
on the same question. Later questions store their adaptive parent and the reason
the previous response caused that branch.

The interactive multiple-choice surface is for probing and teaching. It finds
the learner's frontier, but recognition alone is not durable retention
evidence. Spaced reviews continue through the stricter persisted review
checkpoint lifecycle with transfer, reconstruction, debugging, or retention
questions.

If the learner answers an open-ended teaching or retention checkpoint with
**I don't know**, that admission is persisted against the exact checkpoint
without a grade. The agent teaches the missing mechanism and then opens a new
transfer question; the lesson does not strand or fabricate an incorrect answer.

## Use with Codex

Open this repository in Codex and ask naturally, for example:

> Teach me why gradient descent subtracts the gradient, starting from what I already know.

`AGENTS.md` routes learning requests to the shared adaptive-learning skill. The
skill initializes or resumes durable state before probing or teaching. Codex
shows a compact numbered-card fallback with the same choices, **I don't know**,
and an optional `Note:` line. The card and answer use the same canonical state
as Pi.

## Use with Pi

Pi integration is included, but it is not yet release-qualified. The adapter,
commands, and Pi 0.84 input contract are locally verified. The older live
Pi-to-OpenAI-Codex behavioral artifact exercised the durable review lifecycle;
it did **not** exercise the native multiple-choice modal. Native Pi quiz live
human acceptance is still pending, so do not claim Pi support yet.

Project settings default Pi to OpenAI Codex with model `gpt-5.5`. A command-line
model choice or `/model` still overrides that default. Pi authentication is
host state and is not checked by `npm run setup`; use Pi's login flow if the
provider is not already authenticated.

Launch Pi from this repository, then use:

```text
/teach Understand why gradient descent subtracts the gradient
/teach Optimization :: Understand why subtracting the gradient lowers loss locally
/learn-profile
/learn-status
/learn-review
```

The `topic :: target` form is optional. `/teach` with no argument resumes the
active target. A different target cannot silently overwrite an active session.
When the model calls `adaptive_learning_quiz`, Pi opens an interactive quiz
modal. Use the arrow keys to choose, Tab to move to the optional note editor,
Enter to submit or leave the note editor, Ctrl+J to insert a note newline,
Backspace to edit, and Escape to cancel. The modal saves the question and
response before feedback.

Pi is not bundled with this repository. The adapter follows Pi's project-local
`.agents/skills`, `.pi/extensions`, and `enableSkillCommands` conventions; see
`docs/verification.md` for the pinned upstream source and the boundary of what
was tested locally.

## Open the Obsidian view

After setup, open this repository-relative folder as an Obsidian vault:

```text
vault/
```

The vault contains:

- `Home.md` for session navigation;
- `Profile.md` for the durable learner teaching philosophy and preferences;
- `Sessions/` for the complete target, probe conclusion, graph, sources,
  teaching steps, question choices and answers, learner notes, assessments,
  visuals, synthesis, and gaps;
- `Topics/` for topic history and current evidence;
- `Reviews.md` for the scheduled retention queue.

`.adaptive-learning/state.json` is canonical. The Markdown vault is regenerated
from it and should not be used as the mutation source.

## Direct engine commands

The host runner normally operates the engine through the skill. For inspection
or debugging:

```bash
node bin/learn.mjs --help
npm test
```

The full lifecycle is `init`, `profile`, `set-profile`, `start`,
`start-question`, `pending-question`,
`submit-question` (`answer-question` is the lower-level split operation),
`cancel-question`, `add-note`, `record-probe` or
`record-admitted-gap`, `finish-probe`,
`add-source`, `set-plan`, `begin-teach`, `record-step`, `record-assessment`,
`start-synthesis`, `record-synthesis`, `add-visual`, `status`, `context`, `due`,
`start-review`, `start-review-checkpoint`, `defer-review`, `close-review`, and
`close`. Teaching, review, and synthesis question identities are persisted
before answers are accepted.
Operational commands are `doctor`, `backup`, `restore --check`,
`repair-render`, and `export`. Complete learning examples are in the shared
skill's `references/cli-reference.md`.

## Persistence and safety

- JSON mutations use a process lock, a temporary file, and atomic rename.
- The complete read-modify-write cycle and vault rendering are serialized, so
  concurrent Codex/Pi processes cannot silently overwrite one another.
- Visual paths must remain inside the vault and require recorded inspection.
- The engine requires no model API keys or network credentials and provides no
  dedicated credential storage. Secrets entered as ordinary learning text are
  still persisted and can appear in backups, exports, Obsidian, and host
  conversations.
- The engine sends no telemetry and performs no source fetching.

## Operate and recover

- [Quickstart](docs/operator/quickstart.md)
- [Recovery and backups](docs/operator/recovery.md)
- [Privacy boundary](docs/operator/privacy.md)
- [State and export format](docs/operator/state-format.md)
- [Source-backed video parity](docs/product/video-parity.md)

Before distributing a release, run:

```bash
npm run release-check
```

## Claim boundary

Passing the repository tests proves the deterministic engine, persistence,
skill contract, Pi adapter behavior, Pi input parsing contract, and generated
artifacts match the stated protocol. It does not prove the native modal works
in the learner's exact terminal, that every host model will teach well, that a
source is true merely because it was recorded, or that the learner has mastered
a topic. Those claims still require the recorded evidence.

See `docs/plans/2026-08-24-adaptive-learning-agent-design.md` for the design and
`docs/verification.md` for the exact verification record.
