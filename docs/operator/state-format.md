# State, rendering, backup, and export formats

## Canonical state

`.adaptive-learning/state.json` is the only canonical learner record. The
current schema version is `4`. Every read and every write validates the full
structure. Unsupported future versions are rejected.

Canonical state owns a monotonically increasing `revision`. A successful
mutation commits JSON first and marks rendering stale. Rendering then catches
up to that exact revision. A render failure cannot roll back already committed
learning evidence.

Version-1 state migrates deterministically through version 2, version 3, and version 4;
version-2 state migrates through version 3 to version 4; version-3 state
migrates directly to version 4. The original is preserved under
`.adaptive-learning/backups/` before canonical state changes. Visuals migrated
from version 1 are marked `legacy-unverified`; newly registered visuals store
byte count, media type, and SHA-256 as verified identity.

Version 3 adds first-class question records, answer responses, and learner note
records. A question stores its choices, deterministic answer key, explanation,
adaptive parent, branch reason, response history, and lifecycle status. Public
CLI and context views always redact the stored answer key and explanation;
host feedback may show the supplied explanation only after the persisted retry
state permits it. A learner note can target the session, a question, a concept,
or a teaching step; notes entered with an answer commit atomically with that
response.

Version 4 adds the top-level `learnerProfile`: learner-authored teaching
philosophy and explanation, feedback, visual, and source preferences shared
across sessions. `updatedAt` is null until the learner first updates a field.
Unspecified fields survive later partial updates. Both hosts receive the
profile through `context --json`, and the derived vault renders it to
`Profile.md`.

The additive version-4 session record also contains `checkpointGaps`. Each
entry binds an ungraded learner admission to the exact teaching, retention, or
synthesis checkpoint question, node, concept, statement, evidence, and event
time. This is distinct from `admittedGaps`, which describes the probe-time
diagnostic frontier. Existing version-4 sessions without the collection read
as an empty list.

Do not edit canonical JSON by hand. Use the CLI or the shared host skill.

## Render manifest

`.adaptive-learning/render-manifest.json` records:

- render format version;
- canonical state revision represented;
- repository-relative vault directory;
- every generated path and its SHA-256.

The manifest is the ownership boundary for generated Markdown. Rendering may
replace or remove only files owned by a prior or pending manifest. User-created
notes and visual assets are not silently claimed.

`render-pending.json` means a prior projection did not finish. `doctor` reports
the partial state, and `repair-render` reconciles it.

## Backup format

Each manifest backup directory contains:

```text
manifest.json
state.json
```

The manifest records backup format version `1`, backup ID, creation time,
canonical schema version, revision, state filename, and SHA-256. `restore
--check` validates all of those relationships without mutating state.

## Export format

An export contains:

```text
export-manifest.json
render-manifest.json
state.json
<configured vault directory>/...
```

Export format version `1` records product version, schema version, canonical
revision, canonical `updatedAt`, and a sorted file inventory. Each inventory
entry has a repository-relative path, byte count, SHA-256, and one role:

- `canonical-state`;
- `render-manifest`;
- `generated-note`;
- `verified-visual`.

The export manifest does not hash itself. Its remaining inventory covers every
other exported file. No creation-time clock or destination path is recorded,
so two exports of unchanged state have identical contents.

## Atomicity and exclusions

State writes, manifests, backups, renders, and exports use staged owner-only
files or directories followed by rename. Temporary artifacts are uniquely
owned by one operation and cleaned after failure.

Exports intentionally exclude state locks, backup directories, render-pending
markers, and temporary files. Canonical state plus checksummed projections and
verified visuals are sufficient for the portable record.
