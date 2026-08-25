# Quickstart

## Candidate first release

The locally qualified engine environment is macOS with Node.js 20 or 22,
current Codex project skills, and optional Obsidian. Setup rejects Node
versions below 20. Newer versions can run, but they are not part of the
qualified release matrix until CI covers them.

Pi adapter discovery and command behavior are verified locally, but Pi is not
yet release-qualified. A fresh live Pi-to-OpenAI-Codex behavioral artifact is
mechanically complete with no critical failures, but an independent human pass
and accepted artifact are still required before this document may describe Pi
as supported.

Pi and Obsidian are optional for a Codex-only learning session. Their project
files are still verified so switching hosts later uses the same durable state.

## Set up a fresh clone

Run from the repository root:

```bash
npm run setup
```

The command:

1. validates Node.js and macOS;
2. checks the Codex skill and Pi extension discovery files;
3. creates `.adaptive-learning/state.json` with owner-only permissions;
4. creates the repository-relative `vault/` directory;
5. renders the initial `Home.md`, `Profile.md`, and `Reviews.md` files;
6. runs the same diagnostics exposed by `npm run doctor`;
7. prints the next Codex and Pi commands.

Setup is idempotent. It resumes existing canonical state and reconciles the
generated Obsidian projection; it does not erase learning history.

Verify the result independently:

```bash
npm run doctor -- --json
```

The command exits successfully only when its `ok` field is `true`.

## Start learning immediately

The built-in defaults are active after setup; no learner-profile configuration
is required. In Pi, start with a learning target:

```text
/teach Understand why gradient descent subtracts the gradient
```

In Codex, state the same target naturally. Both hosts load the complete
adaptive-learning protocol before calibration or teaching.

## Optionally customize the learner profile

The learner profile stores optional teaching-philosophy and presentation
overrides instead of forcing you to restate personal preferences for every
target. It does not enable the underlying teaching system. In Pi:

```text
/learn-profile teaching :: Build causal understanding before testing; use transfer rather than repetition.
/learn-profile explanations :: Teach one motivated reasoning step at a time.
/learn-profile feedback :: Assess only the explicit question and identify the exact missing mechanism.
/learn-profile visuals :: Use a diagram when it materially clarifies a relationship.
/learn-profile sources :: Prefer primary sources and preserve uncertainty.
```

Run `/learn-profile` without an argument to inspect custom values or confirm
that the built-in defaults are active. Codex uses the same `profile` and
`set-profile` engine commands. The profile is saved in canonical state and
rendered to Obsidian as `Profile.md`; leaving a field empty keeps the protocol
default active.

## Start in Codex

Open the repository in Codex and state one specific understanding target, for
example:

> Teach me why gradient descent subtracts the gradient, starting from what I already know.

`AGENTS.md` routes the request into the shared adaptive-learning skill. The
skill reads or initializes durable state before probing. The first broad probe
is multiple-choice. Codex displays a numbered card with the available answers,
**I don't know**, and an optional `Note:` line. Reply with the number or
`I don't know`; put `Note: <your note>` on the same response when useful.

These interactive cards are used during probing and teaching. Retention is not
graded from recognition-only multiple choice; due reviews use the persisted
review-checkpoint flow and stronger recall or transfer evidence.

## Exercise the Pi integration candidate

Until the live-host acceptance record reports an accepted Pi artifact, treat
these commands as integration-testing instructions rather than a support
claim.

Launch Pi from the repository root, then use:

```text
/teach Understand why gradient descent subtracts the gradient
/learn-profile
/learn-status
/learn-review
```

`/teach` without an argument resumes the active target. A different target
cannot silently replace an active session.

The Pi extension provides the interactive version of the same question. Use
the arrow keys to move between choices, press Tab to edit the optional note,
then submit. **I don't know** records an admitted gap so the agent teaches the
missing mechanism before asking a new transfer question.

## Open the Obsidian view

Open `vault/` as the Obsidian vault. Obsidian is a viewer, not a state
dependency. Generated Markdown must not be treated as canonical input. Session
notes show each persisted question, its response, adaptive parent and reason,
and any learner note attached to that question. `Profile.md` shows the durable
teaching philosophy and preferences applied by both hosts.

## Exact local data locations

| Location | Purpose |
| --- | --- |
| `.adaptive-learning/state.json` | Canonical learner state |
| `.adaptive-learning/state.lock` | Short-lived mutation ownership lock |
| `.adaptive-learning/backups/` | Checksummed canonical-state snapshots |
| `.adaptive-learning/render-manifest.json` | Generated-file ownership and hashes |
| `.adaptive-learning/render-pending.json` | Interrupted-render recovery marker |
| `vault/` | Derived Markdown plus learner-supplied visual files |

All paths are relative to the repository root. No personal absolute path is
required.
