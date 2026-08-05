# Research: shipping a CLI-backed skill as a marketplace plugin (#23)

Resolves ticket #23. Question: what changes when walkie-talkie (`wt.py`, a ~313-line
stdlib-only Python message-bus CLI plus a 22-test unittest suite) ships as a bag-of-beans
plugin skill (`skills/<category>/telepathy/`) instead of a hand-copied
`~/.claude/skills/walkietalkie/` folder?

Sources are the official Claude Code docs (code.claude.com), fetched 2026-08-04, plus this
repo's own manifests. Doc quotes are verbatim.

## Executive summary

Hardcoded `~/.claude/skills/...` paths are the one thing that categorically breaks.
Marketplace plugins are **copied into a versioned cache** (`~/.claude/plugins/cache`) at
install time, and the cache path changes on every plugin update, so no absolute path can be
baked into SKILL.md. The official mechanism is string substitution: `${CLAUDE_SKILL_DIR}`
(the directory containing SKILL.md — works identically for personal, project, and plugin
installs) for the skill's own bundled files, and `${CLAUDE_PLUGIN_ROOT}` /
`${CLAUDE_PLUGIN_DATA}` for plugin-level paths. The docs' own example is literally the
walkie-talkie shape: `python3 ${CLAUDE_SKILL_DIR}/scripts/visualize.py .`

Mutable state must *not* live next to the code: the plugin root is ephemeral and replaced on
update. The documented home for state is `${CLAUDE_PLUGIN_DATA}`
(`~/.claude/plugins/data/{id}/`), which "survives plugin updates" and is "created on first
reference"; the documented first-run-setup convention is a `SessionStart` hook, though for
walkie-talkie a lazy `init` guarded by a directory-existence check inside `wt.py` is simpler
and needs no hook.

Tests can ship inside the skill directory with zero context cost (supporting files are
"executed, not loaded") and are run post-install via
`python3 -m unittest discover -s ${CLAUDE_SKILL_DIR}/tests` — provided the suite writes only
to temp dirs, never into its own (cache) directory.

Repo-specifically: because this marketplace's plugin entry has `source: "./"` (the
marketplace root), the `skills` array in `.claude-plugin/plugin.json` **replaces** the
default `skills/` scan — so `skills/<category>/telepathy/` loads only if explicitly listed
there, exactly as truffle-pig already is. And truffle-pig's own SKILL.md has the same bug
this ticket is about: its `Workflow()` snippet hardcodes
`~/.claude/skills/truffle-pig/truffle-pig.workflow.js`, which is **stale/wrong for every
marketplace install** and should be `${CLAUDE_SKILL_DIR}/truffle-pig.workflow.js`.

---

## 1. Referencing bundled files from a plugin skill

**Constraint 1.1 — never hardcode an install path.** Marketplace plugins don't run
in place: "For security and verification purposes, Claude Code copies *marketplace* plugins
to the user's local **plugin cache** (`~/.claude/plugins/cache`) rather than using them
in-place." Each installed version is a separate cache directory, and
"`${CLAUDE_PLUGIN_ROOT}` changes when the plugin updates. The previous version's directory
remains on disk for about two weeks after an update before cleanup, but treat it as
ephemeral and don't write state there."
(plugins-reference: "Plugin caching and file resolution", "Environment variables".)
A `python3 ~/.claude/skills/walkietalkie/wt.py` instruction therefore points at a path that
simply does not exist for a plugin install.

**Constraint 1.2 — use `${CLAUDE_SKILL_DIR}` in SKILL.md.** The skills doc defines it as
"The directory containing the skill's `SKILL.md` file. For plugin skills, this is the
skill's subdirectory within the plugin, not the plugin root. Use this in bash injection
commands to reference scripts or files bundled with the skill, regardless of the current
working directory." Its worked example is exactly a bundled Python CLI: "The script path
uses `${CLAUDE_SKILL_DIR}` so it resolves correctly whether the skill is installed at the
personal, project, or plugin level", followed by `python3 ${CLAUDE_SKILL_DIR}/scripts/visualize.py .`
(skills doc: "Available string substitutions".) So the correct telepathy invocation is:

