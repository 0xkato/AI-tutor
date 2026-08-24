# Release-Grade Local Hardening Design

## Decision

The target is a release-grade local learning system for one learner on macOS,
used through Codex and Pi, with Obsidian as the durable human-readable view.
"Release-grade" is an engineering-quality standard, not a plan to sell or host
the system.

The existing hybrid architecture remains the right foundation: a deterministic
local engine owns state and invariants, while the active host model owns
research, diagnosis, explanation, and questioning. The system will not be
rewritten as a standalone model application or expanded into a hosted service.

## Explicit non-goals

This hardening phase does not add:

- hosted infrastructure or cloud synchronization;
- accounts, teams, authentication, permissions, or billing;
- analytics, telemetry, or crash reporting to an external service;
- a separate graphical application;
- mobile, Windows, or Linux support for the first release;
- automatic semantic merging of concepts merely because their names look
  similar.

These omissions remove commercial and multi-user work without lowering the
reliability, correctness, privacy, or evidence standards of the local product.

## Current evidence and corrected boundary

The current repository passes 49 automated tests. Those tests establish the
prototype's deterministic session lifecycle, graph validation, assessment
labels, scheduling functions, file replacement, Obsidian rendering, skill
contract, and Pi adapter harness.

They do not establish release readiness. In particular:

- due reviews can be listed after a session closes, but assessment mutation
  requires an active session, so a closed session's review cannot be completed
  end to end;
- knowledge and review state live inside sessions, so calibration is not a
  durable learner-level model shared across later sessions;
- retry state is recorded but can be bypassed by submitting another question;
- a killed process can leave a permanent lock;
- schema mismatches and corrupted state have no migration or recovery path;
- state can advance even when derived-vault rendering fails, with no explicit
  reconciliation command or status;
- user-controlled identifiers and Markdown content are not fully safe for
  Mermaid and Obsidian rendering;
- a visual can be recorded without the referenced file existing;
- Pi compatibility has not been exercised in a live Pi process;
- host-model teaching quality has not been evaluated through a repeatable
  behavioral suite.

The release must close these gaps rather than relabel the existing tests.

## Product invariants

### 1. Learner knowledge outlives sessions

Sessions are append-only evidence records, not the authoritative location of
knowledge. The canonical state contains durable topics and concepts. A concept
owns its evidence history, current bounded status, retry state, and review
schedule. Sessions reference concepts and preserve what happened during one
interaction.

Concept reuse is explicit through stable identifiers. The host may propose
reusing an existing concept after inspecting history, but the engine does not
merge concepts through fuzzy name matching. Prior evidence can shorten a new
probe, never silently replace it when the new target requires stronger depth.

### 2. Reviews are first-class sessions

A due review can be started when no ordinary learning session is active. The
review session is bound to explicit due review items and concept identifiers.
Retention assessments update the durable concept and schedule the next review.
Partial or incorrect results create repair work. Closing the review preserves a
synthesis and leaves no hidden active state.

The complete acceptance path is:

1. learn a concept in Codex;
2. close the learning session;
3. observe the concept become due;
4. start its review in Pi;
5. record a miss and bounded repair;
6. complete a new transfer check;
7. close the review;
8. begin a related target that deliberately reuses and rechecks the concept.

### 3. Protocol state is enforceable

Assessment stages and session kinds are enumerated. A learning session accepts
probe and teaching actions; a review session accepts only its selected
retention work. Closing is legal only from a completed phase.

A required retry becomes an active checkpoint. Until it is resolved, the
engine rejects unrelated questions, new teaching steps, and closure. After a
second miss, the engine records that teaching is permitted and then requires a
new transfer question before the concept can advance. Contaminated questions
remain in the audit record but cannot satisfy any checkpoint.

### 4. Canonical state is recoverable

Schema version 2 has complete structural validation on every read and before
every write. Migration from version 1 is deterministic and creates a timestamped
backup before changing canonical state.

The store uses ownership-bearing lock files with PID, creation time, and a
random token. A live owner is never displaced. A dead owner's stale lock can be
recovered deterministically. Temporary files are unique per mutation, flushed
before rename, and never confused with canonical state.

The engine supplies:

- `doctor` for state, lock, backup, vault, and configuration diagnostics;
- `backup` for a consistent local snapshot;
- `restore --check` for non-mutating validation before restoration;
- `repair-render` for regenerating the derived Obsidian view;
- `export` for a portable, documented learner record.

