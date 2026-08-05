> **Status: all findings addressed 2026-08-02.** B1 fixed (three-step tracker
> resolution with a local-markdown fallback). B2 fixed as documentation — a new
> "This needs implementation tickets" section plus a rewritten `description`;
> note that `/to-tickets` **is** installed, under
> `~/.claude/plugins/cache/claude-plugins-official/mattpocock-skills/*/skills/engineering/`,
> it just carries `disable-model-invocation: true` so it never appears in the
> auto-invocable skill list. C1–C4 fixed in the script. The closing-note gap is
> fixed, and it surfaced a related bug the review didn't catch: the workflow path
> claims before scouting, so `heldBack` tickets were left claimed-but-idle — the
> caller is now told to release those claims immediately.
>
> Kept unchanged: everything under "What is genuinely good".

> **Naming note, 2026-08-03.** This skill is now `/truffle-pig`. Only the name
> changed — every operative term below (scout, contradicted, collision, round,
> claim, frontier, `ENV:`) is still current, because the skill's language is
> deliberately literal even though its name is not.
>
> The text is left saying `/frontier` throughout rather than being search-replaced.
> A field review is a record of what happened, and it happened under that name. The
> finding ids B1–D16 are cited by the eval cases and are frozen regardless.

# /frontier — field review from first attempted use

Reviewer: a session driving the `majic-pencil` project through
`/wayfinder` → (no `/to-tickets`) → `/frontier`.
Repo under test: `/Users/professornirvar/Documents/GitHub/majic-pencil`
Effort/map under test: `.scratch/ink-to-context-engine/`

Both `SKILL.md` and `frontier.workflow.js` were read in full. The skill could not
be executed — see B1. Findings are ordered by what blocks use, not by severity of
craft.

---

## B1 — BLOCKER: no local-markdown fallback, so the wayfinder pairing breaks

`SKILL.md` "Before you start" hard-stops when `docs/agents/issue-tracker.md` is
absent, directing the user to `/setup-matt-pocock-skills`.

But `/wayfinder` **degrades gracefully** in exactly that situation: *"If no tracker
has been provided, default to the local-markdown tracker."* Any project charted by
wayfinder without a configured tracker therefore has a perfectly good `.scratch/`
map — and `/frontier`, whose entire premise is building what wayfinder charted,
refuses to look at it.

This is the default path, not an edge case. It is how this project got charted.

**Suggested fix.** Mirror wayfinder's fallback rather than hard-stopping:

> Read `docs/agents/issue-tracker.md`. If it does not exist, fall back to the
> local-markdown tracker convention (tickets as Markdown files under
> `.scratch/<effort>/issues/`, `Status:`/`Blocked by:` headers) exactly as
> `/wayfinder` does. Only stop and ask for `/setup-matt-pocock-skills` if neither
> a tracker doc nor a local-markdown effort directory can be found.

A working adapter written for this repo is at
`majic-pencil/docs/agents/issue-tracker.md` — usable as a reference for what the
fallback needs to define (frontier query, claim, blocking, resolve, and the
readiness split).

---

## B2 — BLOCKER: `/to-tickets` is the missing middle, and its absence starves frontier

`SKILL.md`'s description says *"Use after `/to-tickets` has published implementation
tickets."* That skill is not installed (nothing matching `to-tickets` under
`~/.claude`). More importantly the gap is **conceptual, not packaging**:

- `/wayfinder` produces **decision** tickets, and by its own typing most are HITL
  (`grilling`, `prototype`).
- `/frontier` correctly refuses HITL and needs **implementation** tickets (AFK).

Measured on the live map — 5 open tickets: 1 `task`, 1 `research` (already
running), 3 `grilling`. **Frontier's fan-out would be one ticket.** The
parallelism the skill exists to provide has nothing to act on.

Frontier's behaviour here is *right*; the pipeline is what's incomplete. Worth
either shipping `/to-tickets` alongside, or stating plainly in the skill
description that frontier is unusable without it — currently a user can install
frontier alone and reasonably expect it to work.

---

## C1 — BUG: collision grouping ignores `adds`, so new-file conflicts slip through

`frontier.workflow.js:98`

```js
const paths = scout.edits || []
```

Only *existing* files are checked for overlap. The `SCOUT_SCHEMA` collects `adds`
(new paths) and nothing consumes it.

Two tickets that both create `src/core/eval.ts` have disjoint `edits`, so both
dispatch in the same round, both create the file, and you get precisely the merge
conflict scouting exists to prevent — after paying for the parallelism.

This is likely *more* common than edit collisions on a young codebase, where most
tickets add files rather than change them.

**Fix:**

```js
const paths = [...(scout.edits || []), ...(scout.adds || [])]
```

Two tickets adding to the same *directory* are fine; only identical paths clash,
which this handles correctly.

---

## C2 — ROBUSTNESS: scout-id matching fails silently on a formatting drift

`frontier.workflow.js:86,93`

```js
for (const s of scouts) byId[s.id] = s
const scout = byId[String(t.id)]
```