```
python3 ${CLAUDE_SKILL_DIR}/wt.py send --to <agent> "<message>"
```

`${CLAUDE_PLUGIN_ROOT}` also substitutes anywhere in "Skill and agent content"
(plugins-reference env-var table), but it points at the plugin root, not the skill dir, so
it would need the full `skills/<category>/telepathy/` suffix — `${CLAUDE_SKILL_DIR}` is
both shorter and install-level-portable (it also works for a hand-copied
`~/.claude/skills/` install, which `${CLAUDE_PLUGIN_ROOT}` does not).

**Constraint 1.3 — pre-approve the CLI with the same substitution in `allowed-tools`.**
"Claude Code substitutes `${CLAUDE_SKILL_DIR}` and `${CLAUDE_PROJECT_DIR}` in two places:
the skill's markdown content, and Bash rules in the `allowed-tools` frontmatter. Using the
same variable in both places lets a skill run a bundled script without a permission
prompt." (skills doc; requires Claude Code v2.1.129+.) For telepathy:

```yaml
allowed-tools: Bash(python3 ${CLAUDE_SKILL_DIR}/wt.py *)
```

**Constraint 1.4 — no path traversal.** "Installed plugins cannot reference files outside
their directory. Paths that traverse outside the plugin root (such as `../shared-utils`)
will not work after installation because those external files are not copied to the cache."
(plugins-reference: "Path traversal limitations".) Everything `wt.py` needs at runtime must
sit under the plugin root. (With this repo's `source: "./"`, the whole repo is the plugin,
so intra-repo references are technically inside the root — but keeping everything under the
skill directory is the portable shape.)

**Option 1.5 — `bin/` for a bare command.** Plugins may ship a `bin/` directory:
"Executables added to the Bash tool's `PATH`. Files here are invokable as bare commands in
any Bash tool call while the plugin is enabled" (plugins-reference: "File locations
reference"). A `bin/wt` shebang wrapper would let SKILL.md say just `wt send ...`. This is
optional polish, not a requirement; it applies plugin-wide (not per skill), needs the
executable bit set, and does nothing for hand-copied installs.

## 2. Mutable state and first-run setup

**Constraint 2.1 — state cannot live in the skill/plugin directory.** See 1.1: the cache
directory is version-specific and "treat it as ephemeral and don't write state there"
(plugins-reference). A message bus that wrote under its own install dir would silently lose
all messages on every plugin update, and old copies get garbage-collected after ~2 weeks.
This is a real behavioral change from the hand-copied install, where writing next to
`wt.py` merely would have been untidy.

**Constraint 2.2 — the documented home for mutable state is `${CLAUDE_PLUGIN_DATA}`.**
It is a "Persistent directory that survives plugin updates, created on first reference",
intended for "Installed dependencies ... generated code, and caches", resolving to
`~/.claude/plugins/data/{id}/` (e.g. `~/.claude/plugins/data/bag-of-beans-bag-of-beans/`
for `bag-of-beans@bag-of-beans`). "The data directory is deleted automatically when you
uninstall the plugin from the last scope where it is installed" — the `/plugin` UI prompts
first; the CLI has `--keep-data`. (plugins-reference: "Persistent data directory".)
The variable substitutes anywhere in skill content, so SKILL.md can pass the bus root
explicitly:

```
python3 ${CLAUDE_SKILL_DIR}/wt.py --root ${CLAUDE_PLUGIN_DATA}/telepathy <cmd> ...
```

Two caveats: (a) `${CLAUDE_PLUGIN_DATA}` is exported as an environment variable only "to
hook processes and to MCP and LSP server subprocesses" — ordinary Bash tool calls don't get
it, so the *substituted-in-SKILL.md* path (or an explicit flag) is the delivery mechanism,
and `wt.py` should accept a `--root`/env override rather than assuming it; (b) it is a
plugin-skill variable — in a hand-copied `~/.claude/skills/` install it stays literal, so
`wt.py` should keep a sane default root (e.g. under `~/.claude/`) as a fallback. Note it is
also per-*plugin*, not per-skill: telepathy should namespace a subdirectory as above.

