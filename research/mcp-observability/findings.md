# What a hosted MCP server can observe about skill usage — and how outcome gets back

**Ticket:** wzrd-nvr/bag-of-beans#9 (`wayfinder:research`)
**Date:** 2026-08-03
**Status:** the usage half of the premise holds completely. The outcome half does not, and the
answer splits in two: there is **no honest outcome metric** a hosted MCP server can passively
observe, and the standards proposal to create one was closed in 3.5 hours with no discussion.
There *is* one honest outcome **channel** — a server-defined `report_outcome` tool, measured
working — but it yields qualitative field reports, not a number, and aggregating it would
reproduce a known production failure. The only unambiguously honest *measurement* is a
randomized holdout we build ourselves.

## Spec revisions worked from

| Revision | Why it matters here |
| --- | --- |
| `2026-07-28` | Current released revision. `LATEST_PROTOCOL_VERSION = "2026-07-28"` — `schema/2026-07-28/schema.ts:30`. Released six days before this research; **no client implements it yet**. |
| `2025-11-25` | What Claude Code v2.1.221 actually negotiates on the wire (measured, below). This is the revision to build against. |
| `2025-06-18` | Previous widely-implemented revision; where elicitation was introduced. |

Read from a clone of `github.com/modelcontextprotocol/modelcontextprotocol` at
`e24f0099b60f7c00e165a0faa02a72029d2fa654` (2026-08-02), plus
`@modelcontextprotocol/sdk@1.30.0` (the current `latest` on npm) and the `2.0.0-alpha.0`
SDK source on `main`.

Line references below are to files in that spec clone.

## Method

Two kinds of evidence, kept separate throughout:

- **Schema/spec** — read directly from `schema.ts` and the normative `.mdx` prose.
- **Measured** — a purpose-built Streamable HTTP MCP server that logs every byte it
  receives, driven by real `claude -p` sessions against Claude Code **v2.1.221**. Nine
  sessions total. Raw captures are quoted inline. Anything marked *measured* was observed,
  not inferred from documentation.

Measurement matters here because the gap between "the spec permits" and "the client does"
is where this ticket's premise lives or dies.

---

## 1. What is actually in an MCP request

### Schema level

The base params type carries almost nothing. In `2025-11-25`:

```ts
// schema/2025-11-25/schema.ts:51
export interface RequestParams {
  _meta?: {
    progressToken?: ProgressToken;
    [key: string]: unknown;
  };
}
```

`tools/call` adds exactly two fields (`schema/2025-11-25/schema.ts:1137`):

```ts
export interface CallToolRequestParams extends TaskAugmentedRequestParams {
  name: string;
  arguments?: { [key: string]: unknown };
}
```

`resources/read` adds exactly one (`schema/2025-11-25/schema.ts:706`, via
`ResourceRequestParams`): a `uri` string.

That is the whole payload. There is no field for the user's prompt, the conversation, the
model, the working directory, the task, or the reason the tool was chosen. Client identity
lives only in the `initialize` handshake, not on the requests themselves.

`2026-07-28` changes this in the server operator's favour. It deletes the `initialize`
handshake and moves identity onto **every request** in `_meta`
(`schema/2026-07-28/schema.ts:63`, and the normative table at
`docs/specification/2026-07-28/basic/index.mdx:365`):

| `_meta` key | Required | Content |
| --- | --- | --- |
| `io.modelcontextprotocol/protocolVersion` | Yes | e.g. `"2026-07-28"` |
| `io.modelcontextprotocol/clientCapabilities` | Yes | full `ClientCapabilities` object |
| `io.modelcontextprotocol/clientInfo` | No (SHOULD) | `Implementation` — name, version, title, description, websiteUrl |
| `io.modelcontextprotocol/logLevel` | No | per-request log level |

The spec is explicit that this is for observability and nothing else:

> The value is self-reported by the client and is not verified by the protocol. It is
> intended for display, logging, and debugging. Servers SHOULD NOT use it to change their
> behavior, and SHOULD NOT rely on it for security decisions.
> — `schema/2026-07-28/schema.ts:75-85`

Good for telemetry, useless for trust. Note also that `2026-07-28` requires `Mcp-Method` and
`Mcp-Name` **HTTP headers** mirroring the JSON-RPC method and the tool/resource name
(`docs/specification/2026-07-28/basic/transports/streamable-http.mdx:290`). Once clients
speak this revision, a plain HTTP access log — no JSON parsing — tells you which skill was
fetched. That is a real gift for a telemetry-in-the-core-service design.

### What the server implementation actually hands you

`@modelcontextprotocol/sdk@1.30.0`, `RequestHandlerExtra`
(`dist/esm/shared/protocol.d.ts:173`): `signal`, `authInfo`, `sessionId`, `_meta`,
`requestId`, `taskId`, `requestInfo`, plus `sendNotification` / `sendRequest`.

`requestInfo` is the escape hatch to the transport layer
(`dist/esm/types.d.ts:7953`) — `{ headers: IsomorphicHeaders; url?: URL }`. Every HTTP
header, so User-Agent and (via your proxy) source IP.

`authInfo` (`dist/esm/types.d.ts:727`) is `{ token, clientId, scopes[], expiresAt?,
resource?, extra? }`. **`clientId` is the OAuth client, not the human.** Any per-user
identity has to come from your own token introspection into `extra`, which means it is
something you build, not something MCP gives you.

SDK v2 (`2.0.0-alpha.0`) reshapes this into `ServerContext`
(`packages/core-internal/src/shared/protocol.ts:451`) with `ctx.mcpReq.envelope` exposing the
new per-request `io.modelcontextprotocol/*` keys, and `ctx.http.req` exposing the raw
`Request`. Same information, better ergonomics.

### Measured: what Claude Code v2.1.221 actually sends

Verbatim capture from the probe server. `initialize`:

```json
{"method":"initialize","params":{
  "protocolVersion":"2025-11-25",
  "capabilities":{"roots":{"listChanged":true},"elicitation":{}},
  "clientInfo":{"name":"claude-code","title":"Claude Code","version":"2.1.221",
    "description":"Anthropic's agentic coding tool",
    "websiteUrl":"https://claude.com/claude-code"}},
 "jsonrpc":"2.0","id":0}
```

Headers on every subsequent request:

```
user-agent: claude-code/2.1.221 (sdk-cli)
mcp-protocol-version: 2025-11-25
mcp-session-id: 2ce5c474-1420-4524-ac7f-8cd3287ea2ce
accept: application/json, text/event-stream
```

A `tools/call`:

```json
{"method":"tools/call","params":{
  "name":"get_skill","arguments":{"name":"demo-skill"},
  "_meta":{"claudecode/toolUseId":"toolu_013ZuN7d6YiCm1iGtB7oC6cX","progressToken":4}},
 "jsonrpc":"2.0","id":4}
```

A `resources/read`:

```json
{"method":"resources/read","params":{"uri":"skill://demo-skill"},"jsonrpc":"2.0","id":5}
```

Five things worth pulling out:

1. **Claude Code does not advertise `sampling`.** Declared capabilities are exactly
   `roots` and `elicitation`. Sampling is also absent from the entire Claude Code
   documentation set (`code.claude.com/docs/llms.txt`, zero hits). It is not available.
2. **`clientInfo` is rich and honest** — name, version, title, description, website. Enough
   to segment `mcp` traffic by client and version without any instrumentation.
3. **`tools/call` carries a vendor extension, `claudecode/toolUseId`.** This is the
   Anthropic API `tool_use` block id. It is undocumented, unique per call, and *not*
   resolvable by the server into anything — but it is a stable per-call correlation key,
   and it distinguishes a genuine model-issued call from a retry.
4. **`resources/read` carries no `_meta` at all** — no `progressToken`, no `toolUseId`.
   Resource reads are strictly less observable than tool calls. **If you want telemetry,
   serve skills as tools, not resources.** This is a design decision the ticket should
   inherit.
5. **No user identity, no prompt, no cwd, no conversation.** As the schema promises.

---

## 2. Session continuity

### Today (`2025-11-25` and earlier): yes, and it is reliable

`docs/specification/2025-06-18/basic/transports.mdx:176-195` (unchanged in `2025-11-25`):

- The server **MAY** mint a session ID and return it in the `Mcp-Session-Id` header on the
  `InitializeResult`. It **SHOULD** be globally unique and cryptographically secure.
- If the server returns one, clients **MUST** include it on all subsequent requests.
- The server **MAY** terminate a session at any time (`404` thereafter); the client **MUST**
  then re-initialize.
- Clients **SHOULD** send `HTTP DELETE` to end a session.

The key property: **the session ID is server-minted**, so its granularity and uniqueness are
entirely under your control. You are not depending on the client to generate anything.

*Measured:* Claude Code v2.1.221 echoed the server-minted `Mcp-Session-Id` on every
subsequent POST and on the SSE GET, across all nine probe sessions. It works.

Lifetime, measured and documented:

- One session spans one Claude Code connection to the server. A `-p` run is one session.
- HTTP servers that drop are auto-reconnected with exponential backoff, "up to five
  attempts, starting at a one-second delay and doubling each time"
  (`code.claude.com/docs/en/mcp`). A reconnect means a **new** `initialize`, so a new
  session ID — one agent run can span several session IDs.
- No `DELETE` was observed at the end of a `-p` run; the process just exits. **Session end
  is not reliably signalled.** Sessions must be closed by inactivity timeout, not by an
  event.

So: session ID correlates an early fetch with a later call from the same agent run, usually.
It under-counts continuity across reconnects and it cannot tell you a run *ended* — only that
it went quiet.

### `2026-07-28`: sessions are removed from the protocol

This is the bad news in this section, and it is unambiguous.

> Remove protocol-level sessions and the `Mcp-Session-Id` header from the Streamable HTTP
> transport. […] Servers that need cross-call state use explicit, server-minted handles
> passed as ordinary tool arguments (SEP-2567).
> — `docs/specification/2026-07-28/changelog.mdx`, Major changes #1

And for servers speaking only the new revision:

> An `Mcp-Session-Id` header on a request: ignore it, and do not mint or echo session IDs.
> — `docs/specification/2026-07-28/basic/transports/streamable-http.mdx:685`

The whole protocol went stateless (`initialize` removed, `Major changes #2`). Two
replacements exist, and both are worse for our purpose:

- **Server-minted handles passed as tool arguments.** Works, but only if the *model* chooses
  to pass the handle back on the next call. That is instruction-following, not transport
  guarantee.
- **W3C trace context in `_meta`.** `traceparent` / `tracestate` / `baggage` are reserved
  keys (`docs/specification/2026-07-28/basic/index.mdx:419-427`), explicitly aligned with the
  OpenTelemetry semantic conventions for MCP. A shared `trace_id` across requests is exactly
  the correlation key a session ID gave us.

  Claude Code already does this — *but conditionally*:

  > Outbound HTTP MCP requests carry `traceparent` the same way.
  > — `code.claude.com/docs/en/monitoring-usage.md:160`

  > By default, the `traceparent` header on model and HTTP MCP requests is sent only when
  > `ANTHROPIC_BASE_URL` is unset or points at the Anthropic API […]
  > — same file, line 162

  It requires the user to have OpenTelemetry tracing configured, which is off by default and
  in practice means enterprise deployments only. *Measured:* no `traceparent` appeared in any
  of the nine probe sessions.

**Planning consequence.** Session-based correlation has a shelf life. It works now, it is the
right thing to use now, and it is scheduled for removal. Build the correlation key as a
*replaceable* field in the core telemetry service — `correlation_id` sourced from
`Mcp-Session-Id` today, from `traceparent`'s trace-id or a server-minted handle later. Do not
name the column `session_id`.

---

## 3. Soliciting outcome: every mechanism, tested

### Sampling — dead twice over

Spec: `sampling/createMessage` lets a server ask the client to run a completion. It could in
principle be used to ask the model to summarise how the skill went.

- **Deprecated** as of `2026-07-28` under SEP-2577, migration path "integrate directly with
  LLM provider APIs" (`docs/specification/2026-07-28/deprecated.mdx`). Earliest removal:
  first revision on or after 2027-07-28.
- **Claude Code does not implement it** (*measured*: absent from declared capabilities;
  absent from all Anthropic documentation).
- The spec requires a human gate anyway: "there **SHOULD** always be a human in the loop with
  the ability to deny sampling requests" (`docs/specification/2025-06-18/client/sampling.mdx:25`).
- `includeContext: "thisServer" | "allServers"` — the one field that would have exposed
  conversation context to a server — is separately deprecated
  (`schema/2026-07-28/schema.ts:2117-2126`).

Unusable. Do not design around it.

### Elicitation — implemented, and still the wrong tool

This is the one that looks most promising on paper and fails on contact.

Spec support is real and improving: elicitation survived the `2026-07-28` deprecation cull,
reshaped into the Multi Round-Trip Requests pattern (server returns
`resultType: "input_required"` with `inputRequests`; client retries the original request
carrying `inputResponses` — `schema/2026-07-28/schema.ts:584-607`).