### 5. State and Obsidian have an explicit consistency contract

Canonical JSON commits first. The state owns a monotonically increasing
revision. The generated-vault manifest records the revision it represents and
the generated file paths and hashes.

Rendering uses staged files and atomic per-file replacement. If rendering
fails after state commits, the command reports `stateCommitted: true` and a
separate render failure instead of pretending the entire mutation failed.
`doctor` detects a stale or partial projection, and `repair-render` reconciles
it without altering learning evidence.

Generated note filenames include stable identifiers so different topics that
slugify to the same text cannot overwrite one another. Removed generated files
are cleaned only through the prior manifest; user-created vault files and
visual assets are never deleted.

### 6. Stored and rendered inputs are safe

All timestamps are strict ISO-8601 instants. CLI commands reject unknown or
duplicate scalar options. State fields have explicit length and type limits.

Mermaid uses engine-generated safe node identifiers rather than user-supplied
IDs. Markdown headings, lists, links, and Obsidian embeds escape or neutralize
syntax that could change the document structure. Source references use an
allowlist of supported URL schemes or an explicit local-reference type.

Before a visual is recorded, it must resolve to a regular file inside the
vault, not traverse a symlink, and have its size, media type, and SHA-256
captured. Inspection remains a host responsibility, but existence and identity
become deterministic facts.

Private state directories and generated learning notes use owner-only
permissions. Documentation states exactly what is stored, where it is stored,
how to delete it, and that no telemetry leaves the machine.

### 7. Host integrations cannot freeze or overclaim

The Pi adapter invokes the CLI asynchronously with a timeout and cancellation
path. It reports initialization, active-session conflicts, committed-state
warnings, and repair instructions without blocking the Pi process.

Codex and Pi use the same commands and state semantics. The shared skill must
read durable context before acting, record each mutation immediately, and
surface any persistence failure before advancing.

Support claims require one live complete session in Codex and one in Pi. A
harness proves adapter mechanics; it does not substitute for a live host run.

## Behavioral quality gate

The value of the system depends on host-model behavior, so release requires a
versioned scenario suite and human adjudication. Scenarios cover:

- an expert learner with a narrow missing dependency;
- a novice with several missing prerequisite branches;
- a learner who states an admitted gap;
- an ambiguous target that requires one bounded clarification;
- a misconception requiring downward probing;
- a first miss, second miss, teaching repair, and new transfer;
- an answer leaked by the host and therefore contaminated;
- conflicting or insufficient sources;
- resumption after context loss;
- a due review that regresses and later recovers;
- a related new target that reuses prior evidence without assuming mastery.

Each transcript is graded on target fidelity, frontier accuracy, question
clarity, leakage avoidance, assessment accuracy, source support, one-step
pacing, persistence fidelity, and whole-system synthesis. Deterministic
invariants must pass in every scenario. Pedagogical dimensions require no
critical failure and a documented human judgment that the session was useful
and trustworthy.

## Setup and supported environment

The first release supports macOS with Node.js 20 and 22, current Codex project
skills, current Pi project extensions, and an optional Obsidian installation.
Obsidian is a viewer, not a state dependency.

A single setup command validates the runtime, initializes configuration,
creates protected data directories, verifies Codex/Pi discovery files, creates
the vault, and prints exact next commands. It must work from a fresh clone in a
path different from the developer's machine. No documentation may contain a
hardcoded personal absolute path as the required workflow.

## Release definition of done

The system is release-grade only when all of the following are true:

1. the multi-day Codex-to-Pi retention scenario passes end to end;
2. schema migration, backup, restore-check, stale-lock recovery, renderer
   repair, and corrupted-state diagnostics pass destructive fixture tests;
3. hostile identifier, Markdown, source, path, timestamp, and visual inputs
   cannot corrupt state or generated notes;
4. a fresh-clone setup and first session succeed outside the development path;
5. the behavioral scenario suite has no critical failure;
6. the complete automated suite passes on supported Node versions on macOS;
7. documentation, privacy boundary, recovery runbook, changelog, and exact
   verification record match the shipped version;
8. the repository has a clean, committed baseline and a versioned release tag.

Passing only unit tests, only a Pi harness, or only a single good teaching
conversation does not satisfy this definition.
