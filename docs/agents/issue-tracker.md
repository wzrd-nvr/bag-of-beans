# Issue tracker: GitHub

Issues and specs (PRDs) for this repo live as GitHub issues on `wzrd-nvr/bag-of-beans`. Use the
`gh` CLI for all operations; it infers the repo from `git remote -v` when run inside a clone.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body-file <path>`. Prefer `--body-file`
  over `--body` for multi-line bodies — heredocs into `--body` mangle backticks under zsh.
- **Read an issue**: `gh issue view <number> --comments`
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`
- **Comment**: `gh issue comment <number> --body "..."`
- **Label**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

## Shell note

The default shell here is **zsh**, which does not word-split unquoted variables the way bash does.
A loop over a space-separated string silently passes the whole string as one item. Use an explicit
array, `${=VAR}`, or pipe a script into `bash`. Note also that macOS ships bash 3.2, which has no
`declare -A` — associative arrays are unavailable; numeric-keyed indexed arrays still work.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: an issue labelled `wayfinder:map`, holding the Destination / Notes / Decisions-so-far /
  Not-yet-specified / Out-of-scope body. Create with `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a native GitHub **sub-issue**. Sub-issues are
  enabled on this repo and verified working:

  ```sh
  gh api --method POST repos/wzrd-nvr/bag-of-beans/issues/<map>/sub_issues \
    -F sub_issue_id=<child-db-id>
  ```

  `<child-db-id>` is the numeric **database id**, not the `#number` and not the `node_id`:
  `gh api repos/wzrd-nvr/bag-of-beans/issues/<n> --jq .id`. Child bodies also carry
  `Part of #<map>` on the first line as a human-readable backstop.

  Labels: `wayfinder:<type>` — one of `research`, `prototype`, `grilling`, `task`.

- **Blocking**: GitHub's **native issue dependencies**, verified working on this repo:

  ```sh
  gh api --method POST repos/wzrd-nvr/bag-of-beans/issues/<child>/dependencies/blocked_by \
    -F issue_id=<blocker-db-id>
  ```

  Read the live gate from `issue_dependencies_summary.blocked_by` (open blockers only):

  ```sh
  gh api repos/wzrd-nvr/bag-of-beans/issues/<n> --jq .issue_dependencies_summary.blocked_by
  ```

- **Frontier query**: the map's open sub-issues with no open blocker and no assignee:

  ```sh
  gh api repos/wzrd-nvr/bag-of-beans/issues/<map>/sub_issues --paginate \
    --jq '.[] | select(.state=="open")
             | select((.issue_dependencies_summary.blocked_by // 0) == 0)
             | select(.assignees | length == 0)
             | "#\(.number) \(.title)"'
  ```

  First in map order wins.

- **Claim**: `gh issue edit <n> --add-assignee @me` — the session's first write, before any work.
- **Resolve**: `gh issue comment <n> --body-file <answer>`, then `gh issue close <n>`, then append
  a context pointer (one-line gist + link) to the map's Decisions-so-far.

## Labels in use

| Label | Meaning |
| --- | --- |
| `wayfinder:map` | The map issue itself |
| `wayfinder:research` | AFK — resolved by a `/research` subagent |
| `wayfinder:prototype` | HITL — resolved by building something cheap to react to |
| `wayfinder:grilling` | HITL — resolved by conversation, one question at a time |
| `wayfinder:task` | Manual work that unblocks a decision, or a ship milestone |
