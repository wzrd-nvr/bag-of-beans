export const meta = {
  name: 'frontier',
  description: 'Scout, then implement and review an unblocked ticket frontier in parallel worktrees',
  whenToUse:
    'Invoked by the /frontier skill when the frontier is large enough that hand fan-out is unwieldy. Tickets must already be claimed on the tracker. Integration is deliberately left to the calling session.',
  phases: [
    { title: 'Scout', detail: 'read-only pass per ticket to find the files it would touch' },
    { title: 'Implement', detail: 'one worktree-isolated agent per non-colliding ticket' },
    { title: 'Review', detail: 'spec and correctness review of each landed branch' },
  ],
}

const TICKETS = (args && args.tickets) || []
const BASE = (args && args.baseBranch) || 'main'

// Pinned rather than inherited: a coding session often runs at xhigh, and
// inheriting that multiplies it across every concurrent worktree agent. Scouts
// stay cheap; implementation gets the headroom; review sits between.
const IMPL_EFFORT = (args && args.implEffort) || 'high'
const REVIEW_EFFORT = (args && args.reviewEffort) || 'medium'

// Convention docs are repo-specific. Naming files that don't exist costs every
// agent a wasted tool call, so the calling skill passes what this repo has —
// ideally lifted from the tracker adapter doc, which is already repo-specific.
const CONVENTIONS =
  (args && args.conventions) ||
  'If the repo has a CONTEXT.md or ADRs under docs/adr/, read the ones covering your area.'

// Manifests and lockfiles are excluded from the collision test. Any ticket that
// adds a dependency touches package.json, so counting it as a collision
// serialises the whole frontier exactly when fan-out is most valuable — and it
// optimises the wrong thing: a dependency-block conflict is among the most
// trivially mergeable in git, unlike two agents restructuring one source module.
// Lockfiles do conflict, but they regenerate; source does not.
const IGNORED_FOR_COLLISION = new Set(
  (args && args.ignoreForCollision) || [
    'package.json',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'Cargo.toml',
    'Cargo.lock',
    'go.mod',
    'go.sum',
    'requirements.txt',
    'pyproject.toml',
    'poetry.lock',
    'Gemfile.lock',
    'composer.lock',
  ]
)

if (!TICKETS.length) {
  return { error: 'No tickets supplied. Pass {baseBranch, tickets: [{id, title, body}]}.' }
}

const SCOUT_SCHEMA = {
  type: 'object',
  required: ['id', 'edits', 'adds', 'risk'],
  properties: {
    id: { type: 'string' },
    edits: { type: 'array', items: { type: 'string' }, description: 'existing repo-relative paths this ticket must change' },
    adds: { type: 'array', items: { type: 'string' }, description: 'new repo-relative paths this ticket would create' },
    risk: { type: 'string', description: 'one line: anything making this ticket bigger than it looks; empty if none' },
    contradictsTicket: {
      type: 'boolean',
      description:
        'true if the codebase contradicts a premise the ticket states as fact — a file the ticket calls existing that does not, a dependency in the wrong place, an acceptance criterion referencing something absent from the base branch. Not for mere difficulty.',
    },
  },
}

const RESULT_SCHEMA = {
  type: 'object',
  required: ['id', 'status', 'branch', 'tests', 'files', 'summary'],
  properties: {
    id: { type: 'string' },
    status: { type: 'string', enum: ['LANDED', 'BLOCKED'] },
    branch: { type: 'string' },
    tests: { type: 'string', description: 'command run -> pass | fail' },
    files: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string', description: 'at most three sentences' },
    blocked: { type: 'string', description: 'what stopped you; empty unless status is BLOCKED' },
    env: {
      type: 'string',
      description:
        'a problem with the repo or environment that is NOT about this ticket — a broken lockfile, a failing pre-existing test, a missing tool. Empty if none. This is the channel for things a narrow ticket report would otherwise drop.',
    },
  },
}

const REVIEW_SCHEMA = {
  type: 'object',
  required: ['id', 'approved', 'findings'],
  properties: {
    id: { type: 'string' },
    approved: { type: 'boolean' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'detail'],
        properties: {
          severity: { type: 'string', enum: ['blocking', 'minor'] },
          detail: { type: 'string' },
        },
      },
    },
  },
}

