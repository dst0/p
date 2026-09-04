# 2026-09-05 — AGY audits require verified worktree identity

- **Status:** Partial
- **Task/context:** Parallel AGY release audits across several linked worktrees of the same repository.
- **Unexpected observation or failure:** Completed reports cited an older worktree and recommended test changes already present in the assigned worktree.
- **Evidence:** The evidence audit cited `p-project-instructions-terminal-handshake`, while the intended checkout was `p-project-instructions-v5-release`. The reports therefore did not establish coverage of the current changes.
- **Approaches tried:**
  - **Attempt:** Launch with a working directory and a general repository audit prompt.
    - **Outcome:** Partial
    - **Why:** Reports were produced, but some inspected or referenced a different checkout.
- **Root cause:** The observed failure was missing verification of checkout identity in the returned evidence. The exact internal reason the external agent selected another worktree is unconfirmed.
- **Resolution:** Added mandatory parent-side cwd binding, explicit prompt identity, child-side path/branch/SHA preflight, scoped dirty-state tracking, and report identity checks to `AGENTS.md`.
- **Verification:** Reviewed the policy diff. No new external AGY task was launched in this side conversation, so enforcement in a future run remains to be verified.
- **Prevention/follow-up:** Apply the rule to each launch and retry; reject mismatched reports. Any future launcher must enforce the same checks. The installed AGY binary was not modified.
- **Reusable learning:** Process completion proves neither correct checkout selection nor coverage of current uncommitted changes; bind and verify both explicitly.
- **References:** `AGENTS.md`, section `AGY / Google Antigravity worktree binding`.
