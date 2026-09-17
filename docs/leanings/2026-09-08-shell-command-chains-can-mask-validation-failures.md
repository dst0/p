# 2026-09-08 — Shell command chains can mask validation failures

- **Status:** Resolved
- **Task/context:** Reviewing a delegated verification patch with multiple focused validation commands.
- **Unexpected observation or failure:** A formatter check exited with status 1, but a later successful diff check made the combined shell invocation appear successful.
- **Evidence:** The command sequence ran the formatter followed by `git diff --check` without fail-fast handling; the shell returned only the final command's zero exit status.
- **Approaches tried:**
  - **Attempt:** Run independent validations in one plain multi-command shell invocation.
    - **Outcome:** Did not work
    - **Why:** A later zero exit code hid the earlier nonzero result.
  - **Attempt:** Run each validation as a separate captured command and inspect its own exit code.
    - **Outcome:** Worked
    - **Why:** Every gate retained independent pass or fail evidence.
- **Root cause:** A shell sequence reports the last command by default and is not a reliable aggregate validation gate.
- **Resolution:** Execute formatter, compiler, focused tests, and diff validation separately, or use an explicitly reviewed fail-fast wrapper when one process is required.
- **Verification:** Later reviews recorded a distinct exit code for every validation command and did not infer success from the final command in a chain.
- **Prevention/follow-up:** Delegation prompts now require separate validation commands and prohibit claiming green from an aggregate shell status that can mask earlier failures.
- **Reusable learning:** Never treat the exit code of the last command in a validation sequence as proof that all earlier gates passed.
- **References:** `AGENTS.md`
