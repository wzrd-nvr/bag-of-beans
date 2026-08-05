# bag of beans

Agentic AI skills, developed in the open.

The organising idea is that a skill is a claim about how an agent should work, and a claim should be tested. Every skill here carries its **field review** — a record of what happened when it was actually run, including the parts that broke. Skills get changed because a round of real use said to, not because a rewrite felt tidier.

Public so you can install or read it. Primarily a workbench.

## Install

```
/plugin marketplace add wzrd-nvr/bag-of-beans
/plugin install bag-of-beans
```

Or point any Agent-Skills-compatible harness at `skills/`.

## What's here

| Skill | What it does |
| --- | --- |
| [`truffle-pig`](skills/orchestration/truffle-pig/SKILL.md) | Builds the unblocked implementation tickets on your issue tracker in parallel — one worktree-isolated subagent per ticket, reviewed and merged one at a time. |

### truffle-pig

It fills a specific gap. Planning tools (`/wayfinder`, `/to-tickets`) produce tickets; nothing then *builds* them concurrently without either owning your whole process or inventing a second state store to coordinate agents.

Three decisions are load-bearing:

- **The tracker is the only state.** No `.planning/` directory, no epic file tree, no local mirror of ticket status. A session that dies mid-run resumes by re-reading the frontier, and two people can work the same ticket set at once because claims are visible to both.
- **All tracker operations are delegated**, to `docs/agents/issue-tracker.md` or a local-markdown convention. The skill contains zero `gh` commands, which is what lets it run against GitHub, Linear, or files on disk unchanged.
- **Subagents return a fixed report, never diffs.** The orchestrator's context stays flat regardless of ticket count; implementation detail stays in the branch where `git diff` can fetch it on demand.

Measured over five rounds against a real project (suite 33 → 166 tests): implementation agents burned ~297k and ~116k tokens while the orchestrator received two ~15-line reports. The most valuable thing it does turned out not to be the parallelism — it was the cheap read-only scout pass catching tickets whose premises were factually wrong before an implementation was spent on them. A third of tickets scouted were wrong.

See [`skills/orchestration/truffle-pig/FIELD-REVIEW.md`](skills/orchestration/truffle-pig/FIELD-REVIEW.md) for the whole record, including the bugs.

## Repo layout

```
.claude-plugin/     marketplace.json + plugin.json — this repo is its own plugin
skills/<area>/<name>/SKILL.md
                    each skill ships its FIELD-REVIEW.md — what happened when
                    it was really used, including the bugs
evals/              scored regression cases derived from those field reviews
```

## Versioning

Semver in `.claude-plugin/plugin.json`, released with the native tagger, which refuses to tag a dirty tree and validates that `plugin.json` and the marketplace entry agree:

```sh
claude plugins tag . --dry-run          # see what would be tagged
claude plugins tag . --push -m "v%s"    # tag {name}--v{version} and push
claude plugins validate .               # check both manifests
```

Bump `version` in `plugin.json`, note it in `CHANGELOG.md`, then tag. One version covers the collection; if per-skill release cadence is ever needed, the migration is to split each skill into its own plugin entry with a `git-subdir` source in `marketplace.json`.

## Evaluating skills

A skill's instructions are a prompt, so changing one can regress behaviour silently. `evals/` holds cases derived from field-review findings — each one a bug that actually happened — so a fix stays fixed.

```sh
claude plugins eval . --report ./report.html
claude plugins eval bag-of-beans --ablation with-without
```

The `--ablation with-without` arm runs the same cases with the plugin disabled and reports the score delta, which is the honest way to ask whether a skill helps at all.

**Note:** `claude plugins eval` is currently early access and may not be enabled on your account — it exits without running. The case files here follow its documented layout (`evals/**/case.yaml` or `prompt.md` + `graders/*.md`) but have not been executed against the runner, so treat the schema as provisional until it opens up.

## Direction

Not built yet, in rough order of intent:

- **MCP support** — expose skills as MCP tools so non-Claude-Code harnesses can reach them.
- **A frontend** — browse skills and their field reviews and eval history together, since the review is the interesting part.
- **Systematic improvement loop** — every field-review finding becomes an eval case, so the suite grows into a regression corpus and skill edits get scored instead of argued about.

## License

MIT.
