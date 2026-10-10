# 2026-09-29 — Missing targets do not make symlinks safe

- **Status:** Resolved
- **Task/context:** Validate the optional local CA file used by the certified benchmark proxy.
- **Unexpected observation or failure:** A dangling `ca.pem` symlink was treated as if no CA file existed.
- **Evidence:** The focused dangling-symlink regression failed before the fix and passed afterward.
- **Approaches tried:**
  - **Attempt:** Check existence before inspecting the file with `lstat`.
    - **Outcome:** Did not work.
    - **Why:** The existence check follows symlinks and reports false for a missing target.
- **Root cause:** A target-following existence check bypassed the link-type check for dangling links.
- **Resolution:** Call `lstat` directly; only an actual missing path is optional, and every symlink is rejected.
- **Verification:** `node --test benchmarks/test/harness/certified-proxy-ca.test.ts` passes for absent, regular, linked, dangling-linked, and directory paths.
- **Prevention/follow-up:** Keep the dangling-link regression beside the other CA boundary tests.
- **Reusable learning:** Use `lstat` for security decisions about a path itself; do not prefilter it with a target-following existence check.
- **References:** `benchmarks/src/harness/certified-proxy-ca.ts`, `benchmarks/test/harness/certified-proxy-ca.test.ts`.
