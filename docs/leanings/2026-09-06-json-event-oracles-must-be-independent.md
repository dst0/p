# 2026-09-06 — JSON event oracles must be independent

- **Status:** Resolved
- **Task/context:** Adversarial review of the new print-mode terminal-event and proof-source regressions before committing them.
- **Unexpected observation or failure:** The passing test built its expected terminal payload from the same mutable event after that event had been processed.
- **Evidence:** Independent review identified the shared reference in `print-mode-json-stream.test.ts`: an in-place payload deletion could change both the emitted result and the expected object. The proof-source test similarly built expected obligations from the domain array passed to the code under test, so clearing that array could hide lost obligations. These were weaknesses in test oracles, not reproduced runtime mutation defects.
- **Approaches tried:**
  - **Attempt:** Read the original event when constructing the expected output after the call.
    - **Outcome:** Partial
    - **Why:** Correct output passed, but the oracle was not independent of potential mutations by the code under test.
  - **Attempt:** Deep-clone the expected output before invoking print mode.
    - **Outcome:** Worked
    - **Why:** Later mutation of the input can no longer change the expected final payload.
- **Root cause:** Input and expected-output references shared ownership across the invocation boundary.
- **Resolution:** Capture `structuredClone` of the expected terminal events before running the runtime host. Give source-proof recomputation a fixed expected `event-log` obligation and assert the discovered domain before execution, preventing both shared-mutation and empty-fixture false passes.
- **Verification:** Both print-mode JSON stream tests passed after the change; the independent critic reread the correction and returned GO. The proof-source expectation is separately checked by its focused integrity suite.
- **Prevention/follow-up:** Snapshot expected data before exercising a component that receives mutable objects, or assert an independent literal value.
- **Reusable learning:** A passing preservation test proves little if the component can mutate its oracle through an aliased input reference.
- **References:** `packages/coding-agent/test/print-mode-json-stream.test.ts`; `packages/coding-agent/test/task-verification-proof-source-snapshot-integrity.test.ts`.
