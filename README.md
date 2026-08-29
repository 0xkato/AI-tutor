# AI Tutor

AI Tutor helps you learn a subject through Pi or Codex. Give it a learning
target, answer short questions, add notes when useful, and return later for
review. Your progress stays on your computer and can be opened in Obsidian.

## Install

You need macOS and Node.js 22.19 or newer. Obsidian is optional.

```sh
git clone https://github.com/0xkato/AI-tutor.git
cd AI-tutor
npm ci
npm run setup
npm run doctor
```

## Learn with Pi

Start Pi from inside the repository:

```sh
npm run pi
```

Then enter a learning target:

```text
/teach Understand how Transformers work
```

The tutor will establish what you already know, teach the next missing idea,
and check whether you can use it in a new example. It can research the subject
itself when the lesson needs sources.

To learn from material you already have, use:

```text
/teach-from <source> :: <learning target>
```

The source can be a YouTube video, PDF, notes file, web page, or repository.
For example:

```text
/teach-from https://www.youtube.com/watch?v=... :: Understand self-attention
/teach-from ./notes/attention.md :: Test what I retained about attention
```

The tutor saves the supplied material before inspecting it. Claims from that
material remain the **anchor** and keep an exact timestamp, page, heading, or
file location. Any extra research is recorded separately as **supplemental**
evidence, including where it corrects or limits the anchor. Source coverage
shows what supports each lesson step; it is not evidence of your understanding
or mastery.

When a multiple-choice question appears:

- use the arrow keys to choose an answer;
- press Enter to submit it;
- choose **I don't know** to record an ungraded gap;
- press Tab to add an optional note;
- press Esc to cancel.

Your session is saved automatically. Useful commands are:

- `/teach` — resume the active lesson;
- `/teach-from` — start from a supplied source and learning target;
- `/learn-status` — see the current target and next step;
- `/learn-review` — run due review work;
- `/learn-profile` — change how the tutor teaches you.

Built-in defaults work immediately. The optional learner profile stores your
personal teaching philosophy in `vault/Profile.md`; use `/learn-profile` only
when you want to customize it.

## Learn with Codex

Open this repository in Codex and ask:

```text
Teach me Transformers, starting from what I already know.
```

Codex uses numbered questions instead of Pi's interactive quiz.
Codex and Pi use the same saved learning state, so you can move between them
without starting over.

## View your progress in Obsidian

Open the repository's `vault/` folder as an Obsidian vault. It contains your
profile, lesson questions, notes, progress, and review material. Obsidian is a
view of the saved state; you do not need it to use the tutor.

## Your data

- `.adaptive-learning/` contains the canonical learning state.
- `vault/` contains the Obsidian view of that state.
- Both folders are ignored by Git.
- The project has no telemetry and does not store model credentials.

Do not put passwords, API keys, or other secrets in learning notes.

## Useful commands

```sh
npm run pi             # Start Pi
npm run doctor         # Check the local installation
npm test               # Run the test suite
npm run release-check  # Run the complete release gate
```

## Status

This repository is a release candidate, not a stable release. The learning
engine, persistence, recovery, and Pi input paths are covered by automated
tests. Native Pi quiz behavior still requires final human acceptance testing in
a real terminal.

For troubleshooting and operating details, see
[`docs/operator/quickstart.md`](docs/operator/quickstart.md). For the behavior
contract behind the project, see
[`docs/product/video-parity.md`](docs/product/video-parity.md).
