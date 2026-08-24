# Prototype Verification Baseline

Date: 2026-08-24

## Purpose

This record freezes the evidence boundary before release hardening begins. It
describes what the current prototype proves, what it does not prove, and the
specific gaps that prevent a release-grade claim.

## Reproduced baseline

- Repository state: new standalone Git repository with no prior commit.
- Runtime: Node.js `v26.0.0`.
- Automated suite: 49 tests, 49 passed, 0 failed.
- Runtime dependencies: none.
- Host evidence: Codex and Pi contracts are exercised through repository tests.
- Live Pi evidence: not available because Pi is not installed on this machine.
- Behavioral evidence: deterministic lifecycle and adapter fixtures only; no
  live multi-day Codex-to-Pi retention acceptance run has been completed.

## What the 49 tests establish

The tests establish the current version-1 deterministic contract for session
lifecycle, assessment records, graph validation, retention scheduling, JSON
persistence, Obsidian rendering, CLI behavior, the shared skill contract, and
the Pi adapter harness.

They do not establish release readiness. In particular, a passing due-queue
test does not prove that a due review can be started, completed, and persisted
after the original learning session has closed.

## Release-blocking gaps

1. Knowledge and review state are owned by individual sessions instead of a
   durable learner-level concept catalog.
2. Due reviews can be listed after close, but there is no first-class review
   session that can safely record the result.
3. Retry requirements are recorded but do not enforce the next permitted
   assessment or question.
4. Session closure and assessment-stage transitions are insufficiently strict.
5. State reads validate only the schema version, not the complete shape and
   referential integrity, and there is no migration path.
6. A killed process can leave an unrecoverable lock; there is no validated
   backup, restore-check, or doctor workflow.
7. Canonical state may advance before rendering fails, but there is no explicit
   revision/manifest contract or repair-render command.
8. Topic filenames, Markdown contexts, Mermaid identifiers, and generated-file
   cleanup are not hardened against collisions or hostile input.
9. Visual registration does not prove the file exists or record a content hash,
   media type, and byte count.
10. CLI timestamps, duplicate options, and unknown options are not validated
    strictly enough.
11. The Pi adapter uses a synchronous child process and has no timeout or
    cancellation path.
12. Setup, export, recovery, privacy, supported-version CI, live host evidence,
    and release artifacts are incomplete.

## Accepted implementation direction

The current dependency-free Node.js engine remains the base. Hardening moves
knowledge and retention into schema-versioned learner state, adds first-class
review sessions and an enforced protocol state machine, makes storage and
rendering recoverable, hardens every persisted/rendered input, and verifies a
multi-day Codex-to-Pi scenario before any release tag.

The engineering quality target is release-grade local software. This is not a
decision to commercialize the project and does not add hosted, multi-user,
authentication, billing, telemetry, or cross-platform scope.