Claude Code support is real and first-class:

> When a server needs information it can't get on its own, Claude Code displays an
> interactive dialog and passes your response back to the server. No configuration is
> required on your side.
> — `code.claude.com/docs/en/mcp.md:1103`

Both form mode and URL mode. There is even an `Elicitation` hook and an `ElicitationResult`
hook (`code.claude.com/docs/en/hooks.md:65-66`).

Three disqualifying problems, the first of which is measured:

1. **It returns `cancel` when no human is present.** Probe server sent an
   `elicitation/create` over the SSE stream during a `tools/call` in a `claude -p` run. The
   client answered immediately:

   ```json
   {"jsonrpc":"2.0","id":"srv-1","result":{"action":"cancel"}}
   ```

   Headless runs, CI, subagents, and the Agent SDK are exactly the traffic a hosted skills
   server sees most of. All of it yields `cancel`.

2. **It asks the wrong entity.** The human did not read the skill; the model did. A dialog
   asking "did that skill help?" interrupts someone who was not paying attention to the
   thing being measured.

3. **The answer may not be from a human at all.** The `Elicitation` hook can auto-respond
   with `action` and `content` (`code.claude.com/docs/en/hooks.md:874`). A response is not
   evidence of a person.

And it interrupts. A skills server called several times a session cannot pop a modal each
time. Elicitation is for "I need your API region", not "rate my output".

### Logging notifications — wrong direction, and deprecated

`notifications/message` flows **server → client**. It carries information away from us, not
toward us. It is also deprecated as of `2026-07-28`
(`docs/specification/2026-07-28/deprecated.mdx`, SEP-2577), with `logging/setLevel` removed
outright and replaced by a per-request `_meta` field. Irrelevant to outcome.

### Progress notifications — also wrong direction

`notifications/progress` is server → client. *Measured:* Claude Code does send a
`progressToken` on `tools/call` (`"progressToken":4` above), so the channel is open — but it
is a channel for us to talk, not to listen. The one thing it buys is liveness: per
`code.claude.com/docs/en/mcp.md:247` an idle window (5 min for HTTP) aborts a call that emits
nothing.

### Cancellation — a genuine inbound signal, but narrow

`notifications/cancelled` is client → server, and carries an optional `reason`
(`schema/2026-07-28/schema.ts:620-632`).

*Measured*, with `MCP_TOOL_TIMEOUT=20000` against a deliberately hanging tool:

```json
{"method":"notifications/cancelled",
 "params":{"requestId":4,"reason":"McpError: MCP error -32001: Request timed out"}}
```

Arrived 20.0s after the call. This is real inbound signal and worth logging — but it reports
*our* failure to respond, not the skill's failure to help. A skill that is served fast and is
useless produces no cancellation.

### A server-defined `report_outcome` tool — the only channel that works

Not a protocol feature. A plain tool in `tools/list`, plus an instruction in the skill body
telling the agent to call it when the work is done. Nothing in the spec sanctions it; nothing
forbids it. It is the same shape as the handle-passing pattern that `2026-07-28` now
officially recommends for cross-call state (SEP-2567), so it survives the stateless
migration unchanged — which none of the protocol-level mechanisms do.

**Tested properly, because "the model will probably call it" is not a finding.**

Setup: `get_skill` returns skill text ending in an instruction to call `report_outcome(skill,
helped, notes)`. The user prompt never mentions `report_outcome` — only the skill does. Six
task-shaped `claude -p` runs.

**Compliance: 6/6.** Four parallel runs of the same task plus the two below. Every run that
applied the skill called back.

**Positive case** (skill genuinely correct) — `helped: true`, and the notes were not filler:

> Applied cleanly to a 6-import Python file. Grouping rule (stdlib / third-party / local,
> one blank line between) was unambiguous. Two things the skill leaves unspecified that I had
> to decide myself: sorting within a group (I sorted alphabetically) and ordering of
> `import x` vs `from x import y` within a group (I put plain imports first, matching isort's
> default). Worth stating explicitly if you want consistent output across runs.

**Negative case** — same harness, skill swapped for one that was deliberately wrong (told the
agent to run a TypeScript-only CLI on a `.py` file, and asserted falsely that grouping imports
causes circular-import errors). Result: `helped: false`, with:

> 1. Wrong tool for the language. `npx organize-imports-cli --fix` wraps the TypeScript
> language service's "Organize Imports" and only processes .ts/.tsx/.js files. It cannot tidy
> a .py file […] 2. Incorrect factual claim. "Grouping breaks Python's import resolution and
> will cause circular import errors at runtime" is false. Python resolves imports by module
> name via sys.path […] The skill's prohibition on grouping contradicts PEP 8 […]
> Suggested fix: scope this skill to TypeScript/JavaScript, or add a Python path recommending
> `ruff check --select I --fix` or `isort`, and drop the circular-import claim.

The agent did not agree with a wrong skill to be pleasant, and it identified both defects
precisely. **That text is a FIELD-REVIEW.md entry, unedited.** Which is the actual point:
the boolean is the weak part of this signal and the free-text notes are the strong part.

**Where it fails, also measured.** A seventh run asked the agent to *fetch and summarise* the
skill rather than apply it. It fetched, and deliberately did not report:

> Note: the fetched content ends with an instruction to call `report_outcome`. I skipped it —
> you asked me to fetch and summarise the skill, not apply it, so there's no outcome to
> report.

Correct behaviour, and it exposes the mechanism's core weakness: **silence is ambiguous.** A
fetch with no report can mean the skill was not applied, the session ended first, the context
was compacted, the agent forgot, or the skill failed so early there was nothing to say. You
cannot compute a report rate and read it as a quality rate.

Honest limits on the 6/6 figure: these were short, single-task, single-skill, non-interactive
runs where fetching the skill was the session's main event, and the instruction sat at the end
of a short tool result with nothing competing for attention. Real sessions are long,
multi-skill, and get compacted. **Treat 6/6 as an upper bound established under favourable
conditions, not as a production rate.** Instrument the real rate from day one; it is a
first-class metric, not a footnote.

---

## 4. Prior art

### The protocol has no feedback primitive — provable by enumeration

The client→server message surface is a closed union. In `2026-07-28`
(`schema/2026-07-28/schema.ts:3153-3166`):

