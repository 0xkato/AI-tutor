# Behavioral alignment with `amosblomqvist/learn`

## Reference boundary

This review used [`amosblomqvist/learn`](https://github.com/amosblomqvist/learn)
at commit `73eaf7c5a1a0c19217ba98580e4fc4de35841aa6` (2026-08-24) as a
behavioral reference. AI-tutor does not copy its implementation. The reference
is a small personal Pi configuration; AI-tutor is an independently implemented
product with canonical learner state, recovery, retention, and two host
surfaces.

## Adopted product contracts

| Reference behavior | AI-tutor contract |
| --- | --- |
| A graded quiz and a non-graded input prompt are different tools. | Multiple-choice uses a deterministic answer key. Open-ended transfer, explanation, reconstruction, debugging, retention, and synthesis use persisted checkpoints. |
| `I don't know` is a distinct signal, not an incorrect guess. | It creates no assessment or grade. During probe it records a diagnostic gap; during an active teaching, retention, or synthesis checkpoint it records a checkpoint gap, authorizes teaching, and requires a new transfer question. |
| A learner can attach a note to any quiz response. | Pi and Codex persist the answer and optional note before feedback. Notes remain attached to the exact learning object. |
| Correct answers are keyed by stable option values and options may be shuffled. | Deterministic grading binds stable choice values to the persisted question definition rather than a display position. |
| Distractors should represent plausible misconceptions and should not reveal the answer by shape. | The teaching protocol requires diagnostic, unambiguously wrong, parallel options and forbids answer leakage. |
| Probe, plan, and teach are separate phases. | The engine persists the learner-owned target, bounded frontier, validated dependency DAG, one motivated teaching step, and its checkpoint before accepting an answer. |
| Teaching starts from unconditional truths and motivates the next move. | Every step records its foundation, concrete limitation, smallest resolving move, connection, and checkpoint. |
| Questions and results can be logged to Markdown. | Canonical JSON is the mutation source; an inspectable Obsidian vault is regenerated from it and includes questions, notes, gaps, sources, plans, visuals, reviews, and synthesis. |

## Deliberate differences

- The reference reveals the correct option and explanation after any submitted
  quiz result. AI-tutor keeps the first genuine miss answer-free so the bounded
  retry remains valid evidence.
- The reference primarily relies on the Pi transcript and an optional Markdown
  log. AI-tutor uses schema-validated canonical state, atomic writes, backups,
  deterministic export, and render reconciliation.
- The reference delegates research and visuals when subagents are available.
  AI-tutor treats host research as an implementation boundary and records
  claim-level provenance; it does not require a learner to approve sources one
  by one.
- The reference is intentionally personalized and shared as-is. AI-tutor keeps
  learner-authored preferences in a durable cross-session profile and preserves
  the same behavior across Codex and Pi.

## Gap lifecycle fixed by this review

The former plain-text checkpoint path told the host to use
`record-admitted-gap`, while the command accepted only the probe phase. A
learner saying `I don't know` during a persisted teaching checkpoint therefore
hit `INVALID_PHASE` and stranded the lesson.

`record-admitted-gap` is now phase-aware:

1. In probe, it records an ungraded diagnostic gap as before.
2. In teaching or retention, it must match the single active checkpoint; in
   synthesis, the host must first localize the gap to one concrete concept.
3. It stores the exact learner statement and evidence in `checkpointGaps`.
4. It creates no assessment, preserves the checkpoint, authorizes teaching,
   and requires a new transfer question.
5. A mismatched question or node fails without changing canonical state.

For whole-system synthesis, the host first localizes the admission to a concrete
concept. The engine then reopens that concept for teaching or review repair and
requires a new whole-system transfer. It never fabricates an incorrect
synthesis assessment.
