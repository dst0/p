# 2026-09-09 — New session directories require parent fsync

- **Status:** Resolved
- **Task/context:** Make first-use session storage reachable after a machine crash.
- **Unexpected observation or failure:** Session directories were created with recursive `mkdir`, while later file publication flushed only the new session directory. The parent entry that made the directory reachable was never flushed.
- **Evidence:** An operation-order regression observed directory creation without any open/fsync of its existing parent before the fix.
- **Approaches tried:**
  - **Attempt:** Rely on file fsync and a final fsync of the session directory.
    - **Outcome:** Did not work
    - **Why:** Flushing a directory's contents does not durably commit the directory entry stored in its parent.
  - **Attempt:** Create each missing directory level separately and fsync its parent immediately after creation.
    - **Outcome:** Worked
    - **Why:** Every new path component becomes crash-durably reachable before deeper entries are added.
- **Root cause:** File publication durability and directory-tree reachability were treated as the same boundary.
- **Resolution:** Session-manager construction, default directory resolution, forking, and atomic writes share a durable directory creator that fsyncs every created component's parent on supported platforms.
- **Verification:** `session-directory-durability.test.ts` asserts exact mkdir/open/fsync ordering for two newly created levels; the existing publication-order tests continue to cover file and final-directory flushes.
- **Prevention/follow-up:** Whenever durable code creates a new directory, include the parent directory entry in the crash-consistency protocol.
- **Reusable learning:** Durably writing a file is insufficient if the newly created directory containing it is not itself durably reachable.
- **References:** `packages/coding-agent/src/core/session-manager/session-file-durability.ts`, `packages/coding-agent/src/core/session-manager/sessionmanager.ts`, `packages/coding-agent/src/core/session-manager/session-context.ts`, `packages/coding-agent/src/core/session-manager/sessionmanager-methods/forking.ts`, `packages/coding-agent/test/session-manager/session-directory-durability.test.ts`
