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
It returns the durable session, retries, due reviews, and synthesis flag.

## Review lifecycle

`due` only lists currently available review IDs. It does not claim, assess, or
complete them.

```bash
node bin/learn.mjs due --root <root> --json

node bin/learn.mjs start-review --root <root> \
  --review <due-review-id> \
  --review <another-due-review-id>

node bin/learn.mjs record-assessment --root <root> \
  --question-id retention-q1 --node <selected-node> \
  --stage retention --kind retention \
  --question "<fully framed retrieval question>" \
  --answer "<learner answer>" --grade incorrect \
  --evidence "<exact retained and missing mechanism>" \
  --mistake-type "<bounded error type>"

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

If a selected item cannot be assessed validly, defer it explicitly before
closing:

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

node bin/learn.mjs record-probe --root <root> \
  --question-id probe-q1 --node vectors --kind explanation \
  --question "Which operations define this structure?" \
  --answer "<learner answer>" --grade correct \
  --evidence "<specific demonstrated or missing mechanism>"

node bin/learn.mjs finish-probe --root <root> \
  --summary "<demonstrated foundations and bounded gaps>"
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
  --question "<fully framed checkpoint>"

node bin/learn.mjs record-assessment --root <root> \
  --question-id teach-q1 --node covectors --stage teach --kind transfer \
  --question "<new task>" --answer "<learner answer>" \
  --grade partial --evidence "<exact evidence>" \
  --mistake-type "<bounded error type>"
```

The engine blocks a second teaching step until an uncontaminated, durable
checkpoint resolves the active step.

## Visual and closeout

```bash
node bin/learn.mjs add-visual --root <root> \
  --path "Assets/covector.svg" --description "<what it shows>" \
  --verification "<what was inspected>"

node bin/learn.mjs close --root <root> \
  --synthesis "<whole-system synthesis>" \
  --gap "<unresolved gap>"
```

Repeat `--gap` for multiple gaps. Successful mutations atomically update JSON
and regenerate the derived Obsidian notes. If the command fails, do not advance
the conversation as though persistence succeeded.
