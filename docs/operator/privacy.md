# Privacy boundary

## What is stored locally

Canonical state can contain:

- learning targets and learner context;
- probe and assessment questions, answers, grades, and exact evidence;
- dependency plans, source titles and references, teaching steps, and retry state;
- topic and concept history, retention schedules, synthesis, and unresolved gaps;
- visual descriptions, vault-relative paths, media types, byte counts, and hashes.

Generated Markdown presents the same learning record for inspection in
Obsidian. Verified visual files remain in the local vault and are copied into a
portable export.

## What does not leave through this engine

The deterministic engine performs no telemetry, analytics, source fetching,
model API calls, or network uploads. It stores no API keys, authentication
tokens, or model credentials.

Codex and Pi are separate hosts. Their model requests, conversation retention,
account settings, and provider telemetry are governed by those products, not
by this repository. A source URL is recorded as evidence metadata; recording
it does not fetch or verify the page.

## Filesystem protection

Canonical state, manifests, backups, generated notes, and export files are
created owner-only. Mutation locks carry PID, creation time, and a random owner
token. A live owner is never displaced; a dead owner's lock is recovered only
during a later mutation.

Local filesystem permissions do not protect against another process already
running as the same operating-system user. Full-disk encryption, device access,
host account security, and repository sharing remain operator responsibilities.

## Sensitive learning material

Do not attach secrets merely because storage is local. Source references,
answers, and visuals may be copied into backups, exports, terminal output,
Obsidian, or host conversations. Review an export before sharing it.

Deletion instructions are in [Recovery, backup, and export](recovery.md).
