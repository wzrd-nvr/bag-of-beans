# Changelog

Versions track the plugin as a whole. Each entry says what changed and, where it
came from a field review, which finding drove it.

## 0.1.0 — 2026-08-03

First release. One skill.

### frontier

Builds the unblocked implementation tickets on an issue tracker in parallel, one
worktree-isolated subagent per ticket, reviewed and merged one at a time.

Arrives already shaped by five rounds of real use against a live project
(`research/frontier/field-review.md`). Notable behaviour that exists because a
round demanded it:

- **Tolerates both local ticket shapes** — `/wayfinder` decision tickets
  (`Type:`, `Status: open`) and `/to-tickets` implementation slices
  (`**Status:** ready-for-agent`). A query written for one returns nothing against
  the other, which reads identically to an empty frontier (B1, addendum).
- **Trusts tickets over a stale tracker adapter**, and says so, rather than
  silently reporting no work (B1 follow-up).
- **Excludes manifests and lockfiles from collision grouping.** Counting
  `package.json` as a collision serialised a deliberately-parallel three-ticket
  round down to one-at-a-time (D1).
- **Scouts every ticket, including ones authored this session**, and halts
  dispatch when a scout disproves a ticket's premise. Premise-checking outearned
  collision prediction two to one (D2, D14).
- **`ENV:` channel** on the return contract for problems that aren't about the
  ticket. Caught a broken lockfile, a stray dev server holding a port, and a
  worktree with no credentials whose agent had hand-authored a model fixture that
  five assertions depended on (D7, D11).
- **Assumes worktrees have no credentials** and forbids fabricating artifacts
  that need a live call. Confirmed two for two; the instruction measurably changed
  agent behaviour between rounds (D15).
- **Names the artifact-dependency cycle** that blocking edges structurally cannot
  express, since only the scouts can see it (D16).
- **Model-invocable, but self-invocation defaults to `--dry-run`** — read-only
  scouting runs, then it stops for a go-ahead before claiming or dispatching.
