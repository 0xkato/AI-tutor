# CLI Reference

Run from the adaptive-learning repository. Replace `<root>` with the directory
whose `.adaptive-learning/state.json` and Obsidian vault should be used.

```bash
node bin/learn.mjs <command> --root <root> [options]
```

Use `--json` for runner-readable output and `--now <ISO-8601>` only when a
deterministic event time is required.

## Resume and inspect

```bash
node bin/learn.mjs init --root <root>
node bin/learn.mjs status --root <root> --json
node bin/learn.mjs context --root <root> --json
node bin/learn.mjs due --root <root> --json
```

Run `context --json` before probing, resuming, or teaching an active session.
It returns the cross-session `learnerProfile`, durable session, retries, due
reviews, and synthesis flag.

## Learner profile

The profile belongs to canonical state and is shared by Codex, Pi, and the
Obsidian projection. Read it before learning work and update only fields the
learner actually supplied:

```bash
node bin/learn.mjs profile --root <root> --json

node bin/learn.mjs set-profile --root <root> \
  --teaching-philosophy "<learner-authored learning principles>" \
  --explanation-preferences "<pace, structure, and detail>" \
  --feedback-preferences "<assessment and correction preferences>" \
  --visual-preferences "<when and how visuals help>" \
  --source-preferences "<research and evidence preferences>"
```

Unspecified fields are preserved. Pi exposes the same state through
`/learn-profile`; `field :: value` updates `teaching`, `explanations`,
`feedback`, `visuals`, or `sources`, while text without a field updates the
teaching philosophy.

## Review lifecycle

`due` only lists currently available review IDs. It does not claim, assess, or
complete them.

```bash
node bin/learn.mjs due --root <root> --json

node bin/learn.mjs start-review --root <root> \
  --review <due-review-id> \
  --review <another-due-review-id>

node bin/learn.mjs start-review-checkpoint --root <root> \
  --question-id retention-q1 \
  --node <selected-node> \
  --kind retention \
  --question "<fully framed retrieval question>"

node bin/learn.mjs record-assessment --root <root> \
  --question-id retention-q1 --node <selected-node> \
  --stage retention --kind retention \
  --question "<fully framed retrieval question>" \
  --answer "<learner answer>" --grade incorrect \
  --evidence "<exact retained and missing mechanism>" \
  --mistake-type "<bounded error type>"

# The bounded retry preserves the exact checkpoint identity and question.
node bin/learn.mjs record-assessment --root <root> \
  --question-id retention-q1 --node <selected-node> \
  --stage retention --kind retention \
  --question "<fully framed retrieval question>" \
  --answer "<learner retry answer>" --grade incorrect \
  --evidence "<exact retained and still-missing mechanism>" \
  --mistake-type "<bounded error type>"

# After repair, persist the new transfer checkpoint before showing it.
node bin/learn.mjs start-review-checkpoint --root <root> \
  --question-id retention-transfer-q1 \
  --node <selected-node> \
  --kind transfer \
  --question "<new transfer task after repair>"

node bin/learn.mjs record-assessment --root <root> \
  --question-id retention-transfer-q1 --node <selected-node> \
  --stage retention --kind transfer \
  --question "<new transfer task after repair>" \
  --answer "<learner answer>" --grade correct \
  --evidence "<exact transfer evidence>"

node bin/learn.mjs close-review --root <root> \
  --synthesis "<what the review established and what changed>"
```

Repeat `--review` to claim multiple due concepts from the same topic. The claim
is atomic: the selected items stay unavailable to another session until this
review closes. Only selected concepts accept retention assessments.
`start-review-checkpoint` must persist the exact question identity before the
learner answer; `record-assessment` rejects review evidence without that
checkpoint or with changed question text, node, ID, or kind.
Before `start-review-checkpoint`, compare the question with the selected
concept's title, knowledge summary, and causal mechanism. After the learner
answers, run `record-assessment` with the exact answer and wait for success
before showing the grade or assessment feedback. If the command fails, do not
send the grade or advance the review.
If a review answer is contaminated, it remains audit-only and does not change
the review item, concept evidence, retry, or checkpoint. Replace that discarded
question with `start-review-checkpoint`, using a new question ID and a durable
transfer kind, and persist the replacement before accepting the next answer.

