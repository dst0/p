# 2026-08-24 — Benchmark authority must bind raw JSON evidence

- **Status:** Resolved
- **Task/context:** Validating the `5.0.1-rc.5` paired project-instruction benchmark for the event-sourced inventory task.
- **Unexpected observation or failure:** The timed-out legacy child published a receipt-bound result, but the parent classified it as infrastructure failure with `child benchmark proof evidence does not match outer authority`.
- **Evidence:** The receipt envelope and result commitment passed earlier checks. A JSON/IPC round trip removed optional legacy `compiled*` properties whose values were `undefined`; projecting the parsed evidence recreated those properties as own keys with `undefined` values. `isDeepStrictEqual` then rejected absent keys versus explicit undefined keys.
- **Approaches tried:**
  - **Attempt:** Normalize both sides by stripping undefined properties before comparison.
    - **Outcome:** Partial
    - **Why:** It would make the comparison pass, but would compare a derived representation instead of the exact JSON evidence committed by the child.
  - **Attempt:** Apply strict outer authority to the raw parsed publication evidence, then project only after authority succeeds.
    - **Outcome:** Worked
    - **Why:** The comparison now uses the exact JSON wire representation bound by the child result hash while public projection and privacy filtering remain unchanged.
- **Root cause:** Authority was compared after a shape-changing projection. JSON publication and Node IPC omit undefined object properties, while the projection recreated them, so semantically unchanged legacy evidence failed exact structural equality.
- **Resolution:** Verify raw parsed project-instruction evidence against the receipt-bound outer authority and result hash before projecting it for validation and public output.
- **Verification:** A production-entrypoint regression JSON/IPC-round-trips realistic legacy evidence and authority through `createValidatedPairedSample`; it passes with the fix, fails if projection is restored before authority, and still rejects a meaningful `userTurns` substitution. The focused authority, evidence-privacy, proof-IPC, and containment suites pass 22/22.
- **Prevention/follow-up:** Bind authority at the serialization boundary it authenticates. Keep a negative test that changes a meaningful proof value, not only object shape.
- **Reusable learning:** Cryptographic or IPC authority must validate the exact committed wire representation before any projection that can add, omit, or normalize fields.
- **References:** `scripts/benchmark-project-instructions-sample.js`, `scripts/benchmark-project-instruction-evidence-privacy.test.js`, `scripts/benchmark-project-instruction-outer-authority.js`.
