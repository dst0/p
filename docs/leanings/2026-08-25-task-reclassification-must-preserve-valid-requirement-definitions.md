# 2026-08-25 — Task reclassification must preserve valid requirement definitions

- **Status:** Resolved
- **Task/context:** Use a focused live AI-unit to validate the requirement controller before rerunning the paired project-instructions benchmark.
- **Unexpected observation or failure:** The live agent accepted eight referenced requirements, then a later `declare_task` call reset the requirement audit to `pending`. The mutation gate asked for a definition, while the definition tool rejected it as already fixed for the same hash, leaving no valid next action.
- **Evidence:** Candidate `5.0.1-rc.32` reached an accepted eight-item definition in a clean temporary fixture and then entered the contradictory pending/already-fixed state before any product-file mutation. The closed Brotli Q6 log is `/private/tmp/p-rc32-artifact-ai-unit.aUFRqC/live.log.br`.
- **Approaches tried:**
  - **Attempt:** Clone the entire requirement audit through every pre-mutation task declaration.
    - **Outcome:** Did not work
    - **Why:** It could clear a source-restoration error while retaining a definition whose immutable source bytes were missing, allowing an unsafe mutation path.
  - **Attempt:** Preserve only a definition whose user-requirements hash, canonical requirement-set hash, and frozen source snapshots all remain valid; otherwise reset fail-closed to `awaiting_definition` or `pending` according to source availability.
    - **Outcome:** Worked
    - **Why:** Focused deterministic tests and static checks pass, and the corrected live AI-unit completed the full definition, implementation, evidence, verdict, and finish lifecycle without the pending/already-fixed contradiction.
- **Root cause:** `declare_task` unconditionally replaced the requirement audit with an empty pending state and cleared restoration errors. The source mutation gate and definition tool then interpreted the resulting stale definition lifecycle differently, producing mutually incompatible recovery instructions.
- **Resolution:** Pre-mutation reclassification now preserves only canonical definition fields and hashes, resets old verdicts and verification revisions, keeps requirement-source restoration errors, and recomputes both hashes against prospective task state. A corrupt definition with intact prepared sources returns to `awaiting_definition`, and a complete redefine is accepted when the stored hashes are invalid.
- **Verification:** Real Git-backed tests cover a valid passed audit reclassification, verdict/reset semantics, baseline replay, stale requirement-set hash recovery, missing frozen-source restoration, and mutation blocking. Candidate `5.0.1-rc.34` accepted seven requirements after bounded repairs, passed one 7/7 verdict batch, completed `finish_work`, and passed all 11 independent fixture tests. Two pre-definition writes and one post-mutation reclassification were blocked safely and recovered.
- **Prevention/follow-up:** Run a clean live AI-unit before each expensive paired benchmark and stop immediately on controller instructions that cannot both be satisfied. Keep declaration, source, hash, mutation-gate, and definition recovery tests in one lifecycle regression.
- **Reusable learning:** A state-machine transition may preserve derived state only when every authority input still validates, and every fail-closed message must lead to an executable recovery action.
- **References:** `packages/coding-agent/test/task-requirement-declaration-preservation.test.ts`, `packages/coding-agent/src/core/task-verification/taskverificationcontroller-methods/task-declaration-requirement-audit.ts`, `/private/tmp/p-rc32-artifact-ai-unit.aUFRqC/live.log.br`, `/private/tmp/p-rc34-artifact-ai-unit.pwwjXE/live.log.br`
