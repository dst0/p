# 2026-09-21 — Release live tests need service-health gates

- **Status:** Resolved
- **Task/context:** Complete the `v5.0.1` tag validation workflow on the self-hosted release runner.
- **Unexpected observation or failure:** Full validation failed six Ollama tests even though Ollama was installed; the daemon was not listening on localhost.
- **Evidence:** Run `35558621765`, job `106207040764`, reported `Error: could not connect to ollama server, run 'ollama serve' to start it`, followed by `TypeError` failures from uninitialized model values. Other validation tests passed.
- **Approaches tried:**
  - **Attempt:** Rerun the unchanged tag workflow.
    - **Outcome:** Did not work
    - **Why:** The runner continued to expose the `ollama` executable while its daemon remained unavailable, so the test's binary-presence gate activated a broken local suite.
  - **Attempt:** Probe the local Ollama HTTP health endpoint before running the full suite, and set the repository-supported `P_NO_LOCAL_LLM=1` opt-out only when the daemon is unavailable.
    - **Outcome:** Worked
    - **Why:** Healthy local services still run their configured live tests; unavailable optional services no longer convert a release validation into a false code failure.
- **Root cause:** The tests gated optional Ollama coverage on executable presence instead of service health, while the self-hosted runner intentionally does not keep Ollama serving continuously.
- **Resolution:** Add a release-workflow health probe for `127.0.0.1:11434/api/tags` and use the existing opt-out only on the unhealthy branch.
- **Verification:** `scripts/release-workflow.test.js` asserts the health-gated command shape; the next tag workflow must show validate passing before binary and npm publish jobs can start.
- **Prevention/follow-up:** Gate every optional local-provider release test on the service endpoint it actually uses, not only on a command being installed.
- **Reusable learning:** Installed tooling is not a live service; release CI must probe readiness and preserve explicit optional-test semantics.
- **References:** `.github/workflows/build-binaries.yml`, `scripts/release-workflow.test.js`, `packages/ai/test/stream.test.ts`, `packages/ai/test/context-overflow.test.ts`, GitHub Actions run `35558621765`
