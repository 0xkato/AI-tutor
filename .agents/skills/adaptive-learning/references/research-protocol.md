# Research Protocol

The agent owns research logistics, source discovery, verification, and
fact-checking. The learner should spend attention on understanding and source
tradeoffs, not approve every resource individually.

## Source selection

1. Convert each uncertain teaching claim into a research question.
2. Prefer primary sources: official documentation, original papers, standards,
   direct datasets, or authoritative textbooks where appropriate.
3. Use secondary explanations when they materially improve pedagogy, but keep
   the underlying primary support visible.
4. Compare important definitions or contested claims against an independent
   source. Record disagreements instead of silently choosing one.
5. Reject sources whose accessible evidence does not support the intended
   claim.

Discuss source selection with the learner: name why a source class fits, which
claim it supports, and any limitation that changes the lesson. Do not require
per-source approval and do not ask the learner to certify expertise they do not
yet possess.

## Required ledger fields

Every stored source includes:

- title and stable URL or local reference;
- source class;
- role: `anchor` for learner-supplied material or `supplemental` for research
  added by the host;
- the matching material ID for anchor evidence;
- an exact timestamp, page, section, heading, or file locator;
- supported claim;
- verification note describing what was checked.

Keep observation, source claim, inference, and speculation distinct. A source
entry proves only that the stated support and verification were recorded; it
does not make the claim true automatically.

## Source-guided sessions

A session with learner-supplied materials is source-guided.

1. Inspect every supplied material before teaching from it. Resolve it as
   `verified` only after the host can access and identify what it contains;
   otherwise resolve it as `unavailable` and preserve that boundary. An
   unavailable anchor blocks source-guided teaching until the learner supplies
   an accessible replacement or explicitly chooses a supplemental-only lesson.
2. Record claims from the supplied material as anchor evidence with its
   material ID and an exact locator. A video claim needs a timestamp; a PDF
   claim needs a page; notes or a web page need a heading or section; a
   repository claim needs a file locator, adding a line or symbol when useful.
3. Keep independent research as supplemental evidence. Anchor and supplemental
   evidence remain separate even when they support the same claim.
4. If supplemental evidence disagrees with the anchor, make the disagreement
   visible and state whether it corrects, limits, or supplements the anchor.
   Do not silently rewrite the supplied source.
5. After validating the plan, run `record-source-coverage` for each plan node
   before teaching it. The coverage note explains why the cited claims support
   that node and records any remaining uncertainty.
6. When teaching from a claim, show its exact locator with the explanation.

Source coverage is not understanding or learner evidence. It proves that the
teaching step has a recorded source basis; only assessed learner work can show
understanding or mastery.

## Research failure

If a source is inaccessible, contradictory, or too weak, record the unresolved
gap. Do not fabricate a citation or present model recall as verified research.
Teaching may continue only with an explicit uncertainty boundary that does not
undermine the next step.

## Visuals

Use Mermaid for dependency structure. For any generated or imported visual,
inspect the visual before embedding it. Verify labels, orientation, scale,
relationships, and consistency with the explanation; then record both a plain
description and the verification performed.
