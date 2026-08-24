# Recovery, backup, and export

## Diagnose before changing anything

Run:

```bash
npm run doctor -- --json
```

The report separates canonical-state validity, lock ownership, backup health,
render consistency, filesystem permissions, runtime support, host discovery,
and vault availability. Follow only the actions it reports.

## Create a canonical-state backup

```bash
node bin/learn.mjs backup --id before-major-change
```

The backup is stored under `.adaptive-learning/backups/` with owner-only
permissions, a manifest, and a SHA-256 checksum. Backup IDs accept letters,
numbers, `.`, `_`, and `-`.

A backup contains canonical JSON only. Use `export` when the recovery artifact
must also include generated notes and verified visual files.

## Validate a backup without mutating state

```bash
node bin/learn.mjs restore --backup before-major-change --check
```

This validates the manifest, checksum, schema, and revision and leaves
canonical state untouched. Automatic restoration is intentionally not enabled
in this release: validation and replacement are separate so a malformed or
mistyped request cannot overwrite learner history.

For a manual restoration:

1. close Codex and Pi sessions using this repository;
2. run the `restore --check` command above;
3. make a filesystem copy of the current `.adaptive-learning/state.json`;
4. copy the validated backup's `state.json` into place as
   `.adaptive-learning/state.json`;
5. restrict it to the current user with `chmod 600`;
6. run `node bin/learn.mjs repair-render`;
7. run `npm run doctor -- --json` and require `ok: true` before resuming.

Do not copy `state.lock`, render-pending files, or temporary files from any
backup or export.

## Repair the Obsidian projection

If canonical state committed but rendering failed, or `doctor` reports a stale
or partial projection:

```bash
node bin/learn.mjs repair-render
```

This reconciles generated Markdown and its manifest without changing learning
evidence. User-created vault files and verified visual assets are not removed.

## Create a portable learner export

The output directory must not already exist:

```bash
node bin/learn.mjs export --output ../adaptive-learning-export
```

The export contains validated canonical state, the render manifest, every
generated Markdown file, every currently verified visual file, and an export
manifest with product version, schema version, revision, byte counts, roles,
and SHA-256 checksums. Repeating the export at the same state produces the same
file contents.

The export refuses stale rendering, changed visuals, duplicate paths, or an
existing destination. Locks, backups, pending markers, and temporary files are
never included.

## Delete all local learner data

First close Codex, Pi, and Obsidian for this repository. If you may need the
history, create and move an export outside the repository. Then delete:

```text
.adaptive-learning/
vault/
```

This removes the product's canonical state, backups, generated views, and
vault-local visuals. It does not delete host-provider conversation history;
manage that separately in Codex or Pi.
