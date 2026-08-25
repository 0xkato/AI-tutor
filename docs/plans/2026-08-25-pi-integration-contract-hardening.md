# Pi Integration Contract Hardening

## Goal

Make the native Pi learning quiz usable with Pi 0.84.x terminal input and stop first-run setup from silently selecting a different provider after the learner signs in with OpenAI Codex.

## Confirmed failures

1. The quiz controller recognizes configured Pi keybindings only for Up and Down. Modern terminal encodings for Enter, Escape, Tab, Space, Backspace, and newline are ignored in the remaining states.
2. Printable Kitty keyboard input and bracketed paste are ignored by the note editor.
3. User and model text is rendered without removing terminal control sequences.
4. The automated “real Pi quiz path” test bypasses the custom UI and therefore cannot detect any of these failures.
5. Project settings do not choose `openai-codex`, so Pi may select an authenticated Anthropic model even after OpenAI Codex login.
6. Setup and verification language is broader than the evidence: local state and mocked adapters pass, but the native modal has not passed human acceptance.

## Design

- Keep the existing quiz state machine and route every semantic action through Pi's injected `KeybindingsManager`.
- Use Pi TUI's public input helpers for printable Kitty input, literal Space, and terminal-sequence stripping.
- Retain raw-key fallbacks for direct-controller tests and older terminal input.
- Add bounded bracketed-paste handling in the note editor.
- Pin Pi TUI only as a development dependency and declare Pi runtime packages as peers so tests exercise the same public contract the host provides.
- Set an explicit project default of `openai-codex` / `gpt-5.5`; Pi command-line and `/model` choices still override it.
- Add a host-contract test module to the release gate and narrow all readiness claims until one live human acceptance pass is recorded.

## Test-first tasks

1. Add the Pi TUI test dependency without changing runtime behavior.
2. Add failing tests that use the real `KeybindingsManager` and modern terminal encodings for answer, feedback, notes, cancellation, multi-select, paste, and custom bindings.
3. Implement semantic input handling and display sanitization until those tests pass.
4. Add failing tests for project provider defaults and evidence wording, then update settings, setup output, and documentation.
5. Run the focused tests, complete suite, release check, doctor, diff checks, and a terminal-only controller acceptance harness.
6. Commit, fast-forward `main`, push the private remote, and verify the remote commit.

## Completion boundary

Automated verification can establish compatibility with Pi's published input contract. It cannot establish that the learner's exact terminal behaves correctly. Stable/live acceptance remains pending until the learner restarts Pi and completes one question using navigation, submission, note editing, cancellation, and feedback dismissal.