If a selected item cannot be assessed validly, use `defer-review` before starting a review checkpoint.
It cannot be deferred while its checkpoint or retry is active; resume that
checkpoint, or replace it after contamination, before closing:

```bash
node bin/learn.mjs defer-review --root <root> \
  --review <selected-review-id> \
  --reason "<why valid assessment cannot happen now>" \
  --until "2026-09-01T09:00:00.000Z"
```

`close-review` fails until every item is resolved or deferred. A resolved item
advances its durable review record exactly once, even if repair required
multiple assessment attempts. Deferral preserves the review count and records
the reason and next due instant. The session synthesis is audit evidence; it
does not itself raise concept mastery.

## New learning session and probe

```bash
node bin/learn.mjs start --root <root> \
  --topic "Differential forms" \
  --target "Build a causal introduction" \
  --context "Knows basic calculus"

# Persist the first multiple-choice probe before displaying it. Each --choice
# value is JSON with a stable value and learner-facing label.
node bin/learn.mjs start-question --root <root> \
  --id probe-q1 --stage probe --node vectors --kind multiple-choice \
  --question "Which description best matches a vector here?" \
  --mode single-select \
  --choice '{"value":"coordinates","label":"An ordered list relative to a basis"}' \
  --choice '{"value":"derivative","label":"A rule that differentiates functions"}' \
  --correct coordinates \
  --explanation "A vector can be represented by coordinates after choosing a basis."

# Read only the redacted learner-facing question.
node bin/learn.mjs pending-question --root <root> --json

# Atomically persist the learner's selection, optional same-question note, and
# deterministic assessment before conversational feedback.
node bin/learn.mjs submit-question --root <root> \
  --question-id probe-q1 --response-id probe-q1-a1 \
  --selected coordinates \
  --note-id probe-q1-note \
  --note "I remember that the coordinates depend on the chosen basis." \
  --outcome-id probe-q1-assessment

# Every later question records the response that caused the adaptive branch.
node bin/learn.mjs start-question --root <root> \
  --id probe-q2 --stage probe --node basis-dependence --kind multiple-choice \
  --question "What changes when only the basis changes?" \
  --mode single-select \
  --choice '{"value":"vector","label":"The geometric vector itself"}' \
  --choice '{"value":"coordinates","label":"Its coordinate list"}' \
  --correct coordinates \
  --explanation "Coordinates change with the basis while the vector does not." \
  --parent-question-id probe-q1 \
  --adaptation-reason "The first answer was correct; test basis dependence."

# I don't know and the probe-stage admitted gap commit atomically without a
# guess or assessment. Follow with teaching and a new transfer question.
node bin/learn.mjs submit-question --root <root> \
  --question-id probe-q2 --response-id probe-q2-gap \
  --dont-know \
  --note-id probe-q2-note \
  --note "I do not yet understand what belongs to the vector versus the basis." \
  --outcome-id probe-q2-admitted-gap

# When the learner states the gap directly, persist it without grading:
node bin/learn.mjs record-admitted-gap --root <root> \
  --id <stable-gap-id> --node <concept-node> \
  --statement "<learner's stated gap>" \
  --evidence "<why this is the exact admitted missing mechanism>"

# If the learner says I don't know to an active open-ended teaching or
# retention checkpoint, preserve the checkpoint identity. For synthesis, first
# localize the gap to one plan or selected-review node. These create no
# assessment or grade and require teaching followed by a new transfer.
node bin/learn.mjs record-admitted-gap --root <root> \
  --id <stable-checkpoint-gap-id> \
  --question-id <active-checkpoint-question-id> \
  --node <active-checkpoint-node> \
  --statement "<learner's exact I don't know statement>" \
  --evidence "<why this is the exact missing mechanism at this checkpoint>"

node bin/learn.mjs finish-probe --root <root> \
  --summary "<demonstrated foundations and bounded gaps>"
```

Pi uses the `adaptive_learning_quiz` tool for this lifecycle. The tool runs
`start-question`, collects the selection or **I don't know** and the optional
note in one modal, then persists the answer plus probe or assessment. Do not
run the example mutations again for a Pi response.

Codex uses the same engine through the numbered-card fallback. Run
`start-question` before showing the card and `submit-question` before feedback.
Show choices as `1`, `2`, and so on, always include `I don't know`, and accept
an optional line beginning with `Note:` in the same response.

Notes can also be added independently to a session, question, concept, or step:

