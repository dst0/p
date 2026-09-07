# 2026-08-29 — Pre-mutation semantic audits can starve implementation

- **Status:** Verified
- **Task/context:** Restoring task-3 liveness in the compiled project-instruction benchmark after pre-mutation requirement definition was reintroduced.
- **Unexpected observation or failure:** The agent froze the referenced specification quickly but then spent the entire live budget defining and repairing a semantic requirement matrix instead of implementing the task.
- **Evidence:** Candidate rc.50 produced its first potentially mutating action at 67 seconds, then made three complete definition calls and six repair calls. The draft grew from 19 to 50 requirements, diagnostics fell from 21 to 1, and the run was interrupted at 973 seconds with one mutation and no completed sample.
- **Approaches tried:**
  - **Attempt:** Bound sparse repair fan-out, global stagnation, provider output size, and terminal recovery.
    - **Outcome:** Partial
    - **Why:** The bounds prevent an infinite controller loop, but several slow model turns still consume the implementation budget before the bound is reached.
  - **Attempt:** Restore the separation between immutable source capture and semantic completion audit for referenced specifications.
    - **Outcome:** Worked
    - **Why:** Deterministic regressions preserve source and final-audit gates, and the installed compiled-mode live AI-unit reached `src/types.ts` after one source preparation and one batched `read_rules` call with zero definition or repair calls.
- **Root cause:** The controller coupled the time-sensitive safety boundary, freezing mutable user-authorized specification bytes, to an expensive model-generated atomic decomposition that is only required for final verdict mapping.
- **Resolution:** Referenced specifications remain hash-bound and revalidated before mutations, but their complete semantic definition is deferred until `ready_to_finish`. Direct prompts without an authoritative referenced source retain the pre-mutation definition gate.
- **Verification:** The regression failed before the fix because preparation demanded an immediate definition. The complete requirement-verification slice passes 71 files and 567 tests, `npm run check` passes, the full non-e2e suite exits zero, reinstall and semantic-search smoke pass, and the installed compiled-mode live AI-unit reached a real production-file write with zero definition or repair calls. The first canary also proved why pure-delegation-only deferral was insufficient: task 3 adds direct constraints around the referenced README and therefore re-entered eager definition. The corrected policy defers the combined source and direct audit whenever an authoritative source is frozen, while source-free tasks remain eager.
- **Prevention/follow-up:** Bind the next benchmark candidate only after this live liveness gate, then require paired task-3 correctness before comparing efficiency or starting task 4.
- **Reusable learning:** Freeze mutable authority at the first mutation boundary, but schedule model-generated semantic audits at the latest boundary that needs them.
- **References:** `packages/coding-agent/test/task-requirement-source-pre-mutation-definition.test.ts`, `packages/coding-agent/src/core/task-verification/taskverificationcontroller-methods/requirement-definition-mutation-gate.ts`, `benchmarks/results/2026-08-28-v5.0.1-rc.50-task3-thinking-off-qwen-compat-4096-paired-v1/results.json`, `/private/tmp/p-rc51-deferred-ai-unit-v2.gHIGDY/live.jsonl.br`, `docs/leanings/2026-08-25-defer-exhaustive-requirement-definition-until-completion.md`.
