# 2026-09-21 — Release publish tests need the local-LLM gate

- **Status:** Resolved
- **Task/context:** Publish the certified `v5.0.2` release after binary validation succeeded.
- **Unexpected observation or failure:** The release `publish-npm` job reached its full Test step and remained in progress after validate and binary jobs were green. Validate already detected that the Ollama daemon was unavailable and set `P_NO_LOCAL_LLM=1`, but publish ran a bare `npm test`.
- **Evidence:** Workflow run `35567024414` completed validate and binary jobs successfully; `publish-npm` remained in Test without reaching trusted publishing. The publish workflow step had no Ollama probe or `P_NO_LOCAL_LLM` fallback.
- **Approaches tried:**
  - **Attempt:** Wait for the un-gated publish test.
    - **Outcome:** Did not work.
    - **Why:** Optional local-provider tests can start or wait for a service that is not part of the publish runner contract.
  - **Attempt:** Cancel the incomplete run and mirror validate's availability gate in publish.
    - **Outcome:** Worked for the pipeline design.
    - **Why:** Publish now skips only optional local LLM tests when the daemon probe fails, while retaining them when the service is healthy.
- **Root cause:** The release workflow had inconsistent local-LLM gating between validation and the npm publish job.
- **Resolution:** The publish test step now probes the local Ollama API and uses `P_NO_LOCAL_LLM=1 npm test` only when unavailable; a static regression test prevents the two jobs from drifting.
- **Verification:** The workflow regression test covers both the probe and fallback. The corrected workflow is dispatched against the immutable `v5.0.2` tag after merge.
- **Prevention/follow-up:** Keep optional service availability gates identical across all release jobs that run the test suite.
- **Reusable learning:** A release job must not run optional local-provider tests unconditionally after an earlier gate has established that the service is absent.
- **References:** `.github/workflows/build-binaries.yml`, `scripts/release-workflow.test.js`, run `35567024414`.