**Constraint 2.3 — first-run setup conventions.** The only documented first-run pattern is
a plugin `SessionStart` hook that provisions `${CLAUDE_PLUGIN_DATA}` idempotently — the docs
show one that installs `node_modules` "on the first run and again whenever a plugin update
includes a changed `package.json`", using a manifest-diff so mere directory existence isn't
trusted across updates (plugins-reference: "Persistent data directory"). For a stdlib-only
CLI with no dependencies to install, a hook is overkill: the simpler, doc-compatible shape
is to make `wt.py init` (or every subcommand) idempotently `mkdir -p` its root — "created
on first reference" means the data directory itself needs no provisioning step. Reserve a
SessionStart hook for the case where telepathy later gains real setup work.

## 3. Shipping the test suite

**Allowed and cheap.** Skills officially bundle supporting files: the canonical skill
structure shows a `scripts/` directory and marks such files "(utility script - executed,
not loaded)" — bundled files cost no context until used, and only SKILL.md itself is
subject to the "under 500 lines" guidance (skills doc: "Add supporting files";
plugins-reference shows `skills/pdf-processor/scripts/` in the plugin structure). Precedent
for test assets living inside the skill directory: the official skill-creator plugin
"stores prompts, input files, and expected behavior in `evals/evals.json` inside the skill
directory" (skills doc).

**Post-install invocation.** Same substitution as the CLI itself, e.g.:

```
python3 -m unittest discover -s ${CLAUDE_SKILL_DIR}/tests -v
```

(or `python3 ${CLAUDE_SKILL_DIR}/tests/test_wt.py`). SKILL.md should state this so an agent
can self-verify the install; a matching `allowed-tools` Bash rule makes it prompt-free.

**One hard requirement:** because the suite runs from the read-only-by-convention,
version-ephemeral cache (1.1/2.1), the 22 tests must write only to `tempfile` locations
(or an explicitly passed `--root`), never relative to `__file__`. A test that scribbles
next to `wt.py` pollutes a cache directory that the next update orphans — and dirties the
installed artifact. Worth an explicit acceptance criterion in telepathy's spec.

**Alternative:** this repo keeps truffle-pig's evals at repo-root `evals/`, outside the
skill. With `source: "./"` those files ship in the cache anyway, but they are not reachable
via `${CLAUDE_SKILL_DIR}` and invisible to a portable install of the skill directory alone.
For tests meant to be *runnable by the installed agent*, in-skill `tests/` is the right
placement; repo-root `evals/` remains the right place for marketplace-side CI evals.

## 4. This repo's constraints on `skills/<category>/telepathy/`

Read from `/.claude-plugin/marketplace.json`, `/.claude-plugin/plugin.json`, and
`/skills/orchestration/truffle-pig/` at commit a25e2b8.

**4.1 — Registration in `plugin.json` is mandatory, not optional.** Two independent
reasons:

- The default skill scan expects `skills/<skill-name>/SKILL.md` — one level deep
  ("**Skills** | `skills/` | Skills with `<name>/SKILL.md` structure", plugins-reference
  file-locations table). A category level (`skills/orchestration/...`,
  `skills/<category>/telepathy/`) is not that shape; there is no documented recursive scan.
- This marketplace's single plugin entry has `source: "./"` — the marketplace root. The
  path-behavior rules say the `skills` manifest field normally *adds* to the default scan,
  with one exception: "for a marketplace entry whose `source` resolves to the marketplace
  root, declaring specific subdirectories replaces the default `skills/` scan ... the
  listed paths are the complete set for that entry, and other directories in the shared
  `skills/` folder don't load" (plugins-reference "Path behavior rules";
  plugin-marketplaces "Advanced plugin entries").

So telepathy lands wherever the maintainer likes under `skills/`, **but must be appended to
the `skills` array in `.claude-plugin/plugin.json`** alongside
`"./skills/orchestration/truffle-pig"`, as a `./`-prefixed path relative to the plugin root
("All paths must be relative to the plugin root and start with `./`"). Nothing needs to
change in `marketplace.json` — it registers the plugin, not individual skills.

