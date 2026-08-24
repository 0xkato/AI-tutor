# Adaptive Learning Agent

A local, chat-first learning system for Codex and Pi. It diagnoses current
understanding, builds a verified dependency plan, teaches one motivated step at
a time, schedules retention, and renders every session into an Obsidian vault.

The implementation is dependency-free and requires Node.js 20 or newer.

## What the learner does

State the understanding you want. The agent owns the rest of the workflow:

1. probe broadly, then narrow each prerequisite strand to the actual knowledge edge;
2. research and fact-check the missing route while discussing source choices;
3. build and validate a Mermaid prerequisite graph;
4. teach from foundations through one motivated reasoning step at a time;
5. assess with exact evidence, retry misses without answer leakage, and discard contaminated questions;
6. schedule spaced reviews and periodically reconnect the details through whole-system synthesis.

The learner does not approve sources one by one. Source class, supported claim,
verification, and limitations remain visible in the conversation and vault.

## Use with Codex

Open this repository in Codex and ask naturally, for example:

> Teach me why gradient descent subtracts the gradient, starting from what I already know.

`AGENTS.md` routes learning requests to the shared adaptive-learning skill. The
skill initializes or resumes durable state before probing or teaching.

## Use with Pi

Launch Pi from this repository, then use:

```text
/teach Understand why gradient descent subtracts the gradient
/teach Optimization :: Understand why subtracting the gradient lowers loss locally
/learn-status
/learn-review
```

The `topic :: target` form is optional. `/teach` with no argument resumes the
active target. A different target cannot silently overwrite an active session.

Pi is not bundled with this repository. The adapter follows Pi's project-local
`.agents/skills`, `.pi/extensions`, and `enableSkillCommands` conventions; see
`docs/verification.md` for the pinned upstream source and the boundary of what
was tested locally.

## Open the Obsidian view

After the first session begins, open this folder as an Obsidian vault:

```text
/Users/0xkato/Desktop/Hobby/adaptive-learning-agent/vault
```

The vault contains:

- `Home.md` for session navigation;
- `Sessions/` for the complete target, probe conclusion, graph, sources,
  teaching steps, assessments, visuals, synthesis, and gaps;
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

The full lifecycle is `init`, `start`, `record-probe`, `finish-probe`,
`add-source`, `set-plan`, `begin-teach`, `record-step`, `record-assessment`,
`add-visual`, `status`, `context`, `due`, and `close`. Complete examples are in
the shared skill's `references/cli-reference.md`.

## Persistence and safety

- JSON mutations use a process lock, a temporary file, and atomic rename.
- The complete read-modify-write cycle and vault rendering are serialized, so
  concurrent Codex/Pi processes cannot silently overwrite one another.
- Visual paths must remain inside the vault and require recorded inspection.
- The engine stores no model API keys or network credentials.

## Claim boundary

Passing the repository tests proves the deterministic engine, persistence,
skill contract, Pi adapter behavior, and generated artifacts match the stated
protocol. It does not prove that every host model will teach well, that a source
is true merely because it was recorded, or that the learner has mastered a
topic. Those claims still require the recorded evidence.

See `docs/plans/2026-08-24-adaptive-learning-agent-design.md` for the design and
`docs/verification.md` for the exact verification record.
