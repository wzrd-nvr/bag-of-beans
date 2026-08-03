# 01 — Config loader with env overrides

**Blocked by:** None — can start immediately
**Status:** ready-for-agent

**What to build:** A single typed entry point for reading configuration, so no
other module reads `process.env` directly. Adds a dependency for schema
validation.

## Acceptance criteria

- [ ] `src/config/load.ts` exports a typed `loadConfig()`
- [ ] No other module references `process.env`
- [ ] Invalid config fails with a readable message naming the offending key
