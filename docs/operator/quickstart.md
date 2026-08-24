# Quickstart

## Candidate first release

The locally qualified engine environment is macOS with Node.js 20 or 22,
current Codex project skills, and optional Obsidian. Setup rejects Node
versions below 20. Newer versions can run, but they are not part of the
qualified release matrix until CI covers them.

Pi adapter discovery and command behavior are verified locally, but Pi is not
yet release-qualified. A fresh live Pi behavioral run, independent human pass,
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
5. renders the initial `Home.md` and `Reviews.md` files;
6. runs the same diagnostics exposed by `npm run doctor`;
7. prints the next Codex and Pi commands.

Setup is idempotent. It resumes existing canonical state and reconciles the
generated Obsidian projection; it does not erase learning history.

Verify the result independently:

```bash
npm run doctor -- --json
```

The command exits successfully only when its `ok` field is `true`.

## Start in Codex

Open the repository in Codex and state one specific understanding target, for
example:

> Teach me why gradient descent subtracts the gradient, starting from what I already know.

`AGENTS.md` routes the request into the shared adaptive-learning skill. The
skill reads or initializes durable state before probing.

## Exercise the Pi integration candidate

Until the live-host acceptance record reports an accepted Pi artifact, treat
these commands as integration-testing instructions rather than a support
claim.

Launch Pi from the repository root, then use:

```text
/teach Understand why gradient descent subtracts the gradient
/learn-status
/learn-review
```

`/teach` without an argument resumes the active target. A different target
cannot silently replace an active session.

## Open the Obsidian view

Open `vault/` as the Obsidian vault. Obsidian is a viewer, not a state
dependency. Generated Markdown must not be treated as canonical input.

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
