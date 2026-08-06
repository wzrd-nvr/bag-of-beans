# research

Findings from research tickets, one directory per ticket.

These are the evidence behind decisions recorded on the tracker. A closed
research ticket carries a summary; the summary is the claim, and the file here
is what the claim rests on — sources, what was measured, what was checked and
found false, and what could not be established. Read the ticket to know what was
decided. Read the file here to know whether to believe it.

Nothing in this directory is a plan or a spec. It is dated, it goes stale, and
several of these files say so about themselves. Every pricing figure, protocol
revision and client-support number was true on the date at the top of the file
and should be re-checked before it is acted on.

| directory | ticket | subject |
|---|---|---|
| `mcp-hosting-patterns/` | [#7](https://github.com/wzrd-nvr/bag-of-beans/issues/7) | MCP patterns for serving a hosted skill library |
| `gcp-hosting-options/` | [#8](https://github.com/wzrd-nvr/bag-of-beans/issues/8) | GCP hosting and event landing under scale-to-zero |
| `mcp-observability/` | [#9](https://github.com/wzrd-nvr/bag-of-beans/issues/9) | What a hosted MCP server can observe, and how outcome gets back |
| `a2a-frontier-patterns/` | [#22](https://github.com/wzrd-nvr/bag-of-beans/issues/22) | Frontier agent-to-agent communication patterns |
| `plugin-cli-packaging/` | [#23](https://github.com/wzrd-nvr/bag-of-beans/issues/23) | Shipping a CLI-backed skill as a marketplace plugin |

**Why these arrived late.** All five were produced by research subagents in git
worktrees under `.claude/worktrees/`, which is gitignored, and were never merged.
For three days the tickets citing them were closed while the evidence existed
only on one laptop, in a directory the repo could not see. They were landed here
on 2026-08-06. The repo's premise is that evidence belongs next to the claim, and
the repo was not honouring it.
