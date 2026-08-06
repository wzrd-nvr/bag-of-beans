# Hosting a skill library as an MCP server — research findings

**Question.** What are the established patterns for exposing a library of documentation-like
content as a hosted MCP server, and what does the spec require of one?

**Spec revision worked from: `2026-07-28`** — the current protocol version at time of research.
This moves; re-check before acting.
Source: <https://modelcontextprotocol.io/specification/versioning> — "The **current** protocol
version is [**2026-07-28**]". The prior revision is `2025-11-25`, and most deployed clients still
speak that or earlier (§0.2).

Research date: **2026-08-03**. All live probes cited below were run on that date.

---

## Summary

Five hosted documentation MCP servers were live-probed. **All five expose content as tools. None
model documents as resources. All five are anonymous.** Four of five are effectively stateless.
Independently, the (now-deleted) official client matrix shows tools supported by 114/114 clients
versus resources by 47/114, and there is **no `resources/search` method anywhere in the MCP
schema** — a resource-based server cannot offer server-side search at all.

Against that, MCP's own **Skills Over MCP Working Group** is drafting a Resources-based skills
extension (SEP-2640), and its `skill://` URI convention is a clean fit for this repo's layout.
But the SEP is an unmerged draft, and the WG's own experiments record models repeatedly
*ignoring* skills delivered as passive context.

The recommendation (§7) is a tool-first retrieval surface with a resource mirror, `skill://` URIs
adopted as the naming convention either way, anonymous access, and a stateless JSON-response
Cloud Run service.

---

## 0. Baseline: what changed, and why it dominates everything else here

### 0.1 One charting assumption needs correcting

Confirmed at charting and still true: MCP encodes messages as JSON-RPC 2.0; there are two
standard transports, stdio and Streamable HTTP; the authorization framework is HTTP-only and uses
`Authorization: Bearer <token>`.

**Correction:** "Streamable HTTP is a single endpoint over POST/GET with optional SSE" was true
through `2025-11-25`. It is **not** true of `2026-07-28`, which removed the GET stream endpoint
and removed protocol-level sessions.

> "Revision 2026-07-28 changed the behavior of Streamable HTTP. […] Changes included:
> * Removal of the GET stream endpoint.
> * Removal of protocol-level sessions."
>
> — <https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http>

Headline changes, verbatim from
<https://modelcontextprotocol.io/specification/2026-07-28/changelog>:

1. "Remove protocol-level sessions and the `Mcp-Session-Id` header from the Streamable HTTP
   transport. List endpoints (`tools/list`, `resources/list`, `prompts/list`) no longer vary
   per-connection." (SEP-2567)
2. "**Make MCP stateless**: remove the `initialize`/`notifications/initialized` handshake. Every
   request now carries its protocol version and client capabilities in `_meta`." (SEP-2575)
3. "Add `server/discover`: servers MUST implement this RPC to advertise their supported protocol
   versions, capabilities, and identity." (SEP-2575)
4. "Replace the HTTP GET endpoint and `resources/subscribe`/`resources/unsubscribe` with
   `subscriptions/listen`: a single long-lived POST-response stream." (SEP-2575)
9. "Remove SSE stream resumability and message redelivery (the `Last-Event-ID` header and SSE
   event IDs)." (SEP-2575)

Two minor changes matter disproportionately here:

- "Require standard MCP request headers (`Mcp-Method`, `Mcp-Name`) on Streamable HTTP POST
  requests" (SEP-2243) — a free telemetry channel, §6.2.
- "Require `ttlMs` and `cacheScope` fields on results returned by `tools/list`, `prompts/list`,
  `resources/list`, `resources/read`, and `resources/templates/list`" (SEP-2549) — a free
  cost-control channel for a scale-to-zero host, §5.5.

