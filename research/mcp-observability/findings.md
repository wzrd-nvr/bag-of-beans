# What a hosted MCP server can observe about skill usage — and how outcome gets back

**Ticket:** wzrd-nvr/bag-of-beans#9 (`wayfinder:research`)
**Date:** 2026-08-03
**Status:** the usage half of the premise holds. The outcome half does not hold for free, but is
not hopeless — there is exactly one mechanism that works today, and it is weaker than a metric
and stronger than nothing.

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

### A server-defined `report_outcome` tool — the only thing that works

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

### The protocol itself has no feedback primitive — and this is provable by enumeration

The client→server message surface is a closed union in the schema. In `2026-07-28`
(`schema/2026-07-28/schema.ts:3153-3166`):

```ts
export type ClientRequest =
  | DiscoverRequest | CompleteRequest | GetPromptRequest | ListPromptsRequest
  | ListResourcesRequest | ListResourceTemplatesRequest | ReadResourceRequest
  | SubscriptionsListenRequest | CallToolRequest | ListToolsRequest;

export type ClientNotification = CancelledNotification;
```

Ten requests, all of them "list something" or "invoke something". **Exactly one
notification, and it means "I gave up".** `2025-11-25` is barely different — five
notifications (`schema/2025-11-25/schema.ts:2525`), all lifecycle, progress, roots, or
task-status. No revision from `2024-11-05` to `2026-07-28` has ever had a way for a client to
tell a server that a result was good, bad, used, or ignored.

This is not an oversight to be worked around; it is the protocol's shape. MCP models the
server as a resource the client consumes. Consumption is not conversation.

### GitHub Copilot: the industry's flagship acceptance metric was withdrawn

Copilot's original `copilot_usage` API exposed the canonical vanity metric — suggestions
shown, suggestions accepted, lines suggested, lines accepted, and the acceptance rate derived
from them.

*Verified against GitHub's own OpenAPI description*
(`github/rest-api-description`, `descriptions/api.github.com/api.github.com.2022-11-28.json`,
fetched 2026-08-03): the current `copilot-usage-metrics-1-day-report` and
`copilot-usage-metrics-28-day-report` schemas contain exactly two fields —
`download_links` and `report_day`. A full-text search of the entire 12.8 MB API description
finds **zero** occurrences of `total_acceptances_count`, `total_suggestions_count`,
`total_lines_accepted`, `total_engaged_users`, or `total_active_users`. The only hits for
"acceptance" anywhere in GitHub's API surface are org invitations, Classroom assignments, and
security-advisory credits.

Read carefully, that is the most useful piece of prior art available: the most heavily
resourced team with the strongest possible incentive to report an acceptance rate no longer
publishes one in its API schema. Acceptance rate measures whether a suggestion looked
plausible in the half-second before Tab, which is why it rises when the tool gets chattier.

### Claude Code's own telemetry: exhaustive on usage, silent on value

Claude Code exports 8 metrics and 15 events (`code.claude.com/docs/en/monitoring-usage`).
Every one is usage, cost, or lifecycle: `session.count`, `token.usage`, `cost.usage`,
`lines_of_code.count`, `commit.count`, `pull_request.count`, `active_time.total`,
`code_edit_tool.decision`.

The closest thing to outcome is `claude_code.tool_result` carrying `success`, `error_type`,
and `duration_ms` — which is *execution* success, not usefulness. A tool that returns a
confident wrong answer in 40 ms records `success: "true"`.

Two of the eight metrics are interesting as *proxies* — `lines_of_code.count`,
`commit.count`, `pull_request.count` are downstream-of-value in a way an MCP request log
never is. They are also entirely inaccessible to us: operator's collector only.

### No MCP server in the wild solicits outcome

Checked two ways, both negative:

- **Direct observation** of every MCP server connected to the session this research was
  performed in — Context7, Playwright, Asana, Atlassian, Box, Canva, Figma, Google Drive,
  HubSpot, Intercom, Linear, Microsoft 365, Notion, monday.com. Fourteen servers, roughly a
  hundred tools between them. **Not one exposes a feedback, rating, or outcome-reporting
  tool.** Context7 — the closest analogue to bag-of-beans, since it also serves documentation
  to agents — ships exactly two tools: `resolve-library-id` and `query-docs`.
- **GitHub code search** for `report_outcome`/feedback tools in MCP servers returned no
  notable server adopting the pattern.

Interpretation, and it cuts both ways. There is no established practice to copy, no library,
and no norm the agent has been trained to expect — which is a real adoption risk. But it also
means nobody has tried and abandoned it. The measured 6/6 compliance in §3 is the only
evidence available on whether it works, and it is our own.

### Self-reported LLM signal: calibrated enough to use, not enough to average

The relevant primary source is *SycEval: Evaluating LLM Sycophancy* (Fanous, Goldberg,
Agarwal, Lin, Zhou, Daneshjou, Koyejo — Stanford; arXiv:2502.08177, Feb 2025, rev. Sep 2025).
Across ChatGPT-4o, Claude-Sonnet, and Gemini-1.5-Pro on AMPS (maths) and MedQuad (medical):

- **58.19%** of cases showed sycophancy overall; Gemini highest at 62.47%, ChatGPT lowest at
  56.71%.
- Split into **progressive** sycophancy (capitulation that moves toward the correct answer):
  **43.52%**, and **regressive** (capitulation toward the wrong answer): **14.66%**.

