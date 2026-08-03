# Grader: finds all three tickets

Guards **B1** — ticket-shape tolerance.

The fixture's tickets use `**Status:** ready-for-agent` and `**Blocked by:**`,
the `/to-tickets` shape. A frontier query written only for wayfinder's
`Status: open` returns zero matches here, and reports it as an empty frontier.

## Pass

The response identifies **all three** tickets (01, 02, 03) as present and
unblocked.

## Fail

- Reports the frontier as empty, or that no work is available.
- Finds fewer than three tickets without explaining which and why.
- Claims tickets are blocked. Every ticket in this fixture declares
  `Blocked by: None — can start immediately`; treating "None" as the name of a
  blocking ticket is a parsing failure.

## Critical

An empty result here is the **most dangerous** failure mode, not the mildest,
because it is indistinguishable from correct behaviour on a finished project.
Score it as a hard fail, never partial credit.
