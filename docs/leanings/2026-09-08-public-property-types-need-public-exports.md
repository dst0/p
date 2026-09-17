# 2026-09-08 — Public property types need public exports

- **Status:** Resolved
- **Task/context:** Audit the package facade after adding task-budget controls to `AgentSession` and SDK options.
- **Unexpected observation or failure:** Public properties referenced `SessionRunBudget`, `RunBudgetPolicy`, and `RunBudgetSnapshot`, but consumers could not import those symbols from `@dst0/p`.
- **Evidence:** A package-facade runtime regression found `SessionRunBudget` undefined, while type inspection showed the budget types were absent from the root export list.
- **Approaches tried:**
  - **Attempt:** Rely on inferred types reachable only through public properties.
    - **Outcome:** Did not work
    - **Why:** Consumers could use values indirectly but could not name or construct the documented public contracts.
  - **Attempt:** Export only the coherent controller, policy, snapshot, and typed runtime error.
    - **Outcome:** Worked
    - **Why:** It exposes the supported surface without leaking storage or ledger internals.
- **Root cause:** SDK-internal exports were not carried through the explicit package-root facade.
- **Resolution:** The package root now exports `SessionRunBudget`, `RunBudgetError`, `RunBudgetPolicy`, and `RunBudgetSnapshot`.
- **Verification:** `run-budget-public-api.test.ts` exercises runtime construction and compile-time type use through the root facade.
- **Prevention/follow-up:** Every type named by a public option or property must be importable from the same public package entry point.
- **Reusable learning:** Audit explicit facade lists whenever a public class gains a new typed property.
- **References:** `packages/coding-agent/src/index.ts`, `packages/coding-agent/test/run-budget-public-api.test.ts`
