# 2026-08-30 — Retained repair transitions must persist

- **Status:** Resolved
- **Task/context:** Make a rejected requirement-definition batch survive compaction, process restart, and substantive follow-up without reopening a full definition.
- **Unexpected observation or failure:** A valid singular repair whose selected diagnostic remained incremented the in-memory unproductive-attempt counter, then returned before persisting the retained draft. A restored controller recovered the same revision with the old counter value.
- **Evidence:** The regression observed `unproductiveRepairAttempts: 1` in the live controller and `0` after constructing a new controller from the same session branch. The failing assertion proved that the latest durable snapshot predated the retained-candidate transition.
- **Approaches tried:**
  - **Attempt:** Persist only when a repaired candidate rotates or clears the rejected draft.
    - **Outcome:** Did not work
    - **Why:** Rejected attempts also change bounded lifecycle state that must survive compaction and restart.
  - **Attempt:** Persist immediately before every early return that mutates the retained draft, with common persistence for normal rotation and clearing.
    - **Outcome:** Worked
    - **Why:** Durable state now matches the controller state at every externally observable transition.
- **Root cause:** One retained-candidate early return bypassed the common persistence path after mutating the attempt counter.
- **Resolution:** The branch persists the exact retained draft before returning feedback. Persisted repair state is paired with an explicit marker and validated for phase, schema, size, canonical clause IDs, and bounded counters before restoration.
- **Verification:** The regression failed before the fix and passes afterward. The durable repair-state file passes 5 of 5 tests, and an adversarial audit found no other draft-mutating early return without persistence.
- **Prevention/follow-up:** Audit every early return in state-machine tools for mutations before return. Behavioral persistence tests must create a fresh controller from the same session rather than checking only in-memory state.
- **Reusable learning:** Retaining an object in memory is not a no-op when its counters or diagnostics change; persist every externally visible state transition before returning.
- **References:** `packages/coding-agent/src/core/task-verification/taskverificationcontroller-methods/requirement-audit-tool.ts`, `packages/coding-agent/test/task-requirement-definition-durable-repair-state.test.ts`
