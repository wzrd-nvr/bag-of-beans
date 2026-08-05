---
name: truffle-pig
description: Use when implementation tickets already exist on the tracker and the user wants them built — reads the unblocked, unclaimed frontier and runs each ticket in its own worktree-isolated subagent in parallel, then reviews and merges them one at a time. Requires published tickets from /to-tickets. Do NOT use to plan work, to decide what to build, to build from a prose description, or against a raw /wayfinder map, whose decision tickets are human-in-the-loop and will not dispatch.
---

# Truffle Pig

`/to-tickets` publishes vertical slices with blocking edges. `/wayfinder` charts the decisions above them. Neither one *builds*. This skill does: it reads the **frontier** — every ticket whose blockers are all closed and which nobody has claimed — and runs those tickets concurrently, each in its own isolated workspace.

**The tracker is the only state.** There is no `.planning/` directory, no epic file tree, no local mirror of ticket status. Claims, results, and blockers are written back to the tracker as they happen, so a session that dies mid-run is resumed by re-reading the frontier. Nothing to reconcile.

## Vocabulary

Plain terms, used consistently. Nothing here is metaphorical — an agent acting on these instructions should never have to translate.

| Term | Means |
| --- | --- |
| **frontier** | Every ticket whose blockers are closed and which nobody has claimed. `/wayfinder`'s word; it means the same thing here |
| **scout** | The read-only pass over a frontier ticket, and the agent that performs it. Writes nothing |
| **contradicted** | A ticket whose premise the codebase disproves. A fault in the ticket, not a difficulty in the work |
| **collision** | Two tickets whose file sets intersect, so building both this round would conflict at merge |
| **round** | One pass of the loop: read frontier, scout, claim, build, review, integrate |
| **claim** | Marking a ticket taken on the tracker, so a concurrent session skips it |
| **`ENV:`** | The return-contract channel for problems that are about the repo or environment, not the ticket |

## Deciding to run this yourself

You may reach for this on your own judgement, but it launches a fleet of subagents that write code, create branches, and merge them. Treat the two entry paths differently.

**Explicit `/truffle-pig` is itself the go-ahead.** The user asked; run the loop.

**Self-invoked, every one of these must already be true.** If any is false, don't invoke — say what's missing instead:

- Implementation tickets exist on the tracker *now*. Not a plan, not a spec, not a conversation about what to build. Tickets, on disk or on a tracker, with blocking edges.
- At least one is unblocked and unclaimed. Zero means there is nothing to do; one means you're doing serial work with orchestration overhead, so say so rather than dressing it up as a round.
- The user's intent is to *build*, not to decide, discuss, plan, estimate, or review. "What should we do next?" is not this skill.
- You are in the repo those tickets describe, with a clean working tree.

**When you self-invoke, stop after scouting.** Run steps 1 and 2 — the frontier query and the scouts — since both are read-only and cost little. Then present the dispatch plan and wait for a go-ahead before step 3. Claiming is a write that other sessions observe, and dispatch spawns agents that modify a repo the user didn't explicitly point you at. In other words: **self-invocation defaults to `--dry-run`.**

Never self-invoke to "check whether there's work." The frontier query alone answers that, and it doesn't need this skill.

## Before you start

**Find the tracker, in this order:**

1. **`docs/agents/issue-tracker.md`** — written by `/setup-matt-pocock-skills`. Its "Wayfinding operations" section defines, for *this* repo, the **frontier query**, **claim**, blocking, and **resolve** operations. Use those definitions verbatim — with one exception below.
2. **Local markdown** — if that file is absent but a `.scratch/<effort>/issues/` directory exists, use the local-markdown convention below, since that's how the effort was charted.
3. **Neither** — stop and ask the user to run `/setup-matt-pocock-skills`.

Never hardcode `gh` commands. Wayfinder degrades to local markdown by design, so a skill that only speaks to a hosted tracker would refuse to build the very maps wayfinder charts by default.

If more than one `.scratch/<effort>/` directory exists, a repo is running several efforts at once. Take the effort from the invocation argument; if none was given, list them and ask which — never guess, and never work two at once.

**When the adapter doc and the tickets on disk disagree, trust the tickets.** An adapter written before `/to-tickets` ever ran describes only decision tickets, and it usually hardcodes the effort directory that existed at the time. Applied verbatim to an implementation corpus in a newer effort directory, its frontier query matches nothing — which reads as "no work available" rather than "wrong query." So: read the adapter for the operations it defines, then sanity-check its query against what's actually in the issues directory. If it returns nothing on a directory that visibly holds ready tickets, fall through to the shape rules below and **tell the user their adapter doc is stale** so they can fix it once instead of every session.

