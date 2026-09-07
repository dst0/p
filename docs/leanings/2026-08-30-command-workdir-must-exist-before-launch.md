# 2026-08-30 — Command workdir must exist before launch

- **Status:** Resolved
- **Task/context:** Create an isolated temporary Git workspace for a live AI protocol canary.
- **Unexpected observation or failure:** A command was launched with a working directory that the same command intended to create. The execution layer fell back to its parent context, so `git init` created an unintended repository in the user directory.
- **Evidence:** Process cwd and filesystem birth timestamps identified the newly created metadata exactly; no pre-existing repository metadata was present at that location.
- **Approaches tried:**
  - **Attempt:** Create the temporary directory and use it as the command workdir in one launch.
    - **Outcome:** Did not work
    - **Why:** Command workdir resolution happens before the command body can create that directory.
  - **Attempt:** Resolve the exact unintended metadata by timestamp and move only that directory to the operating-system Trash.
    - **Outcome:** Worked
    - **Why:** It removed the accidental repository without destructive deletion and kept recovery possible.
- **Root cause:** The command assumed shell setup ran before process working-directory resolution.
- **Resolution:** The exact newly created Git metadata was moved to Trash, its original path was verified absent, and later canaries create and verify their temporary directory in a separate command before launching any cwd-bound process.
- **Verification:** The original user-directory Git metadata path is absent and the timestamp-bound recovery item exists in Trash.
- **Prevention/follow-up:** For every temporary workspace, create it first, verify it is an absolute directory, then launch a separate command with that workdir. Treat cwd fallback as unsafe for mutating commands.
- **Reusable learning:** A process working directory must exist before launch; never depend on the launched command to create its own cwd.
- **References:** `AGENTS.md` destructive-action and temporary-directory guidance
