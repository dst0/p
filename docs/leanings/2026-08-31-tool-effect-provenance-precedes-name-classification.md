# 2026-08-31 — Tool effect provenance precedes name classification

- **Status:** Resolved
- **Task/context:** Generalize task verification from a fixed set of coding tools to built-in and custom tools with explicit effect metadata.
- **Unexpected observation or failure:** A custom tool named `bash`, `write`, or another built-in name could be classified by built-in name rules before its declared external effect was examined.
- **Evidence:** The focused external-effect receipt regression reproduced the collision with custom tools named `bash` and `write`.
- **Approaches tried:**
  - **Attempt:** Apply existing built-in name and argument classifiers before reading effect metadata.
    - **Outcome:** Did not work
    - **Why:** A name alone does not prove that a custom tool has built-in behavior or provenance.
  - **Attempt:** Resolve valid declared or fail-conservative custom effects first, and limit name and argument refinement to trusted built-in effects or legacy calls without metadata.
    - **Outcome:** Worked
    - **Why:** Provenance now determines whether built-in classifiers are authoritative.
- **Root cause:** Effect classification conflated a tool's public name with its trusted runtime origin.
- **Resolution:** Declared and default-unknown effects are authoritative before built-in classification; malformed metadata fails conservative; built-in name and argument refinement remains available only for trusted built-ins or absent legacy metadata.
- **Verification:** `task-verification-external-effect-receipts.test.ts` passes five focused cases, including declared custom `bash` and `write` tools.
- **Prevention/follow-up:** Keep collision regressions whenever adding a built-in classifier, and never infer custom-tool effects from names or descriptions.
- **Reusable learning:** Authenticate effect provenance before applying privileged name-based behavior.
- **References:** `packages/coding-agent/src/core/task-verification/taskverificationcontroller-methods/tool-effect-resolution.ts`, `packages/coding-agent/test/task-verification-external-effect-receipts.test.ts`