The join depends on the scout agent echoing the ticket id byte-exactly. The prompt
asks for this and the schema requires the field, but a model returning `"ticket-08"`
for id `"08"` — or `"08 "`, or `8` — drops the ticket into `heldBack` with the
reason **"scout failed or returned nothing"**, which is actively misleading: the
scout succeeded, the join didn't.

`parallel()` preserves input order, so positional joining removes the failure mode
entirely:

```js
const scouts = await parallel(TICKETS.map(...))          // keep nulls, don't filter
const pairs  = TICKETS.map((t, i) => ({ ticket: t, scout: scouts[i] }))
```

Then `heldBack` genuinely means the scout returned nothing. If the id must stay
authoritative, at minimum normalise both sides and distinguish "no scout" from
"id mismatch" in the reason string.

---

## C3 — COST: implement and review agents have no `effort` floor

Scout is correctly pinned `effort: 'low'` (line 78). `impl:` (128) and `review:`
(138) set no effort, so they inherit the session's — which in a coding session is
frequently `xhigh`, now multiplied across N concurrent worktree agents.

The skill is otherwise cost-conscious (cheap scouts, one review round, no
escalation ladder); this is the one unpinned expensive path. Consider an explicit
default with an `args` override, e.g. implement at `high`, review at `medium`.

---

## C4 — POLISH: the brief cites files that frequently don't exist

Both `SKILL.md` (step 4) and the script (line 123) instruct every agent to read
`CONTEXT.md` and `docs/adr/`. Neither exists in this repo, and neither is a
universal convention. Each agent spends a tool call learning that.

Make it conditional — *"if the repo has a CONTEXT.md or ADRs under docs/adr/, read
the ones covering your area"* — or derive the convention list from the tracker
adapter doc, which is already repo-specific.

---

## What is genuinely good (keep these)

- **The return contract.** Forcing `STATUS/BRANCH/TESTS/FILES/SUMMARY` and banning
  diffs is the strongest idea in the skill. It solves the actual hard problem in
  multi-agent orchestration — orchestrator context stays flat regardless of ticket
  count — and *"it stays in the branch, where `git diff` can retrieve it on demand"*
  is the right justification.
- **Scout-then-group.** Converts collision detection from guesswork into data for
  one cheap read-only agent per ticket. The `RISK` line catching mis-sized tickets
  before an implementation is spent on them is a bonus worth advertising more.
- **Parallel build, serial integrate**, and never auto-resolving a conflict.
- **One review, one fix, then a human.** *"A ticket that fails twice is telling you
  the ticket is wrong"* is a real insight, and refusing the escalation ladder is
  the disciplined call.
- **The script deliberately not integrating.** Merges need judgement the script
  cannot have; handing back `ready`/`needsFix`/`blocked`/`heldBack` is the right
  seam.
- **`disable-model-invocation: true`** on something that spawns worktree fleets.
- **`--dry-run` that refuses to claim**, because a claim is a write other sessions
  observe. Easy to get wrong; got right.

## Not a defect, but worth stating in the script

`heldBack` never re-enters within a run — the script returns after one wave.
`SKILL.md` step 8 covers this at the session level, but the script's closing `note`
mentions only integration. Adding "held-back tickets return to the frontier; re-run
this workflow after integrating" would make the script self-describing for anyone
reading it without the skill.

---

# Addendum — a real implementation-ticket corpus for testing /frontier

The B2 gap is now filled in the test repo. `/to-tickets` was run against the
settled decisions and published **8 vertical implementation slices**:

```
/Users/professornirvar/Documents/GitHub/majic-pencil/.scratch/v1-1-engine/issues/
```

| # | Ticket | Blocked by |
| --- | --- | --- |
| 01 | Model client with fixture record/replay *(prefactor)* | — |
| 02 | Canvas projection: records to semantic skeleton | — |
| 03 | Capture layer: draw order and timing | 02 |
| 04 | Structured parse: projection to real IR | 01, 02 |
| 05 | Vision fallback for freehand ink | 04 |
| 06 | Chat correction loop | 04 |
| 07 | Eval harness and IR diff scorer | 04 |
| 08 | MCP server over committed specs | — |

**Opening frontier is 01, 02, 08 — three genuinely parallel tickets**, which is
the fan-out frontier was built for and which the decision map could never supply.
After 01+02 land, 03 and 04 unblock; after 04, three more open at once. So the
corpus exercises multiple rounds, not just one wave.

Useful properties for exercising the skill:

- **Real collision pressure for the C1 fix.** 01 and 02 both create new files
  under `src/core/`; 04 must *edit* what 01 and 02 created. If `adds` is still
  excluded from grouping, a round containing two new-file tickets will dispatch
  them together and collide — this corpus can demonstrate the bug and the fix.
- **A genuine prefactor.** 01 exists to make 04–06 testable. Good test of whether
  scouting notices that 01 has near-zero `edits` and mostly `adds`.
- **Mixed sizes.** 03 is ~40 lines; 04 and 06 are full vertical slices. Useful
  for seeing whether the `RISK` line catches the size disparity.