// ── Phase 1: scout ────────────────────────────────────────────────────────────
// A genuine barrier: grouping needs every scout's file set before any dispatch.
phase('Scout')
log(`Scouting ${TICKETS.length} frontier tickets`)

// Keep nulls: parallel() preserves input order, so position is the join key.
// Matching on a model-echoed id would misreport a formatting drift ("08 ", 8,
// "ticket-08") as a failed scout.
const scoutResults = await parallel(
  TICKETS.map((t) => () =>
    agent(
      `Read ticket ${t.id}: ${t.title}\n\n${t.body}\n\n` +
        `Do NOT modify anything — you are read-only.\n\n` +
        `YOUR PRIMARY JOB is to check the ticket's premises against the codebase. If it describes a ` +
        `file, export, env var, or capability as already existing and it does not exist on this ` +
        `branch — or exists somewhere that would break the architecture, like a browser-only export ` +
        `needed by server code — set contradictsTicket true and say so in risk. That is a fault in ` +
        `the ticket, not a difficulty in the work, and it is the most valuable thing you can find. ` +
        `Check this even if the ticket looks freshly written and confident; recently-authored ` +
        `tickets have been wrong.\n\n` +
        `SECOND, determine which existing files this ticket must change and where new files would ` +
        `go, so collisions can be predicted. Confirm by reading, do not guess from the ticket text. ` +
        `If the file list comes out surprisingly wide, say so in risk — that usually means the ` +
        `ticket is over-scoped rather than the work being genuinely wide.\n\n` +
        `Report the ticket id exactly as "${t.id}".`,
      { label: `scout:${t.id}`, phase: 'Scout', schema: SCOUT_SCHEMA, effort: 'low' }
    )
  )
)

// ── Group: greedy maximal set with disjoint path sets ─────────────────────────
const taken = []
const claimedPaths = new Set()
const heldBack = []

const contradicted = []

TICKETS.forEach((t, i) => {
  const scout = scoutResults[i]
  if (!scout) {
    heldBack.push({ id: t.id, reason: 'scout returned nothing' })
    return
  }
  // A scout that found the ticket factually wrong stops dispatch on scout
  // evidence alone. Spending an implementation on a ticket whose premise is false
  // wastes the cheap check that just caught it.
  if (scout.contradictsTicket) {
    contradicted.push({ id: t.id, risk: scout.risk || '(no detail given)' })
    return
  }
  // Both sides matter: two tickets creating the same new path collide exactly as
  // hard as two editing the same existing one, and on a young codebase that is
  // the more common case.
  const paths = [...(scout.edits || []), ...(scout.adds || [])].filter(
    (p) => !IGNORED_FOR_COLLISION.has(p.split('/').pop())
  )
  const clash = paths.filter((p) => claimedPaths.has(p))
  if (clash.length) {
    heldBack.push({ id: t.id, reason: `paths overlap already-dispatched work: ${clash.join(', ')}` })
    return
  }
  paths.forEach((p) => claimedPaths.add(p))
  taken.push({ ticket: t, scout })
})

if (contradicted.length) {
  log(`${contradicted.length} ticket(s) contradicted by the codebase — not dispatching those`)
}

log(`Dispatching ${taken.length} in parallel; holding ${heldBack.length} for a later round`)
if (!taken.length) {
  return {
    dispatched: [],
    heldBack,
    contradicted,
    scouts: scoutResults.filter(Boolean),
    note: contradicted.length
      ? 'Nothing dispatched. Tickets were contradicted by the codebase — fix the tickets before rerunning; this is a planning problem, not an execution one.'
      : 'Every frontier ticket collided on real source paths. Widen the slices or run them serially.',
  }
}

