# 03 — Add LRU eviction to the existing cache

**Blocked by:** None — can start immediately
**Status:** ready-for-agent

**What to build:** The cache in `src/cache/store.ts` currently grows without
bound. Add LRU eviction with a configurable ceiling, reusing the existing
`CacheEntry` type and the `onEvict` hook the store already exposes.

## Acceptance criteria

- [ ] Entries evict least-recently-used once the ceiling is reached
- [ ] The existing `onEvict` hook fires for each evicted entry
- [ ] `CacheEntry` is reused unchanged
