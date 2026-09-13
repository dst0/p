# 2026-09-13 — Safe failure cleanup requires typed termination state

- **Status:** Resolved
- **Task/context:** Finalizing benchmark credentials, receipts, and workspaces after agent errors.
- **Unexpected observation or failure:** Ordinary parser or recording-finalization errors were treated like unconfirmed process termination, unnecessarily skipping safe cleanup.
- **Evidence:** A confirmed-exit startup recording failure suppressed evidence and artifact sanitation even though no child could still mutate the tree.
- **Approaches tried:**
  - **Attempt:** Mark every thrown child-run error as unsafe.
    - **Outcome:** Did not work
    - **Why:** Error type alone did not describe whether the process tree was still alive.
  - **Attempt:** Propagate a dedicated unconfirmed-termination error only from failed process-tree shutdown.
    - **Outcome:** Worked
    - **Why:** Safe failures still dispose and sanitize, while only genuinely mutable trees avoid traversal.
- **Root cause:** Process outcome and artifact traversal authority were represented by one generic failure channel.
- **Resolution:** Cleanup policy now keys off typed, recursively recognized termination uncertainty, preserves the original cause directly, always sanitizes parent-owned receipt artifacts, and skips only candidate-writable traversal when process termination is unconfirmed.
- **Verification:** `benchmark-run-finalization.test.ts` verifies direct cause identity and split cleanup authority; `certification-artifact-sanitization.test.ts` proves receipt redaction without traversing a swapped workspace; `certification-preflight-finalization.test.ts` verifies recording redaction on an unconfirmed preflight; `kilo-startup-fail-closed.test.ts` distinguishes confirmed and unconfirmed failures.
- **Prevention/follow-up:** Preserve termination confirmation as structured lifecycle state across every wrapper.
- **Reusable learning:** Decide mutable-tree cleanup from confirmed process ownership, not from whether an operation threw.
- **References:** `benchmarks/src/harness/process-termination-error.ts`, `docs/leanings/2026-09-12-unconfirmed-termination-forbids-tree-cleanup.md`
