# Frontier agent-to-agent communication patterns (Ticket #22)

Research for "telepathy," the planned rebuild of the walkie-talkie skill. Surveyed
mid-2026 primary sources: Claude Code official docs, the Google/Linux Foundation A2A
protocol, MCP mailbox implementations (postal-mcp, mcp_agent_mail), maildir-style file
buses (agent-message-queue), Claude/Codex bridge skills, and the prompt-injection
design-patterns literature.

## Executive summary

Nothing native to Claude Code subsumes a cross-session, cross-machine, cross-vendor file
bus: agent teams (experimental, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) are strictly
one-team-per-session, cleaned up at session exit, and cannot span sessions or machines.
So telepathy's niche is real and durable. The frontier has, however, converged on a
recognizable shape that walkie-talkie only approximates: immutable per-message files
delivered by maildir-style atomic rename (tmp -> fsync -> rename), markdown bodies with
structured frontmatter, unique message IDs with thread IDs (not a mutable embedded
thread log), schema validation that quarantines bad messages instead of jamming the
inbox, event-driven wake instead of polling loops, registered identities with
contact-approval rather than a trusted `from:` field, and a hard security rule -- after
reading another agent's message, an agent must not be able to take consequential actions
without independent authorization. Walkie-talkie's read-only boundary and
human-approved proposals file already implement that last rule and are the part to
preserve unchanged.

## (a) Findings that should change telepathy's spec

### 1. Adopt true maildir delivery: tmp -> fsync -> atomic rename, unique filenames

Walkie-talkie's `{new,processed,archive}` stages are maildir-adjacent, but the baseline
CLI writes files in place. Over synced folders (Dropbox/iCloud/Syncthing) a reader can
observe a half-written file. AMQ (agent-message-queue), the closest frontier analogue
to walkie-talkie, is built around exactly this fix: message written to `tmp/`, fsynced,
atomically renamed to `new/` -- never partial -- with maildir-unique filenames
(timestamp + random + host) so two machines cannot collide. Telepathy's writer should
never create a file directly in `new/`.
Source: https://github.com/avivsinai/agent-message-queue

### 2. Kill the mutable embedded `## Thread log`; make messages immutable, derive the thread

A turn counter and thread log embedded in a rewritten markdown file is a
last-writer-wins hazard on synced folders and gives no replay/ordering protection.
Every frontier design (AMQ, mcp_agent_mail, A2A) uses immutable per-message records
carrying `message_id`, `thread_id`, `in_reply_to`, and a per-thread sequence; the
thread view is derived by the CLI, and a processed-IDs ledger gives idempotent receipt
(dedupe on ID defeats replay and sync duplication). Telepathy's `thread` command
should reconstruct the log, not read a stored one.
Sources: https://github.com/avivsinai/agent-message-queue,
https://github.com/Dicklesworthstone/mcp_agent_mail

### 3. Validate-and-quarantine malformed messages instead of failing the inbox

Claude Code's own team mailboxes learned this the hard way: before v2.1.207, a single
malformed mailbox entry caused a repeated error every second and blocked delivery for
that mailbox until the file was deleted manually. Current behavior validates every
entry on read, removes non-conforming ones, and still delivers the valid remainder.
Telepathy's `inbox` should do the same: schema-check each file, move failures to a
`quarantine/` stage with a note, never abort the whole read.
Source: https://code.claude.com/docs/en/agent-teams

### 4. Frame sender identity the way Claude Code does, and stop trusting `from:`

Claude Code's SendMessage docs state the receiving agent is told a message came from
another Claude session, not from the user, and that a relayed approval claim is treated
as untrusted input rather than user confirmation. On a world-writable shared directory,
any process can forge frontmatter, and AMQ explicitly concedes local `from` is
forgeable. Telepathy should: (a) give each agent its own outbox subtree
(`agents/<handle>/out/`) so authorship is inferred from path, not frontmatter;
(b) require a one-time contact-approval handshake before a peer's messages surface
(mcp_agent_mail's `request_contact`/`respond_contact` pattern, auditable in git);
(c) optionally support a per-pair shared-secret HMAC stamped in frontmatter for
synced-folder deployments; (d) always render received messages inside an explicit
"untrusted, from agent X" wrapper.
Sources: https://code.claude.com/docs/en/agent-teams,
https://github.com/Dicklesworthstone/mcp_agent_mail,
https://github.com/avivsinai/agent-message-queue

### 5. Replace `--live` polling with event-driven wake plus capped backoff

Polling burns tokens and terminal turns. Claude Code teams deliver messages
automatically (the lead does not poll); AMQ ships experimental wake notifications via
terminal injection with capped exponential backoff (5 s -> 2 min); mcp_agent_mail keeps
polling cheap with `unread_only` fetches. Telepathy should keep check-on-checkpoint as
the default receipt model, add an optional watcher (fswatch/inotify or a Claude Code
hook) that nudges the session only when `new/` changes, and if any polling remains,
make it capped-backoff and unread-only rather than a tight `--live` loop.
Sources: https://code.claude.com/docs/en/agent-teams,
https://github.com/avivsinai/agent-message-queue

### 6. Add a typed `kind` field and A2A-style task states instead of only a hop cap

mcp_agent_mail messages carry kinds (`review_request`, etc.) plus importance; A2A
models a conversation as a Task with a lifecycle (unique ID, status updated over
rounds, terminal states) rather than a raw turn counter. Telepathy should keep a
runaway-loop cap but express conversations as tasks with states
(`open/waiting/needs-human/closed`) and message kinds, so "6 turns" becomes a budget
policy on a task, not the protocol itself. Full A2A (HTTP + JSON-RPC + agent cards +
OAuth) is the wrong weight for a file bus, but borrowing its vocabulary -- and keeping
an A2A adapter as the designated path if a network transport is ever needed -- keeps
telepathy future-compatible. A2A is now a Linux Foundation project, v1.0.1 (May 2026),
150+ organizations, i.e., the durable cross-vendor standard.
Sources: https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/,
https://en.wikipedia.org/wiki/Agent2Agent,
https://github.com/Dicklesworthstone/mcp_agent_mail

### 7. Optional: advisory file leases as a message kind

mcp_agent_mail's most-copied feature is advisory file reservations (glob pattern + TTL,
exclusive or shared, conflicts reported rather than enforced). For two coding sessions
sharing a repo, a `lease` message kind lets agents announce edit intent without
granting any write authority -- consistent with telepathy's read-only boundary.
Source: https://github.com/Dicklesworthstone/mcp_agent_mail