- **Tracker adapter present.** `docs/agents/issue-tracker.md` now exists in that
  repo, so the B1 fallback path can be tested against a real adapter as well as
  against its absence.

One note on ticket format: these follow the `/to-tickets` local template
(`**Blocked by:**`, `**Status:** ready-for-agent`) rather than the wayfinder
decision-ticket headers (`Type:`/`Status: open`). A frontier implementation
should tolerate both shapes, or the adapter doc should reconcile them — worth
deciding which, since a repo can legitimately hold both kinds at once, as this
one now does.

---

## Addendum resolution — 2026-08-02

**Decided: the skill tolerates both shapes.** Reconciling in the adapter doc was
rejected — the two kinds mean different things and legitimately coexist, and the
adapter is meant to hold repo-specific facts, not a suite-level convention every
repo would otherwise re-solve. `SKILL.md` now carries a two-shape table plus
parsing rules (optionally-bold headers, `None — can start immediately` as
unblocked, `ready-for-agent` as a readiness label rather than a done state), and
step 7 resolves each shape in its own vocabulary — `## Answer` + `Status:
resolved` for decisions, ticked acceptance boxes + `**Status:** done` for
implementation slices.

**Verified against this corpus, not just asserted.** The shape-tolerant query
returns exactly `01, 02, 08` as the opening frontier, with `03` blocked by `02`,
`04` by `01+02`, and `05/06/07` by `04` — matching the table above. The same
query against `.scratch/ink-to-context-engine/` correctly splits the decision
corpus into one AFK ticket (`08`, `type=task`) and two HITL (`09`, `12`, both
`grilling`). The pre-fix query (`^Status: open$`) returns **zero** matches against
the implementation corpus, confirming it was blind to it.

**New finding this validation surfaced.** That repo now has
`docs/agents/issue-tracker.md`, so tracker-resolution step 1 wins over the
local-markdown fallback — and that adapter describes only the decision shape and
hardcodes `.scratch/ink-to-context-engine/`. Applied verbatim it would query the
wrong effort with the wrong shape and report an empty frontier. `SKILL.md` now
says to sanity-check the adapter's query against what's on disk, fall through to
the shape rules when it returns nothing on a directory that visibly holds ready
tickets, and tell the user the adapter is stale. **The adapter in `majic-pencil`
should be updated to cover the `v1-1-engine` effort and the implementation
shape** — that's a repo-side fix, not a skill-side one.

Still unproven: the write path. Nothing has been claimed, implemented, merged, or
resolved yet — only the read path is verified.

---

# Round 2 — `/frontier --dry-run` executed against the implementation corpus

Post-fix run. **B1 is confirmed fixed**: the three-step tracker resolution found
`docs/agents/issue-tracker.md`, and the new "trust the tickets over the adapter"
paragraph correctly predicted this repo's exact failure — the adapter was written
before `/to-tickets` ran, hardcodes `.scratch/ink-to-context-engine/`, and matches
`Status: open`, so applied verbatim it returns **nothing** against
`**Status:** ready-for-agent`. The skill now catches that. Good fix; the warning
text is doing real work.

**Multi-effort detection also worked** — two `.scratch/<effort>/` dirs exist and
the skill correctly requires the caller to name one rather than guessing.

## D1 — DESIGN: `package.json` collisions degenerate the grouping heuristic

Scout output for the three-ticket frontier:

| Ticket | EDITS |
| --- | --- |
| 01 model client | `bin/majic-pencil.ts`, **`package.json`** |
| 02 canvas projection | `src/web/App.tsx`, **`package.json`**, `vitest.config.ts` |
| 08 MCP server | `src/server/repo-io.ts`, `bin/majic-pencil.ts`, **`package.json`**, `package-lock.json` |

All three intersect on `package.json`. Applying step 2 verbatim — *"group tickets
whose EDITS sets intersect and dispatch one ticket per group"* — collapses a
deliberately-parallel three-ticket frontier into **one ticket this round, then
one, then one.** The parallelism the skill exists to provide is fully serialised
by a manifest file.

This is not an artefact of badly-written tickets. **Any ticket that adds a
dependency touches `package.json`**, so on a young project the heuristic
degenerates toward strict serialisation exactly when fan-out is most valuable.
And it optimises the wrong thing: `package.json` dependency-block conflicts are
among the most trivially mergeable in git, whereas the conflicts worth avoiding
are two agents restructuring the same source module.

**Suggested fix.** Exclude manifest/lock files from the intersection test, with
an override:

```js
const IGNORED_FOR_COLLISION = new Set([
  'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  'Cargo.toml', 'Cargo.lock', 'go.mod', 'go.sum', 'requirements.txt', 'pyproject.toml',
])
const paths = [...(scout.edits||[]), ...(scout.adds||[])]
  .filter(p => !IGNORED_FOR_COLLISION.has(p.split('/').pop()))
```

Lockfiles genuinely do conflict, but they are regenerable — `npm install` after
merge resolves them, which is not true of source. Worth saying so in step 6 so
the integrator knows a lockfile conflict is the one safe auto-resolution.

