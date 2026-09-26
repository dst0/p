# 2026-09-26 — Node timer deadlines need explicit bounds

- **Status:** Resolved
- **Task/context:** Validate the new project-instruction startup deadline exposed through CLI and SDK.
- **Unexpected observation or failure:** The parser accepted a safe integer of 2,147,484 seconds even though converting it to milliseconds exceeds Node's maximum timer delay, causing an unexpectedly near-immediate timeout.
- **Evidence:** The CLI boundary regression accepted the value before the fix and rejected it afterward; the SDK also now rejects non-finite or out-of-range values.
- **Approaches tried:**
  - **Attempt:** Use `Number.isSafeInteger` alone.
    - **Outcome:** Did not work
    - **Why:** Number safety does not imply timer-delay safety after multiplication.
  - **Attempt:** Cap seconds at 2,147,483 and validate finite non-negative SDK values at the consumer.
    - **Outcome:** Worked
    - **Why:** The converted delay stays below Node's timer limit, while zero remains a documented disable switch.
- **Root cause:** Validation constrained the source number but not the unit-converted value sent to `setTimeout`.
- **Resolution:** Reject oversized CLI values and invalid SDK values before scheduling a timer.
- **Verification:** Focused CLI parsing and SDK boundary tests, full `./test.sh`, `npm run check`, and `./reinstall.sh` pass.
- **Prevention/follow-up:** Validate timeout quantities in the final scheduler's units and cover the overflow boundary.
- **Reusable learning:** A numeric deadline is safe only after its unit conversion is checked against the platform timer range.
- **References:** `packages/coding-agent/src/cli/argument-values.ts`, `packages/coding-agent/src/core/project-instructions/compiler-runner.ts`, `packages/coding-agent/test/project-instruction-mode-cli.test.ts`
