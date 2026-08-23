# 2026-08-17 — Reject invalid CLI arguments before session initialization

- **Status:** Resolved
- **Task/context:** Re-running the full coding-agent unit suite after the release-fixture portability fix.
- **Unexpected observation or failure:** The empty `--name` integration test timed out and killed the CLI process instead of receiving the expected validation error.
- **Evidence:** The focused subprocess test repeatedly returned `code=null` after its 10-second kill deadline. A new parser regression showed that both an empty string and whitespace-only input were accepted into `Args.name` before the fix.
- **Approaches tried:**
  - **Attempt:** Treat the failure as load-only flakiness and rerun the complete suite.
    - **Outcome:** Did not work
    - **Why:** The focused test reproduced without suite load, proving that the expensive startup path preceded validation.
  - **Attempt:** Validate and diagnose empty names while parsing CLI arguments.
    - **Outcome:** Worked
    - **Why:** Invalid input now exits through the existing diagnostic path before migrations, session lookup, or runtime startup; valid names retain their original whitespace until the existing append boundary trims them.
- **Root cause:** `parseArgs` preserved blank names and `main` validated them only after creating the session manager, making a syntactic error depend on unrelated startup work.
- **Resolution:** Reject empty and whitespace-only `--name` values in `parseArgs` and remove the now-unreachable late validation branch.
- **Verification:** `test/args.test.ts` and `test/startup-session-name.test.ts` pass together with 81 tests after failing with two parser regressions and one subprocess timeout before the fix.
- **Prevention/follow-up:** Validate argument syntax and value shape in the parser; defer only checks that genuinely require runtime or repository state.
- **Reusable learning:** Fail-fast CLI validation reduces both side effects and false timeout flakes because invalid input never enters expensive initialization.
- **References:** `packages/coding-agent/src/cli/args.ts`, `packages/coding-agent/src/main/command-dispatch.ts`, `packages/coding-agent/test/args.test.ts`, `packages/coding-agent/test/startup-session-name.test.ts`
