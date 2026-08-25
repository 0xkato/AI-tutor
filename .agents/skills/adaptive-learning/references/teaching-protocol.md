# Teaching Protocol

Use this protocol for probing, teaching, assessment, clarification, retention,
and whole-system reconstruction.

## 1. Frame the target

The learner supplies the target. Restate it once with the supplied context and
scope. Ask only for missing context that would materially change the route.
Do not ask the learner to redesign behavior already fixed by this protocol.

## 2. Locate the knowledge frontier

For a new target, the first broad probe is a persisted multiple-choice question
that samples a major prerequisite branch. Every multiple-choice interaction
offers **I don't know** and an optional note on the same interaction as the
question and answer. Recognition is calibration evidence, not mastery.

In Pi, call `adaptive_learning_quiz`; it persists the question, response, note,
and assessment before returning feedback. Do not duplicate those mutations.
In Codex, render a compact numbered card only after `start-question` succeeds,
accept a numbered answer or `I don't know` plus optional `Note: ...`, then run
`submit-question` before feedback. It atomically persists the response, note,
and deterministic assessment or probe-stage admitted gap. Never expose the
stored answer key in the card or context.

After the first question, every question records the exact prior question as
`--parent-question-id` and the observed reason for the branch as
`--adaptation-reason`. This applies whether the next question becomes harder,
backs up to a prerequisite, or transfers after teaching.

Then binary-search each prerequisite strand:

1. If the learner demonstrates a node, probe a harder dependent node.
2. If the learner misses, probe the nearest prerequisite.
3. Continue until the first demonstrated prerequisite and first unsupported
   dependent concept are adjacent.
4. Stop probing once every important branch has a bounded frontier. Do not
   turn diagnosis into an exhaustive trivia interview.

An admitted knowledge gap is not a quiz target. Selecting **I don't know** is
an admission, not an incorrect attempt. The interactive submission persists it
without an assessment or grade. Use `record-admitted-gap` only when the learner
states the gap outside that interaction. Teach the missing mechanism, then
assess it with a new transfer question or example. Never duplicate the
admission as incorrect attempts to satisfy a retry gate.

## 3. Produce the dependency route

The plan is a directed acyclic graph in which `from -> to` means the learner
needs `from` to understand `to`. Every edge states the causal reason for the
dependency. A validated prerequisite dependency DAG must exist before teaching.
Render it as Mermaid and identify the current frontier.

## 4. Teach through motivated discovery

For one frontier node only:

1. **Foundation:** State the definitions, invariants, or unconditional
   foundations available at this point.
2. **Problem:** Name the concrete limitation those foundations cannot yet
   solve.
3. **Move:** Introduce the smallest new idea that resolves that limitation.
4. **Connection:** Show how the move depends on the prior node and enables the
   next one.
5. **Checkpoint:** Ask one fully framed question that tests the move.

Motivate every move; never dump the completed route and call it teaching. Use
one reasoning step at a time and wait for the checkpoint before advancing.

## 5. Clarify without leakage

A clarification explains only the missing term, variable role, or premise and
then returns to the same question. It must not contain the inference being
tested. If the requested clarification cannot avoid revealing that inference,
discard the question and construct a fresh one.

## 6. Grade exact evidence

Use exactly:

- **Correct:** the required causal mechanism is present for the stated scope;
- **Partial:** a named portion is correct, but a specific required link is
  absent or wrong;
- **Incorrect:** the central mechanism or prediction is wrong.

Assess the learner's latest clarified answer, not stale wording. State the
exact demonstrated part, missing link, or error type. Never invent a criticism
to make feedback appear rigorous.

On the first genuine miss, describe where the reasoning broke and its error
type, do not reveal the answer, and offer a bounded retry. After a second miss
or direct request, teach the missing mechanism. Afterwards, require a new
transfer question rather than repetition.

First-miss feedback must not state the correct outcome, expected mechanism,
correct value, corrective steps, or replacement answer wording. It may name
only the location of the break and a bounded error type. Before sending any
assessment feedback, persist the exact question, exact learner answer, grade,
evidence, and mistake type with `record-assessment`. Send the feedback only
after `record-assessment` succeeds; a persistence failure blocks the grade and
the next conversational step.

For retention, before running `start-review-checkpoint`, compare the candidate
question with the selected concept's title, knowledge summary, and causal
mechanism. A new scenario is valid only when solving it requires that same
mechanism. Topic overlap alone is not enough; reject a question that substitutes
a neighboring mechanism.

If the assistant exposed an answer or steered the learner to it, mark the
question contaminated. Discard contaminated work as evidence even when the
learner's final words are correct.

## 7. Build durable evidence

Prefer an appropriate mix of:

- explanation in the learner's own words;
- prediction before an output is shown;
- transfer to an unfamiliar example;
- reconstruction without notes;
- debugging a broken mechanism;
- whole-system synthesis.

Multiple choice locates the initial frontier and may cheaply refine it, but
recognition alone supports only fragile evidence. Later checks should move to
own-words, prediction, transfer, reconstruction, or debugging evidence. Due
review results drive spaced retention. Three related due nodes or every seventh
completed review should trigger a whole-system synthesis rather than isolated
repetition.

When a correct teaching-stage multiple-choice answer produces
`new-transfer-required` with `answerMayBeTaught: false`, do not reteach that
answer. Persist a new checkpoint with a new question ID that asks for durable
transfer, prediction, reconstruction, or debugging evidence.

The interactive multiple-choice surface is therefore limited to `probe` and
`teach`. Never label one of its selections as a `retention` assessment. Use the
persisted review-checkpoint lifecycle for retention evidence.
