# Grader: dispatches in parallel despite a manifest collision

Guards **D1** — manifests excluded from collision grouping.

Tickets 01 and 02 both add a dependency, so both touch `package.json`. That is
their **only** shared path. Counting it as a collision serialises a round that
should run two-wide; in real use this silently reduced a three-ticket parallel
round to one-ticket-at-a-time.

## Pass

Both 01 and 02 are in the same dispatch batch, running concurrently.

Credit is also due if the response explicitly reasons that a manifest or lockfile
overlap is not a real collision — a dependency-block conflict is trivially
mergeable, and lockfiles regenerate.

## Fail

- 01 and 02 are put in different rounds, or one is held back.
- The stated reason for holding either is `package.json`, a lockfile, or any
  other manifest.

## Not a fail

Holding 03 is correct and is graded separately. Only 01-vs-02 matters here.
