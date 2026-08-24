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

## New session and probe

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

