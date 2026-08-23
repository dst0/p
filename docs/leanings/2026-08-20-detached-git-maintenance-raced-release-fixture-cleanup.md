# 2026-08-20 — Detached Git maintenance raced release-fixture cleanup

- **Status:** Resolved
- **Task/context:** Complete the full non-E2E unit gate after benchmark and
  pre-commit hardening.
- **Unexpected observation or failure:** The release-policy assertions passed,
  but recursive removal of a temporary Git fixture intermittently failed with
  `ENOTEMPTY`; a second full run reproduced the same lifecycle failure.
- **Evidence:** The directory left after the failed removal contained only a
  newly written `repo/.git/objects/info/packs`, identifying a late Git object
  maintenance writer after the release subprocess had returned.
- **Approaches tried:**
  - **Attempt:** Treat the first cleanup failure as a one-time filesystem event
    after one clean rerun.
    - **Outcome:** Failed.
    - **Why:** A later authoritative full run reproduced the same late-writer
      shape in another release fixture.
  - **Attempt:** Add generic recursive-delete retries.
    - **Outcome:** Rejected.
    - **Why:** Retrying deletion would mask the unowned background process
      rather than make fixture process ownership deterministic.
  - **Attempt:** Disable automatic and detached maintenance/GC in both the
    fixture repository and its bare remote.
    - **Outcome:** Worked.
    - **Why:** Release tests do not need optimization, and every Git writer now
      remains synchronous with the fixture lifecycle.
- **Root cause:** Git's automatic maintenance/GC policy was inherited by
  short-lived release repositories, allowing detached object-info work to race
  the test's synchronous cleanup.
- **Resolution:** Release-flow fixtures now configure `maintenance.auto=false`,
  `maintenance.autoDetach=false`, `gc.auto=0`, and `gc.autoDetach=false` on
  the local repository, bare remote, and every temporary clone created under
  the fixture root.
- **Verification:** A focused regression proves all four repository-local
  settings on the fixture repository, bare remote, and a managed clone; the
  release-flow suite and complete unit gate pass without teardown residue.
- **Prevention/follow-up:** Temporary release Git fixtures that recursively
  delete repositories, remotes, or clones must disable detached maintenance
  locally unless the test explicitly owns and joins that background lifecycle.
- **Reusable learning:** A synchronous parent Git command does not prove that
  auto-maintenance has no detached descendants; control the repository policy,
  not the delete retry count.
- **References:** `scripts/release-flow-test-fixture.js`,
  `scripts/release-flow-certificate.test.js`