**The upshot: statelessness is no longer something you engineer around the protocol. As of
`2026-07-28` it *is* the protocol.** The spec index now summarises the base protocol as
"Stateless, self-contained requests / Per-request capability negotiation"
(<https://modelcontextprotocol.io/specification/>). The security-best-practices page states it
flatly: "MCP is stateless and has no protocol-level sessions"
(<https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices>).

### 0.2 But target `2025-11-25` on the wire today

> "Production servers should continue speaking 2025-11-25 today." … "clients that speak
> `2026-07-28` fall back to the `initialize` handshake when they reach a server on `2025-11-25`
> or earlier."
>
> — <https://blog.modelcontextprotocol.io/posts/sdk-betas-2026-07-28/>

**Sourcing caveat, stated plainly.** That post was published while `2026-07-28` was still a
release candidate — "The release candidate is locked as of May 21, 2026. The final specification
will be published on July 28, 2026"
(<https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/>). The spec has since
gone final and stable SDKs have shipped, so "today" in that quote is a week stale. **I could not
find a first-party post superseding its client-readiness guidance.** Treat "most deployed clients
still speak `2025-11-25` or earlier" as likely but **unconfirmed**.

Independent corroboration from live probes (§4): of five hosted production docs servers probed on
2026-08-03, **none negotiated above `2025-06-18`**, and AWS negotiated `2025-03-26`. The installed
base is well behind the spec.

### 0.3 SDK readiness (TypeScript)

The TypeScript SDK shipped **stable v2** on 2026-07-27, one day before the spec went final
(`gh api repos/modelcontextprotocol/typescript-sdk/releases`, all `prerelease=false`):

| Package | Version | Published |
| --- | --- | --- |
| `@modelcontextprotocol/server` | 2.0.0 | 2026-07-27 |
| `@modelcontextprotocol/core` | 2.0.0 | 2026-07-27 |
| `@modelcontextprotocol/hono` | 2.0.0 | 2026-07-27 |
| `@modelcontextprotocol/express` | 2.0.0 | 2026-07-27 |
| `@modelcontextprotocol/fastify` | 2.0.0 | 2026-07-27 |
| `@modelcontextprotocol/node` | 2.0.0 | 2026-07-27 |
| `@modelcontextprotocol/server-legacy` | 2.0.0 | 2026-07-27 |
| (v1 line, still supported) | 1.30.0 | 2026-07-27 |

`@modelcontextprotocol/server` v2 "is the stable release implementing the 2026-07-28 MCP spec"
(<https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/server/README.md>).
The separate **`server-legacy`** package is the SDK's own answer to §0.2 — run both side by side.
v1.x gets "bug fixes and security updates for at least six months"
(<https://blog.modelcontextprotocol.io/posts/sdk-betas-2026-07-28/>).

The v2 HTTP handler is stateless by construction:

> "The factory runs once per HTTP request: a fresh instance serves every request, and the handler
> holds nothing between requests."
>
> — <https://ts.sdk.modelcontextprotocol.io/v2/serving/http>

```typescript
const handler = createMcpHandler(() => {
    const server = new McpServer({ name: 'notes', version: '1.0.0' });
    server.registerTool('add-note', { /* ... */ }, async ({ text }) => ({
        content: [{ type: 'text', text: `Saved: ${text}` }]
    }));
    return server;
});
```

For the v1 line the equivalent knobs are `sessionIdGenerator: undefined` ("If not provided,
session management is disabled (stateless mode)") and `enableJsonResponse: true` ("the server
will return JSON responses instead of starting an SSE stream … Default is `false`"), both from
<https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/v1.29.0/src/server/streamableHttp.ts>.
The v1 class doc warns that stateful mode means "State is maintained in-memory (connections,
message history)" — precisely what breaks on Cloud Run (§5.2).

---

## 1. Tools vs resources vs prompts for content that is read, not executed

### 1.1 What the spec says each primitive is for

First-party control-model table, verbatim from
<https://modelcontextprotocol.io/docs/learn/server-concepts>:

| Feature | Explanation | Who controls it |
| --- | --- | --- |
| **Tools** | "Functions that your LLM can actively call, and decides when to use them based on user requests." | **Model** |
| **Resources** | "Passive data sources that provide read-only access to information for context, such as file contents, database schemas, **or API documentation**." | **Application** |
| **Prompts** | "Pre-built instruction templates that tell the model to work with specific tools and resources." | **User** |

Normative pages agree:

- "Tools in MCP are designed to be **model-controlled**, meaning that the language model can
  discover and invoke tools automatically based on its contextual understanding and the user's
  prompts." — <https://modelcontextprotocol.io/specification/2026-07-28/server/tools>
- "Resources in MCP are designed to be **application-driven**, with host applications determining
  how to incorporate context based on their needs." —
  <https://modelcontextprotocol.io/specification/2026-07-28/server/resources>
- Prompts "are user-controlled, requiring explicit invocation rather than automatic triggering."
  — <https://modelcontextprotocol.io/docs/learn/server-concepts>

On a purity reading a skill is a resource — documentation is the spec's own worked example of one.
**But the control model is the entire problem** (§1.5).

### 1.2 There is an official working group on exactly this question

The most directly relevant find in this research: MCP has a **Skills Over MCP Working Group**,
converted from an interest group on 2026-04-16, co-led by Anthropic and Nordstrom.

> "The Skills Over MCP Working Group defines how 'agent skills' — rich, structured instructions
> for agent workflows — are discovered, distributed, and consumed through MCP."
>
> — <https://modelcontextprotocol.io/community/working-groups/skills-over-mcp>

> "The WG's current direction is captured in [SEP-2640 — Skills Extension] (Resources-based,
> Extensions Track)."

> "the draft Skills Extension SEP represents the WG's current direction: a formal extension using
> existing Resources primitives"

**Status, checked 2026-08-03 via
`gh pr view 2640 --repo modelcontextprotocol/modelcontextprotocol`:**

```
title:     SEP-2640: Skills Extension
state:     OPEN        mergedAt: null      isDraft: false
labels:    SEP, draft, extension
createdAt: 2026-04-23  updatedAt: 2026-07-27
url:       https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2640
```

An active, sponsored, **not-yet-ratified** draft on the Extensions Track. Best available signal of
ecosystem direction; not a compliance requirement. Building to it is a bet.

### 1.3 The WG evaluated six approaches and chose resources-by-convention

From <https://github.com/modelcontextprotocol/experimental-ext-skills/blob/main/docs/approaches.md>:

1. Skills as distinct MCP primitives — new `skills/list` / `skills/get` methods (SEP-2076;
   **not adopted**)
2. Skills as registry metadata
3. Skills as tools and/or resources — a `list_skills` tool, or `skill://` resources
4. Gateway/composition pattern
5. Server instructions reference — point at resources from server instructions for deferred
   loading
6. **Official convention as intermediate step** — patterns over existing primitives

They chose **approach 6**, which became SEP-2640: existing Resources primitives, zero protocol
changes. Rationale quoted in that document:

> "Skills-as-resources is much more accurate" because "pretty much everything an MCP server
> exposes is context."

> "convention can prove patterns before standardization — or whether the ecosystem needs
> protocol-level support."

Concrete shape, from
<https://github.com/modelcontextprotocol/experimental-ext-skills/blob/main/docs/skill-uri-scheme.md>:

- Scheme: **`skill://`**
- Primary content: `skill://<skill-path>/SKILL.md` — e.g. `skill://git-workflow/SKILL.md`,
  `skill://acme/billing/refunds/SKILL.md`
- Sub-resources by relative path: `skill://code-review/references/SECURITY.md`
- "`SKILL.md` MUST be explicit in the URI", aligning with the Agent Skills directory model
- "a `skill://` URI is directly readable via `resources/read` whether or not it appears in any
  list" — enumeration is optional; `resources/read` is the contract

`_meta` keys are **not standardized**. The WG reserves the namespace
`io.modelcontextprotocol.skills/` and lists provenance, dependencies, input/output schemas,
content integrity and activation triggers only as *candidate* areas
(<https://github.com/modelcontextprotocol/experimental-ext-skills/blob/main/docs/skill-meta-keys.md>).
There is also **no protocol-level marker distinguishing a skill resource from any other
resource** — the distinction rests entirely on the URI scheme by convention. The WG's example
listing entry:

```json
{
  "uri": "skill://code-review/SKILL.md",
  "name": "code-review",
  "description": "Structured code review workflow with checklist-driven analysis and inline annotations.",
  "annotations": { "audience": ["assistant"], "priority": 0.8 }
}
```

This repo's layout (`skills/<area>/<name>/SKILL.md`) maps onto the multi-segment form essentially
unchanged: `skill://orchestration/frontier/SKILL.md`, with
`skill://orchestration/frontier/FIELD-REVIEW.md` as a sub-resource. A good fit, and worth adopting
as the naming convention **regardless of which primitive carries retrieval.**

### 1.4 …and the WG's own experiments say resources alone do not get read

The decisive evidence, and it is the WG contradicting its own preferred direction with field data.
From
<https://github.com/modelcontextprotocol/experimental-ext-skills/blob/main/docs/experimental-findings.md>:

- **McpGraph (TeamSparkAI)** tested Claude against a `SKILL.md` colocated with an MCP server.
  "Claude initially ignored the skill documentation despite similar descriptions" and "eventually
  read the skill after failing at tool usage multiple times." The fix: "Added server instructions
  directing agents to read SKILL.md first, which resolved the issue."
- > "Even Opus 4.6 needs to be constantly bugged to load skills when they're preloaded in the
  > context already"
- > "Skills are ephemeral and/or time decaying — it clicks once and then give it some time and
  > they lose the plot"
- Unresolved issues include: "Models frequently ignore preloaded skills without explicit hooks."

**NimbleBrain** is the one positive datapoint: they "Implemented skills as `skill://` resources
directly on servers" and comparative tests against a skills-injection approach "showed equal or
improved performance."

From the WG's open questions
(<https://github.com/modelcontextprotocol/experimental-ext-skills/blob/main/docs/open-questions.md>):

> "Clients have been slow to implement support for resources... they all went for 'tools' and have
> slowly been getting around to implementing other primitives."

Question 9 ("model-controlled vs. application-controlled") and Question 11 ("whether the control
model should vary by use case") are recorded as **unresolved**. Question 1, on how skills are
discovered at scale, has "no consensus reached."

### 1.5 Why the control model is the crux

- Resources are **application-driven** — the host decides whether to surface them at all. The
  spec's illustration is a *resource picker UI*, and its listed patterns begin "Expose resources
  through UI elements for explicit selection" and "Allow the user to search through and filter
  available resources" before reaching "Implement automatic context inclusion, based on
  heuristics or the AI model's selection".
- Tools are **model-controlled** — "the language model can discover and invoke tools
  automatically".

Both pages carry the same disclaimer: "the protocol itself does not mandate any specific user
interaction model." **That disclaimer is the risk.** Automatic inclusion is one permitted option
of three, and a server author cannot rely on it. For bag-of-beans an agent must find and pull a
skill on its own initiative, mid-task, with no human in the loop — the model-controlled path by
definition.

**This also determines what telemetry can mean**, a stated project goal. A `tools/call` is an
unambiguous act of agent intent: the model decided it needed this skill, mid-task. A
`resources/read` may equally be a host prefetching a listing, a user clicking a picker, or an
indexer warming a cache. **Tool-call telemetry measures demand; resource-read telemetry measures
traffic.** If usage data is to feed back into which skills are worth maintaining, that is the
difference between a signal and a number.

### 1.6 What clients actually handle

Three independent primary sources converge on tools.

**(a) The official client matrix — note that it was deleted.** `modelcontextprotocol.io/clients`
now 301s to the getting-started intro; the redirect is in the site's own routing config
(<https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/docs/docs.json>).
The page was removed on 2026-05-27 in commit `2075a21d`, "Remove Example Clients overview page":
"Delete the community-maintained list of MCP clients (docs/clients.mdx) and the navigation entry
for it"
(<https://github.com/modelcontextprotocol/modelcontextprotocol/commit/2075a21d039385fc90852b7e505060aa21bdaddd>).
Figures below are recovered from the last committed version (`git show 2075a21d^:docs/clients.mdx`,
content last updated 2026-05-26). **First-party but historical and community-maintained — treat as
directional.**

| Feature | Clients | Share |
| --- | ---: | ---: |
| **Tools** | **114** | **100%** |
| **Resources** | **47** | **41%** |
| Prompts | 43 | 38% |
| Elicitation | 17 | 15% |
| Sampling | 16 (+2 partial) | 14% |
| Roots | 9 | 8% |

Clients that read **tools only, no resources**: ChatGPT, Cursor, Gemini CLI, Windsurf, JetBrains
AI, LibreChat. Clients supporting resources include VS Code Copilot, Claude Code, Claude.ai /
Desktop, goose, Continue, Postman.

**(b) Claude Code supports resources, but the model's path to them is a wrapped tool.** From
<https://code.claude.com/docs/en/mcp>:

> "MCP servers can expose resources that you can reference using @ mentions, similar to how you
> reference files." … "Type `@` in your prompt to see available resources from all connected MCP
> servers."

> "Resources are automatically fetched and included as attachments **when referenced**"

> "**Claude Code automatically provides tools to list and read MCP resources when servers support
> them**"

That last line is the crux: even in a resource-supporting client, the autonomous path is a
synthesised tool call — tools again, with an extra indirection and no search. The @-mention is the
user-driven path. MCP prompts do surface well here, as slash commands: "MCP prompts appear with
the format `/mcp__servername__promptname`".

**(c) The Claude Messages API MCP connector is tools-only.** From
<https://platform.claude.com/docs/en/agents-and-tools/mcp-connector>:

> "Of the feature set of the MCP specification, only **tool calls** are currently supported."

> "Use the `mcp_servers` API parameter when you have remote servers accessible by URL and **only
> need tool support**."

Hosted claude.ai / Desktop connectors *do* support resources — "Tools, prompts, and resources";
"Text and binary resources" supported, "Resource subscriptions" not
(<https://claude.com/docs/connectors/building>). But anyone consuming a hosted server through the
API sees zero resources.

**Unconfirmed:** whether claude.ai auto-surfaces resources to the model or only via a picker.
`claude.com/docs/connectors/building` confirms support but is silent on the surfacing mechanism.
I could not find a primary source resolving this.

---

## 2. Discovery ergonomics: how an agent finds the right skill among many

### 2.1 There is no search primitive in MCP. At all.

Verified by grepping the schema
(<https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/schema/2026-07-28/schema.ts>).
The complete set of request methods in `2026-07-28`:

```
completion/complete   prompts/get    resources/list             server/discover
elicitation/create    prompts/list   resources/read             subscriptions/listen
roots/list                           resources/templates/list   tools/call
                                                                tools/list
```

Exactly three `resources/*` methods — `list`, `read`, `templates/list`. **There is no
`resources/search`, and no search primitive of any kind.** The resources page confirms `list` and
`templates/list` support cursor pagination, and that's the entirety of the discovery affordance
(<https://modelcontextprotocol.io/specification/2026-07-28/server/resources>).

This is dispositive for a library that will grow. A resources-only server can offer the agent a
paginated dump of every skill's name and description and nothing else. Server-side ranking,
query-time relevance, and filtering by task are all unreachable through the resources interface.
A `search` **tool**, by contrast, is trivially implementable and works in 114/114 clients.

### 2.2 What real servers do: two-step search-then-fetch dominates

From the five live-probed servers (§4 for full detail):

| Server | Discovery shape |
| --- | --- |
| Context7 | `resolve-library-id(query, libraryName)` → `query-docs(libraryId, query)` |
| Microsoft Learn | `microsoft_docs_search(query)` → `microsoft_docs_fetch(url)` (+ a code-sample search) |
| AWS Knowledge | `aws___search_documentation(search_phrase, topics, limit)` → `aws___read_documentation([{url,…}])` |
| Mintlify | `search_<site>(query)` → `query_docs_filesystem_<site>(command)` |
| Cloudflare Docs | `search_cloudflare_documentation(query)` only — no fetch step |

**Four of five use one query tool plus one retrieval tool.** Nobody uses a resource listing for
discovery. Nobody does one-tool-per-document — with one deliberate exception worth copying:
Cloudflare's zero-argument `migrate_pages_to_workers_guide`, whose entire description is "ALWAYS
read this guide before migrating Pages projects to Workers"
(<https://github.com/cloudflare/mcp-server-cloudflare/blob/main/packages/mcp-common/src/shared-tools/docs-ai-search.tools.ts>).
That is the pattern for a small number of high-value documents an agent should read unprompted.

### 2.3 Prose steering is doing the heavy lifting

Across the prior art, the tool description and the server `instructions` field are used as the
orchestration layer:

- **Microsoft Learn** puts a workflow script in `instructions`: "1. Use `microsoft_docs_search`
  to find relevant documents. 2. If you need code examples … use `microsoft_code_sample_search`.
  3. If deeper or complete information is needed, use `microsoft_docs_fetch`. Search gives
  breadth. Code Sample Search gives practical examples. Fetch gives depth." (live probe,
  `https://learn.microsoft.com/api/mcp`)
- **Context7** enforces sequencing in prose — "You MUST call this function before 'Query
  Documentation' tool" — and self-imposes a call budget: "Do not call this tool more than 3 times
  per question." (live `tools/list`)
- **AWS** steers retrieval with a `topics` enum plus "Pick ONE topic. Add a 2nd ONLY if query
  genuinely spans domains. Extra topics dilute ranking." (live `tools/list`)
- The **skills WG** found the same thing from the other direction: adding server instructions
  telling the agent to read `SKILL.md` first was what fixed Claude ignoring the skill (§1.4).

`instructions` is a first-class field on `server/discover`: "Optional natural-language guidance
for LLMs on how to use this server effectively"
(<https://modelcontextprotocol.io/specification/2026-07-28/server/discover>).

**Claude Code-specific constraint:** "Claude Code truncates tool descriptions and server
instructions at **2KB each**" (<https://code.claude.com/docs/en/mcp>). Budget accordingly.

### 2.4 The "too many tools" objection is real but bounded — and already mitigated

First-party numbers from
<https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool>:

> "**Context bloat:** A typical multiserver setup (GitHub, Slack, Sentry, Grafana, and Splunk) can
> consume ~55k tokens in definitions before Claude does any work."

> "**Tool selection accuracy:** Claude's ability to pick the right tool degrades once you exceed
> **30–50 available tools**."

Standard tool calling is recommended "when you have fewer than 10 tools." A two-or-three-tool
search/fetch surface sits far below every threshold. **One tool per skill does not** — it puts the
server on a collision course with the 30–50 limit as the library grows, and it is the shape nobody
in the prior art chose.

Separately, Claude Code defers MCP tool definitions by default: "Tool search keeps MCP context
usage low by deferring tool definitions until Claude needs them. Only tool names and server
instructions load at session start" (<https://code.claude.com/docs/en/mcp>). Its guidance to
server authors is directly relevant: "the server instructions field becomes more useful with tool
search enabled. Server instructions help Claude understand when to search for your tools, similar
to how skills work." Servers can also force a tool to always load via `"anthropic/alwaysLoad":
true` in the tool's `_meta`.

**No standardized progressive disclosure exists in MCP yet.** "Primitive Grouping" is an *interest
group*, not a working group, and explicitly disclaims authority: "this IG does not have authority
to approve protocol changes"
(<https://modelcontextprotocol.io/community/interest-groups/primitive-grouping>). A "Tool
Filtering" WG is named as an example at
<https://modelcontextprotocol.io/community/working-interest-groups> but **has no charter page — I
could not confirm it is chartered or active.** The eight chartered WGs are file-uploads,
inspector-v2, interceptors, registry, sdk, server-card, skills-over-mcp, triggers-events.

---

## 3. Auth for a public read-only server

### 3.1 The spec sanctions anonymous access explicitly

> "Authorization is **OPTIONAL** for MCP implementations. When supported:
> * Implementations using an HTTP-based transport **SHOULD** conform to this specification."
>
> — <https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization>

That is the sanctioned unauthenticated path, and it is unambiguous. Every `MUST` in the
authorization spec — including "MCP servers **MUST** implement OAuth 2.0 Protected Resource
Metadata ([RFC9728])" — is scoped by "When supported". A server that does not implement
authorization has no OAuth obligations at all: no Protected Resource Metadata document, no
`WWW-Authenticate` challenge, no authorization server, no dynamic client registration.

This matters because the OAuth flow is genuinely heavy. The spec requires OAuth 2.1, PKCE, RFC
8707 resource indicators ("MUST be included in both authorization requests and token requests"),
RFC 9207 issuer validation, and at least one of RFC 8414 or OpenID Connect Discovery. **For a
service with no user accounts, all of that machinery would exist solely to issue tokens that
distinguish nobody from nobody.** There is no first-party guidance suggesting a public read-only
server should do this, and the prior art unanimously does not.

The spec does acknowledge open servers elsewhere: under CIMD trust policies it lists "Accept any
HTTPS `client_id` (for open servers)"
(<https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices>).

### 3.2 Real clients tolerate it — 5 out of 5 public docs servers are anonymous

Every server probed in §4 served content with no `Authorization` header. First-party statements:

- **Cloudflare:** "This public documentation server does not require authentication" and "This
  server does not require OAuth."
  (<https://github.com/cloudflare/mcp-server-cloudflare/blob/main/apps/docs-ai-search/README.md>)
- **Microsoft Learn:** "No API keys, no logins, no sign-ups required."
  (<https://github.com/MicrosoftDocs/mcp>)
- **AWS Knowledge:** "The Knowledge MCP server does not require authentication but is subject to
  rate limits." and "Do I need an AWS account? No."
  (<https://github.com/awslabs/mcp/blob/main/src/aws-knowledge-mcp-server/README.md>)
- **Mintlify** publishes it machine-readably in a server card at
  `/.well-known/mcp/server-card.json`: `"authentication":"none"`.
- **Context7** works anonymously in practice (I completed an anonymous `resolve-library-id` call
  returning real content), though its README recommends an API key "for increased rate limits"
  (<https://github.com/upstash/context7>).

### 3.3 The pattern to copy: two paths, not one

Two of the five implement OAuth as an *upgrade* rather than a gate, and Mintlify's split is the
cleanest model:

> "`/mcp`: Does not require authentication. Returns only public content. … `/authed/mcp`: Always
> requires authentication. Returns content scoped to each user's permissions based on their user
> groups." … "The `/authed/mcp` endpoint uses its own OAuth flow at `/authed/mcp/oauth/*`."
>
> — <https://www.mintlify.com/docs/ai/model-context-protocol>

Context7 does the same thing for rate limits rather than content scoping: anonymous works, and a
bearer key raises the ceiling. Notably it advertises OAuth on *every* response, including 200s,
via `WWW-Authenticate: Bearer resource_metadata="…"` — optional OAuth, discoverable, with an
anonymous fallback.

For bag-of-beans: ship `/mcp` anonymous. If per-user telemetry or private skills ever matter, add
a second authed path rather than gating the public one.

### 3.4 What anonymity costs

Two things follow, and neither is a blocker:

- **Rate limiting becomes the only abuse control.** The spec requires it independently of auth:
  servers **MUST** "Rate limit tool invocations"
  (<https://modelcontextprotocol.io/specification/2026-07-28/server/tools>). AWS makes the
  trade explicit — no auth "but is subject to rate limits."
- **Telemetry is per-request, not per-user.** You get method, tool name, and client identity
  (§6.2), not a stable user. For "which skills get pulled and by what kind of agent" that is
  sufficient; for retention or per-customer analytics it is not.

Also mandatory regardless of auth: "Servers **MUST** validate the `Origin` header on all incoming
connections to prevent DNS rebinding attacks. If the `Origin` header is present and invalid,
servers **MUST** respond with HTTP 403 Forbidden"
(<https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http>).

---

## 4. Prior art: five hosted servers serving reference content

All probed live on 2026-08-03 with a `POST` carrying
`Accept: application/json, text/event-stream`, an `initialize` body, and **no** `Authorization`
header.

| Server | Endpoint | Primitive | Shape | Auth | Session |
| --- | --- | --- | --- | --- | --- |
| Context7 (Upstash) | `mcp.context7.com/mcp` | Tools | resolve → query | anonymous (key = rate limit) | **required** |
| Cloudflare Docs | `docs.mcp.cloudflare.com/mcp` | Tools + **Prompts** | search only | anonymous | none |
| Microsoft Learn | `learn.microsoft.com/api/mcp` | Tools | search / code-search / fetch | anonymous | issued, not enforced |
| AWS Knowledge | `knowledge-mcp.global.api.aws` | Tools | search → batched read | anonymous | issued, not enforced |
| Mintlify (template) | `<site>/mcp` | Tools + **Resources** | search + virtual FS | anonymous | none |

### 4.1 Context7 (Upstash) — `https://mcp.context7.com/mcp`

`initialize` → 200, `serverInfo: {"name":"Context7","version":"3.2.5"}`. Capabilities:
`{"tools":{"listChanged":true},"prompts":{},"resources":{}}` — prompts and resources are declared
but empty.

Two tools: `resolve-library-id(query, libraryName)` returning candidate `/org/project` IDs with
snippet counts and reputation scores, then `query-docs(libraryId, query)`. Both carry
`annotations: {readOnlyHint: true, idempotentHint: true, openWorldHint: true}`. The `query` arg is
scoped to one concept — the description's own example of a bad query is "routing and auth and
caching in Next.js". Docs are semantically queried, not paged.

**The outlier on state:** it returns `mcp-session-id` and `tools/list` without it returns
`400 {"code":-32000,"message":"Bad Request: No valid session ID provided"}`. `GET /sse` → 404 with
"Use /mcp for MCP protocol communication." Source: <https://github.com/upstash/context7>.

### 4.2 Cloudflare Docs — `https://docs.mcp.cloudflare.com/mcp`

`serverInfo: {"name":"docs-ai-search","version":"0.4.10"}`. Capabilities:
`{"tools":{"listChanged":true},"prompts":{"listChanged":true}}` — **the only one shipping a real
MCP prompt.** Source is public under `apps/docs-ai-search/` at
<https://github.com/cloudflare/mcp-server-cloudflare>.

- `search_cloudflare_documentation(query)` — registered via
  `context.registerTool('search_cloudflare_documentation', { … inputSchema: z.object({ query: z.string() }) … })`
  (<https://github.com/cloudflare/mcp-server-cloudflare/blob/main/packages/mcp-common/src/shared-tools/docs-ai-search.tools.ts>).
  Declares a full `outputSchema` (`similarity`, `id`, `url`, `title`, `text`).
- `migrate_pages_to_workers_guide` — **zero args**, description "ALWAYS read this guide before
  migrating Pages projects to Workers." One-tool-per-document, used once, deliberately.
- Prompt `workers-prompt-full` live-fetches `developers.cloudflare.com/workers/prompt.txt` at
  prompt-get time with `cacheTtl: 3600`
  (<https://github.com/cloudflare/mcp-server-cloudflare/blob/main/packages/mcp-common/src/shared-prompts/docs-ai-search.prompts.ts>).

**No fetch step at all** — the design bets entirely on chunk quality, which is why it is also the
one that returns structured output.

**The cleanest statelessness story of the five**, and the closest analogue to what bag-of-beans
should build. From its README: "The `/mcp` and `/sse` URLs use the same stateless SDK v2 handler
and create a fresh server for every request. `/sse` is not the deprecated HTTP+SSE transport." and
"supports modern MCP requests and stateless 2025 compatibility without an MCP protocol session."
No `mcp-session-id` is ever returned; `tools/list` and `tools/call` succeed with no prior
`initialize`. `GET` on either path → `405`.

**Caveat on a first-party source that is wrong:** Cloudflare's fleet overview page
(<https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/>)
describes all ~16 servers generically as OAuth. That does not hold for the docs server. The
per-app README and the live probe win.

### 4.3 Microsoft Learn — `https://learn.microsoft.com/api/mcp`

`serverInfo: {"name":"Microsoft Learn MCP Server","version":"1.0.0"}`. Advertises `logging`,
`prompts`, `resources`, `tools` — but `resources/list` → `{"resources":[]}` and `prompts/list` →
`{"prompts":[]}`. **Declared capabilities it does not populate.**

Three tools: `microsoft_docs_search(query)` (≤10 chunks, ≤500 tokens each, with `outputSchema`),
`microsoft_code_sample_search(query, language?)` with an enumerated language list, and
`microsoft_docs_fetch(url)` returning full markdown. Splitting code samples into their own tool is
unique among the five. Its `instructions` field is quoted in §2.3.

**Pseudo-stateless:** it returns an `mcp-session-id` whose value is base64 JSON, not an opaque
handle — decoding gives `{"clientInfo":{…},"userIdClaim":"69321abd-…"}`. So the "session" is an
identity/telemetry token carried in the header rather than server state, and it is not enforced:
`tools/list` with no session header → 200. **A neat trick worth noting for a stateless server that
still wants a correlation id.**

**Honest gap:** <https://github.com/MicrosoftDocs/mcp> contains **no server source** — only
README, AGENTS.md, cli, scripts, skills, `.mcp.json`. Tool-shape evidence here is live probe plus
README, not source.

### 4.4 AWS Knowledge MCP — `https://knowledge-mcp.global.api.aws`

GA. `serverInfo: {"name":"AWSKnowledgeMCP","version":"1.0.0"}`, `server: CloudFront`. Capabilities
`{"tools":{"listChanged":false}}` — the only one declaring a fixed tool set. (Distinct from
`awslabs/mcp`'s local stdio `aws-documentation-mcp-server`; don't conflate them.)

Five tools, all live names carrying an `aws___` prefix the README omits:
`aws___search_documentation(search_phrase, topics[≤3], limit)`,
`aws___read_documentation([{url, max_length?, start_index?}])`, `aws___list_regions`,
`aws___get_regional_availability`, `aws___retrieve_skill(skill_name, file?)`. README:
<https://github.com/awslabs/mcp/blob/main/src/aws-knowledge-mcp-server/README.md>.

Three choices unique among the five, all worth stealing:

- **Batched reads** — `read_documentation` takes an array ("Batch 2-5"), not one URL.
- **Explicit char-offset pagination** — `max_length` (default 10000) and `start_index`, with
  responses returning `total_length, start_index, end_index, truncated` and a table of contents
  with char ranges so the agent can jump. Real document paging; nobody else does it.
- **A URL allow-list in the tool description**, enumerating permitted prefixes, plus enumerated
  error codes (`not_found, invalid_url, throttled, downstream_error, validation_error`).

It is also **a skills server**: `retrieve_skill` takes a `skill_name` that must come verbatim from
a search result ("it is an opaque registry ID. Never guess or fabricate"), and `agent_skills` is
one of the `topics` enum values. **This is the closest existing thing to what bag-of-beans is
building, and it is tool-based, search-first, and anonymous.**

Returns `application/json`, not `text/event-stream` — the only one answering unary JSON. Issues a
session id but does not enforce it. Negotiates `2025-03-26`.

### 4.5 Mintlify — `https://www.mintlify.com/docs/mcp` (and every Mintlify docs site)

A *template*, not one server: "Mintlify generates a search MCP server for your site and hosts it
at the `/mcp` path of your site URL"
(<https://www.mintlify.com/docs/ai/model-context-protocol>). `x-matched-path:
/_mintlify/mcp/[subdomain]/[transport]` confirms multi-tenant generation.

Capabilities `{"tools":{"listChanged":true},"resources":{"listChanged":true}}` — **the only one of
the five that populates `resources/list`.** And this is the detail that matters most for this
research: it returns **three skill files, not documentation pages**:

```
mintlify://skills/mintlify
mintlify://skills/mintlify-api
mintlify://skills/mintlify-docs
```

all `mimeType: text/markdown`. First-party: "Your search MCP server also exposes your skill.md
files as MCP resources." **So even the one server that uses resources deliberately does not model
documents as resources — it uses resources for skills and tools for retrieval.**

Three tools. `search_<site>(query, language?)`. `submit_feedback(path, feedback)` — the only
non-read-only tool across all five. And the most unusual design in the set,
`query_docs_filesystem_<site>(command)`, taking a shell command string:

> "Run a read-only shell-like query against a virtualized, in-memory filesystem rooted at `/` that
> contains ONLY the … documentation pages and OpenAPI specs. This is NOT a shell on any real
> machine."

Supports `rg, grep, find, tree, ls, cat, head, tail, stat, wc, sort, uniq, cut, sed, awk, jq`;
pages read as `.mdx` by path; output truncated at 30KB. "This is how you read documentation pages:
there is no separate 'get page' tool." Each call is independently stateless — "the working
directory always resets to `/`".

Fully stateless: no `mcp-session-id` ever. Also emits a `Link` header advertising
`llms-txt`, `llms-full-txt`, `api-catalog`, `mcp-server-card`, `agent-card`, `agent-skills`
alongside MCP — a useful model for a project that also wants a website surface.

Hard constraint worth knowing: "Documentation that requires authentication for all pages cannot
generate an MCP server."

### 4.6 Cross-cutting conclusions from the prior art

1. **Documents are tools, essentially universally.** 5/5. Two declare a `resources` capability and
   return an empty list. Only Mintlify populates resources, and uses them for *skill* files, not
   pages. **Nobody models documentation as MCP resources. The field has already voted.**
2. **Two-step search-then-fetch is the dominant shape** (4/5). The exception, Cloudflare, is
   search-only and compensates with a rich `outputSchema`.
3. **One-tool-per-document is not done**, except deliberately for a single must-read doc
   (Cloudflare).
4. **All five are anonymous.** Two implement OAuth as an upgrade path, never as a gate.
5. **Streamable HTTP has won; legacy HTTP+SSE is gone.** No server ran the deprecated transport.
   Cloudflare keeps `/sse` as a path alias to the same stateless handler; Context7 and Mintlify
   404 on it.
6. **Four of five are effectively stateless.** Only Context7 hard-requires a session.
7. **Prose steering — descriptions, `instructions`, call budgets — is the orchestration layer.**
8. **Deployed reality beat the docs twice**: AWS's live tool names are `aws___`-prefixed while its
   README is not, and Cloudflare's fleet page wrongly implies its docs server needs OAuth. Live
   `tools/list` is the more reliable source.

---

## 5. Hosting on Cloud Run

**URL note:** `cloud.google.com/run/docs/*` now 301s to `docs.cloud.google.com/run/docs/*`. Both
are first-party; the canonical destination is cited.

### 5.1 Google publishes a first-party MCP-on-Cloud-Run guide

<https://docs.cloud.google.com/run/docs/host-mcp-servers> and
<https://docs.cloud.google.com/run/docs/tutorials/deploy-remote-mcp-server>.

On transport, unambiguous:

> "Cloud Run supports hosting MCP servers with streamable HTTP transport, but not MCP servers with
> stdio transport."

On auth, it defaults to locked-down:

> "By default, the URL of Cloud Run services requires all requests to be authorized with the Cloud
> Run Invoker (`roles/run.invoker`) IAM role."

with `gcloud run deploy mcp-server --no-allow-unauthenticated …` and a client-side
`gcloud run services proxy mcp-server --region=… --port=3000` — "an authenticated tunnel to the
remote MCP server on your local machine." Google's own MCP server follows the identical pattern
(<https://github.com/GoogleCloudPlatform/cloud-run-mcp>).

**Note this conflicts with a public skills server.** Google's documented posture is IAM-gated
plus a local proxy, which is exactly wrong for a distribution channel meant to be added to any
agent's config with a bare URL. `--allow-unauthenticated` at the Cloud Run layer plus anonymous
MCP (§3) is the right call here — but be aware you are departing from Google's default guidance,
deliberately.

**A real gap in Google's docs, flagged explicitly:** neither first-party MCP page mentions
statelessness, session affinity, `Mcp-Session-Id`, or in-memory state. Google tells you to deploy
a Streamable HTTP MCP server onto an autoscaling platform and never warns that an in-memory
session store will break. Its sample works only because it happens to be stateless.

### 5.2 Session affinity is best-effort — do not build on it

<https://docs.cloud.google.com/run/docs/configuring/session-affinity> calls it "best effort
affinity":

> "If the instance is terminated for any reason, or reaches maximum request concurrency or maximum
> CPU utilization, then session affinity is broken and further requests are routed to a different
> instance."

> "Although you can cache client session data in memory of instances, you cannot assume that a
> client will always reconnect to the same instance, **even when session affinity is enabled**."

An in-memory `Mcp-Session-Id` map on Cloud Run is a correctness bug that surfaces under scale-out,
scale-in, concurrency saturation, and every redeploy. Affinity reduces the failure rate; it does
not eliminate it.

**This is a non-issue if you build stateless**, which §0.1 shows is now the protocol's own
direction and §4.6 shows is what 4 of 5 production servers do.

### 5.3 SSE can be safely omitted in v1 — and it is spec-compliant

Under `2026-07-28` there is no GET stream to omit; it was deleted. A server that only supports
POST is the specified shape:

> "The server **MUST** provide a single HTTP endpoint path … that supports POST."

and for legacy traffic: "HTTP GET or DELETE to the MCP endpoint: respond with `405 Method Not
Allowed`" and "An `Mcp-Session-Id` header on a request: ignore it, and do not mint or echo session
IDs" (<https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http>).

Under `2025-06-18` / `2025-11-25`, omitting SSE is also explicitly allowed. The client "**MAY**
issue an HTTP GET", and "The server **MUST** either return `Content-Type: text/event-stream` … or
else return **HTTP 405 Method Not Allowed**, indicating that the server does not offer an SSE
stream at this endpoint" (<https://modelcontextprotocol.io/specification/2025-06-18/basic/transports>).
Sessions there are `MAY`, never `MUST`.

For POST responses, both revisions require the server to return **either** `application/json`
**or** `text/event-stream`, and the client **MUST** support both. So `enableJsonResponse: true` is
not a shortcut — it is one of two sanctioned behaviours. AWS Knowledge ships exactly this in
production (§4.4).

Note the one client obligation that does not go away: the client **MUST** send
`Accept: application/json, text/event-stream` on POST regardless.

**Conclusion: omit SSE in v1.** For a request/response docs server there is nothing to stream, and
avoiding long-lived connections sidesteps §5.4 entirely.

### 5.4 Request timeout caps any long-lived stream

<https://docs.cloud.google.com/run/docs/configuring/request-timeout>:

> "The timeout is set by default to **5 minutes (300 seconds)** and can be extended up to
> **60 minutes (3600 seconds)**."

On expiry the connection is closed and a **504** returned — and the container keeps running, so an
abandoned SSE handler can leak. "For a timeout longer than 15 minutes, Google recommends
implementing retries and making sure the service is tolerant to clients re-connecting."

A `subscriptions/listen` stream is a single HTTP request and is subject to this cap. **There is no
unbounded stream on Cloud Run.** If you ever add server-push, the spec's own mitigations apply:
servers **SHOULD** send `X-Accel-Buffering: no` and emit periodic SSE comment keep-alives (`:\r\n`)
(<https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http>).

*Could not confirm:* the request-timeout page makes no specific mention of SSE or streaming
responses; the 504 behaviour is documented generically.

### 5.5 Cold starts, free tier, and the caching lever

**Cold starts** (<https://docs.cloud.google.com/run/docs/about-instance-autoscaling>):

> "To minimize cold starts, Cloud Run might keep instances idle for a period of time after they
> finish handling requests (up to 15 minutes, or 10 minutes for GPUs)."

Revisions with no traffic scale to zero by default. `--min-instance` keeps instances warm but
"incurs costs even during idle periods"
(<https://docs.cloud.google.com/run/docs/configuring/min-instance>) — which conflicts with a
free-tier-first posture.

**Startup CPU boost is already on**
(<https://docs.cloud.google.com/run/docs/configuring/services/cpu>): "provides additional CPU
during instance startup time and for 10 seconds after the instance has started", and per
<https://docs.cloud.google.com/sdk/gcloud/reference/run/deploy> it is "**Enabled by default when
unspecified on new services.**" No action needed.

**Free tier** (<https://docs.cloud.google.com/free/docs/free-cloud-features>):

- 2 million requests per month
- 360,000 GiB-seconds of memory
- 180,000 vCPU-seconds of compute
- 1 GB outbound data transfer from North America per month

**Scoped to request-based billing** — "other billing configurations have different free tier
amounts." Min-instances pushes toward instance-based billing, where these numbers may not apply.

*Partially unconfirmed:* I could not verify from the free-tier page whether there is a tier-1
region restriction, and the `cloud.google.com/run/pricing` body was truncated on fetch. The
billing-model restriction **is** confirmed; the region question is not.

**The caching lever is the real cost control.** Because `resources/read`, `tools/list` and the
list methods all now carry `ttlMs` and `cacheScope`, and "`public`" means "Any client, shared
gateway, or caching proxy **MAY** store and serve the cached response to any user"
(<https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching>), a public
skill library can mark essentially everything `cacheScope: "public"` with a long `ttlMs`. Skills
change on commit, not per request. Combined with `listChanged` as an invalidation signal — "the
notification acts as an immediate invalidation signal" — this pushes most repeat traffic off the
origin entirely. **For a free-tier-first, scale-to-zero service this is the single highest-leverage
protocol feature available**, and it is a `MUST` to populate anyway: "Servers MUST include caching
hints on results with `resultType: "complete"`".

One security note attached to it: "Servers MUST be aware that responses with a `"public"`
`cacheScope` may be shared between callers even if the Result is coming from an authenticated
endpoint." For a public server that is precisely the desired behaviour.

### 5.6 Statelessness is nearly free with the current SDK

The v2 handler already holds nothing between requests (§0.3), and `resources/list` / `tools/list`
"**MUST NOT** vary per-connection … The set **MAY** vary by the authorization presented on the
request — since credentials are per-request input, not connection state"
(<https://modelcontextprotocol.io/specification/2026-07-28/server/resources>). A skill library is
naturally a pure function of the deployed commit, so this constraint costs nothing.

If cross-call state is ever needed, the spec's sanctioned mechanism is an explicit handle passed
as an ordinary tool argument, not a session: "MCP has no protocol-level session, so a server
cannot rely on implicit per-connection state … servers … should do so by returning an explicit
handle from a creation tool and accepting that handle as an argument on subsequent calls"
(<https://modelcontextprotocol.io/specification/2026-07-28/server/tools>). With the corollary that
"MCP servers **MUST NOT** treat possession of a state handle as authentication"
(<https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices>).

---

## 6. Telemetry, which the project wants instrumented at the core

### 6.1 Tool calls are the only unambiguous intent signal

Restating §1.5 because it is an architectural consequence, not an aside: `tools/call` means the
model decided, mid-task, that it needed this skill. `resources/read` does not distinguish agent
intent from host prefetch, user picker click, or cache warming. If skill-usage data is meant to
drive which skills get maintained, retrieval must run through tools.

### 6.2 `2026-07-28` mirrors routing data into HTTP headers — free observability

> "The Streamable HTTP transport mirrors selected JSON-RPC body fields into HTTP headers so that
> intermediaries (load balancers, gateways, observability tooling) can route and inspect requests
> without parsing the body."

| Header | Source field | Required for |
| --- | --- | --- |
| `Mcp-Method` | `method` | All requests |
| `Mcp-Name` | `params.name` or `params.uri` | `tools/call`, `resources/read`, `prompts/get` |

"These headers are **REQUIRED** for compliance."
(<https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http>)

**This means the skill being requested appears in the HTTP request line's headers**, so Cloud Run
request logs alone give you per-skill usage counts with no application instrumentation at all.
Servers **MUST** validate that headers match the body, so the signal is trustworthy on compliant
clients. On older clients the headers are absent and you fall back to body parsing at the core.

Additional signals available per-request without sessions:

- `io.modelcontextprotocol/clientInfo` in `_meta` — "Clients SHOULD identify themselves on each
  request" — gives you client name and version, i.e. which agents are pulling which skills.
- OpenTelemetry trace context is now a documented `_meta` convention (`traceparent`, `tracestate`,
  `baggage`, SEP-414 — changelog minor change 2).
- Microsoft Learn's trick (§4.3) of putting a self-describing correlation token in the session
  header is available if you want request grouping without server state.

---

## 7. Recommendation

### 7.1 Primitive: tools for retrieval, resources as a mirror

**Expose a small, fixed set of tools as the retrieval surface. Additionally register skills as
`skill://` resources.** Not either/or.

Why tools carry retrieval:
1. **Reach** — 114/114 clients vs 47/114; the misses include ChatGPT, Cursor, Gemini CLI,
   Windsurf, JetBrains (§1.6a).
2. **Model visibility** — resources are spec-designated application-driven, and even Claude Code
   routes the model's autonomous path through synthesised tools (§1.6b).
3. **Search is impossible via resources** — no `resources/search` exists in the schema (§2.1).
4. **The Claude API sees tools only** (§1.6c).
5. **5/5 of the prior art chose tools**, including AWS's skills-serving `retrieve_skill` (§4.6).
6. **Telemetry means something** (§6.1).
7. **The tool-count objection doesn't bite** at 2–3 tools, far below the 30–50 threshold (§2.4).

Why the resource mirror is still worth ~a day of work:
- It is where SEP-2640 and the Skills WG are heading (§1.2), and mirroring costs almost nothing
  once the `skill://` URI scheme is the internal identifier anyway.
- It makes skills selectable in picker UIs (Claude Code `@`-mention, VS Code, Claude Desktop),
  which is a genuine human-facing affordance the tools path does not provide.
- Mintlify does exactly this — resources for skill files, tools for retrieval (§4.5).
- If the WG's direction ratifies, you are already compliant.

**Adopt `skill://<area>/<name>/SKILL.md` as the canonical identifier now**, regardless. It costs
nothing, matches the repo layout, and is the one piece of the draft SEP that is safe to bet on.

**Skip prompts in v1.** Only 43/114 clients support them and they are user-invoked, which is the
wrong control model for mid-task retrieval. Reconsider later for a small number of
deliberately human-triggered workflows — Cloudflare's single `workers-prompt-full` is the model.

### 7.2 Discovery: one search tool + one fetch tool

```
search_skills(query, area?, limit?)  → ranked [{ uri, name, description, when_to_use }]
get_skill(uri, file?)                → SKILL.md, or a named sub-file (FIELD-REVIEW.md, evals/…)
```

- **Not one tool per skill** — collides with the 30–50 accuracy limit as the library grows, and
  nobody in the prior art does it (§2.2, §2.4).
- **Not a resource listing** — no server-side search is possible (§2.1).
- Return `uri` values as `skill://…` so the tool path and the resource mirror share identifiers.
- Follow AWS on **batched reads and explicit offset pagination** if `SKILL.md` files get long
  (§4.4); follow Cloudflare on declaring an `outputSchema` so results come back structured (§4.2).
- Consider one zero-argument always-read tool if a single meta-skill should be read unprompted —
  Cloudflare's pattern (§4.2).

**Invest disproportionately in prose.** The `instructions` field on `server/discover` is the
highest-leverage thing a hosted server controls: it is what the skills WG found fixed models
ignoring skills (§1.4), it is how Microsoft Learn sequences its three tools (§2.3), and under
Claude Code's tool search it is what loads at session start (§2.4). **Budget ≤2KB for
`instructions` and ≤2KB per tool description** (Claude Code truncation limit). Include an explicit
call budget, as Context7 does.

Surfacing `FIELD-REVIEW.md` as a named sub-file rather than inlining it fits the two-step shape
well — the agent pulls the critical record only when it is actually about to rely on the skill.

### 7.3 Auth: anonymous, and it is sanctioned

**Ship `/mcp` with no authorization.** "Authorization is **OPTIONAL** for MCP implementations"
(§3.1); with no user accounts, OAuth would exist only to distinguish nobody from nobody. All five
production docs servers are anonymous and clients tolerate it (§3.2).

Consequences to handle:
- **Rate limit** — required by the spec independently of auth, and the only abuse control you
  have (§3.4). Follow AWS's framing: no auth, but rate limited.
- **Validate `Origin`, return 403 on invalid** — a `MUST`, unrelated to auth (§3.4).
- **Deploy with `--allow-unauthenticated`**, knowingly departing from Google's documented default
  of IAM + local proxy, which would defeat the distribution goal (§5.1).
- If per-user scoping or private skills ever arrive, **add a second `/authed/mcp` path** rather
  than gating the public one — Mintlify's split (§3.3).

### 7.4 Cloud Run shape for v1

- **Stateless, no sessions.** `createMcpHandler` already holds nothing between requests (§0.3).
  Never keep an in-memory session map — affinity is best-effort (§5.2).
- **JSON responses, no SSE.** Spec-sanctioned in every revision, and required in `2026-07-28`
  (§5.3). AWS ships this in production.
- **`405` on GET and DELETE**; ignore any `Mcp-Session-Id`.
- **Speak `2025-11-25` (and ideally `2025-06-18`) on the wire**, not just `2026-07-28` — the
  installed base is behind (§0.2, §4). `@modelcontextprotocol/server-legacy` exists for this.
- **Populate `ttlMs` and `cacheScope: "public"` aggressively.** Required anyway, and the single
  biggest lever on staying inside the free tier (§5.5).
- **No `--min-instances`** initially; accept cold starts. Startup CPU boost is on by default.
- **Telemetry from `Mcp-Method` / `Mcp-Name` headers plus `clientInfo`** (§6.2), which needs no
  session and survives the stateless design.

### 7.5 What would change this recommendation

- **SEP-2640 merging and clients shipping real resource support.** Watch
  <https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2640> and the WG board.
- **A `resources/search` primitive appearing.** That would remove the strongest argument for
  tools. Nothing suggests it is coming.
- **Client resource support crossing ~80%.** The deleted matrix means this is now hard to measure
  — which is itself a reason to prefer the primitive with 100% support.

---

## 8. Where the evidence is thin

Stated plainly, because this feeds an architecture decision.

1. **The 114-client matrix is dated 2026-05-26, community-maintained, and has since been
   deleted** — plausibly for accuracy reasons. The 100%-tools / ~41%-resources *ratio* is
   corroborated independently by the prior art and by the WG's own remark that clients "all went
   for 'tools'". Individual client rows may be stale.
2. **"Most deployed clients still speak `2025-11-25` or earlier" is inferred, not confirmed.** The
   SDK blog said so a week before the spec went final; I found nothing superseding it. Live probes
   of five servers corroborate but measure servers, not clients.
3. **Whether claude.ai auto-surfaces resources to the model, or only via a picker, is
   undocumented.** This is the single most load-bearing unknown for the resource-mirror half of
   the recommendation.
4. **Microsoft Learn has no public source** — its tool shape rests on live probe plus README.
5. **Cloud Run free-tier region eligibility is unverified** (pricing page truncated on fetch). The
   request-based-billing restriction is confirmed; a tier-1-region restriction is neither
   confirmed nor ruled out.
6. **No Google doc addresses MCP session state on Cloud Run at all.** Both first-party MCP pages
   were read in full. The statelessness argument here is assembled from the MCP spec, the SDK
   source, and the session-affinity doc — not from Google saying it about MCP.
7. **No first-party guidance exists on resource counts or resource context cost.** All numeric
   guidance (30–50 tools, ~55k tokens) is tool-centric, so the "too many resources" question is
   genuinely unanswered.
8. **"Tool Filtering WG" could not be confirmed as chartered** — it appears only as a passing
   example with no charter page.
9. **SEP-2640's normative text was not read line by line.** Its shape is taken from the WG charter,
   the `experimental-ext-skills` design docs, and the PR's metadata. The 63KB draft at
   `docs/sep-draft-skills-extension.md` in that repo is the authoritative text if the resource
   mirror is pursued seriously.
