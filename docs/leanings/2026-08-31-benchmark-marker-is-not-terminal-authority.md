# 2026-08-31 — Benchmark marker is not terminal authority

- **Status:** Resolved
- **Task/context:** Running the three-condition project-instruction benchmark with explicit task verification enabled for P.
- **Unexpected observation or failure:** The first fixture workspace passed every quality check and contained `finish_notes.md`, but the outer correctness gate stopped because no accepted `finish_work` call was present. A later live smoke also showed that raw start events can omit a token that the controller safely auto-populates before execution.
- **Evidence:** Semantic recording evidence contained a readiness attempt and one evidence certificate, but zero `finish_work` starts or accepted finishes. In the live smoke, a prior certificate was issued, raw model arguments omitted `verification_token`, and the matching `finish_work` end explicitly reported successful execution.
- **Approaches tried:**
  - **Attempt:** Treat the fixture marker as successful task completion.
    - **Outcome:** Did not work
    - **Why:** The marker proves only that a requested file exists; it does not prove that P completed its terminal verification protocol.
  - **Attempt:** Keep the semantic correctness gate unchanged and make the watchdog continue P until the terminal handshake is accepted.
    - **Outcome:** Worked
    - **Why:** It preserves both independent contracts: the fixture deliverable and P's verification authority.
- **Root cause:** `runAgentTask` used one generic marker-only completion rule for agents with different terminal protocols, so it could terminate P between certificate issuance and `finish_work`.
- **Resolution:** P with task verification active now requires both a current `finish_notes.md` marker and a same-turn, explicitly successful `finish_work`. The semantic proof accepts either an explicit non-empty token or the controller's auto-population path after a previously observed certificate. Pending tool calls are cleared at every internal and subprocess turn boundary, exhaustion fails closed, and the recovery nudge preserves task state while naming the missing handshake. Other agents and P with verification off retain marker-only completion.
- **Verification:** A fake-CLI regression reproduces the two-turn failure and proves continuation through `--continue`; focused tests reject stale, failed, tokenless, mismatched, and cross-turn finishes, prove fail-closed nudge exhaustion, and preserve generic marker completion. The complete benchmark-infrastructure suite passes 334/334 tests.
- **Prevention/follow-up:** Keep benchmark artifact markers separate from agent terminal authority. When a protocol has an explicit completion event, the watchdog must wait for that event and the outer gate must independently verify it.
- **Reusable learning:** A filesystem marker is a workload artifact, not a universal proof that an agent's completion protocol succeeded.
- **References:** `benchmarks/src/workloads/agent-task-completion.ts`, `benchmarks/test/workloads/agent-turn-runner.test.ts`
