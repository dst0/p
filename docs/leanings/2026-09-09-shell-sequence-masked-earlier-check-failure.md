# 2026-09-09 — Shell sequence masked earlier check failure

- **Status:** Resolved
- **Task/context:** Run focused tests and static checks for agent-hardening changes in a nested package directory.
- **Unexpected observation or failure:** Biome and tsgo both exited `127` because root-relative binaries were invoked from the package directory, but a later passing Vitest command made the combined shell process exit `0`.
- **Evidence:** The command output contained two `no such file or directory` errors followed by `107 passed`; the final process status represented only Vitest.
- **Approaches tried:**
  - **Attempt:** Sequence independent gates in one shell without fail-fast handling.
    - **Outcome:** Did not work
    - **Why:** POSIX shells return the last command's status unless the sequence explicitly stops or aggregates failures.
  - **Attempt:** Rerun Biome, tsgo, and tests as separate commands from their correct roots.
    - **Outcome:** Worked
    - **Why:** Each gate retained its own authoritative exit status and cwd.
- **Root cause:** Unrelated validations were chained without fail-fast semantics, allowing the last success to mask earlier command-not-found failures.
- **Resolution:** Static checks were rerun separately from the repository root; the focused Vitest suite remained a separate package-root invocation.
- **Verification:** Biome and tsgo each exited `0`; focused tests reported their own independent exit `0`.
- **Prevention/follow-up:** Run independent gates in separate tool calls, or use explicit fail-fast semantics when a single shell is unavoidable.
- **Reusable learning:** Never treat the final status of a multi-command shell as evidence that every earlier gate ran successfully.
- **References:** `AGENTS.md`, `.agents/skills/test-output-discipline/SKILL.md`
