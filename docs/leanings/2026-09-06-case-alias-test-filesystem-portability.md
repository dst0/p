# 2026-09-06 — Case-alias tests must expose native filesystem differences

- **Status:** Resolved
- **Task/context:** Verify the explicit task-budget update and the complete API v5 release branch on local macOS and Linux CI.
- **Unexpected observation or failure:** All functional tests passed, but Linux changed-line coverage was 98.98% while the same source measured 99.05% locally.
- **Evidence:** CI run `34025409241` on `da158f28188a3cabd9cb2f7728adc3d5a6f9cfd1` covered 7,927 of 8,009 changed lines. The local canonical reports covered 7,933. The six-line difference was the case-alias identity path in `evidence-critical-proof-observation.ts:251`, not budget dispatch or a compiler failure.
- **Approaches tried:**
  - **Attempt:** Rely on an existing test reading `readme.md` after creating `README.md`.
    - **Outcome:** Partial
    - **Why:** On a case-sensitive filesystem the test returned early and was reported as passed without exercising its named alias-identity behavior.
  - **Attempt:** Add real symlink substitution/recovery and distinct case-only file scenarios, and explicitly skip tests whose required native filesystem behavior is unavailable.
    - **Outcome:** Worked
    - **Why:** Symlink substitution runs on both filesystem types. Distinct case-only files exercise inode mismatch on case-sensitive filesystems; the existing positive alias test exercises native case-insensitive identity. No mocked file identities or lowered coverage threshold are used.
- **Root cause:** Native filesystem case semantics were hidden behind a silent early return, so successful local coverage was incorrectly assumed to transfer unchanged to Linux.
- **Resolution:** Make the unsupported positive case an explicit test skip. Require unsafe alias reads to retain the declared source identity and discovery failure, block mutation, and recover only after a safe canonical reread. Require a distinct case-only file to be rejected instead of adopting its contract.
- **Verification:** The focused source-safety suite passed locally with five executed cases and one explicit case-sensitive-only skip. Linux execution is performed by the normal exact-head CI run; this entry does not claim a Linux result before that run completes.
- **Prevention/follow-up:** Inspect actual changed-line differences when local and CI coverage disagree. Preserve the 99% gate and add behavior-focused native filesystem cases instead of treating an early return as a pass.
- **Reusable learning:** A filesystem-dependent test must either exercise its named behavior or explicitly report why that behavior is unavailable on the current filesystem.
- **References:** `packages/coding-agent/test/task-verification-critical-proof-source-safety.test.ts`; [failed exact-head coverage gate](https://github.com/dst0/p/actions/runs/34025409241).
