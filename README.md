# AI Tutor

AI Tutor is a local tutor for Pi and Codex. It calibrates, teaches, tests your
reasoning, and schedules review. Your progress stays on your computer.

## Quick start

Requires macOS and Node.js 22.19 or newer. Obsidian is optional.

```sh
git clone https://github.com/0xkato/AI-tutor.git
cd AI-tutor
npm ci
npm run setup
npm run pi
```

In Pi, enter what you want to learn:

```text
/teach Understand how Transformers work
```

The tutor starts with a short calibration, teaches one step at a time, and
adapts future questions and reviews to your answers.

## Learn from a source

```text
/teach-from <source> :: <learning target>
```

The source can be a YouTube video, PDF, notes file, web page, or repository:

```text
/teach-from https://www.youtube.com/watch?v=... :: Understand self-attention
```

Your supplied source is the anchor; independent research remains supplemental.
Source coverage shows lesson support, not mastery. Replace an unavailable
anchor or choose supplemental-only; that decision is saved.

## Answer questions in Pi

- Arrow keys: choose an answer
- Enter: submit
- **I don't know**: record an ungraded gap
- Tab: add an optional note
- Esc: pause the question without discarding it

Sessions save automatically. Use:

- `/teach` to resume
- `/teach-restart` to preserve the old session and restart with fresh selectable calibration
- `/learn-status` to see your next step
- `/learn-review` to complete due review work
- `/learn-profile` to optionally change the teaching style
Built-in defaults work immediately. The optional learner profile stores your
teaching philosophy in `vault/Profile.md`.

## Use Codex

Open this repository in Codex and ask:

```text
Teach me Transformers, starting from what I already know.
```

Codex uses numbered questions. Codex and Pi use the same saved learning state,
so you can switch between them without starting over.

## Progress and privacy

- `.adaptive-learning/` stores the canonical learning state.
- `vault/` is the optional Obsidian view of your progress and notes.
- Both folders are ignored by Git.
- There is no telemetry, and model credentials are not stored.

Do not put passwords, API keys, or other secrets in learning notes.

## Status

This is a release candidate. The learning engine and persistence paths are
automatically tested. Native Pi quiz behavior still requires final human
acceptance testing in a real terminal.

No license is included; public access does not grant reuse or redistribution.

See the [operator quickstart](docs/operator/quickstart.md) for troubleshooting or
the [behavior contract](docs/product/video-parity.md) for implementation details.