If excluding them feels too magic, the alternative is to keep grouping but report
*why* a ticket was held back with the specific path, so the caller can override a
manifest-only collision. Right now `heldBack` reasons would all read
"edits overlap: package.json", which is technically true and practically useless.

## D2 — VALIDATION: scouting earned its cost immediately

Two of three tickets were proven mis-specified **before** an implementation agent
was spent on them. Concretely:

- **Ticket 02** claimed a prototype "productionises" the projection. The scout
  read the prototype and found it implements only the second half (containment
  over pre-extracted boxes); the snapshot→shape extraction does not exist
  anywhere. Worse, it found that `tldraw` is a **devDependency** and the needed
  `getPointsFromDrawSegment` is exported only from the browser/React entry — so
  the ticket as written would drag a browser dependency into `src/core/` and the
  server bundle. That is an architecture error in the ticket, not an
  implementation detail.
- **Ticket 08** asserted the work was "a thin adapter reusing the existing core."
  The scout established that `repo-io.ts` is **write-only** — no `listSpecs`, no
  `getSpec` — and that `MAJIC_REPO_DIR`, which the ticket's acceptance criteria
  reference, **does not exist on the base branch** (it is sitting in an unmerged
  PR). The ticket would have failed its own AC.

Both were caught by three cheap read-only agents. This is the single strongest
argument in the skill's favour, and the `RISK` line is where the value
concentrated — the `EDITS`/`ADDS` sets were useful, but `RISK` is what proved the
tickets wrong. Worth promoting in the docs from a by-the-way to a headline.

**Suggestion:** have the skill state explicitly that a `RISK` line contradicting
the ticket's own premise should **halt dispatch for that ticket** and go back to
the human, rather than being reported alongside a dispatch that proceeds anyway.
Currently step 2 says a risk line is "worth a comment on the ticket and a look
from the user" — but the loop continues to step 3 regardless. It should be able
to hold a ticket on scout evidence alone.

## D3 — MINOR: unmerged branches make base-branch choice load-bearing

Ticket 08's AC referenced a feature living in an open PR, not on `main`. Nothing
in the skill prompts the caller to check whether the base branch actually
contains what the tickets assume. One line in "Before you start" — *note the base
branch and check for open PRs whose work the tickets may depend on* — would have
surfaced this before scouting rather than during.

## D4 — DISPATCH: context I added to the brief should have been in the ticket

Step 4 says *"Give each one only what it needs — never your session history."*
Correct rule, but following it exposed a gap. Writing the two briefs, I found
myself injecting things the tickets did not carry:

- the verified tldraw v5 traps (`props.richText` not `props.text`; `path` is
  delta-encoded base64; the JSDoc is stale)
- the exact prototype path holding the settled containment rule
- "invoke the `claude-api` skill before choosing a model id"
- which existing files establish house style

All of that is durable project knowledge, not session history — and every bit of
it was learned expensively, by research and measurement earlier in the effort. If
it lives only in the dispatcher's head, the next session re-derives it or, worse,
an implementer guesses and gets it wrong.

**Suggestion for step 4:** add a line along the lines of —

> If you find yourself adding context to a brief that isn't in the ticket, that
> context belongs *in the ticket*. Write it there first, then dispatch. A brief
> is assembled fresh every run; a ticket is written once and survives the
> session that learned the thing.

This also makes the tickets better inputs for a re-run after a failed round, and
it keeps the "never your session history" rule enforceable — right now the rule
forbids passing session history but offers nowhere else to put knowledge that
legitimately came from the session.

Related, smaller: the brief template's conventions line is now conditional
(good — C4 fixed), but there is no prompt to check whether the *ticket* names its
own prerequisites. A ticket whose AC references a feature on an unmerged branch
(see D3) is only catchable by reading the ticket against the base branch, which
nothing currently asks the dispatcher to do.

## D5 — INTEGRATION HAZARD: worktrees live inside the repo and `git add -A` swallows them

`isolation: "worktree"` places each agent's worktree at
`.claude/worktrees/agent-<id>/` — **inside the orchestrated repo**. That path is
not gitignored by default, so the very next `git add -A` in the orchestrating
session stages them as embedded git repositories:

```
warning: adding embedded git repository: .claude/worktrees/agent-a7a71a9cf6b0a49bf
```

Committing that produces a gitlink to a repo nobody else can fetch — broken for
every future clone, and easy to miss since `git add -A` is how most sessions
stage tracker updates between merges. The orchestrator commits *frequently* by
design (claim, resolve, tick boxes), so the exposure window is the whole run.

**Suggested fix,** one line in "Before you start":

> Ensure `.claude/worktrees/` is gitignored in the target repo before dispatching
> — worktrees are created inside the repo, and an orchestrator that stages with
> `git add -A` between merges will otherwise commit them as embedded repos.

Cheap to prevent, annoying to unpick after the fact.

## D6 — OBSERVED: the branch instruction in the brief is honoured, but the harness names its own