### Two local ticket shapes, both valid

A repo can hold both kinds simultaneously, in different effort directories, and usually does once it has been through the full pipeline. Match either; **never rewrite one shape into the other.**

| | Decision ticket (`/wayfinder`) | Implementation ticket (`/to-tickets`) |
| --- | --- | --- |
| Marker | has a `Type:` line | has no `Type:`; status reads `ready-for-agent` |
| Status | `Status: open \| claimed \| resolved` | `**Status:** ready-for-agent` |
| Blocked by | `Blocked by: NN, NN`, or an em dash for none | `**Blocked by:** NN, NN`, or `None — can start immediately` |
| Dispatchable? | only `research` and `task` — `grilling` and `prototype` are HITL | **all of them.** `ready-for-agent` *is* the AFK signal |
| Body | `## Question`, resolved with `## Answer` | `**What to build:**` plus `## Acceptance criteria` checkboxes |
| Done means | `Status: resolved` + an `## Answer` section | every acceptance box ticked + `**Status:** done` |

Practical parsing notes, since these bite:

- **Header markers are optionally bold.** Match `Status:` whether or not it's wrapped in `**`. A query written for one shape silently returns nothing on the other, which reads identically to "the frontier is empty."
- **`None — can start immediately` means unblocked**, not "blocked by a ticket named None."
- **Unblocked means every listed number is done** — `Status: resolved` for a decision ticket, `**Status:** done` for an implementation one. Resolve the blocker and the dependent becomes takeable; there's no separate dependency store.
- **Claim by setting the status to `claimed`** in either shape. Status is the assignee field: a ticket that still reads `open` or `ready-for-agent` means nobody is on it, and keeping that true is what stops two sessions colliding.
- **`ready-for-agent` is a readiness label, not a completion state.** Don't read it as "already done."

Then three checks, all cheap, each of which has cost a real round:

1. **Repo clean, base branch noted.** Every worktree forks from it.
2. **`.claude/worktrees/` is gitignored.** Worktrees are created *inside* the repo, and this orchestrator stages frequently — claims, resolutions, ticked boxes. One `git add -A` between merges commits them as embedded git repositories, producing gitlinks to throwaway branches that nobody can fetch and every future clone sees as broken. Add the ignore before dispatching; it is annoying to unpick afterwards.
3. **Does the base branch actually contain what the tickets assume?** Check for open PRs whose work the tickets depend on. A ticket whose acceptance criteria reference an env var or module living on an unmerged branch will fail its own criteria no matter how well it is implemented, and that is invisible until an agent has already been spent on it.

## This needs implementation tickets, not decision tickets

`/wayfinder` produces **decision** tickets, and by its own typing most are HITL — `grilling` and `prototype` resolve only through live exchange with a person. This skill correctly refuses those, which means **pointing it at a raw wayfinder map will find almost nothing to run.** That isn't a bug in either skill; it's the middle of the pipeline missing.

The middle is `/to-tickets`, which converts resolved decisions into vertical implementation slices sized to one fresh context window, each declaring its blocking edges. The full chain:

```
/wayfinder      chart the decisions, resolve them one per session
/to-tickets     convert the cleared route into implementation slices
/truffle-pig    build the unblocked slices in parallel   ← you are here
/code-review    review before merge
```

If the frontier query returns only `grilling` / `prototype` tickets, say so plainly and point the user at the missing step rather than dispatching the one `task` ticket and calling it a round.

## Invocation

- **`/truffle-pig`** — run the loop until the frontier is empty or something needs a human.
- **`/truffle-pig <ticket-id>`** — work exactly that ticket, if it is genuinely unblocked. Refuse if it has an open blocker; say which.
- **`/truffle-pig --dry-run`** — read the frontier, scout it, print the dispatch plan (what would run in parallel, what is held back and why, what is HITL or blocked), then **stop without claiming anything**. Claiming is a write other sessions can see, so a dry run must not do it.

Run `--dry-run` first on any ticket set you haven't executed before. The scout output is the cheapest place to notice that the tickets are wrong. If you got here on your own judgement rather than an explicit invocation, `--dry-run` is the mode — see "Deciding to run this yourself".

## The loop

### 1. Read the frontier

Run the tracker's frontier query: tickets that are unblocked, unclaimed, and not yet done.

Drop anything that needs a human in the loop — a ticket asking for a decision, a credential, or a judgement call is not implementable by a subagent. **Only dispatch AFK work.** For decision tickets that means `research` and `task` only; for implementation tickets it means all of them, since `ready-for-agent` is itself the AFK signal. Report the HITL tickets to the user instead of silently skipping them — they aren't blocked, they're waiting on a person.

