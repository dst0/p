# 2026-08-18 — Noisy verification needs a compact exit-code-preserving harness

- **Status:** Resolved
- **Task/context:** Running the monorepo unit and reinstall gates from a fresh isolated worktree during the review.
- **Unexpected observation or failure:** The first unit run failed because workspace `dist` artifacts had not been built. After building, raw unit and reinstall output exceeded the context wrapper's capture limit and produced a wrapper exit of `1` even though the retained logs contained green suite summaries and completed smoke output.
- **Evidence:** The unbuilt run reported `ERR_MODULE_NOT_FOUND` for workspace `dist` files. A compact rerun after `reinstall.sh` returned authoritative exit `0` for both the full unit harness and reinstall while preserving their closed logs as Brotli Q6 artifacts.
- **Approaches tried:**
  - **Attempt:** Stream the entire monorepo command through the model-facing wrapper.
    - **Outcome:** Did not work
    - **Why:** Multi-megabyte output hit the capture budget, making the wrapper result differ from the underlying command result.
  - **Attempt:** Redirect to a bounded temporary log, retain the command exit code, close and compress the log, and print one result line.
    - **Outcome:** Worked
    - **Why:** The underlying process completed without output backpressure or context overflow, while failures can still expose a short decisive tail.
- **Root cause:** The verification launcher mixed command execution with unbounded model-visible log transport, and a fresh workspace had not yet satisfied tests that import built package artifacts.
- **Resolution:** Build/relink with the required reinstall path, then run noisy gates through a compact harness that reports only `PASS` or `FAIL` plus the saved Brotli Q6 log path.
- **Verification:** Compact `npm run test:unit` and `./reinstall.sh` runs both returned exit `0`; `p --version` returned `0.4.224` and semantic-search smoke returned one result.
- **Prevention/follow-up:** Prepare workspace artifacts before full integration-style unit runs and keep success output to one line; on failure include only exit code and the decisive log tail.
- **Reusable learning:** Preserve the subprocess exit code separately from output capture, and compress only a closed log chunk rather than an actively appended stream.
- **References:** `test.sh`, `reinstall.sh`, `.agents/skills/test-output-discipline/SKILL.md`
