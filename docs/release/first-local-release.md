# First Local Release Audit

Date: 2026-08-25

Status: **locally verified release candidate; not a stable release**

Package version: `0.2.0-rc.1`

Release tag: none

This is the requirement-by-requirement audit for the first release-grade local
adaptive-learning build. It records evidence even when the evidence fails a
gate. Passing unit tests, a complete artifact package, or a successful runtime
smoke test is not treated as release acceptance.

## Definition-of-done reconciliation

| # | Release criterion | Authoritative evidence | Status |
| --- | --- | --- | --- |
| 1 | Multi-day Codex-to-Pi retention passes end to end | [`live-host-acceptance.md`](../verification/live-host-acceptance.md), `artifacts/evals/2026-08-24-codex-novice-branches-byte-exact/`, and `artifacts/evals/2026-08-25-pi-retry-repair-transfer-openai-byte-exact/` | **Partially verified / unproved.** Fresh Codex and Pi-to-OpenAI-Codex sessions used the same canonical root and completed the required learning, due-review, bounded repair, transfer, and closure lifecycle with byte-exact final snapshots and no critical failures. Both independent human verdicts remain pending. |
| 2 | Migration, backup, restore-check, stale-lock recovery, renderer repair, and corrupted-state diagnostics pass destructive checks | Focused recovery/migration/render/setup/CLI/review tests; manual malformed-state check; actual permission-failure audit | **Verified locally.** The actual permission audit committed canonical revision 1 despite `EACCES`; after permissions were restored, `repair-render` preserved the exact state bytes and `doctor` reported the projection current. Export and evaluation capture also refuse source files swapped to symlinks between validation and opening. |
| 3 | Hostile identifiers, Markdown, sources, paths, timestamps, and visuals cannot corrupt state or notes | Schema, CLI-options, render-safety, source, visual, graph, and protocol-invariant tests in the full suite | **Verified locally** for the defined macOS implementation contract. Unsafe custom vault paths are rejected before canonical state is created and are rejected again during state validation. |
| 4 | Fresh-clone setup and first session succeed outside the development path | `npm run release-check`, including disposable fresh-path setup and E2E fixtures | **Verified locally** with the complete release check on official Node `v20.20.2` and `v22.23.2` macOS arm64 runtimes. Setup exposes `Profile.md` and the Pi `/learn-profile` entry point before `/teach`. |
| 5 | Behavioral scenario suite has no critical failure | Five preserved live-host packages plus the release validator | **Partially verified.** The two fresh release candidates have no contaminated questions or critical failures and pass every deterministic check. Their human verdicts remain pending. The earlier Pi failures remain preserved as historical regression evidence rather than being overwritten. |
| 6 | Complete suite passes on macOS with Node 20 and 22 | Local runtime and GitHub Actions matrix | **Partially verified.** The complete release check passed locally on official Node `v20.20.2` and `v22.23.2` macOS arm64 runtimes. The uncached macOS workflow is committed and contract-tested. Private remote `0xkato/AI-tutor` contains candidate commit `c827024`; workflow run [`32833414368`](https://github.com/0xkato/AI-tutor/actions/runs/32833414368) created both jobs with zero steps, then GitHub rejected them before execution because of an account billing/spending-limit block. |
| 7 | Documentation, privacy, recovery, changelog, and verification match the shipped version | Operator documentation and this audit | **Verified for the release candidate.** Privacy, recovery, scoped transmission approval, version `0.2.0-rc.1`, changelog, source-backed parity contract, operator setup, and current local verification are reconciled. Human acceptance and hosted CI remain separate release gates. |
| 8 | Repository is clean, committed, and has a release tag | Git status, commit history, and tag list | **Partially verified.** The candidate is prepared on an isolated branch for a clean intended commit. No release tag exists, by design, while human acceptance and hosted CI remain incomplete. |

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

- 196 of 196 automated tests passing;
- JavaScript syntax and JSON document checks passing;
- disposable fresh-path setup passing;
- 7 of 7 end-to-end learning and review fixtures passing;
- fresh-path `doctor` reporting `ok`;
- the final `Release check passed.` receipt.

This proves the supported runtime matrix locally on this macOS arm64 machine.
It does not prove hosted GitHub Actions execution or another operating system.

## Live-host decision

Five evidence packages are preserved. The two fresh candidates are mechanically
complete but are not passing release evidence until independent review:

- `2026-08-24-codex-context-resume`: structurally valid, human verdict pending,
  deterministic final-state check false;
- `2026-08-24-pi-gptoss-answer-leakage`: structurally valid failed evidence,
  critical leakage and persistence failures;
- `2026-08-24-pi-gptoss-target-drift`: structurally valid failed evidence,
  critical target-drift and leakage failures.
- `2026-08-24-codex-novice-branches-byte-exact`: every deterministic check
  passes, no critical failures, human verdict pending;
- `2026-08-25-pi-retry-repair-transfer-openai-byte-exact`: every deterministic
  check passes, no critical failures, human verdict pending.

The validator accepts all five structurally with `--allow-failed`. It correctly
rejects the historical failures and the two pending candidates as release
evidence without that flag.

## Required path before a release tag

1. Obtain independent human `pass` verdicts for the fresh Codex and Pi packages
   and validate the accepted packages
   without `--allow-failed`.
2. Resolve the GitHub billing/spending-limit block, then rerun the committed
   uncached macOS Node 20/22 CI matrix and retain executed hosted receipts.
3. The hardened prerelease version, changelog, and local matrix now exist.
   Create the annotated stable tag only after the two remaining gates pass.

Until every item passes, do not create a release tag or describe this build as
fully production-ready.
