# 2026-08-25 — lean-ctx wrapper can bound long tests

- **Status:** Resolved
- **Task/context:** Running the repository-wide `npm run test:unit` gate before binding benchmark candidate `5.0.1-rc.15`.
- **Unexpected observation or failure:** The suite stopped after about 120 seconds even though the test command itself had no deadline, and the temporary auth backup remained in place because the test wrapper was interrupted.
- **Evidence:** The wrapper exited with a message that output reached its 8 MB / 120 s limit while the underlying log contained passing tests but no terminal suite summary. At interruption, the primary auth file was absent and its intact backup existed with mode `0600`.
- **Approaches tried:**
  - **Attempt:** Run the long suite through `lean-ctx -c` with output redirected to a file.
    - **Outcome:** Did not work
    - **Why:** The wrapper still enforced its own 120-second execution limit despite the file-backed output.
  - **Attempt:** Validate the backup, restore it only because the primary was absent, and rerun the suite directly with file-backed output and no wrapper deadline.
    - **Outcome:** Worked
    - **Why:** Direct process execution preserves the suite's unbounded runtime while the output file keeps the model context small.
- **Root cause:** `lean-ctx -c` applies a bounded execution lifetime to the wrapped command; redirecting stdout and stderr does not remove that process deadline.
- **Resolution:** Use direct process execution for suites expected to exceed the lean-ctx wrapper lifetime, write their output to a closed log, and inspect only focused summaries afterward. After any interruption, restore `auth.json.bak` only when `auth.json` is absent and the backup is intact with mode `0600`.
- **Verification:** The backup was restored to `auth.json` with mode `0600` and the `.bak` path was absent before the unbounded rerun. The direct run in a detached terminal then completed every `test.sh` stage successfully, including the workspace Vitest suites, 92 Python tests, 768 Node tests, 312 benchmark tests, 53 script tests, and 61 release-audit tests; it ended with `Restored auth.json`, mode `0600`, and no `.bak` path.
- **Prevention/follow-up:** Never run `npm run test:unit` or another potentially long suite through a wrapper with an implicit execution cap; keep the command itself unbounded and monitor the file-backed log separately.
- **Reusable learning:** Output compression and process supervision are separate concerns; a context-saving wrapper is unsuitable when its lifetime is shorter than the authoritative test gate.
- **References:** `test.sh`, `AGENTS.md`
