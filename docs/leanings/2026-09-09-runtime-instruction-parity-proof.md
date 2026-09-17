# 2026-09-09 — Runtime instruction parity proof across Pi, P, and Kilo

- **Status:** Resolved
- **Task/context:** Disproving the assumption that Kilo under `--pure` cannot load `AGENTS.md` and implementing a fail-closed runtime instruction parity proof.
- **Unexpected observation or failure:** Initial design assumed Kilo could not load `AGENTS.md` under `--pure` and emitted a permanent failure sentinel (`kiloProofAvailable: false`). Official documentation confirmed Kilo automatically loads root `AGENTS.md` in `--pure` mode and cannot be individually disabled.
- **Evidence:** Official Kilo documentation (`https://kilo.ai/docs/customize/custom-instructions` and `https://github.com/Kilo-Org/kilocode/blob/main/packages/kilo-docs/pages/customize/agents-md.md`) demonstrates automatic `AGENTS.md` loading from the project root.
- **Approaches tried:**
  - **Attempt:** Blindly trust agent execution without runtime evidence.
    - **Outcome:** Rejected as non-rigorous.
    - **Why:** Certified benchmark comparison must verify that instructions were actually delivered and read at runtime.
  - **Attempt:** Create an augmented instruction document once per experiment with a high-entropy parity receipt directive, and execute an isolated preflight turn for Pi, P, and Kilo asking for the receipt value without leaking the token in the prompt.
    - **Outcome:** Worked.
    - **Why:** Preflight forces all agents to prove instruction loading from `AGENTS.md` (or compiled project instructions in P), records only safe receipt hashes in evidence, checks workspace `AGENTS.md` before/after each cell, and enables certified PASS when all receipts and cells succeed.
- **Root cause:** Initial assumption contradicted official CLI documentation; required replacing static failure flag with runtime receipt preflights and workspace instruction integrity checks.
- **Resolution:** Implemented `createAugmentedProjectInstructions`, `verifyWorkspaceInstructions`, and `runCertifiedPreflights` in `certification-preflight.ts`; eliminated `kiloProofAvailable: false`.
- **Verification:** Synthetic preflight tests verify all 3 agents succeed only by reading `AGENTS.md`, prompt leaks no tokens, argv echoing cannot cheat, and tampering fails closed.
- **References:** `benchmarks/src/workloads/certification-preflight.ts`, `benchmarks/src/workloads/certification.ts`.