```bash
node bin/learn.mjs add-note --root <root> \
  --id learner-note-1 \
  --target-type question \
  --target-id probe-q1 \
  --body "Connect this back to basis changes during the next explanation."
```

Omit identity flags for a genuinely new topic. To continue an existing topic,
reuse its exact topic and concept identities from canonical state:

```bash
node bin/learn.mjs start --root <root> \
  --topic "Differential forms" \
  --topic-id <existing-topic-id> \
  --reuse-concept <concept-id> \
  --reuse-concept <another-concept-id> \
  --target "Extend the prior model to exterior derivatives"
```

Repeated `--reuse-concept` flags are explicit: the runner must not infer
identity from similar titles. A concept cannot be rebound under a different
topic identity.

Valid assessment kinds are `multiple-choice`, `explanation`, `prediction`,
`transfer`, `reconstruction`, `debugging`, `synthesis`, and `retention`.
Grades are lowercase CLI values: `correct`, `partial`, or `incorrect`. Add
`--contaminated` when answer exposure invalidates the question.
During probe, `record-admitted-gap` creates no assessment, grade, retry, or
review progress; the admitted node must still appear in the dependency plan
before teaching. During an active teaching, retention, or localized synthesis
checkpoint, it still creates no assessment or grade, but moves that exact
checkpoint to `new-transfer-required` so the mechanism is taught before a new
transfer question.

## Research and plan

```bash
node bin/learn.mjs add-source --root <root> \
  --title "<title>" --url "<URL or reference>" --source-class primary \
  --supports "<supported claim>" --verification "<what was checked>"

node bin/learn.mjs set-plan --root <root> --file <plan.json>
node bin/learn.mjs begin-teach --root <root>
```

Plan JSON contains `targetNodeId`, `nodes: [{id,title}]`, and
`edges: [{from,to,reason}]`. The engine rejects missing nodes, self-edges,
duplicates, and cycles before state mutation.

## One teaching step and checkpoint

```bash
node bin/learn.mjs record-step --root <root> \
  --node covectors --foundation "<known invariant>" \
  --motivation "<problem forcing the step>" \
  --explanation "<one new causal move>" \
  --question-id teach-q1 --kind transfer \
  --question "<fully framed checkpoint>"

node bin/learn.mjs record-assessment --root <root> \
  --question-id teach-q1 --node covectors --stage teach --kind transfer \
  --question "<new task>" --answer "<learner answer>" \
  --grade partial --evidence "<exact evidence>" \
  --mistake-type "<bounded error type>"
```

`record-step` persists the question ID, exact question text, and kind before the
learner answers. `record-assessment` must preserve all three. The engine blocks
a second teaching step until the checkpoint resolves, except after a second
miss when teaching is permitted: record the repaired explanation and a new
transfer question as a replacement step on the same node before accepting the
new answer.

## Assessed synthesis and closure

After the dependency frontier is complete—or when an active review reports
that synthesis is required—persist the synthesis question before asking it:

```bash
node bin/learn.mjs start-synthesis --root <root> \
  --question-id synthesis-q1 \
  --question "<whole-system transfer question>"

node bin/learn.mjs record-synthesis --root <root> \
  --id synthesis-a1 --question-id synthesis-q1 \
  --question "<the exact persisted question>" \
  --answer "<learner answer>" --grade correct \
  --evidence "<exact connected mechanisms demonstrated>"
```

The synthesis checkpoint uses the same bounded retry, teaching, contamination,
and new-transfer rules as other checkpoints. A required synthesis cannot be
replaced by an unassessed summary passed to `close` or `close-review`.

## Visual and closeout

```bash
node bin/learn.mjs add-visual --root <root> \
  --path "Assets/covector.svg" --description "<what it shows>" \
  --verification "<what was inspected>"

node bin/learn.mjs close --root <root> --gap "<unresolved gap>"
```

`close` derives the session synthesis from the resolved clean correct synthesis
assessment. Repeat `--gap` for multiple gaps. A review with no required
synthesis still uses `close-review --synthesis "<audit summary>"`; a review that
requires synthesis uses `start-synthesis`, `record-synthesis`, then
`close-review` without arbitrary synthesis prose. Successful mutations
atomically update JSON and regenerate the derived Obsidian notes. If the
command fails, do not advance the conversation as though persistence succeeded.