The brief says *"You are in an isolated worktree on branch `ticket/<id>`"*, and
the agent did create and commit to `ticket/01`. But the harness had already put
the worktree on `worktree-agent-<id>`, which remains as a second, empty branch
alongside. Harmless, but it means `git branch` accumulates a dead branch per
dispatched ticket, and a caller looking for the work by branch name may find the
harness one first and conclude nothing landed.

Worth a note in step 6 that the branch to merge is the ticket branch named in the
returned report, not the worktree branch — and that the leftover
`worktree-agent-*` branches are safe to prune after integration.

---

# Round 3 — full loop executed: two tickets built, reviewed, integrated

Tickets 01 and 02 ran concurrently in worktrees, were reviewed independently, and
merged serially into an integration branch. Suite 33 → 66 tests. **The loop works,
and the review step is where the value concentrated.**

## The skill's core claims, tested

**The return contract holds up.** Two implementation agents burned ~297k and
~116k tokens respectively; the orchestrator received two ~15-line reports. Context
stayed flat, exactly as designed. This is the skill's best idea and it survives
contact.

**Review caught things no unit test would.** Both reviewers *probed* rather than
read — one appended an SDK import to an unrelated file to prove an import-guard
test wasn't vacuous, and unset an env var to check both auth paths; the other ran
2400 shuffled permutations to verify determinism and proved a cycle-guard
correct algebraically. Neither finding was reachable by reading a diff. Whatever
the reviewer prompt is doing, it is working.

**Scouting's mis-sizing detection paid off twice** (see D2) — and notably, the
*implementer* of ticket 02 then found a real bug in the prototype the ticket was
based on: two identical hand-drawn boxes each satisfy the other's containment
test, which would infinitely recurse. The ticket asked for the prototype's rule
"as the decision"; the agent correctly treated that as a decision to *improve*
rather than transcribe. Worth noting the brief's "treat as a hint, not a limit"
phrasing seems to license exactly this, which is good.

## D7 — the loop has no step for "the repo itself is broken"

`npm ci` was failing on every branch — `package-lock.json` was missing a
transitive dependency — so **no CI run could ever have passed**, on any ticket,
regardless of quality. An implementation agent reported this as an aside
("`npm ci` fails in a fresh worktree on pre-existing lockfile drift"). I
spot-checked two package names, found them present, and dismissed it. The real
CI log named a third package.

Two lessons, one for me and one for the skill:

- *Mine:* verify the failing command, not a proxy for it. `npm ci` was two
  minutes away and would have been definitive.
- *The skill's:* an agent reporting an environment problem outside its ticket has
  no channel. The return contract is deliberately narrow — `STATUS/BRANCH/TESTS/
  FILES/SUMMARY/BLOCKED` — and "the repo's lockfile is broken" fits none of those
  fields, so it arrived as free prose after the report and was easy to under-weight.

**Suggestion:** add an optional `ENV:` line to the return contract, for problems
the agent hit that are *not* about its ticket. Then a dispatcher can aggregate
them across a round and notice when three agents all report the same broken
thing. Cheap, and it keeps the narrow-report discipline intact rather than
inviting general prose.

## D8 — step 6 assumes integration targets the base branch

Step 6 says merge into the base. But a project whose owner wants review before
`main` needs the round's merges to land on an **integration branch** that then
becomes one PR — which is what I did (`frontier/round-1`). The skill has no
vocabulary for this, and step 7's "marking done is what unblocks the dependents"
becomes ambiguous: the work is merged, but not to base, so are the dependents
takeable?

I resolved it by marking done and stopping the loop rather than continuing to
03/04 against an unmerged base. Worth stating a policy either way — an
`--integration-branch <name>` mode, or explicit guidance that review-gated repos
should run one round per PR and stop.

## What I would fix first, across all findings

1. **D1** (`package.json` degenerates grouping) — highest impact on the skill's
   central promise.
2. **D7** (`ENV:` channel) — cheap, and it prevents a whole class of silent
   round-wide failure.
3. **D5** (gitignore worktrees) — one line, prevents committing broken gitlinks.
4. **D4** (context belongs in tickets) — improves every subsequent run.

---

## Rounds 2–3 resolution — 2026-08-02

**All eight findings fixed.** D1–D8, in the priority order above.

**D1 — verified by replay, not assertion.** Manifests and lockfiles are excluded
from the intersection test (13 default filenames, overridable via
`args.ignoreForCollision`). Replayed against the actual Round 2 scout output, the
grouping now dispatches **01 + 02 in parallel** and holds **08** on
`bin/majic-pencil.ts` — a real source collision shared with 01, not
`package.json`. Before: 1 → 1 → 1. After: 2 in parallel, 1 held for a reason
worth acting on. `heldBack` reasons name the specific colliding paths, so a
caller can judge and override.