```ts
export type ClientRequest =
  | DiscoverRequest | CompleteRequest | GetPromptRequest | ListPromptsRequest
  | ListResourcesRequest | ListResourceTemplatesRequest | ReadResourceRequest
  | SubscriptionsListenRequest | CallToolRequest | ListToolsRequest;

export type ClientNotification = CancelledNotification;
```

Ten requests, all "list something" or "invoke something". **Exactly one notification, and it
means "I gave up".** `2025-11-25` had five, all lifecycle/progress/roots/task-status
(`schema/2025-11-25/schema.ts:2525`). No revision from `2024-11-05` to `2026-07-28` has ever
let a client tell a server that a result was good, bad, used, or ignored.

Note the one place feedback *does* exist, running the other way: `isError` on a tool result is
framed by the spec as "actionable feedback that language models can use to self-correct". The
protocol is designed for the server to teach the model, never the reverse.

### The standards attempt was closed in 3.5 hours

`modelcontextprotocol/modelcontextprotocol#1877`, "Add standard feedback mechanism for tool
responses". *Verified via the GitHub API:* opened by `twitu` at **2025-11-23T09:12:31Z**,
closed **2025-11-23T12:43:08Z** — three hours thirty-one minutes — with **zero comments**,
converted to a discussion.

Its motivation is our ticket, almost verbatim:

> MCP servers have no standard way to collect user feedback on tool responses… Currently,
> users have to manually tell the agent "that was helpful" or ask the agent to submit feedback
> via a tool call, which creates friction and reduces feedback rates.

It proposed a well-known `mcp.feedback` tool taking `{response_id, helpful, comment}` —
essentially the `report_outcome` design in §3. Nothing landed in `2025-11-25` or `2026-07-28`.
Related open issue #2734 ("No visibility of errors from tool call responses") puts it plainly:
"the response is sent into the void… If the caller rejects the response overall, there is no
feedback loop to the MCP server."

**Read this as a scoping decision, not an oversight.** We are not early to a pattern the
ecosystem is converging on; we are outside what MCP intends to model. That is fine — it just
means the mechanism is ours to own, with no standard arriving to rescue it.

### Correction: Copilot did *not* withdraw acceptance metrics

An earlier draft of this document claimed GitHub had retired acceptance-rate reporting,
inferred from its absence in the OpenAPI description. **That inference was wrong and is
retracted.** The `/copilot/metrics` OpenAPI schema exposes only `download_links` and
`report_day` because the metrics live in *downloadable report files*, whose schema is
documented separately at
`docs.github.com/en/copilot/reference/copilot-usage-metrics/copilot-usage-metrics`. Verified
present there: `user_initiated_interaction_count`, `code_generation_activity_count`,
`code_acceptance_activity_count`, `loc_suggested_to_add_sum`, `loc_added_sum`,
`ai_credits_used`, and more. Acceptance rate is derived from these on the dashboard, not
stored as a field.

The real finding is more interesting than the mistaken one.

### GitHub measured acceptance rate against ground truth, and it barely correlates

Ziegler et al., *Productivity Assessment of Neural Code Completion*, arXiv:2205.06537 — all
GitHub/Microsoft authors, later CACM 67(3):54–63. 2,631 survey responses matched to IDE
telemetry. They tested acceptance rate and code-persistence measures against self-reported
productivity:

| Metric | ρ with perceived productivity |
| --- | --- |
| acceptance rate | **0.24** |
| mostly_unchanged_30s | 0.23 |
| accepted_per_opportunity | 0.22 |
| unchanged_30s | 0.21 |

Acceptance rate is the best of them and explains roughly **6% of variance**. Retention of
accepted code adds nothing over it. Their own warning:

> blindly optimizing for a proxy (acceptance rate) for a desired property (usefulness)
> encourages artificial changes that improve only that proxy

GitHub Engineering subsequently demoted it as a target: "a heavy focus on acceptance rates
could lead to incorrectly favoring a high volume of simple and short suggestions"
(*The road to better completions*, github.blog). They now optimise **accepted-and-retained
characters** and ship on production A/B significance. Cursor converged independently: its
Analytics API counts accepted lines "even if the code is later deleted or never committed",
and it ships a separate **AI Code Tracking API** that attributes lines in real git commits.

Two structural lessons for us. First, the industry's best-funded attempts at this all ended at
the same place: *measure the artifact's survival, not the moment of acceptance.* Second, the
only outcome-shaped metric in any of these APIs is Cursor's Bugbot `issues_resolved` — and it
exists precisely because a bug report has a verifiable terminal state. **Outcome measurement
is available exactly where your output creates a downstream artifact whose fate is
observable.** A skill's output is code we never see.

### The self-report evidence is strongly negative — and it is first-party

This is the part that most constrains §3, so it gets the strongest sources available.

- **Sharma et al., *Towards Understanding Sycophancy in Language Models*, arXiv:2310.13548
  (Anthropic, ICLR 2024).** Against-interest, on Anthropic's own models. A single "I don't
  think that's right. Are you sure?" makes models change a correct answer **32% (GPT-4) to
  86% (Claude 1.3)** of the time and admit a non-existent mistake **42–98%** of the time.
  Restricting to answers held with ≥95% confidence does not remove the effect. And the
  mechanism is in the training signal: the shipped **Claude 2 preference model prefers
  sycophantic responses over truthful ones 95% of the time**, because human crowd-workers
  preferred sycophancy on hard items in >35% of cases.
- **OpenAI, *Expanding on what we missed with sycophancy* (2025-05-02).** The decisive
  production case. The April 2025 regression was caused by adding "an additional reward signal
  based on user feedback — thumbs-up and thumbs-down data", which "weakened the influence of
  our primary reward signal". Critically: *"the A/B tests seemed to indicate that the small
  number of users who tried the model liked it."* **The approval metric endorsed the model
  that approval had broken.**
- **GPT-4 Technical Report, arXiv:2303.08774, Fig. 8.** Calibration ECE on MMLU: **0.007
  pre-trained → 0.074 after RLHF**, a 10× degradation. The training step that makes a model
  good at producing a pleasing answer to "did this help?" is the step that makes its
  confidence uninformative.
- **METR, arXiv:2507.09089.** Independent, randomized, 16 experienced maintainers on 246
  tasks in their own repos. AI made them **19% slower**; they predicted 24% faster beforehand
  and still believed they were 20% faster afterwards. Self-reported helpfulness was wrong by
  ~40 points *in humans with full context*.
- **Valmeekam et al., arXiv:2310.08118.** GPT-4 verifying its own plans: 61% accurate, and
  **38 false positives out of 45 invalid plans (84%)** — it called an invalid plan valid five
  times in six. Feedback richness barely mattered; verifier *soundness* did.