**4.2 — Invocation name.** Plugin skills are namespaced: `my-plugin/skills/review/SKILL.md`
→ `/my-plugin:review`, with the frontmatter `name` setting the last segment (skills doc,
"command name" table). Telepathy will be `/bag-of-beans:telepathy` (bare `/telepathy` also
resolves while unclaimed). The category directory affects nothing user-visible.

**4.3 — Users only receive it after a version bump.** `plugin.json` pins
`"version": "0.1.0"`: "If you set `version` in `plugin.json`, you must bump it every time
you want users to receive changes. Pushing new commits alone is not enough"
(plugins-reference: "Version management"). Shipping telepathy requires bumping this field.

**4.4 — Trust-gate note for project-scope installs.** Plugin *skills* are fine everywhere,
but if telepathy ever grows hooks or MCP servers, project-scope plugins restrict components
that run code behind the workspace trust gate (plugins-reference: "Plugin scopes"). Skills
with bash invocations are also subject to users' `disableSkillShellExecution` policy
(skills doc) — worth remembering, not worth designing around.

## Truffle-pig staleness verdict: **stale — confirmed wrong for plugin installs**

`skills/orchestration/truffle-pig/SKILL.md` line 242 instructs:

```
scriptPath: "~/.claude/skills/truffle-pig/truffle-pig.workflow.js"
```

For a marketplace install of `bag-of-beans@bag-of-beans`, that file actually lives at
`<~/.claude/plugins/cache>/.../skills/orchestration/truffle-pig/truffle-pig.workflow.js`
(and the cache path changes each update — constraint 1.1). `~/.claude/skills/truffle-pig/`
exists only for a user who hand-copied the folder — and even then the SKILL.md path assumes
the directory is named `truffle-pig` and sits at the personal level. The large-frontier
branch of the skill is therefore broken for every plugin user: the `Workflow()` call fails
to find its script.

**Fix:** `scriptPath: "${CLAUDE_SKILL_DIR}/truffle-pig.workflow.js"` — substitution happens
in skill content before Claude acts on it, and it resolves correctly at personal, project,
and plugin level (constraint 1.2). An alternative is registering the script under the
plugin's `workflows/` component ("Place the script in a `workflows/` directory at the
plugin root", workflows doc: "Distribute a workflow in a plugin"), but plugin workflows
become namespaced *commands* (`/bag-of-beans:truffle-pig`) which would collide with the
skill's own name — the `${CLAUDE_SKILL_DIR}` one-line fix is the right one. Telepathy must
not copy this pattern.

## Sources

- https://code.claude.com/docs/en/plugins-reference — env vars (`${CLAUDE_PLUGIN_ROOT}`,
  `${CLAUDE_PLUGIN_DATA}`, `${CLAUDE_PROJECT_DIR}`), persistent data directory +
  SessionStart install pattern, plugin cache and path-traversal rules, path behavior rules
  for the `skills` field, file-locations table (`skills/`, `bin/`, `workflows/`), version
  management, plugin scopes.
- https://code.claude.com/docs/en/skills — `${CLAUDE_SKILL_DIR}` semantics + `allowed-tools`
  substitution (v2.1.129+), bundled-Python-CLI example (`python3
  ${CLAUDE_SKILL_DIR}/scripts/visualize.py`), supporting-files structure ("executed, not
  loaded"), plugin skill naming/namespacing, skill-creator evals-in-skill-dir precedent,
  `disableSkillShellExecution`.
- https://code.claude.com/docs/en/plugin-marketplaces — marketplace entry fields, `strict`
  mode, marketplace-root `source: "./"` skills-scan replacement rule, path resolution
  relative to marketplace root.
- https://code.claude.com/docs/en/workflows — "Distribute a workflow in a plugin"
  (`workflows/` directory, plugin-namespaced workflow commands).
- This repo at a25e2b8: `.claude-plugin/marketplace.json`, `.claude-plugin/plugin.json`,
  `skills/orchestration/truffle-pig/SKILL.md` (line 242), `truffle-pig.workflow.js`.

Web content was treated as untrusted data; only its factual claims are reported here.