**D2 — scouts can now halt dispatch on their own evidence.** `SCOUT_SCHEMA` gained
`contradictsTicket`, the scout prompt asks for it explicitly ("that is a fault in
the ticket, not a difficulty in the work, and it is the most valuable thing you
can find"), and contradicted tickets are returned in a separate `contradicted`
array rather than dispatched. Step 8 now lists "a ticket was held back as
contradicted" as a stop condition, because looping cannot fix a planning problem.
The `RISK` line is promoted in step 2 from a by-the-way to where the value
concentrates.

**D7 — `ENV:` added to the return contract** and to `RESULT_SCHEMA`, aggregated
across the round into `envReports`. Step 4 now says to read the aggregate *before
judging any ticket*, and — taking the lesson about `npm ci` directly — to **run
the named failing command rather than a proxy for it**.

**D3, D5** — "Before you start" is now three explicit checks: clean repo and base
branch; `.claude/worktrees/` gitignored; and whether the base branch actually
contains what the tickets assume, including open PRs they may depend on.

**D4** — step 4 carries the rule verbatim in spirit: context you'd add to a brief
belongs in the ticket, written there first. Includes the reasoning that this is
what makes "never your session history" enforceable rather than merely
prohibitive.

**D6** — step 6 says to merge the branch named in the returned report, not the
harness's `worktree-agent-*` branch, and notes those are safe to prune.

**D8** — step 6 requires choosing the integration target deliberately, step 7
splits on it, and the review-gated path is now explicit: mark done, name the
branch to PR from, and **stop** rather than continuing against a base that lacks
the merged work.

Also folded in from D1: step 6 records that a lockfile conflict is the one safe
auto-resolution — regenerate with the project's install command — while source
conflicts still always stop for a human.

### One deliberate reversal — `disable-model-invocation` removed, 2026-08-02

The review listed `disable-model-invocation: true` under "what is genuinely
good," and it was right about the risk. It was removed anyway, at the user's
request, so the agent can reach for the skill on its own judgement. The risk was
not eliminated but relocated, on the view that the real hazard was never
invocation itself — it was a **greedy description** firing on "let's build X,"
which is the failure mode CCPM demonstrates (*"use ccpm any time the user is
talking about shipping a feature, even if they don't say ccpm"*).

Three compensating changes:

1. **The description is now precondition-heavy and carries an explicit negative
   clause** — "Do NOT use to plan work, to decide what to build, to build from a
   prose description, or against a raw `/wayfinder` map." It matches on *tickets
   already existing*, not on build intent.
2. **A new "Deciding to run this yourself" section** lists four conditions that
   must all hold before self-invoking, and requires saying what's missing rather
   than proceeding when one fails.
3. **Self-invocation defaults to `--dry-run`.** Steps 1–2 (frontier query and
   scouts) are read-only and cheap, so they run; the loop then stops and presents
   the dispatch plan before step 3. Claiming is a write other sessions observe and
   dispatch spawns a fleet against a repo the user didn't explicitly name, so
   those wait for a go-ahead. An explicit `/frontier` *is* that go-ahead.

Net: the model can decide *whether the situation calls for this skill*, but not
unilaterally decide to claim tickets and launch agents.

---

# Round 4 — post-fix run, full loop, two tickets shipped

Ran against the implementation corpus after all findings were addressed. Tickets
04 and 08 built in parallel worktrees, reviewed, integrated. Suite 69 → 125 tests.
**Every earlier finding is confirmed fixed in practice, not just in the text.**

## The fixes, verified by use

| Finding | Verified how |
| --- | --- |
| **B1** local-markdown fallback | Found the adapter; the "trust the tickets over the adapter" paragraph predicted this repo's exact staleness |
| **D1** manifest exclusion | Round 1 collapsed to one ticket on `package.json`; round 2 dispatched two in parallel |
| **D2** contradicted ⇒ halt | Ticket 03 held on scout evidence alone — the single highest-value event of the round |
| **D3** base-branch check | Caught ticket 08 telling the implementer not to use `MAJIC_REPO_DIR`, which had since merged |
| **D5** worktrees gitignored | Pre-flight check passed; no embedded-repo incident this round |
| **D6** merge the reported branch | Both `ticket/04` and `ticket/08` existed alongside empty `worktree-agent-*` branches, exactly as documented |
| **D7** `ENV:` channel | **Earned its place immediately — see D11** |
| **D8** integration-branch mode | Round landed on `frontier/round-2` and stopped, rather than continuing against an unmerged base |

The multi-effort prompt also worked: two `.scratch/<effort>/` dirs exist and the
skill correctly required the caller to name one.

## D11 — the `ENV:` channel caught the round's most important problem

This is the finding I would most want propagated, because it validates the fix in
a way I did not anticipate when suggesting it.

Ticket 04's agent reported on `ENV:` that **no Anthropic credentials existed in its
worktree**, so the committed model fixture's response body was *hand-authored* —
real request key and file shape from the record-mode middleware, invented content.
Five test assertions depended on that fabricated answer.

Under the old narrow contract that disclosure had nowhere to go. It would have
arrived as prose after the report, or — worse — not at all, and the round would
have shipped a green suite whose green depended on a made-up model response. The
tool would have looked proven when only the plumbing was.

The orchestrator (with a key available) re-recorded it live. The genuine answer
happened to match structurally, and only a string differed — but that is luck, not
vindication. The point is that the channel surfaced it.

**Two things worth adding to the skill on the back of this:**

1. **Worktree agents may not inherit credentials.** This is a systematic gap, not a
   one-off: any ticket whose work requires a live API call cannot complete honestly
   inside an isolated worktree that lacks the environment. Say so in step 4 — *"if
   your ticket needs a credential you don't have, report it on `ENV:` and do not
   fabricate the artifact"* — and in step 6, *"if an agent reported a missing
   credential, produce the affected artifact yourself before judging the ticket."*
2. The instruction that made this work was **"don't silently work around it."** The
   agent could easily have hand-authored the fixture and said nothing; the report
   would have been true in every field. Worth keeping that exact phrasing.

Ticket 08's `ENV:` also flagged a pre-existing `npm audit` high (a devDependency
ReDoS) *and* that port 5173 was occupied so it could not run Playwright — the
latter was the **orchestrator's own stray dev server**. A channel for "the
environment is wrong" catches the orchestrator's mess too, which is a use case
beyond the broken-lockfile case that motivated it.

## D12 — over-scoped tickets manufacture fake collisions

Round 2's scout showed ticket 04 touching ten files, three of which only mattered
because the ticket said "delete the sample IR" — a module that is also the shared
fixture for three unrelated test files. Those spurious edits were the *only* thing
colliding with ticket 08.

Narrowing the ticket to "remove it from the parse route only" **de-collided the
round**, turning one-ticket-per-round back into two-in-parallel.

So the scout's path sets are not only a collision predictor — they are a **scope
review**. A ticket whose `EDITS` list is surprisingly wide is usually over-scoped
rather than genuinely wide, and narrowing it buys parallelism. Worth saying in
step 2: *when a ticket collides, check whether its scope is real before holding it
for a later round.*

## D13 — merging a ticket that adds a dependency needs an install before judging

Both merges succeeded and `tsc` then failed with `Cannot find module
'@modelcontextprotocol/sdk/...'` — because ticket 08 added the dependency to
`package.json` and the orchestrator's `node_modules` predated it. Two test files
failed for the same reason. Nothing was wrong with the ticket.

Step 6 says to run the suite between merges, which is right, but a red suite here
means "install first", not "the ticket is broken". One line: *after merging a
ticket that changed the manifest, run the project's install command before
believing the test results.*

## Still unfixed after this round

Nothing blocking. The two open items are both mine to note rather than the skill's
to fix: the read-only guard pattern that ticket 08 used is a literal-token regex
rather than a capability boundary (a handler assembling a method name dynamically
bypassed it), and I left three dev servers running across the session, one of
which blocked an agent's Playwright run. The second is a discipline problem, not a
skill problem — but a line in step 6 reminding the orchestrator to free ports
before the round would have saved it.

---

# Round 5 — third full loop: correction engine + scorer

Tickets 06 and 07, four-way frontier scouted, two dispatched. Suite 125 → 166.
No new blockers. Three findings, one of which is about a class of problem the
skill structurally cannot catch.

## D14 — scouting caught a ticket the orchestrator had rewritten one round earlier

The strongest single result so far, because it caught *me*.

Round 4 held ticket 03 as contradicted and I rewrote it, including a section
telling the implementer how to handle the fixture-hash hazard. One of the two
resolutions I offered — *"keep `t` out of the projection, the hash is untouched"* —
was **false when written.** `seq` already reaches the projection output; the
committed fixture merely lacks it because nothing stamps `meta.seq` yet, so it
serialises as absent. The instant capture lands, the request body changes and the
hash misses. There is no version of this ticket where the fixture survives.

Round 5's scout found that in one read. The implication for the skill is worth
stating explicitly: **scout every ticket, including ones written or rewritten by
the current session.** The intuition that "I just wrote this, I know it's right"
is exactly the case that produced the error, and re-scouting cost one cheap
read-only agent.

Step 2 currently frames scouting as collision prediction with mis-sizing as a
bonus. On this evidence the ordering is backwards: **premise-checking is the
primary value and collision prediction is the useful by-product.** Two of six
tickets scouted across three rounds were factually wrong, and both were caught
before an implementation was spent.

## D15 — the credential gap is systematic, and the "don't fabricate" rule is load-bearing

Second and third confirmations. Both ticket 06 and ticket 04 needed a live model
call to record a fixture; both worktrees had no `ANTHROPIC_API_KEY`, no
`ant` profile, nothing. **Two for two.** This is not an environment fluke — an
isolated worktree should be assumed credential-less.

Ticket 06 reported it on `ENV:` and shipped scripted-stub coverage instead,
explicitly declining to hand-author a fixture. Ticket 04, one round earlier, *did*
hand-author one and disclosed it. Both behaviours were honest; the difference is
that the ticket text had since been updated to say "report it, do not fabricate."

**The instruction changed the outcome.** That is about as clean a demonstration as
this kind of thing gets, and it argues for hoisting it from ticket text into the
skill's step-4 brief, since it generalises to any artifact requiring credentials —
fixtures, snapshots, recorded traces.

Suggested addition to step 6, alongside the existing `ENV:` aggregation: *if an
agent reported a missing credential, produce the affected artifact yourself before
judging the ticket.* Doing that this round turned "the plumbing runs" into "the
prompt actually works" — the recorded turn showed the live model correctly merging
two nodes and collapsing their relations, which no stub could have demonstrated.

## D16 — blocking edges cannot express "needs an artifact from", and scouting is the only net

Tickets 05 and 07 were **circularly dependent in a way the tracker could not
represent.** Both declared `Blocked by: 04` and neither mentioned the other. But
05's acceptance criteria wanted "within the eval's tolerance" — from a harness 07
had not built — and 07 needed a parser-consumable input that only 05's vision path
could produce. Each was individually unblocked; together they deadlocked.

Nothing in the frontier query could see this. `Blocked by` expresses *sequence*,
not *artifact dependency*, and both tickets satisfied it. Only the scouts, reading
the actual corpus, found that the gold case has no runnable input at all.

This is not obviously the skill's job to fix — a richer dependency vocabulary is a
tracker concern. But it is worth one line in step 2: **when two scouts each report
a gap the other ticket was supposed to fill, that is a cycle, and one of them has
to be cut before either dispatches.** I cut it on 07's side (build the scorer
against synthetic pairs, accept an empty real corpus) and 05 remains held.

