# First Local Release Audit

Date: 2026-08-24

Status: **not released**

Package version: `0.1.0`

Release tag: none

This is the requirement-by-requirement audit for the first release-grade local
adaptive-learning build. It records evidence even when the evidence fails a
gate. Passing unit tests, a complete artifact package, or a successful runtime
smoke test is not treated as release acceptance.

## Definition-of-done reconciliation

| # | Release criterion | Authoritative evidence | Status |
| --- | --- | --- | --- |
| 1 | Multi-day Codex-to-Pi retention passes end to end | [`live-host-acceptance.md`](../verification/live-host-acceptance.md) and `artifacts/evals/2026-08-24-*` | **Failed / unproved.** The Codex package is pending because the byte-exact final live state was not retained. Both local Pi behavioral runs contain critical failures. The cloud Pi run proves connectivity only. |
| 2 | Migration, backup, restore-check, stale-lock recovery, renderer repair, and corrupted-state diagnostics pass destructive checks | Focused recovery/migration/render/setup/CLI/review tests; manual malformed-state check; actual permission-failure audit | **Verified locally.** The actual permission audit committed canonical revision 1 despite `EACCES`; after permissions were restored, `repair-render` preserved the exact state bytes and `doctor` reported the projection current. Export and evaluation capture also refuse source files swapped to symlinks between validation and opening. |
| 3 | Hostile identifiers, Markdown, sources, paths, timestamps, and visuals cannot corrupt state or notes | Schema, CLI-options, render-safety, source, visual, graph, and protocol-invariant tests in the full suite | **Verified locally** for the defined macOS implementation contract. Unsafe custom vault paths are rejected before canonical state is created and are rejected again during state validation. |
| 4 | Fresh-clone setup and first session succeed outside the development path | `npm run release-check`, including disposable fresh-path setup and E2E fixtures | **Verified locally** with the complete release check on official Node `v20.20.2` and `v22.23.2` macOS arm64 runtimes. |
| 5 | Behavioral scenario suite has no critical failure | Three packaged live-host artifacts plus the release validator | **Failed.** The two Pi packages preserve answer leakage, target drift, persistence mismatch, or incomplete-review failures. No artifact currently receives an accepted human verdict. |
| 6 | Complete suite passes on macOS with Node 20 and 22 | Local runtime and GitHub Actions matrix | **Partially verified.** The complete release check passed locally on official Node `v20.20.2` and `v22.23.2` macOS arm64 runtimes. The uncached macOS workflow is committed and contract-tested, but it cannot produce hosted evidence until this local repository has a GitHub remote and the workflow runs there. |
| 7 | Documentation, privacy, recovery, changelog, and verification match the shipped version | Operator documentation and this audit | **Unproved.** Privacy and recovery documentation exist, but an accepted version, changelog entry, final versioned verification record, and CI evidence do not. |
| 8 | Repository is clean, committed, and has a release tag | Git status, commit history, and tag list | **Partially verified.** The canonical release-hardening branch is clean and its current changes are committed. No release tag exists. |

## Destructive evidence completed locally

- deterministic migration from schema version 1 and rejection of unsupported
  future versions;
- malformed canonical JSON rejected with `INVALID_STATE` while the malformed
  bytes remained unchanged;
- backup integrity, tamper detection, and non-mutating `restore --check`;
- live-owner lock protection and dead-owner stale-lock recovery;
- staged rendering, symlink and unmanifested-target refusal, stale-projection
  diagnosis, and non-mutating repair;
- descriptor-based export and evaluation capture that refuse symlink swaps and
  recheck verified visual bytes and hashes before export;
- unsafe custom vault directories rejected before canonical state creation and
  during every state validation;
- actual vault permission denial (`EACCES`) after canonical commit, followed by
  successful repair at the same revision with identical canonical state bytes;
- fresh setup, independent CLI lifecycle, first-class review lifecycle, and
  generated-note collision handling.

## Supported-runtime evidence completed locally

Official macOS arm64 archives for Node `v20.20.2` and `v22.23.2` were checked
against their published `SHASUMS256.txt` entries before use. The complete
`scripts/release-check.mjs` path then exited `0` under each runtime with:

- 146 of 146 automated tests passing;
- JavaScript syntax and JSON document checks passing;
- disposable fresh-path setup passing;
- 7 of 7 end-to-end learning and review fixtures passing;
- fresh-path `doctor` reporting `ok`;
- the final `Release check passed.` receipt.

This proves the supported runtime matrix locally on this macOS arm64 machine.
It does not prove hosted GitHub Actions execution or another operating system.

## Live-host decision

The preserved evidence packages are complete historical records, not passing
release evidence:

- `2026-08-24-codex-context-resume`: structurally valid, human verdict pending,
  deterministic final-state check false;
- `2026-08-24-pi-gptoss-answer-leakage`: structurally valid failed evidence,
  critical leakage and persistence failures;
- `2026-08-24-pi-gptoss-target-drift`: structurally valid failed evidence,
  critical target-drift and leakage failures.

The validator accepts these packages only when explicitly asked to preserve
failed evidence with `--allow-failed`. It rejects all three as release evidence
without that flag.

## Required path before a release tag

1. Run a fresh Codex scenario and retain the original final state bytes before
   any later host mutates the root. Use the tested exclusive
   `scripts/package-eval-artifact.mjs` capture path immediately after session
   closure rather than manually copying evidence later.
2. After explicit founder approval for the described data egress, run a fresh
   cloud Pi behavioral scenario on a disposable root.
3. Repair any critical behavioral failure with a regression test or narrowly
   scoped protocol rule, then rerun from a fresh root.
4. Obtain independent human `pass` verdicts and validate the accepted packages
   without `--allow-failed`.
5. Create or attach the intended GitHub remote, then run the committed uncached
   macOS Node 20/22 CI matrix and retain the hosted receipts.
6. Only after live acceptance, choose the hardened prerelease version, add the
   changelog and exact version record, rerun the full destructive audit, land a
   clean commit, and create the annotated tag.

Until every item passes, do not create a release tag or describe this build as
fully production-ready.