Before concluding the frontier is empty, check you matched the right ticket shape. A query written for `Status: open` returns nothing against `**Status:** ready-for-agent`, and that looks exactly like "no work available." An empty result on a directory that visibly contains tickets is a parsing bug, not an empty frontier.

If the frontier is genuinely empty, say so and stop. Either everything is claimed, or the rest is blocked and someone has to finish a blocker first.

### 2. Scout every ticket

Scouting does two jobs, and the important one is not the one it looks like. **Checking the ticket's premises against the codebase is the primary value; collision prediction is the useful by-product.** Across five rounds of real use, a third of the tickets scouted were factually wrong — describing a file as existing that didn't, wanting a browser-only export in server code, referencing an env var that lived on an unmerged branch — and every one was caught before an implementation was spent on it. That is worth far more than the merge conflicts avoided.

**Scout every ticket, including ones you wrote or rewrote earlier in this session.** "I just wrote it, I know it's right" is precisely the case that has produced errors: a rewritten ticket confidently offered a fix that was false at the moment of writing, and the next round's scout found it in one read. A scout costs one cheap read-only agent. Your certainty costs an implementation.

The collision half still matters — two agents editing one file produce a merge conflict at integration, and predicting that beats discovering it at merge — but treat it as the second reason you're doing this, not the first.

Send one **read-only scout** per frontier ticket, all in parallel. A scout writes nothing:

> Read ticket `<id>`: `<title>`. `<body>`
>
> Do not modify anything. Identify which existing files this ticket would have to change, and where new files would go. Search the codebase to confirm — do not guess from the ticket text.
>
> Return only:
> ```
> TICKET: <id>
> EDITS:  <existing paths this must change>
> ADDS:   <new paths this would create>
> RISK:   <one line: anything that makes this ticket bigger than it looks>
> ```

Then group tickets whose paths intersect and dispatch **one ticket per group** this round; the rest return to the frontier for the next round. Non-intersecting tickets all go at once.

**Exclude manifests and lockfiles from the intersection test** — `package.json`, `package-lock.json`, `Cargo.toml`, `go.mod`, `pyproject.toml` and friends. Any ticket that adds a dependency touches the manifest, so counting it as a collision serialises the entire frontier exactly when fan-out is most valuable. It also optimises the wrong thing: a dependency-block conflict is among the most trivially mergeable in git, while the conflicts actually worth avoiding are two agents restructuring the same source module. Lockfiles do genuinely conflict, but they regenerate — see step 6.

**A scout that contradicts the ticket halts that ticket.** If the codebase disproves something the ticket states as fact — a file it calls existing that isn't, a browser-only export it wants in server code, an acceptance criterion referencing something absent from the base branch — that is a fault in the ticket, not a difficulty in the work. Do **not** dispatch it. Comment the finding on the ticket and report it; a human fixes the ticket. Spending an implementation on a ticket whose premise is false throws away the cheap check that just caught it.

**When a ticket collides, check whether its scope is real before holding it.** A surprisingly wide `EDITS` list usually means the ticket is over-scoped, not that the work is genuinely wide. One ticket's ten-file footprint came down to three files it only touched because it said "delete the sample IR" — a module that happened to be the shared fixture for unrelated tests — and those spurious edits were the *only* thing colliding with its neighbour. Narrowing the ticket to what it actually needed de-collided the round and turned one-per-round back into two-in-parallel. The path sets are a scope review as much as a collision predictor.

**Two scouts each reporting a gap the other ticket was meant to fill is a cycle.** Blocking edges express *sequence*, not artifact dependency, so two tickets can both be unblocked and still deadlock — one wanting a tolerance from a harness the other hasn't built, the other wanting an input only the first can produce. The frontier query cannot see this; the scouts are the only net. When you spot it, cut one side explicitly — usually by letting one ticket proceed against synthetic inputs — and hold the other. Don't dispatch both and hope.

Report the grouping you derived, which tickets you held for collisions, and — separately, because it means something different — which you held because the ticket is wrong.

### 3. Claim before dispatching

Claim every ticket you are about to dispatch, using the tracker's claim operation, **before any work starts**. The claim is what stops a concurrent session from picking up the same ticket. An unclaimed open ticket means nobody is on it — keep that invariant true.

### 4. Dispatch in parallel

One subagent per ticket, all in a single message so they run concurrently, each with `isolation: "worktree"`. Give each one only what it needs — never your session history.

