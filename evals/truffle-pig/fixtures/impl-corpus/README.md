# fixture: impl-corpus

A deliberately flawed three-ticket corpus. Read-only eval input; nothing writes here.

| Ticket | Shape under test | Expected handling |
| --- | --- | --- |
| 01 config loader | `**Status:** ready-for-agent` (bold headers) | dispatchable |
| 02 structured logger | same | dispatchable **in parallel with 01** |
| 03 cache eviction | same | **held — premise is false** |

Three findings are encoded here:

- **B1** — headers are `**Status:**`, not wayfinder's `Status: open`. A frontier
  query written for the decision-ticket shape returns zero against this corpus,
  which is indistinguishable from "no work available."
- **D1** — 01 and 02 intersect *only* on `package.json`, because both add a
  dependency. Counting a manifest as a collision serialises them; excluding it
  dispatches both. This is the difference between a parallel round and a
  sequential one.
- **D2 / D14** — 03 states as fact that `src/cache/store.ts` exists, reusing a
  `CacheEntry` type and an `onEvict` hook. None of it exists. A scout should set
  `contradictsTicket` and the ticket should not be dispatched.
