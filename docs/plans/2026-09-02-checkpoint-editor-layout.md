# Checkpoint editor and layout plan

## Scope

Repair the native free-response checkpoint so the learner can paste, edit at
the cursor, leave the answer, return to it, and revise before choosing an
action. Reshape teaching and checkpoint presentation for fast visual scanning.

## Interaction contract

- Use Pi's multiline editor for the answer instead of an append-only string.
- Preserve the draft and cursor while focus moves between answer, optional
  fields, and actions.
- Tab moves forward; Shift+Tab moves backward.
- Up from the first action returns to the answer.
- Enter from the answer moves to actions; it does not persist immediately.
- Only Enter on a selected action persists a response or admitted gap.

## Layout contract

- Present a compact checkpoint card with clear question, answer, optional, and
  action sections.
- Keep the reading column bounded while allowing more width than the existing
  narrow panel.
- Show controls that match the actual focus and make the path back to editing
  explicit.
- Keep teaching explanations to compact Why, Rule, and Example blocks where
  practical; avoid dense definition dumps.

## Verification

- Regression tests for bracketed paste, cursor editing, reverse navigation,
  draft preservation, and layout labels.
- Full test and release checks.
- Restart Pi and inspect the checkpoint in a real terminal before calling the
  live interaction fully accepted.
