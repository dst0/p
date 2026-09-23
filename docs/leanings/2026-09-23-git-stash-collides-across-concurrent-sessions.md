# 2026-09-23 — `git stash` collides across concurrent sessions sharing a worktree

- **Status:** Resolved
- **Task/context:** Implementing the local/LAN host-unavailable retry budget in
  `packages/coding-agent/src/core/agent-session/agentsession-methods/retry.ts` and
  `constants.ts`. Before writing the fix, the plan required proving the new tests fail
  against the pre-fix code, then restoring the fix.
- **Unexpected observation or failure:** Used `git stash push -- <9 source files>` to
  snapshot the pre-fix baseline, ran the new tests (confirmed real failures), then ran
  `git stash pop` to restore the fix. The pop reported success (`Dropped refs/stash@{0}
  (a46b2a5...)`), but the working tree came back at a clean `HEAD` for all 9 files — the
  fix was gone — while two unrelated files
  (`packages/coding-agent/src/core/task-verification/taskverificationcontroller-methods/completion-checklist.ts`
  and `.../critical-proof-source-output.ts`) appeared modified for the first time. Those
  files were not touched by this session; a different concurrent session was working in
  the same checkout at the same time (this repo explicitly documents that multiple `p`
  sessions can run in the same cwd, each modifying different files).
- **Evidence:** `git diff --stat HEAD -- <the 9 files>` was empty immediately after the
  pop (i.e. byte-identical to `HEAD`), and `git stash list` was empty, so the stash that
  got applied and dropped was not the one this session had pushed. `git reflog` showed an
  unexplained `reset: moving to HEAD` entry around the same time, consistent with another
  process's stash/pop interleaving with this session's on the shared `.git` stash stack
  (the stash is a single global ref list per repository, not per-session).
- **Approaches tried:**
  - **Attempt:** `git stash push -- <pathspec>` then `git stash pop` to get a fail-before-fix
    proof.
    - **Outcome:** Did not work.
    - **Why:** The stash ref stack (`refs/stash`) is shared by every session/process
      operating on the same `.git` directory. A concurrent session's own stash/pop activity
      can interleave with a pathspec-scoped stash from another session, so `git stash pop`
      (which always pops the top of the stack, not "my" entry) can silently apply/drop the
      wrong changes. `AGENTS.md` already forbids `git stash` for exactly this reason
      ("destroys other agents' work"); this incident is the concrete failure mode that rule
      prevents, and it cost the recorded edits (recovered only because the exact diffs were
      still available in the conversation transcript and could be reapplied by hand).
  - **Attempt:** Manually redo the 9 edits with `Edit` calls against the confirmed-clean
    `HEAD` baseline, leaving the other session's 2 modified files untouched.
    - **Outcome:** Worked.
    - **Why:** `Edit` operates on the named file directly with no shared global state, so it
      cannot collide with another session's concurrent work the way the stash stack does.
- **Root cause:** `git stash`/`git stash pop` operate on a single global `refs/stash`
  ref per repository. In a workflow where multiple agent sessions run concurrently in the
  same working tree/`.git` directory, any session's stash push or pop can race another
  session's, silently applying or dropping the wrong stash entry with no conflict markers
  or error — the commands succeed and report a plausible-looking result.
- **Resolution:** Stopped using `git stash` entirely for this task. Redid the 9 edits
  directly from the recorded diffs, verified via `git diff --stat HEAD` that only this
  session's intended files changed, and left the other session's in-progress files alone.
- **Verification:** After reapplying, `git status --porcelain` showed exactly the 9
  intended files modified plus the 2 new test files, with the other session's 2 files
  still present and unmodified by this session's actions. The new tests
  (`test/host-unavailable-retry-classifier.test.ts`,
  `test/suite/host-unavailable-retry.test.ts`) passed against the restored fix, and
  `npm run check` passed.
- **Prevention/follow-up:** For a fail-before-fix proof in this repo, do not use
  `git stash` under any circumstances (already codified in `AGENTS.md`'s "Never run"
  list). Instead: save a patch of just the touched files
  (`git diff -- <files> > /tmp/x.patch`), `git restore -- <files>` to get the pre-fix
  baseline, run the failing tests, then `git apply /tmp/x.patch` to restore the fix. This
  never touches the shared stash stack and cannot collide with another session.
- **Reusable learning:** In a repository where concurrent sessions share one working
  tree, never use `git stash`/`git stash pop` — even scoped to a pathspec, and even
  briefly — because the stash ref stack is global and another session's stash activity
  can silently consume or reorder your entry. Use `git diff > patch file` +
  `git restore` + `git apply` for any "snapshot, mutate, restore" workflow instead.
- **References:** `AGENTS.md` "Git" section (`Never run ... git stash`);
  `packages/coding-agent/test/host-unavailable-retry-classifier.test.ts`;
  `packages/coding-agent/test/suite/host-unavailable-retry.test.ts`.
