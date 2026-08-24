# Race-safe idempotent creation

- **Session:** `bfd30957-37ab-4689-9c1a-a667c9ff2cb9`
- **Phase:** Review
- **Created:** 2026-08-25T17:00:00.000Z
- **Updated:** 2026-08-25T17:00:00.000Z
- **Completed:** Not completed

## Learning target

Review 1 due concept

## Learner context

Not recorded.

## Probe conclusion

Probe is not complete.

## Dependency plan

No dependency plan recorded.

## Admitted gaps

None recorded.


## Sources and verification

No sources recorded.

## Teaching steps

No teaching steps recorded.

## Active review checkpoint

- **Status:** Awaiting answer
- **Node:** `unique-constraint-arbitration`
- **Question ID:** `retention-q1`
- **Kind:** retention
- **Question:** Assume a PostgreSQL table coupon\_redemptions has an immediate UNIQUE constraint on (account\_id, coupon\_id). Requests A and B simultaneously check whether account 42 has redeemed coupon SAVE10; both SELECTs return no row. A then inserts (42, SAVE10) but has not committed when B attempts the same insert. In your own words, explain what happens to B if A commits, what happens to B if A rolls back, and what guarantee the UNIQUE constraint provides that the two earlier SELECTs did not. Limit your answer to the database concurrency mechanism; do not discuss HTTP response handling yet.
- **Attempts:** 0
- **Prior question ID:** None
- **Resolved evidence:** None
- **Mistake type:** None

## Assessments

No assessments recorded.

## Retention

- **unique-constraint-arbitration:** developing; level 1; due 2026-08-25T16:03:47.200Z

## Visuals

No visuals recorded.

## Whole-system synthesis

Not completed yet.

## Unresolved gaps

None recorded.