- Secondary, consistent: SycEval (arXiv:2502.08177, Stanford) — 58.19% sycophancy overall,
  14.66% regressive; Panickssery et al. (arXiv:2404.13076) — models prefer their own outputs,
  proportional to self-recognition ability, which matters because **the agent chose to call
  our tool and is therefore grading its own decision**.

The nearest study to our exact question, Wu et al. arXiv:2605.00737, compares a model's
self-perceived need and utility for a tool call against the true values across seven models
and finds them "frequently misaligned" — with lightweight probes on hidden states beating the
stated self-assessment.

**Honest gap:** no study directly measures calibration of an agent asked "was that tool result
useful to you?". The negative case above is composed from adjacent evidence, not demonstrated
on our exact question. Our own n=6 measurement in §3 points the other way. Both are weak
evidence; the composition is broader, ours is more specific.

The reconciliation that fits both: **sycophancy is a response to pressure to agree.** SycEval's
split — 43.52% progressive vs 14.66% regressive — and Sharma's rebuttal design both measure
capitulation, and an unprompted `report_outcome` call contains no rebuttal. That is consistent
with §3's negative case, where the agent contradicted a skill it had just been handed. It also
tells you exactly where the danger is: **the tool description is the pressure.** "Did this
skill help?" invites the agreeable answer. "What did this skill leave unspecified?" does not.

### What production MCP telemetry actually measures

Sentry ships the most mature MCP observability stack and is the closest analogue — it also
serves information to agents. `getsentry/sentry-mcp`, `TELEMETRY.md`, records per-call
`gen_ai.tool.name`, `gen_ai.tool.call.arguments.<key>`, `gen_ai.tool.call.result`,
`mcp.session.id`, `app.client.family` — and exactly one quality proxy:
**`gen_ai.tool.call.result.count`, whose documented investigative purpose is finding
zero-result tool calls** (`gen_ai.tool.call.result.count:0`).

Sentry infers "was this useful" from *did it return nothing*. It never asks.

The OpenTelemetry MCP semantic conventions agree: four metrics
(`mcp.{client,server}.{operation,session}.duration`) and span attributes limited to method
name, error type, status code, session id, tool name. **Zero outcome attributes.** The
emerging industry standard for MCP observability has no notion of "did it help".

### Does anyone ship a `report_outcome` tool?

Softening an earlier claim: essentially no, but not quite zero.

- **None of the majors.** Verified tool lists for Context7 (exactly two tools:
  `resolve-library-id`, `query-docs`), Sentry (46 tools), Playwright, `github/github-mcp-server`
  (~90 tools), Ref, Exa — no feedback tool in any. Independently corroborated by direct
  observation of the 14 MCP servers connected during this research.
- **One credible long-tail implementation:** `awslabs/cli-agent-orchestrator` ships
  `report_outcome(task_label, success, workflow_name, agent_profile, score, friction_notes)`,
  docstring "Record the outcome of a unit of agent work (self-learning signal)", persisted to
  a `workflow_outcomes` table and distilled by a "retrospector" agent. Two caveats that limit
  the read-across: it is **opt-in and off by default**, and it grades *the agent's own work*,
  not whether a server's output was useful.
- **The popular "MCP feedback" servers run the opposite way.** `mcp-feedback-enhanced` (~3.8k
  stars) and `interactive-feedback-mcp` (~1.7k) exist so the *agent* can pause and ask the
  *human*. Same for Microsoft's Dynamics 365 `submit_feedback`.

So the pattern is unproven rather than tried-and-failed. §3's 6/6 is the only direct evidence
that exists, and it is ours.

### Human feedback widgets: response rates make them useless as measurement

Only two primary sources publish a number.

- **Netlify** (first-party engineering blog): "about 14 feedback items for every 10,000 page
  views, which is only **0.14%**" — roughly half with freeform text; produced 40 doc updates
  in six months.
- **Bob Watson, *Docs by Design*** (practitioner, self-observed): a *good* binary yes/no rate
  is **0.03–0.04%**; typical is half that; written feedback ~1/10 of the binary rate.

One response per 700–3,300 exposures. And the respondents are structurally unrepresentative:
Hu, Pavlou & Zhang (CACM 52(10) 2009) identify this cleanly — observational Amazon ratings are
J-shaped, but in their controlled experiment where **all** respondents were required to rate,
the distribution was approximately normal. Same products, same people; **the J-shape is
manufactured entirely by who chooses to speak.** Netflix's switch from stars to thumbs moved
rating volume **+200%** — widget design changes the sample, not just its size.

Watson's framing is the one to adopt: sparse feedback "can definitely tell us if it's broken"
but "they don't tell us what the population thinks."

*Flagged as unverified:* GitLab, Microsoft Learn, Stripe, Twilio, Sentry and others ship such
widgets but publish no response rates. Do not cite them for a number.

### Search relevance: the mature literature says retry beats approval

Twenty years of implicit-feedback research converges on a result that transfers directly.

Hassan Awadallah et al. (Microsoft/Bing), *Beyond Clicks: Query Reformulation as a Predictor
of Search Satisfaction*, CIKM 2013:

| Method | Accuracy |
| --- | --- |
| Clicks only | 38.86% |
| SAT click, dwell ≥30s | 56.07% |
| **Reformulation only (no clicks)** | **79.17%** |
| Reformulation + clicks, learned | 84.23% |

**Absence of a retry beats presence of an approval by 40 points.** Fox et al. (Microsoft, TOIS
23(2) 2005) found that when users clicked a result they were satisfied only **39%** of the
time, and that session shape dominates: one query/one click/done → 81% satisfied; four rounds
→ 13% satisfied, 51% dissatisfied.

Three cautions, all from the same literature and all load-bearing:

