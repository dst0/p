# 2026-09-06 — Node sandbox startup needs metadata traversal

- **Status:** Resolved
- **Task/context:** OS isolation for hidden benchmark evaluators.
- **Unexpected observation or failure:** Node could not resolve its allowed entrypoint through the macOS `/var` alias under deny-default isolation.
- **Evidence:** AGY's harmless probe encountered `EPERM` while reading path metadata; independent parent tests subsequently passed.
- **Approaches tried:**
  - **Attempt:** Permit file reads only under explicit runtime and workspace roots.
    - **Outcome:** Partial
    - **Why:** Node also resolves filesystem metadata along parent paths.
- **Root cause:** Metadata traversal was denied independently of file-content access.
- **Resolution:** Allow metadata reads while keeping file contents restricted and runtime writes denied.
- **Verification:** Node reads allowed runtime data, cannot read oracle/credential/prior-result fixtures, cannot write runtime, and can write its workspace.
- **Prevention/follow-up:** These primitives are not yet proof that every benchmark agent launch is sandboxed; integration and live evaluation remain separate gates.
- **Reusable learning:** Verify an actual language-runtime child, not only a shell utility, when testing a sandbox.
- **References:** `benchmarks/test/harness/benchmark-isolation.test.ts`.