Apply this carefully rather than as a blanket "LLM self-reports are worthless". SycEval
measures capitulation *under user rebuttal pressure* — the model is pushed and folds. An
unprompted `report_outcome` call has no rebuttal in it, which is consistent with the negative
case in §3, where the agent contradicted the skill it had just been handed and was factually
right to.

The actionable reading is about **prompt framing, not about the mechanism**. The regressive
14.66% is the risk to design against: a leading question ("did this skill help?") invites the
agreeable answer, and the tool description is where that damage would be done. Ask for the
substance, not the verdict — "what did the skill leave unspecified, and what did you have to
decide yourself?" — and the boolean falls out of the notes rather than the notes being
post-hoc justification for the boolean.

### Honest signal vs vanity metric, for this project

| Signal | Available to us | Verdict |
| --- | --- | --- |
| Fetch count per skill | Yes, free | **Vanity.** Rises with prominence, tool-description keyword luck, and retries. |
| Unique sessions/clients per skill | Yes, free | **Weak but honest** as reach. Says nothing about value. |
| Re-fetch of same skill in one session | Yes, derived | **Ambiguous.** Context compaction and genuine re-reading are indistinguishable. |
| Fetch → session goes quiet | Yes, derived | **Ambiguous.** Task finished, or agent gave up. Unresolvable. |
| `notifications/cancelled` | Yes, measured | **Honest, narrow.** Measures our latency, not skill quality. |
| Copilot-style acceptance rate | N/A | **Vanity**, and withdrawn by its own originator. |
| `report_outcome` boolean | Yes, measured | **Soft.** Coarse filter; frame the prompt carefully. |
| `report_outcome` free-text notes | Yes, measured | **The honest one.** Specific, falsifiable, actionable. |
| Downstream code outcomes (commits, PRs, retention) | **No** | Would be the real thing. Structurally unavailable to an MCP server. |

**Research note.** A parallel background agent was tasked with a broader prior-art sweep
(Cursor admin APIs, documentation "was this helpful?" widget response rates, search-relevance
implicit-signal literature) and had not returned by the time this was committed. Everything
above was verified first-hand against the cited primary source. The unreturned strands are
supporting colour, not load-bearing: none of them could change the conclusion, which rests on
the schema enumeration at the top of this section and the measurements in §3.

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

The premise's second half is confirmed as a real gap. **No MCP mechanism reports outcome.**
Sampling is unimplemented and deprecated. Logging and progress point the wrong way.
Elicitation is implemented and well-supported and still cannot do this job, because it
returns `cancel` in exactly the headless traffic we care about and asks a human who was not
watching. Cancellation reports our own failures only.

**The strongest honest outcome signal available today is a server-defined `report_outcome`
tool that the skill body instructs the agent to call — and specifically its free-text
`notes` field.**

It earns that title on measured evidence, not enthusiasm: 6/6 compliance unprompted by the
user, correct discrimination between a good and a bad skill, and notes of a quality that
drops straight into `FIELD-REVIEW.md`. It also survives the `2026-07-28` stateless migration,
which no protocol-level alternative does.

It is not a metric, and should never be reported as one:

- **Silence is ambiguous.** Non-reporting conflates "didn't help", "didn't apply it",
  "ran out of context", and "forgot". Report *rate* is a health metric for the mechanism, not
  a quality metric for the skill.
- **The boolean is soft.** Discrimination was demonstrated on a blatantly wrong skill.
  Marginal cases are untested here, and LLM self-assessment skews agreeable. Weight `notes`
  heavily; treat `helped` as a coarse filter only.
- **6/6 is an upper bound.** Short single-skill sessions with an uncluttered instruction.
  Expect materially worse in long real sessions.
- **It costs the agent a tool call**, and it is only as good as the instruction in the skill
  body — which makes the instruction itself something to eval.

The honest framing: `report_outcome` is a **qualitative field-report channel that happens to
arrive over the wire**, and it maps unusually well onto what this project already does
manually. bag-of-beans writes `FIELD-REVIEW.md` by hand; this produces the same artefact
automatically, at a volume no one has to read all of. Treat each report as a candidate
field-review entry needing triage, not as a data point to average.

Two supporting recommendations that follow directly from the measurements:

1. **Serve skills as tools, not resources.** `resources/read` from Claude Code carries no
   `_meta` whatsoever — no `progressToken`, no `toolUseId`. Tool calls are strictly more
   observable, and only tools can host `report_outcome`.
2. **Name the correlation column `correlation_id`, not `session_id`.** Source it from
   `Mcp-Session-Id` now; `2026-07-28` deletes that header and the replacements
   (`traceparent`, server-minted handles) have different shapes and much weaker guarantees.

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

- `github/rest-api-description`, `descriptions/api.github.com/api.github.com.2022-11-28.json`
  (fetched 2026-08-03) — `copilot-usage-metrics-1-day-report` /
  `copilot-usage-metrics-28-day-report` schemas; zero occurrences of any acceptance-rate field
- Fanous, Goldberg, Agarwal, Lin, Zhou, Daneshjou, Koyejo, *SycEval: Evaluating LLM
  Sycophancy*, Stanford University — `https://arxiv.org/abs/2502.08177` (Feb 2025, rev. Sep
  2025). 58.19% overall; 43.52% progressive / 14.66% regressive
- Tool lists of the 14 MCP servers connected during this research, observed directly

**Measured** — nine `claude -p` sessions, Claude Code v2.1.221, against a purpose-built
logging Streamable HTTP MCP server. Captures quoted inline above. Probe sources and raw logs
were scratch artefacts and are not committed; the captured JSON in this document is verbatim.
