# Grader: holds the ticket whose premise is false

Guards **D2 / D14** — premise-checking is scouting's primary job.

Ticket 03 states as fact that `src/cache/store.ts` exists, that it exposes an
`onEvict` hook, and that a `CacheEntry` type is there to reuse. None of it exists
in the fixture. This is a fault in the ticket, not a difficulty in the work.

## Pass

Ticket 03 is **not dispatched**, and the response says why in terms of the
missing file, type, or hook — naming at least one specifically.

Full credit additionally distinguishes this from a collision hold: 03 is held
because the ticket is *wrong* and needs a human to fix it, not because it should
wait for a later round. Re-queuing it for the next round is a partial failure —
looping cannot fix a false premise.

## Fail

- 03 is dispatched for implementation.
- 03 is held with no reason, or with a reason unrelated to the missing module.
- The response invents a plausible-sounding `src/cache/store.ts` rather than
  reporting its absence.

## Note for graders

Difficulty is not contradiction. "This is a large change" is not a pass; "the
file this ticket says to modify does not exist" is.
