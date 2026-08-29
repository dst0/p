# 2026-08-26 — Rootless cwd-qualified paths must fail before I/O

- **Status:** Resolved
- **Task/context:** Investigating rc.41 task 3 workspace contamination during an otherwise isolated benchmark cell.
- **Unexpected observation or failure:** A model emitted the absolute workspace path without its leading root separator, so the shared resolver treated the full cwd text as a relative path and the write tool created a nested copy of the workspace path.
- **Evidence:** The recorded argument was shaped like `private/var/.../workspace/src/index.ts`; the write resolver joined it to `/private/var/.../workspace` before recursively creating parents. A literal `/private/var/...` input resolves correctly and cannot produce the nested path.
- **Approaches tried:**
  - **Attempt:** Automatically add a leading separator when a relative path resembles the cwd.
    - **Outcome:** Partial
    - **Why:** It is convenient but can silently reinterpret an intentionally named relative directory tree.
  - **Attempt:** Reject only the exact cwd-without-root prefix before resolution.
    - **Outcome:** Worked
    - **Why:** It catches the observed ambiguity before any directory or file operation while preserving normal relative paths and all rooted absolute paths.
- **Root cause:** `resolveToCwd` correctly handled absolute and relative paths, but had no fail-closed check for the uniquely dangerous hybrid of an absolute cwd copied without its root separator.
- **Resolution:** The shared tool-path resolver throws an actionable retry error for that exact shape. The guard does not impose general workspace containment or rewrite the path.
- **Verification:** Unit coverage proves the malformed path is rejected, ordinary nested relative paths still resolve, and the write tool calls neither `mkdir` nor `writeFile` after rejection.
- **Prevention/follow-up:** Keep the check in the shared resolver so read, write, and edit surfaces cannot diverge.
- **Reusable learning:** Reject rootless cwd-qualified paths before resolution; never silently guess whether a duplicated cwd prefix was intended as relative data.
- **References:** `packages/coding-agent/src/core/tools/path-utils.ts`, `packages/coding-agent/test/path-utils.test.ts`, `packages/coding-agent/test/rootless-cwd-qualified-write.test.ts`
