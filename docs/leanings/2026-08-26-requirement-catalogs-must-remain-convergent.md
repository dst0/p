# 2026-08-26 — Requirement catalogs must remain convergent

- **Status:** Resolved
- **Task/context:** Run a small live compiled-mode AI proof before the expensive paired benchmark.
- **Unexpected observation or failure:** The agent spent more than 20 minutes alternating definition and repair calls without reaching the first mutation.
- **Evidence:** `Requirements:` was emitted as a normative prose clause that could neither be mapped nor ignored, while `src/log.js` and `dependency-free` falsely introduced event-log and dependency-graph concepts.
- **Approaches tried:**
  - **Attempt:** Let bounded sparse repair find another model decomposition.
    - **Outcome:** Did not work
    - **Why:** Every candidate faced the same controller-created impossible classification and false concept obligations.
  - **Attempt:** Correct structural extraction and make ambiguous concepts occurrence-aware.
    - **Outcome:** Worked
    - **Why:** Only literal `Requirements:` becomes a structural heading; paths and `dependency-free` no longer create concepts, while explicit DAG, dependency-order, and event-log semantics remain enforced symmetrically.
- **Root cause:** Clause extraction understood only ATX headings, and critical-concept regexes treated filenames and ordinary dependency qualifiers as architecture guarantees.
- **Resolution:** The catalog uses a minimal literal structural-label rule and shared source/mapping concept predicates with path-token and explicit dependency semantics.
- **Verification:** Structural negatives, live-clause catalog projection, source/mapping symmetry, durable-workflow dependency phrases, and the affected 70-file aggregate pass.
- **Prevention/follow-up:** Every derived catalog obligation must have at least one legal definition representation; pair false-positive negatives with explicit-source and mapped-requirement positives.
- **Reusable learning:** A fail-closed compiler is safe only if controller-derived obligations are also satisfiable and semantically exact.
- **References:** `packages/coding-agent/src/core/task-verification/requirement-source-clauses.ts`, `packages/coding-agent/src/core/task-verification/requirement-clause-concepts.ts`
