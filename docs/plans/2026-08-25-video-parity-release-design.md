# Video-Parity Release Design

## Purpose

Finish AI-tutor against the learner experience demonstrated in
<https://www.youtube.com/watch?v=kzcI5F4tGiU>, rather than treating automated
engine coverage as product completion.

The source transcript was retrieved directly from YouTube on 2026-08-25. The
demonstration defines one trusted teaching interface that owns calibration,
research logistics, planning, teaching, feedback, visuals, and a durable
Obsidian learning artifact.

## Source-derived product contract

| Video behavior | Evidence in the video | Required AI-tutor behavior | Current state before this release |
| --- | --- | --- | --- |
| Learner-owned target | The learner invokes `teach` with a desired understanding. | Persist the exact target and never replace it silently. | Implemented. |
| Broad-to-narrow probe | The quiz starts broad and binary-searches every important prerequisite strand. | The first probe is multiple-choice; later questions carry their adaptive parent and reason. | Implemented and unit-tested; fresh live interactive acceptance remains. |
| One question surface | The quiz shows choices, `I don't know`, and a note area for reasoning/context. | Pi provides one interactive card; Codex provides the same persisted numbered-card fallback. | Implemented and unit-tested. |
| Agent-owned logistics | Research, source discovery, verification, fact-checking, ordering, and planning belong to the system. | The learner discusses material source choices but does not approve or verify each source. | Implemented as the host skill contract and source ledger; host quality remains evidence-dependent. |
| Explicit dependency plan | The system reasons out the route and shows a Mermaid graph before teaching. | Validate a causal prerequisite DAG and render the same graph in Obsidian. | Implemented. |
| Learner-specific philosophy | Teaching behavior is installed with the learner's own learning philosophy and preferences. | Persist a reusable learner profile and require the host to consult it before probing or teaching. | Missing as a first-class cross-session product surface. |
| Slow motivated teaching | The lesson advances one reasoning step at a time and does not rush through the graph. | Persist one motivated step and resolve its checkpoint before advancing. | Implemented. |
| Continuous feedback | The system quizzes periodically for calibration, practice, and consolidation. | Persist assessments, repair first misses without leakage, and require transfer evidence. | Implemented. |
| Useful verified visuals | Visual work is generated when helpful, inspected, corrected, and embedded in the lesson. | The host generates and inspects visuals; the engine verifies file identity and records description and inspection evidence before embedding. | Structurally implemented; fresh live acceptance remains. |
| Obsidian as durable UI | The learning session, Mermaid plan, LaTeX, notes, and visuals appear in a linked Markdown artifact. | Canonical JSON renders automatically to an Obsidian-compatible vault after every successful mutation. | Implemented. |
| One trusted interface over many sources | The learner should spend effort on the material rather than switching tools and source conventions. | Codex and Pi share one protocol and canonical state; sources remain visible with provenance. | Implemented within the stated host boundaries. |

## Architecture change

Add a schema-versioned top-level learner profile containing a learner-authored
teaching philosophy and optional preferences for explanations, feedback,
visuals, and sources. The profile belongs to canonical state, renders to
`vault/Profile.md`, and is available through one read/update CLI surface.
Codex and Pi must both consult it; Pi also exposes a `/learn-profile` command.

Do not build a second tutoring application or duplicate Codex/Pi model APIs.
The video itself uses Pi plus Obsidian as the interface. The existing hybrid
engine remains responsible for deterministic state, while the host model owns
research, explanation, and visual generation.

## Release evidence

Completion requires:

1. every row in this contract implemented or explicitly bounded as a host
   quality claim rather than a product feature;
2. a fresh interactive acceptance flow that begins with the persisted
   multiple-choice surface and carries learner notes into Obsidian;
3. the full release check on supported Node 20 and 22 runtimes;
4. hosted CI attempted and its exact result recorded without calling an
   account or billing rejection a code failure;
5. clean release documentation, version, changelog, commit, and remote receipt;
6. no production-ready claim until the remaining independent human acceptance
   gate is actually resolved.

## Claim boundary

Parity means that AI-tutor implements the complete workflow demonstrated by
the video. It does not mean the host model is guaranteed to teach well, every
source is automatically true, every generated visual is pedagogically useful,
or a learner has mastered a subject. Those are behavioral outcomes that need
recorded evidence.
