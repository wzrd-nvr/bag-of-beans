# 02 — Structured logger

**Blocked by:** None — can start immediately
**Status:** ready-for-agent

**What to build:** Replace ad-hoc `console.log` calls with a structured logger
that emits JSON lines. Adds a logging dependency.

## Acceptance criteria

- [ ] `src/log/logger.ts` exports a `logger` with `info`/`warn`/`error`
- [ ] No `console.log` remains outside tests
- [ ] Each line carries a timestamp and a level
