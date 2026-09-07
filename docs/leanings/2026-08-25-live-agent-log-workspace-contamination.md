# 2026-08-25 — Live agent logs must stay outside the fixture workspace

- **Status:** Resolved
- **Task/context:** Run a live AI-unit fixture while task verification tracked workspace mutations.
- **Unexpected observation or failure:** A read-only evidence command unexpectedly advanced the mutation revision.
- **Evidence:** The active JSONL output log was redirected inside the fixture root, so every model event changed the workspace fingerprint observed around shell calls.
- **Approaches tried:**
  - **Attempt:** Store the active canary log beside fixture files for convenience.
    - **Outcome:** Did not work
    - **Why:** Task verification correctly treated the continuously growing file as a workspace mutation.
  - **Attempt:** Store the active log in the fixture's parent evidence directory and compress it after close.
    - **Outcome:** Worked
    - **Why:** Runtime telemetry no longer changes the workspace under verification.
- **Root cause:** The test harness mixed out-of-band observer telemetry with the system under test.
- **Resolution:** Subsequent live AI-unit logs are written outside the fixture workspace and compressed with Brotli Q6 only after the process closes.
- **Verification:** The rerun checks that evidence-only shell calls do not advance the fixture mutation revision.
- **Prevention/follow-up:** Keep sessions, active logs, and observer artifacts outside any workspace-fingerprint boundary.
- **Reusable learning:** Observability files must live outside the state boundary whose mutations they measure.
- **References:** `packages/coding-agent/src/core/workspace-fingerprint.ts`
