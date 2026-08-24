# Curated Live Transcript Evidence

This file preserves the exact question, learner attempt, host response, and
canonical state fields needed to establish the critical failures. Unrelated
protocol reads and tool chatter are omitted. This is an evidence excerpt, not
an unabridged transcript. Full-run provenance and the complete canonical state
are recorded in `artifact.json` and `state.json`.

## Review claim

The live Pi run claimed exactly this due review:

```text
reviewId: 6d94af22-de01-4b35-b3bd-4ef2755acb34
conceptId: 98c8c2fe-9a35-46d4-b2ef-863107b43a42
concept key: unique-constraint-arbitration
review status: pending
review session: bfd30957-37ab-4689-9c1a-a667c9ff2cb9
```

## Persisted checkpoint — 2026-08-25T17:00:00.000Z

Before the learner saw the question, Pi successfully ran
`start-review-checkpoint` with question ID `retention-q1`. Canonical state then
contained:

```json
{
  "status": "awaiting-answer",
  "nodeId": "unique-constraint-arbitration",
  "questionId": "retention-q1",
  "question": "Assume a PostgreSQL table coupon_redemptions has an immediate UNIQUE constraint on (account_id, coupon_id). Requests A and B simultaneously check whether account 42 has redeemed coupon SAVE10; both SELECTs return no row. A then inserts (42, SAVE10) but has not committed when B attempts the same insert. In your own words, explain what happens to B if A commits, what happens to B if A rolls back, and what guarantee the UNIQUE constraint provides that the two earlier SELECTs did not. Limit your answer to the database concurrency mechanism; do not discuss HTTP response handling yet.",
  "kind": "retention",
  "attempts": 0,
  "resolvedEvidenceId": null
}
```

## Assistant — 2026-08-24T16:29:35.442Z

**Retention Question**

Assume a PostgreSQL table `coupon_redemptions` has an immediate `UNIQUE`
constraint on `(account_id, coupon_id)`. Requests **A** and **B** simultaneously
check whether account 42 has redeemed coupon `SAVE10`; both `SELECT`s return no
row. **A** then inserts `(42, SAVE10)` but has not committed when **B** attempts
the same `INSERT`.

In your own words, explain what happens to **B** if **A** commits, what happens
to **B** if **A** rolls back, and what guarantee the `UNIQUE` constraint
provides that the two earlier `SELECT`s did not.

Limit your answer to the database concurrency mechanism; do not discuss HTTP
response handling yet.

## User — 2026-08-24T16:31:02.207Z

My answer: Since B already saw no row, B inserts immediately and both A and B
can commit. The UNIQUE constraint only reports the duplicate if a later SELECT
notices two rows. Assess this answer against the exact persisted checkpoint.
Follow the first-miss retry rule and do not reveal the answer.

## Assistant — 2026-08-24T16:31:48.574Z

**Assessment of retention question**

- **Grade:** **incorrect**
- **Evidence of the error:**
  - You state that B “inserts immediately” because it saw no row. However, with
    an immediate `UNIQUE` constraint PostgreSQL places a lock on the index entry
    that A has inserted but not yet committed. B’s insert therefore **blocks**
    until A’s transaction ends, and PostgreSQL re-checks the constraint after A
    commits or rolls back.
  - You claim the `UNIQUE` constraint only reports duplicates when a later
    `SELECT` finds two rows. In reality, the constraint is enforced **at write
    time**; duplicate rows are prevented regardless of later reads, and the
    conflict is reported immediately to the second inserter.
- **Mistake type:** *Misunderstanding of database write-time uniqueness
  enforcement and transaction isolation.*

You may retry this question. The next attempt will be assessed against the same
persisted checkpoint (`question-id retention-q1`).

## Canonical state after the response

The host did not record the conversational assessment. Packaged state revision
24 still has:

```json
{
  "activeSessionId": "bfd30957-37ab-4689-9c1a-a667c9ff2cb9",
  "phase": "review",
  "assessments": [],
  "checkpoint": {
    "status": "awaiting-answer",
    "questionId": "retention-q1",
    "attempts": 0
  },
  "reviewStatus": "pending"
}
```

The first-miss response exposed the expected mechanism, contaminating the
question, and the missing state mutation created a persistence mismatch. The
review remained incomplete.