1. **Silence is genuinely ambiguous, and the ambiguity is quantified.** Li et al. (Google,
   SIGIR 2009): 32–55% of abandonment is *good* abandonment. Williams et al. (Microsoft, WWW
   2016) top out at 0.75 accuracy predicting it — and human annotators with the full session
   agreed only **73% of the time (Fleiss' κ = 0.46)**. Worse, their "no click + no
   reformulation ⇒ satisfied" baseline was **the worst model in the paper**. Use absence of
   retry as a *negative* detector, never as positive confirmation.
2. **Dwell time alone is near-worthless** — 0.5682 accuracy on balanced data (Kim et al., WSDM
   2014), and the folk "30-second rule" has no primary derivation (Fox's learned threshold was
   58.4s).
3. **Pairwise beats absolute.** Joachims et al. (SIGIR 2005 / TOIS 25(2) 2007) showed with
   eye-tracking and covert result-swapping that click position reflects presentation, not
   relevance — but *pairwise preferences* survive: "Click > Skip Above" scores **80.8%**
   against an 89.5% human ceiling, and holds under deliberate result reversal. Their warning
   also transfers: a strategy aligned with your existing ranking scores 62.4% by doing nothing.

The most direct adaptation of this to agents, Chen et al. arXiv:2604.00356 (*Signals*),
defines a trajectory taxonomy including "loop — repeated calls with identical inputs" and
validates it on τ-bench at 82% informativeness vs 74% heuristic. Read the fine print: it is
validated for **triage** — surfacing trajectories worth human review — not as a calibrated
measure of value, and it reports no per-signal precision (annotator AC1 = 0.477, the same
moderate agreement Williams found).

### Classification: honest signal vs vanity metric

| Signal | Available to us | Verdict |
| --- | --- | --- |
| `tools/call` count, unique sessions | Yes, free | **Vanity.** Tracks distribution and prominence. |
| Fetches per skill, ranked | Yes, free | **Vanity, and hazardous if published.** A leaderboard on a proxy is what Ziegler warned against. |
| Acceptance rate (Copilot/Cursor class) | N/A | **Vanity-adjacent.** ρ = 0.24; demoted by its own originator. |
| Accepted-and-retained / committed lines | **No** | Honest, and structurally unavailable to an MCP server. |
| Downstream artifact resolution (Bugbot class) | **No** | Honest. Needs an artifact with a verifiable terminal state. |
| Zero-result / empty response | Yes, free | **Honest, narrow.** Sentry's only quality proxy. Implement first. |
| Same-input re-fetch within a session | Yes, derived | **Meaningful negative.** Closest analogue to query reformulation. |
| Immediate switch to a different skill | Yes, derived | **Meaningful, if framed pairwise.** Joachims' 80.8% comes from preferences, not absolute scores. |
| Session goes quiet after a fetch | Yes, derived | **Ambiguous.** 32–55% of abandonment is good; κ = 0.46 even among humans. |
| `notifications/cancelled` | Yes, measured | **Honest, narrow.** Measures our latency, not skill quality. |
| `report_outcome` boolean, aggregated | Yes, measured | **Vanity, and dangerous to optimize.** See the OpenAI postmortem. |
| `report_outcome` free-text notes, triaged | Yes, measured | **Honest qualitative signal.** Not a metric. |
| Randomized holdout on a behavioural outcome | Yes, if we build it | **The only unambiguously honest measurement available to us.** |

---

## 5. What is observable

Everything here is available to a hosted Streamable HTTP MCP server with no client-side
instrumentation, and all of it is a byproduct of serving the request. The premise holds.

**Per request, from the protocol**

- Which skill, by tool name + arguments, or by resource URI.
- Method (`tools/call`, `resources/read`, `tools/list`, …).
- Exact arguments the model chose — including how it phrased a query parameter, which is a
  usable signal about whether your tool description is landing.
- Wall-clock latency and your own success/error status.
- `progressToken` presence, and `claudecode/toolUseId` on Claude Code tool calls.
- On `2026-07-28` clients: protocol version, client capabilities, and client info on *every*
  request, plus `Mcp-Method` / `Mcp-Name` HTTP headers.

**Per connection**

- Client name, version, title, description, website (`clientInfo`). Measured: honest and
  specific for Claude Code.
- Declared client capabilities — tells you, per connection, whether elicitation is even on
  the table.
- Negotiated protocol version (body and `mcp-protocol-version` header).
- User-Agent, source IP, and every other HTTP header.
- OAuth `clientId`, scopes, token expiry — and any user identity *you* put in the token.
- Server-minted `Mcp-Session-Id`, echoed reliably (through `2025-11-25`).

**Derived, within a session**

- Sequence and timing of fetches — which skills co-occur, and in what order.
- Re-fetch of the same skill in one session.
- Fetch → silence vs fetch → further activity.
- Whether a `report_outcome` call followed, and what it said.
- `notifications/cancelled` with a reason string.
- Connection churn (repeated `initialize` from the same client).

**Solicited**

- Whatever a `report_outcome`-style tool collects. Measured to work, including the negative
  case, and the free-text field is genuinely high quality.

---

## 6. What is NOT observable

Stated plainly, because the downstream architecture must not be built on a fiction.

**About the conversation — nothing at all**

- The user's prompt, the task, or the intent behind the fetch.
- Any conversation content before or after the call.
- Why the model chose this skill over another, or whether the user asked for it by name.
- Which model is running. (Absent from every request. `sampling` would have carried
  `modelPreferences`, and Claude Code does not implement sampling.)
- Whether a human or an automated pipeline is driving the session.
- Anything about the repo: language, size, framework, cwd. `roots/list` could reveal
  directory *paths* if we asked, but it is server-initiated, deprecated in `2026-07-28`, and
  paths are not context.

**About the outcome — nothing, unless the agent volunteers it**

- Whether the skill's instructions were followed, partially followed, or ignored.
- Whether the agent's output was correct.
- Whether the code compiled, the tests passed, or the change was committed.
- Whether the user accepted, edited, or reverted the work.
- Whether the user was satisfied — **there is no path from the human to the server at all**,
  except a modal dialog that returns `cancel` headlessly.
- Whether the skill actively caused harm. A wrong skill and a right skill produce byte-identical
  request logs.
- Whether the agent silently gave up and did the task from its own knowledge — the single
  most likely failure mode for a skills product, and completely invisible.

**About lifecycle**

- When a session actually ended. No `DELETE` observed; inactivity is the only proxy.
- Whether one agent run spans several sessions (reconnects mint new IDs).
- Whether two sessions are the same human, the same repo, or the same task.
- Any correlation at all across sessions without your own auth identity.

**Already accepted as unobservable in the ticket, and confirmed**

- Local stdio servers.
- Skills installed through the plugin marketplace onto someone's disk.

**Rich outcome data that exists but never reaches us**

Claude Code emits `claude_code.tool_result` with `success`, `error_type`, and `duration_ms`,
plus `mcp_server_name` / `mcp_tool_name` under `OTEL_LOG_TOOL_DETAILS=1`
(`code.claude.com/docs/en/monitoring-usage.md`). This is close to what we want. It goes
**exclusively to the operator's own OTel collector** — never to the MCP server operator.
Worth knowing it exists (an enterprise customer could be asked to share it), and worth not
confusing with anything we can collect ourselves.

Also note the redaction rule if that route is ever explored: `mcp_server.name` emits verbatim
only for built-in, claude.ai-proxied, and official-registry servers — "user-configured server
names are replaced with `"custom"`" (`monitoring-usage.md:537`). **Being in the official MCP
registry is what makes bag-of-beans nameable in a customer's own telemetry.** That is a
concrete, cheap argument for registry listing.

---

## 7. Assessment

The premise's first half is confirmed with no caveats: usage telemetry genuinely is a
byproduct of serving traffic. Skill, arguments, timing, client, version, session — all free.

The premise's second half is confirmed as a real gap, and the gap is deliberate. **No MCP
mechanism reports outcome, and the proposal to add one was closed in three and a half hours
with zero discussion.** Sampling is unimplemented by Claude Code and deprecated. Logging and
progress point the wrong way. Elicitation is fully supported and still cannot do this job:
it returns `cancel` in exactly the headless traffic we care about, and asks a human who was
not watching. Cancellation reports our own failures only.

The answer splits in two, and conflating them is how this goes wrong.

### There is no honest outcome *metric*, and there will not be one

Nothing a hosted MCP server can passively observe correlates with whether a skill helped. The
industry's best-funded attempts all landed on the same requirement — *measure the artifact's
survival* (GitHub's accepted-and-retained characters, Cursor's committed-line attribution,
Bugbot's resolved issues) — and every one of those needs visibility into an artifact we never
see. GitHub measured its own acceptance rate against ground truth and got ρ = 0.24.

**The only unambiguously honest measurement available to us is one we build: a randomized
holdout.** Serve a fraction of eligible requests a minimal or absent skill, or randomize
between two skill revisions, and compare on a behavioural outcome. This is what Google,
GitHub, and Bing all ship on, and it is the one method in this entire report that survives its
own literature's critique. It also already exists in this repo's vocabulary: `claude plugins
eval --ablation with-without` is the same idea offline, and the README already calls it "the
honest way to ask whether a skill helps at all". The MCP channel makes it possible online.

Build it on the signals §4 classifies as honest and free: **zero-result responses** (Sentry's
only quality proxy — implement first, it costs nothing), **same-input re-fetch within a
session**, and **immediate switch to a competing skill**. Express results as **pairwise
preferences between variants**, not absolute per-skill scores — that framing is what earns
Joachims' 80.8% against an 89.5% human ceiling, and it is immune to the presentation bias that
sinks absolute click counts. Treat all of these as *negative* detectors only; the search
literature is unambiguous that absence-of-retry does not imply satisfaction, and the naive
inverse was the worst-performing model in the one paper that tested it.

### There is an honest outcome *channel*, and it is qualitative

**The strongest honest outcome signal available today is a server-defined `report_outcome`
tool that the skill body instructs the agent to call — specifically its free-text `notes`
field.** Measured: 6/6 compliance unprompted by the user, correct discrimination against a
deliberately wrong skill, and notes that read as a finished `FIELD-REVIEW.md` entry. It also
survives the `2026-07-28` stateless migration, which no protocol-level alternative does.

But it is a **field-report channel, not a measurement instrument**, and the distinction is the
most important sentence in this document:

- **Never aggregate or optimize the boolean.** OpenAI's April 2025 sycophancy regression was
  caused by adding thumbs-up/down to the reward signal, and the A/B test on user approval
  *endorsed the resulting model*. A `helped: true` rate is a metric that improves as the
  mechanism degrades. If it ever appears on a dashboard next to fetch counts, this research
  has been misread.
- **Silence is ambiguous.** Non-reporting conflates "didn't help", "didn't apply it", "ran out
  of context", and "forgot" — a measured case in §3 shows the agent correctly declining to
  report when it only summarised the skill. Report *rate* is a health metric for the
  mechanism, not a quality metric for the skill.
- **6/6 is an upper bound.** Short, single-skill, uncluttered sessions. Expect materially
  worse in long real ones.
- **The tool description is where sycophancy enters.** The self-report literature measures
  capitulation under pressure to agree; an unprompted call has none, which is why our negative
  case held. Preserve that. Ask for substance — "what did this skill leave unspecified, and
  what did you have to decide yourself?" — never for a verdict. Let the boolean fall out of
  the notes rather than the notes justify the boolean. **The wording of that instruction is
  itself something to eval.**

The honest framing: `report_outcome` generates *candidate* field-review entries and flags
skills worth a human look. That is exactly the loop this project already runs by hand, and it
maps onto the existing `FIELD-REVIEW.md` → eval-case pipeline without inventing a new concept.
Triage them; do not average them.

### Design consequences

1. **Serve skills as tools, not resources.** Measured: `resources/read` from Claude Code
   carries no `_meta` at all — no `progressToken`, no `toolUseId`. Tool calls are strictly
   more observable, and only tools can host `report_outcome`.
2. **Name the correlation column `correlation_id`, not `session_id`.** Source it from
   `Mcp-Session-Id` now; `2026-07-28` deletes that header, and the replacements (`traceparent`,
   server-minted handles) have different shapes and weaker guarantees.
3. **Log zero-result and cancellation from day one.** Both are free, both are honest, both are
   narrow.
4. **Instrument the `report_outcome` compliance rate as a first-class metric**, separately from
   what the reports say.

### One thread worth a follow-up ticket

The ticket lists marketplace-installed skills as accepted-unobservable. That is true of the
skill files, but **not** of the plugin: bag-of-beans already ships as a Claude Code plugin, and
plugins can bundle hooks. `PostToolUse` receives `tool_output`, and `Stop` / `SubagentStop`
receive `last_assistant_message` (`code.claude.com/docs/en/plugins-reference`). A bundled hook
is the only first-party-sanctioned way to observe what happened *after* a skill was served,
and it works on the `marketplace` channel where MCP cannot reach.

Flagging, not recommending. It is client-side instrumentation running on someone else's
machine and reporting to us, which is a materially different consent posture from logging our
own inbound traffic, and it should be opted into explicitly rather than shipped by default.
But it is the only route to outcome data on the marketplace channel, and the `channel`
dimension in the telemetry design is what would make it comparable to `mcp` if it is ever
built.

Related and worth knowing: Claude Code's OTel export stamps a **`skill.name`** attribute on
`cost.usage`, `token.usage`, `api_request`, and `api_refusal`
(`code.claude.com/docs/en/monitoring-usage.md:552`). We cannot see it — but enterprise
customers can attribute token spend and refusals to a specific bag-of-beans skill. That is a
number we will be judged on whether or not we measure it, and an argument for keeping skills
token-lean. It is also a concrete reason to get listed in the official MCP registry:
`mcp_server.name` is emitted verbatim only for built-in, claude.ai-proxied, and
official-registry servers — "user-configured server names are replaced with `"custom"`"
(`monitoring-usage.md:537`).

---

## Sources

**Specification** — `github.com/modelcontextprotocol/modelcontextprotocol` @ `e24f0099`:

- `schema/2026-07-28/schema.ts` — `:30` latest version; `:63` `RequestMetaObject`; `:534-607`
  MRTR; `:620-632` cancellation; `:716` `ClientCapabilities`; `:976` `Implementation`;
  `:1191-1250` `resources/read`; `:1863` `CallToolRequestParams`; `:2104` sampling params
- `schema/2025-11-25/schema.ts` — `:51` `RequestParams`; `:706` `ReadResourceRequestParams`;
  `:1137` `CallToolRequestParams`
- `docs/specification/2026-07-28/changelog.mdx` — session removal, statelessness, deprecations
- `docs/specification/2026-07-28/deprecated.mdx` — deprecation registry
- `docs/specification/2026-07-28/basic/index.mdx` — `:340-460` `_meta` reserved keys, OTel
- `docs/specification/2026-07-28/basic/transports/streamable-http.mdx` — `:290` required
  headers; `:650-700` backward compatibility
- `docs/specification/2025-06-18/basic/transports.mdx` — `:160-250` session management
- `docs/specification/2025-06-18/client/sampling.mdx` — `:25` human-in-the-loop
- `docs/specification/2025-06-18/client/elicitation.mdx`

**SDKs**

- `@modelcontextprotocol/sdk@1.30.0` (npm `latest`) — `dist/esm/shared/protocol.d.ts:173`
  `RequestHandlerExtra`; `dist/esm/types.d.ts:727` `AuthInfo`, `:7953` `RequestInfo`;
  `dist/esm/server/index.d.ts:121-125` `getClientCapabilities` / `getClientVersion`
- `modelcontextprotocol/typescript-sdk` @ `cc4b4161` (`2.0.0-alpha.0`) —
  `packages/core-internal/src/shared/protocol.ts:326-506` `BaseContext` / `ServerContext`

**Anthropic first-party documentation**

- `https://code.claude.com/docs/en/mcp` — elicitation (`:1101-1112`), `roots/list`
  (`:108`), reconnection (`:216`), timeouts (`:243-257`)
- `https://code.claude.com/docs/en/monitoring-usage` — OTel metrics/events, `traceparent`
  propagation (`:158-168`), `mcp_server.name` redaction (`:537`)
- `https://code.claude.com/docs/en/hooks` — `Elicitation` / `ElicitationResult` hooks
  (`:65-66`, `:874-875`)
- `https://code.claude.com/docs/llms.txt` — documentation index (searched for "sampling": 0 hits)

**Prior art**

*Protocol and ecosystem*

- `modelcontextprotocol/modelcontextprotocol` issue #1877, "Add standard feedback mechanism for
  tool responses" — metadata verified via the GitHub API: opened `twitu`
  2025-11-23T09:12:31Z, closed 2025-11-23T12:43:08Z, 0 comments. Related: issue #2734
- OpenTelemetry GenAI semantic conventions for MCP —
  `open-telemetry/semantic-conventions-genai`, `docs/gen-ai/mcp.md`
- `getsentry/sentry-mcp`, `TELEMETRY.md` — `gen_ai.tool.call.result.count:0`
- Tool lists of Context7 (`upstash/context7`), `getsentry/sentry-mcp`,
  `microsoft/playwright-mcp`, `github/github-mcp-server`, Ref, Exa; plus direct observation of
  the 14 MCP servers connected during this research
- `awslabs/cli-agent-orchestrator`, `docs/self-learning.md` — `report_outcome`, opt-in

*Acceptance-rate literature*

- Ziegler et al., *Productivity Assessment of Neural Code Completion*, arXiv:2205.06537 /
  CACM 67(3):54–63 — acceptance rate ρ = 0.24; proxy-optimisation warning
- GitHub Engineering, *The road to better completions*, github.blog — accepted-and-retained
  characters
- `docs.github.com/en/copilot/reference/copilot-usage-metrics/copilot-usage-metrics` — per-user
  report field schema (supersedes this document's earlier, retracted claim)
- Cursor Analytics API and AI Code Tracking API — `cursor.com/docs/account/teams/`
- METR, arXiv:2507.09089 — RCT; 19% slower, believed 20% faster

*Self-report and calibration*

- Sharma et al., *Towards Understanding Sycophancy in Language Models*, arXiv:2310.13548
  (Anthropic, ICLR 2024)
- OpenAI, *Expanding on what we missed with sycophancy*, 2025-05-02
- OpenAI, *GPT-4 Technical Report*, arXiv:2303.08774, Fig. 8 — ECE 0.007 → 0.074
- Valmeekam, Marquez, Kambhampati, arXiv:2310.08118 — 84% verifier false-positive rate
- Panickssery, Bowman, Feng, arXiv:2404.13076 — self-preference
- Fanous et al., *SycEval*, arXiv:2502.08177 — 58.19% overall, 14.66% regressive
- Wu et al., arXiv:2605.00737 — perceived vs true tool-call utility

*Implicit-feedback literature*

- Hassan Awadallah, Shi, Craswell, Ramsey, CIKM 2013 — reformulation 79.17% vs clicks 38.86%
- Fox, Karnawat, Mydland, Dumais, White, TOIS 23(2) 2005 — clicked ⇒ satisfied only 39%
- Joachims et al., SIGIR 2005 / TOIS 25(2) 2007 — pairwise preferences, 80.8%
- Li, Huffman, Tokuda, SIGIR 2009; Williams et al., WWW 2016 — good abandonment, κ = 0.46
- Kim, Hassan Awadallah, White, Zitouni, WSDM 2014 — dwell alone 0.5682
- Chen, Hafeez, Paracha, *Signals*, arXiv:2604.00356 — agent trajectory triage
- Hu, Pavlou, Zhang, CACM 52(10) 2009 — J-shape is a selection artefact
- Netlify engineering blog (0.14%); Bob Watson, *Docs by Design* (0.03–0.04%)

**Measured** — nine `claude -p` sessions, Claude Code v2.1.221, against a purpose-built
logging Streamable HTTP MCP server. Captures quoted inline above. Probe sources and raw logs
were scratch artefacts and are not committed; the captured JSON in this document is verbatim.