// ── Phases 2–3: implement then review, pipelined per ticket ───────────────────
// No barrier: each ticket reviews the moment its own implementation lands.
const results = await pipeline(
  taken,
  ({ ticket, scout }) =>
    agent(
      `Implement ticket ${ticket.id}: ${ticket.title}\n\n${ticket.body}\n\n` +
        `You are in an isolated git worktree forked from ${BASE}. Work on branch ticket/${ticket.id}.\n` +
        `A scout expects you to touch: ${(scout.edits || []).join(', ') || '(new files only)'}. ` +
        `Treat that as a hint, not a limit.\n\n` +
        `Match the conventions already in the code. ${CONVENTIONS}\n` +
        `Work test-first at the seams the ticket names. Run typechecking and the relevant tests as you go, ` +
        `and the full suite once at the end. Commit to your branch.\n\n` +
        `If you hit a problem with the repo that is NOT about your ticket — a broken lockfile, a ` +
        `pre-existing failing test, a missing tool — put it in the env field. Do not silently work ` +
        `around it and do not bury it in the summary.\n\n` +
        `Assume you have NO credentials: this worktree almost certainly has no API keys or auth ` +
        `profiles. If your ticket needs a live call to produce an artifact — a recorded fixture, a ` +
        `snapshot, a captured trace — report it in the env field and DO NOT fabricate the artifact. ` +
        `A hand-authored fixture that tests assert against yields a green suite proving only the ` +
        `plumbing. Ship whatever honest coverage you can, say plainly that it is a stub, and let ` +
        `the orchestrator record the real thing.\n\n` +
        `Return ONLY the structured report — no diffs, no code blocks, no file contents, no step-by-step ` +
        `narration. Report the ticket id exactly as "${ticket.id}" and the branch as "ticket/${ticket.id}".`,
      {
        label: `impl:${ticket.id}`,
        phase: 'Implement',
        schema: RESULT_SCHEMA,
        isolation: 'worktree',
        effort: IMPL_EFFORT,
      }
    ),
  (built, { ticket }) => {
    if (!built || built.status !== 'LANDED') return { built, review: null }
    return agent(
      `Review branch ${built.branch} against ticket ${ticket.id}.\n\n${ticket.body}\n\n` +
        `Diff it against ${BASE}. Judge two things only: does it satisfy the acceptance criteria, and is ` +
        `anything actually broken. Ignore style and formatting. Mark a finding "blocking" only if the ` +
        `ticket is unmet or the code is wrong — not for taste.\n\n` +
        `If any part of the diff was unreadable — git classified a file as binary, grep skipped it — ` +
        `report that as a finding rather than approving around it. An approval that silently ` +
        `excluded a file covers less than it appears to.\n\n` +
        `Return findings only. Do not rewrite the code. Report the ticket id exactly as "${ticket.id}".`,
      { label: `review:${ticket.id}`, phase: 'Review', schema: REVIEW_SCHEMA, effort: REVIEW_EFFORT }
    ).then((review) => ({ built, review }))
  }
)

const settled = results.filter(Boolean)

return {
  base: BASE,
  ready: settled.filter((r) => r.built && r.built.status === 'LANDED' && r.review && r.review.approved),
  needsFix: settled.filter(
    (r) => r.built && r.built.status === 'LANDED' && r.review && !r.review.approved
  ),
  blocked: settled.filter((r) => r.built && r.built.status === 'BLOCKED').map((r) => r.built),
  heldBack,
  contradicted,
  // Aggregated so a round-wide breakage is visible as a pattern. Three agents
  // reporting the same broken lockfile is a different signal from one aside.
  envReports: settled
    .filter((r) => r.built && r.built.env && r.built.env.trim())
    .map((r) => ({ id: r.built.id, env: r.built.env })),
  risks: scoutResults
    .filter(Boolean)
    .filter((s) => s.risk && s.risk.trim())
    .map((s) => ({ id: s.id, risk: s.risk })),
  note:
    'This is ONE wave, and integration is deliberately not done here — merge the ready branches ' +
    'serially in the calling session, running tests between each, and never auto-resolve a conflict. ' +
    'Two follow-ups are the caller\'s job: release the tracker claim on every heldBack ticket ' +
    'immediately (they were claimed before this ran but never worked, and a claimed-but-idle ticket ' +
    'blocks other sessions), then re-run this workflow after integrating to pick them up.',
}
