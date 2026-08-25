# Source-backed video parity

## Scope

This contract maps AI-tutor to the learner experience demonstrated in
[Build Your Own AI Learning Assistant](https://www.youtube.com/watch?v=kzcI5F4tGiU).
The English transcript was retrieved directly from YouTube on 2026-08-25 and
reviewed across the full `0:00`–`16:21` demonstration. The mapping paraphrases
the source; it does not reproduce the transcript.

## Demonstrated workflow

| Demonstrated behavior | Video range | AI-tutor implementation | Evidence boundary |
| --- | --- | --- | --- |
| Learner-owned target | 0:00–0:43 | `/teach` and `start` persist the learner's exact target and reject silent target replacement. | Persistence proves the target is retained, not that it is pedagogically well scoped. |
| One trusted interface over many sources | 0:00–5:13 | Codex and Pi share one skill, one canonical state engine, and one Obsidian projection. | External research still depends on the selected host's available tools. |
| Broad-to-narrow probe | 5:16–6:03 | The first probe is multiple-choice; adaptive children persist their parent and branch reason while the host binary-searches prerequisite strands. | The engine preserves the branch; host behavior determines question quality. |
| Choices, **I don't know**, and a note area | 8:08–8:30, 10:24–10:33, 11:29–12:04 | Pi supplies one interactive quiz modal; Codex supplies a numbered-card fallback. Answers, admitted gaps, and optional notes commit before feedback. | The Codex surface is chat-native rather than a TUI modal. |
| Agent-owned research and logistics | 0:43–5:13, 12:06–12:45 | The host owns source discovery, verification, fact-checking, ordering, and planning. Source choices remain discussable; the learner does not approve sources one at a time. | A recorded source is provenance, not automatic truth. |
| Explicit dependency plan | 6:03–6:53 | A validated prerequisite DAG is required before teaching and is rendered as Mermaid. | Acyclicity is deterministic; causal adequacy is a host-quality boundary. |
| Learner-specific teaching philosophy | 6:53–7:42 | Schema v4 stores a cross-session learner profile with teaching, explanation, feedback, visual, and source preferences. Codex and Pi read it through durable context; Obsidian renders `Profile.md`. | Empty fields deliberately fall back to the shared protocol. |
| One reasoning step at a time | 13:49–16:21 | Each motivated step persists its foundation, problem-solving move, and checkpoint before the learner answers; unresolved checkpoints block advancement. | A persisted step can still be explained poorly by a host model. |
| Periodic quizzes and checkpoints | 7:42–8:02, 13:49–16:21 | Probe, teaching, transfer, review, and synthesis lifecycles persist feedback and schedule later retention. | Scheduled review is not evidence of mastery until completed. |
| Verified visuals | 13:16–14:52 | Visuals are added only with a safe vault path, byte identity, description, and recorded inspection before embedding. | The engine verifies identity and inspection evidence; pedagogical usefulness remains a host-quality boundary. |
| Obsidian as the durable UI | 9:15–9:48, 13:49–16:21 | Canonical JSON regenerates linked Markdown for the profile, sessions, Mermaid plan, questions, notes, sources, visuals, topics, and reviews. | Obsidian is a viewer, not the mutation source. |

## Completion meaning

Video parity means the complete demonstrated workflow has a concrete product
surface and durable evidence path in AI-tutor. It does not guarantee that a
host model teaches well, every source is correct, every visual helps, or a
learner understands the target. Those are behavioral outcomes, not properties
that repository tests can prove.
