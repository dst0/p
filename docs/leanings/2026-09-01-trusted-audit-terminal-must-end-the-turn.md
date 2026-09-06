# 2026-09-01 — Trusted audit terminal must end the turn

- **Status:** Resolved
- **Task/context:** Closing audit-mode task verification cleanly and preserving the authoritative failure reason in paired project-instruction benchmarks.
- **Unexpected observation or failure:** A successful audit verdict could issue a valid completion certificate but still require another provider turn for `finish_work`. That redundant turn could time out, and later semantic-incompleteness checks could mask the explicit timeout or provider termination.
- **Evidence:** The trusted audit finalizer had already passed the current-revision certificate, in-flight-operation, verification-ledger, session-state, and completion gates. Focused regressions now require its reserved completion payload to terminate the tool batch, and require `timed_out` or provider-failed status to precede secondary semantic-evidence failures.
- **Approaches tried:**
  - **Attempt:** Always require a separate provider-authored `finish_work` after the accepted audit verdict.
    - **Outcome:** Did not work
    - **Why:** It repeated an already-authoritative decision and exposed a completed run to another provider failure or deadline.
  - **Attempt:** Let only the controller-issued, schema-validated audit completion marker terminate the turn and propagate its structured completion contract.
    - **Outcome:** Worked
    - **Why:** It preserves one trusted terminal authority without accepting arbitrary tool-result text, while keeping the artifact marker as an independent workload proof.
- **Root cause:** The controller and agent loop had separate completion authorities: the audit verdict completed every gate, but only `finish_work` could end the loop. Benchmark assessment then checked derived semantic completeness before explicit run termination.
- **Resolution:** Successful standalone audit verdicts emit a reserved verified-completion payload, terminate without another provider request, and are recognized by print, RPC, recording, and benchmark completion paths. Explicit timeout and provider termination retain precedence in benchmark failure reporting.
- **Verification:** Regressions cover standalone versus batched finalizers, invalid or stale completion markers, one-turn termination, final-output projection, benchmark acceptance after the current marker, and timeout/provider-failure precedence.
- **Prevention/follow-up:** Keep the reserved payload schema strict, require the marker on the last successful trusted tool result, and never let derived semantic diagnostics overwrite an explicit terminal process or provider outcome.
- **Reusable learning:** Once a trusted controller atomically accepts completion, end the turn; do not ask the provider to restate that decision, and preserve explicit terminal failures as the primary diagnostic.
- **References:** `docs/leanings/2026-08-31-benchmark-marker-is-not-terminal-authority.md`, `packages/coding-agent/src/core/task-verification/verified-completion-runtime.ts`, `packages/agent/src/agent-loop/error-recovery.ts`, `benchmarks/src/project-instructions/run-assessment.ts`, `benchmarks/test/project-instructions/run-cell-terminal-precedence.test.ts`