## Smaller observations

- **`ENV:` caught a harness quirk, not just a repo one.** Ticket 07 reported that
  its sandbox refuses any bash command containing the substring `eval`, so
  `npm run eval` could not be invoked by name. Not a repo problem and not
  actionable by the skill — but a channel that surfaces "the environment I am in
  is strange" is earning its keep beyond the broken-lockfile case that motivated
  it.
- **Review quality is the strongest part of the loop.** This round's reviewers
  built roughly thirty adversarial IR pairs, rotated every node id to defeat
  id-based scoring, and mounted three separate attacks on relation-provenance
  carrying. None of that is reachable by reading a diff. Whatever the reviewer
  prompt is doing — findings-only, no rewritten code, spec-compliance framing — it
  is producing genuine verification rather than commentary.
- **One reviewer finding the skill's own discipline would have missed:** a literal
  NUL byte in a source file made git classify it as binary, so its diff was
  unreviewable and grep skipped it. Worth knowing that "reviewed and approved" can
  be less true than it looks when the reviewer's own tooling can't read the file.

---

## Rounds 4–5 resolution — 2026-08-02

All six findings applied, plus both smaller observations.

**D14 — step 2 reordered, and this is the biggest change to the skill's framing.**
The section is now "Scout every ticket," and it opens by stating that
premise-checking is the *primary* value with collision prediction as the
by-product — the reverse of how it read before. It carries the measured result (a
third of tickets scouted across five rounds were factually wrong, all caught
before an implementation was spent) and the specific instruction that follows
from catching a self-authored ticket: **scout tickets you wrote or rewrote this
session**, because "I just wrote it, I know it's right" is exactly the case that
produced the error. The scout prompt in the script now says "YOUR PRIMARY JOB" for
premise-checking and "SECOND" for the path sets, and explicitly warns that
recently-authored tickets have been wrong.