The brief:

> Implement ticket `<id>`: `<title>`
>
> `<full ticket body: what to build, acceptance criteria>`
>
> You are in an isolated worktree on branch `ticket/<id>`. Match the conventions already in the code. `<if this repo has a CONTEXT.md, ADRs under docs/adr/, or convention docs named by the tracker adapter, name them here — otherwise say nothing, so the agent doesn't spend a tool call discovering they don't exist>`
>
> Use test-driven development at the seams the ticket names. Run typechecking and the relevant test files as you go, and the full suite once at the end. Commit to your branch.
>
> If you hit a problem with the repo that is **not** about your ticket — a broken lockfile, a pre-existing failing test, a missing tool — put it on the `ENV:` line. Don't silently work around it, and don't bury it in the summary.
>
> **Assume you have no credentials.** Your worktree almost certainly has no API keys or auth profiles. If your ticket needs a live call to produce an artifact — a recorded fixture, a snapshot, a captured trace — report it on `ENV:` and **do not fabricate the artifact.** A hand-authored fixture that tests then assert against produces a green suite that proves only the plumbing. Ship whatever honest coverage you can (a scripted stub is fine, and say that's what it is) and let the orchestrator record the real thing.
>
> **Return only this report. No diffs, no code blocks, no file contents, no narration of what you did step by step:**
>
> ```
> STATUS:  LANDED | BLOCKED
> BRANCH:  ticket/<id>
> TESTS:   <command> -> pass | fail
> FILES:   <paths you touched>
> SUMMARY: <at most three sentences>
> BLOCKED: <what stopped you — only if STATUS is BLOCKED>
> ENV:     <a repo/environment problem unrelated to this ticket — omit if none>
> ```

**Aggregate the `ENV:` lines across the round before doing anything else with the results.** Three agents reporting the same broken lockfile is a completely different signal from one agent's aside, and without a dedicated field that class of problem arrives as free prose after the report and gets under-weighted. If an `ENV:` line says a build or install command is broken, **run that exact command yourself** before judging any ticket in the round — a repo where `npm ci` cannot succeed produces failing CI on every branch regardless of implementation quality. Verify the failing command, not a proxy for it.

The channel catches more than repo faults. It has surfaced a port the orchestrator's own stray dev server was holding, and a sandbox that refused any command containing a particular substring. Read it as "something about my environment is wrong," not only "something about this repo is wrong."

**If you find yourself adding context to a brief that isn't in the ticket, that context belongs *in the ticket*.** Write it there first, then dispatch. Verified API traps, the path to a prototype holding a settled decision, which files establish house style, "consult the `claude-api` skill before choosing a model id" — that's durable project knowledge, usually learned expensively earlier in the effort. A brief is assembled fresh every run and thrown away; a ticket is written once and outlives the session that learned the thing. This is also what makes the "never your session history" rule enforceable: without it, the rule forbids passing session knowledge and offers nowhere else to put it.

That return contract is the point. The orchestrator's context stays small enough to keep coordinating no matter how many tickets run, because implementation detail never flows back up — it stays in the branch, where it belongs and where `git diff` can retrieve it on demand.

### 5. Review, once

For each ticket that came back `LANDED`, dispatch one reviewer subagent against that branch's diff. Ask for spec compliance against the acceptance criteria and for anything actually broken — not style. Same report discipline: findings only, no rewritten code.

Tell the reviewer to **say so if any part of the diff was unreadable** rather than approving around it. A single NUL byte makes git classify a source file as binary, so its diff shows nothing and `grep` skips it — and "reviewed and approved" then covers less than it appears to. An honest "I could not read this file" is a finding.

If the review finds real problems, send the ticket back for **one** fix round. If it comes back still broken, stop working that ticket: post the findings as a tracker comment, leave the issue open and unclaimed, and move on. Do not escalate through repeated rounds — a ticket that fails twice is telling you the ticket is wrong, and that is a human's call.

### 6. Integrate one at a time

Merge **sequentially**, running the test suite between each. Parallel build, serial integrate.

Two things to do before believing a red suite:

- **After merging a ticket that changed the manifest, run the project's install command.** Your `node_modules` predates the dependency the ticket added, so `tsc` and any test importing it will fail for a reason that has nothing to do with the ticket. Red here means "install first," not "the ticket is broken."
- **If an agent reported a missing credential on `ENV:`, produce the affected artifact yourself before judging the ticket.** Recording the real fixture is what turns "the plumbing runs" into "the behaviour works" — and it is the only way to know whether the stub the agent honestly shipped was hiding a real failure.

Free any ports you're holding before the round starts, too. A stray dev server from an earlier session has blocked an agent's browser tests, and it reads as a ticket failure.

**Merge the branch named in the returned report**, not the branch the harness put the worktree on. Worktree isolation creates its own `worktree-agent-<hash>` branch, and the agent then creates and commits to `ticket/<id>` as the brief instructs — so both exist, and the harness one is empty. A caller looking up work by branch name can find the empty one and conclude nothing landed. The `worktree-agent-*` branches are safe to prune once integration is done.

**Pick the integration target deliberately.** Merging into the base branch is the default, but a repo that wants human review before `main` should have the round land on an integration branch — `truffle-pig/round-N` — that becomes one PR. If you do that, the round **stops there**: don't continue to tickets whose blockers merged only to the integration branch, because their base doesn't contain the work they depend on. One round per PR, then stop and hand off. State which mode you're in before you start merging, since it changes what step 7 means.

**Never auto-resolve a merge conflict** in source. The one safe exception is a lockfile: regenerate it with the project's install command rather than hand-merging. Everything else — stop, leave the branch in place, report which tickets collided, and let the user decide.

### 7. Resolve on the tracker

For each ticket that merged green, use the tracker's resolve operation. On a hosted tracker that's a comment plus a close. In local markdown it depends on the shape: a decision ticket gets an `## Answer` section and `Status: resolved`; an implementation ticket gets its acceptance boxes ticked and `**Status:** done`.

Tick a box only if the merged code actually satisfies it. Unticked boxes on an otherwise-landed ticket are the honest signal that the slice was partial, and they're what a human needs to see.

Marking done is what unblocks the dependents — so if you merged to the base branch, the frontier has now grown.

**If you merged to an integration branch instead, mark the tickets done and stop.** The work is real but it isn't on the base yet, so the dependents' assumptions still don't hold. Say plainly that the round is complete, name the branch to open a PR from, and leave the next round to a session running after that PR lands.

### 8. Go again

Re-run the frontier query. If new tickets are unblocked, repeat from step 1.

Stop when the frontier is empty, when everything left is HITL or blocked, when a conflict needs a human, when a round merged to an integration branch, or when a ticket was held back as contradicted — that last one is a planning problem, and looping will not fix it.

## When the frontier is large

Above roughly six tickets, hand fan-out gets unwieldy. Use the shipped script instead — it does scout → group → implement → review with the same policy, using `pipeline()` so each ticket reviews the moment its own implementation lands rather than waiting on a wave:

```
Workflow({
  scriptPath: "<this skill's base directory>/truffle-pig.workflow.js",
  args: { baseBranch: "<base>", tickets: [{ id, title, body }, ...] }
})
```

The script ships next to this SKILL.md; use the base directory announced when the skill was invoked. For a marketplace install that resolves under `${CLAUDE_PLUGIN_ROOT}/skills/orchestration/truffle-pig/`, for a hand-copied install under `~/.claude/skills/truffle-pig/` — never assume the latter.

Pass `conventions` with the actual convention docs this repo has, and `implEffort` / `reviewEffort` if the defaults (`high` / `medium`) don't fit. Effort is pinned rather than inherited so a session running at `xhigh` doesn't multiply that across every concurrent worktree agent. `ignoreForCollision` overrides the manifest/lockfile exclusion list if this project's ecosystem isn't covered.

It returns `contradicted` (tickets the scout disproved — fix these, don't retry them) and `envReports` (repo-level problems aggregated across the round) alongside the build results. Read both before judging any ticket.

**Claim the tickets on the tracker before invoking it** — the script assumes that's done. It deliberately does **not** integrate: it hands back `ready`, `needsFix`, `blocked`, `heldBack`, and the scouts' `risks`, and you merge serially in this session.

Because the script scouts *after* you claim, some tickets come back `heldBack` — claimed but never worked. **Release those claims as soon as the workflow returns.** A claimed-but-idle ticket looks taken to every other session, which is the one invariant this design depends on. Then re-run after integrating to pick them up.

If a run dies partway, relaunch with `resumeFromRunId` — completed agents return from cache, so you don't pay twice for work that already landed.

## What this skill deliberately does not do

- **No planning.** If the tickets don't exist yet, that's `/wayfinder` then `/to-tickets`. This skill refuses to invent work.
- **No review ladder.** One review, one fix, then it goes back to a human. Cheaper than escalating, and a twice-failed ticket is a scoping bug.
- **No parallel state store.** If you find yourself writing status into a local file, the tracker operation you needed already exists in `docs/agents/issue-tracker.md`.
