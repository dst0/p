# 2026-09-21 — Certified holdouts must be domain-specific and evaluator-owned

- **Status:** Resolved
- **Task/context:** Hardening the four-task agent benchmark against fixture-specific answers before binding it to the major-release gate.
- **Unexpected observation or failure:** The existing post-binding challenge was placed in the candidate workspace and prompt, tested only a generic digest, and contributed zero score. A candidate could pass it without demonstrating unseen calculator, refactor, inventory, or workflow behavior. The first sealed implementation also named its private destination `adapter.js` but tried to load that name from source, so certified setup failed before execution.
- **Evidence:** Adversarial review found prompt-visible challenge values and `weight: 0`. A setup-to-publication integration regression then reproduced `ENOENT` for the mismatched adapter source name.
- **Approaches tried:**
  - **Attempt:** Use one generated digest challenge shared by every task.
    - **Outcome:** Did not work
    - **Why:** It proved only generic string handling and was visible to the candidate before execution.
  - **Attempt:** Generate task-domain inputs after candidate binding, keep expected values inside the evaluator snapshot, and execute a bounded read-only adapter.
    - **Outcome:** Worked
    - **Why:** The candidate sees only fresh behavioral inputs through its normal API, while the expected result, seed, and plan remain evaluator-owned and hash-bound.
- **Root cause:** Post-binding randomness was treated as sufficient even though secrecy, domain discrimination, score impact, and executable packaging are separate requirements.
- **Resolution:** Generate sealed calculator, monolith, inventory, and workflow plans after candidate binding; bind the plan hash into the final harness; execute the adapter without network or workspace writes; award nonzero task-specific weight; distinguish the source adapter filename from its private sealed destination; and exercise semantic lifecycle branches such as atomic batch rollback, command-ID reuse, lease reclaim, stale fencing, and retry backoff.
- **Verification:** Holdout execution, tamper, timeout, output-bound, score-policy, setup, and full release-pipeline regressions exercise the sealed path. The pipeline reaches default receipt persistence only after the bound holdout passes.
- **Prevention/follow-up:** Keep holdout inputs unique and deterministic for a seed, require mutants that pass the previous happy path but fail newly covered invariants, validate adapter source packaging during setup, and rerun the final harness integrity check before intentional private cleanup.
- **Reusable learning:** A useful holdout must be unseen, domain-discriminating, score-bearing, evaluator-owned, bound to the exact candidate, and broad enough to distinguish lifecycle semantics; random values inside one fixed happy path are not enough.
- **References:** `docs/leanings/2026-09-13-certification-needs-post-binding-holdouts-and-bounded-egress.md`, `benchmarks/src/workloads/certification-holdout-plan.ts`, `benchmarks/src/workloads/certification-holdout-execution.ts`, `benchmarks/test/workloads/certified-release-pipeline.test.ts`