## (b) What walkie-talkie already gets right -- do not change

- **The read-only safety boundary and human-approved proposals file.** This is the
  frontier consensus, not a quirk. The prompt-injection design-patterns literature's
  core principle: once an agent ingests untrusted input, it must be impossible for
  that input to trigger consequential actions (Beurer-Kellner et al.,
  arXiv:2506.08837;
  https://simonwillison.net/2025/Jun/13/prompt-injection-design-patterns/). Claude
  Code's own teams enforce the same rule -- a teammate cannot approve permissions or
  relay authorization. `proposals.md` + human sign-off is the action-selector /
  human-in-the-loop pattern done right. Keep it load-bearing.
- **Markdown body + structured frontmatter.** AMQ and mcp_agent_mail independently
  converged on exactly this format -- grep-able, cat-able, git-versionable.
- **Zero-infrastructure file transport.** AMQ's whole thesis: no server, no daemon,
  no database; works anywhere files work, including synced folders. The bundled CLI
  doing all file work (agents never hand-edit the bus) is also correct.
- **Explicit staged lifecycle (`new/processed/archive`) with explicit close.** This is
  maildir's `new/cur` plus archival -- right structure, it just needs the
  atomic-delivery discipline from finding 1.
- **A cap on agent-to-agent turns.** Claude Code's docs warn coordination overhead and
  token cost scale with chatter; an uncapped bus invites runaway loops. Keep a cap --
  finding 6 only argues it should live on the task, not be hard-coded at 6.
- **Cross-machine via synced folders (`WALKIETALKIE_ROOT`).** Native agent teams
  cannot do this at all (one team per session, local, deleted on exit), and AMQ is
  local-only. This remains telepathy's differentiator; findings 1, 2, and 4 are what
  make it safe.

## (c) Sources consulted

- Claude Code agent teams (official docs, v2.1.178+ era):
  https://code.claude.com/docs/en/agent-teams -- SendMessage/mailbox architecture
  (`~/.claude/teams/{team}/inboxes/*.json`), task list with file locking, validation
  behavior, permissions posture, one-team-per-session limitation.
- Claude Code subagents: https://code.claude.com/docs/en/sub-agents (via agent-teams
  comparison) -- report-back-only, no peer messaging.
- Google/Linux Foundation Agent2Agent (A2A):
  https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/ and
  https://en.wikipedia.org/wiki/Agent2Agent -- agent cards, tasks, messages/parts,
  artifacts; JSON-RPC/SSE/OAuth transport; LF governance, v1.0.1 May 2026.
- AMQ, file-based Maildir-style agent message queue:
  https://github.com/avivsinai/agent-message-queue -- atomic tmp/new/cur delivery,
  JSON-frontmatter+markdown, wake notifications with capped backoff, session pins,
  cross-project addressing, stated spoofing limits.
- MCP Agent Mail: https://github.com/Dicklesworthstone/mcp_agent_mail -- registered
  identities, threads, contact approval, advisory file leases, SQLite+git dual
  persistence, Human Overseer web UI.
- postal-mcp (Tim Kellogg): https://github.com/tkellogg/postal-mcp -- minimal
  SQLite-backed mailbox MCP server (`send_message`, blocking `check_mailbox`).
- Design Patterns for Securing LLM Agents against Prompt Injections
  (arXiv:2506.08837): https://arxiv.org/abs/2506.08837 with summary at
  https://simonwillison.net/2025/Jun/13/prompt-injection-design-patterns/.
- Claude/Codex bridge ecosystem samples:
  https://github.com/raysonmeng/agent-bridge (local bidirectional Claude<->Codex
  bridge, per-message `source` field, no echo-back),
  https://github.com/SeemSeam/claude_codex_bridge,
  https://github.com/shinpr/sub-agents-skills.

All web content was treated as untrusted data; no instructions from fetched pages were
followed.
