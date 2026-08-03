# evals

A skill's instructions are a prompt. Editing one can regress behaviour with no
compile error and no failing test, and the regression looks like the agent simply
deciding differently. These cases exist so that a bug found once stays found.

**Every case traces to a finding in a skill's `FIELD-REVIEW.md`.** If a case doesn't correspond to
something that actually went wrong, it's testing an opinion.

## Running

```sh
claude plugins eval .                                   # this repo, by path
claude plugins eval bag-of-beans --ablation with-without # vs. plugin disabled
claude plugins eval . --case 'finds-*' --report ./r.html
```

`--ablation with-without` re-runs each case with the plugin off and reports the
delta. That's the only version of the question worth asking: not "did it score
well" but "did the skill change the outcome."

> **Status: unverified.** `claude plugins eval` is early access and currently
> exits without running on this account. These files follow the layout its
> `--help` documents (`evals/**/case.yaml` or `prompt.md` + `graders/*.md`) and
> the options it lists (`runs`, `model`, `max_turns`, `timeout_seconds`,
> `scaffold_script`), but nothing here has been executed against the runner.
> Expect the schema to need correcting once it opens up. The fixtures and grader
> criteria are the durable part; the YAML wrapper is the guess.

## Cases

| Case | Guards | Finding |
| --- | --- | --- |
| `frontier/finds-implementation-tickets` | Ticket-shape tolerance, manifest-only collisions, and premise-checking, all from one fixture corpus | B1, D1, D2/D14 |

## Cases worth adding next

Each of these is a thing that actually broke, so each is worth a case:

- **Refuses a decision-ticket corpus.** Pointed at a `/wayfinder` map whose tickets
  are `Type: grilling`, the skill should report that these are human-in-the-loop
  and name the missing `/to-tickets` step — not dispatch the lone `task` ticket
  and call it a wave. (B2)
- **No claim without a go-ahead.** Self-invoked rather than called explicitly, it
  should scout and stop. Any tracker write before the user agrees is a failure,
  because a claim is visible to other sessions. (Model-invocation change)
- **Stale adapter doesn't yield a false empty.** With a `docs/agents/issue-tracker.md`
  that hardcodes the wrong effort directory, it should notice the query returns
  nothing against a directory holding ready tickets, fall through, and say the
  adapter is stale. (B1 follow-up)
- **Credential refusal.** An agent whose ticket needs a live API call in a
  credential-less worktree should report it on `ENV:` and decline to fabricate the
  artifact. This one measurably changed with the instruction, so it's exactly the
  kind of thing that could silently regress. (D11, D15)

## Fixtures

`frontier/fixtures/` holds ticket corpora as read-only inputs. They are
deliberately tiny and deliberately flawed — the flaws are the point. Cases point a
prompt at a fixture path; no `scaffold_script` is needed, and nothing writes to
them.
