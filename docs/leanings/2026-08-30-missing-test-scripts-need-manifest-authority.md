# 2026-08-30 — Missing test scripts need manifest authority

- **Status:** Resolved
- **Task/context:** Recover completion liveness after an inventory benchmark ran a repository-inapplicable `npm run test:unit` command.
- **Unexpected observation or failure:** The failed launch stayed in the verification ledger after applicable tests passed, but an output-only exception would also allow spoofed diagnostics to erase genuine test failures.
- **Evidence:** Adversarial regressions reproduced declared scripts emitting a matching missing-script line plus `TypeError`, `SyntaxError`, timeout, or signal failures; the earlier classifier retired all of them.
- **Approaches tried:**
  - **Attempt:** Recognize the package manager's missing-script text and exclude the command from implementation failures.
    - **Outcome:** Did not work
    - **Why:** Output text does not prove which manifest governed the invocation and can coexist with another real failure.
  - **Attempt:** Resolve the focused invocation's literal working directory and inspect its `package.json` before classifying the launch.
    - **Outcome:** Worked
    - **Why:** Script absence becomes an independently observed fact, while missing, invalid, mismatched, declared, timed-out, or signaled cases fail closed.
- **Root cause:** Verification evidence conflated a package-manager launch/configuration failure with an implementation test failure and then tried to distinguish them using only process output.
- **Resolution:** Missing-script retirement now requires an exact supported package-manager invocation with no unmodeled scope or pass-through arguments, a matching diagnostic, authoritative absence in the effective manifest, canonical package-manager output, and no independent failure marker. A matching diagnostic also forces a nominal zero-exit result to remain unconfirmed.
- **Verification:** `task-verification-test-evidence-lifecycle.test.ts` covers four package managers, literal `cd`, declared and absent scripts, invalid and missing manifests, spoofed runtime failures, native Bun tests, and persisted full-output outcomes. `task-verification-missing-script-authority.test.ts` covers executable identity, script-name mismatch, zero-exit diagnostics, stale passing footers, and workspace or pass-through arguments.
- **Prevention/follow-up:** New launch-error exceptions must bind to independent execution inputs or state, never only to diagnostic prose.
- **Reusable learning:** Retire a failed command only when the reason it could not execute is proven from the actual invocation environment.
- **References:** `packages/coding-agent/src/core/task-verification/taskverificationcontroller-methods/test-evidence-outcome.ts`, `packages/coding-agent/test/task-verification-test-evidence-lifecycle.test.ts`