**D11/D15 — the credential rule is hoisted from ticket text into the step-4
brief**, on the strength of two-for-two. The brief now opens that clause with
"Assume you have no credentials," and carries the finding's own reasoning: a
hand-authored fixture yields a green suite proving only the plumbing. The
"don't silently work around it" phrasing was kept verbatim, as the review asked.
Step 6 gained the matching obligation — if an agent reported a missing
credential, produce the artifact yourself before judging the ticket — with the
note that this is what turns "the plumbing runs" into "the behaviour works."

**D12 — step 2 now says to check whether a colliding ticket's scope is real
before holding it**, with the ten-files-down-to-three example and the conclusion
that path sets are a scope review as much as a collision predictor.

**D13 — step 6 gained "run the install command after merging a manifest change,"**
framed as the review framed it: red here means "install first," not "the ticket
is broken."

**D16 — step 2 names the artifact-cycle pattern** (two scouts each reporting a gap
the other ticket was meant to fill), states that blocking edges express sequence
rather than artifact dependency so the frontier query cannot see it, and says to
cut one side explicitly rather than dispatching both and hoping.

**Both smaller observations landed too.** Step 4's `ENV:` guidance now says to read
the channel as "something about my environment is wrong," not only "something
about this repo is wrong," citing the stray-port and sandbox-substring cases.
Step 5 and the reviewer prompt now require saying so when part of a diff was
unreadable rather than approving around it.

**Deliberately not changed:** the reviewer prompt's core framing. Three rounds of
evidence — probing rather than reading, thirty adversarial IR pairs, rotated node
ids, three attacks on relation provenance — say it is producing genuine
verification. The only addition was the unreadable-diff clause.
