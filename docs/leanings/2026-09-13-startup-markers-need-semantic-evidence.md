# 2026-09-13 — Startup markers need semantic evidence

- **Status:** Resolved
- **Task/context:** Certifying Kilo startup before benchmark cells.
- **Unexpected observation or failure:** A marker present in raw echoed input could be mistaken for the assistant response, and failed processes could leave passing evidence.
- **Evidence:** Wrong-response, timeout, nonzero-exit, malformed-stream, and raw-echo fixtures exposed independent acceptance gaps.
- **Approaches tried:**
  - **Attempt:** Search raw stdout for the marker.
    - **Outcome:** Did not work
    - **Why:** Requests and diagnostics can echo prompt text without a valid assistant response.
  - **Attempt:** Require exact parsed final text, complete model identity, clean exit, and zero parser errors.
    - **Outcome:** Worked
    - **Why:** Each acceptance fact comes from its authoritative semantic channel.
- **Root cause:** Startup success combined untrusted raw text with incomplete process status checks.
- **Resolution:** Kilo request startup passes only on an exact parsed marker from the expected model and a clean process; every failure finalizes evidence as failed.
- **Verification:** `kilo-startup-fail-closed.test.ts` exercises all five failure modes and confirmed-exit cleanup.
- **Prevention/follow-up:** Keep startup acceptance conjunctive and fail closed when any semantic or lifecycle field is absent.
- **Reusable learning:** A raw marker proves byte presence, not a valid model response.
- **References:** `benchmarks/src/workloads/startup-probes.ts`
