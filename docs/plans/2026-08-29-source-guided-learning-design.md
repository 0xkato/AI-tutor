# Source-Guided Learning Design

## Goal

Let a learner start from material they already chose—a YouTube video, PDF,
notes file, web page, or repository—and have AI Tutor teach the requested
target from that material while preserving exact provenance, independently
checking claims, and keeping source coverage separate from demonstrated
understanding.

The primary Pi surface is:

```text
/teach-from <source> :: <learning target>
```

Codex supports the same workflow when the learner asks to learn a target from
a supplied source.

## Product contract

1. The learner chooses the anchor material and target. The tutor does not
   silently replace either.
2. The source reference is persisted before the host begins research.
3. The host inspects the supplied material, records whether it was usable, and
   cites exact timestamps, pages, headings, or file locations for claims used
   in the lesson.
4. External research is allowed and agent-owned, but it is recorded as
   supplemental evidence rather than presented as part of the learner's
   supplied material.
5. Every taught plan node in a source-guided session has recorded source
   coverage before its teaching step is accepted.
6. Source coverage is provenance, not proof that the learner understands the
   concept. Assessments and retention remain the only understanding evidence.
7. The Obsidian session note shows the supplied materials, resolution status,
   source roles and locators, per-node source coverage, and learner evidence.

## Architecture

### Learner-supplied materials

Schema version 5 adds `session.materials`. Each material stores a stable ID,
the learner-supplied reference, an inferred kind, a lifecycle status, a title,
resolution evidence, and timestamps. The deterministic engine accepts only
web references or explicit `local:` references. Pi normalizes a plain local
path to `local:<path>` before persistence.

Material lifecycle:

- `pending`: persisted but not yet inspected by the host;
- `verified`: the host accessed and identified the material;
- `unavailable`: the host could not access it and recorded why.

The engine does not download or parse arbitrary material. Pi or Codex performs
that work with the tools available to the selected host. This preserves the
existing boundary: the local engine owns durable invariants; the host owns
research quality and logistics.

### Claim-level sources

Existing verified source records gain:

- `role`: `anchor` or `supplemental`;
- `locator`: the exact timestamp, page, section, heading, or file range;
- `materialId`: the supplied material that an anchor claim came from, or null
  for supplemental research.

An anchor source must reference a verified supplied material and use the same
reference. Supplemental sources cannot claim a material link. Version-4
sources migrate as supplemental sources with a whole-source locator.

### Source coverage

Schema version 5 adds `session.sourceCoverage`. A coverage record binds one
plan node to one claim-level source and records the bounded mechanism or claim
the source supports. Coverage may be added only after a plan exists and must
refer to an existing plan node and source.

In a source-guided session, `record-step` rejects a teaching step if its node
has no source coverage. Questions already bind to the same node, so the
Obsidian projection can show the exact source basis beside each teaching and
assessment record without duplicating citations inside every question.

### Host workflow

The adaptive-learning skill adds a source-guided preflight:

1. read the persisted material and target;
2. inspect or retrieve the material;
3. resolve it as verified or unavailable;
4. record claim-level anchor sources with exact locators;
5. use external research where needed and record it as supplemental;
6. probe the learner and build the dependency plan;
7. record source coverage for each node before teaching it;
8. teach, assess, review, and synthesize through the existing lifecycle.

Source disagreements remain visible. The host must state when external
evidence corrects, limits, or supplements the anchor material.

## User experience

Pi adds `/teach-from` alongside `/teach`. It rejects malformed input, refuses
to overwrite a different active target, and resumes the same source-guided
session when invoked without arguments. Invoking it with another source and
the same target appends a pending material for inspection. The dispatched skill
message names both the persisted target and material so the host begins with
the intended source.

The README documents the shortest path:

```text
/teach-from https://www.youtube.com/watch?v=... :: Understand self-attention
```

For local notes, PDFs, or repositories:

```text
/teach-from ./notes/attention.md :: Reconstruct the argument without notes
/teach-from ./papers/attention.pdf :: Understand the attention mechanism
/teach-from ./transformer-repo :: Understand the model implementation
```

## Failure handling

- Invalid or unsafe references fail before state mutation.
- An inaccessible material becomes `unavailable` with explicit evidence; it is
  not silently treated as verified.
- Pending material blocks teaching. If every supplied material is unavailable,
  the learner must add a replacement or explicitly authorize a persisted
  supplemental-only continuation.
- Anchor claims cannot be recorded against pending or unavailable material.
- Coverage cannot point to missing sources or plan nodes.
- Source-guided teaching cannot advance with an uncited node.
- Rendering and state commits preserve the existing atomicity boundary.

## Acceptance boundary

Automated tests can prove parsing, persistence, migration, provenance roles,
coverage enforcement, rendering, and Pi dispatch behavior. They cannot prove
that a host successfully extracts every YouTube transcript or PDF, chooses
good sources, cites the right passage, teaches well, or that the learner
understands. Those remain host and human acceptance boundaries.
