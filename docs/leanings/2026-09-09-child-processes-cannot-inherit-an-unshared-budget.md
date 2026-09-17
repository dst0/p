# 2026-09-09 — Child processes cannot inherit an unshared budget

- **Status:** Resolved
- **Task/context:** Launch subagents after first-run budget selection became mandatory.
- **Unexpected observation or failure:** A child without `--budget` failed startup, while blindly adding `--budget unlimited` would let a limited parent multiply spend across untracked child ledgers.
- **Evidence:** The real spawned CLI first exited with `budget_required`. A limited-parent regression then demonstrated that no aggregate ledger existed to share the parent's request, token, or USD allowance safely.
- **Approaches tried:**
  - **Attempt:** Always launch children with `--budget unlimited`.
    - **Outcome:** Did not work
    - **Why:** It silently discards an explicit limited parent policy.
  - **Attempt:** Expose an isolated read-only parent-policy snapshot to extensions, allow explicit unlimited propagation, and reject limited parents before spawn.
    - **Outcome:** Worked
    - **Why:** Unlimited remains user-selected, while limited accounting fails closed until a shared aggregate ledger is available.
- **Root cause:** Child process creation had neither trusted budget propagation nor a shared spend-accounting boundary.
- **Resolution:** `ExtensionContext` exposes a read-only budget snapshot; subagents pass `--budget unlimited` only for an explicitly unlimited parent and reject every limited mode before spawning.
- **Verification:** `subagent-executor.test.ts` proves limited parents never reach the runner and unlimited parents propagate the trusted mode; `subagent-runner.test.ts` proves the real `p` CLI starts with that explicit budget.
- **Prevention/follow-up:** Implement a shared aggregate ledger before supporting limited-budget child processes.
- **Reusable learning:** Never translate a bounded parent budget into independent or unlimited child budgets without shared accounting.
- **References:** `packages/coding-agent/src/core/extensions/types.ts`, `packages/coding-agent/examples/extensions/subagent/runner.ts`, `packages/coding-agent/test/subagent-runner.test.ts`
